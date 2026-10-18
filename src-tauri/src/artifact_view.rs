//! Artifact panel: a claude.ai artifact link clicked in a pane opens beside
//! the terminals instead of the default browser.
//!
//! The page lives in a borderless window owned by `main`, laid exactly over
//! the empty body of the React panel (the frontend reports that body in
//! physical pixels of main's client area) and moved along with `main`
//! (`follow`). An owned window stays above its owner, hides when it is
//! minimised and dies with it. A separate window rather than a child webview:
//! child webviews need Tauri's `unstable` feature, which turns every window
//! into a multi-webview one and breaks `get_webview_window("main")` and the
//! keyboard focus of the terminals.
//!
//! Each Claude account gets its own WebView2 data folder, so the window is
//! signed in to the account that published the artifact: an artifact is
//! private to that account. The page is remote: `ipc_allowed` refuses every
//! app command from it, and no capability lists it, which keeps plugins out.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::ipc::Invoke;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, State, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

const LABEL_PREFIX: &str = "artifact-view-";

#[derive(Default)]
pub struct ArtifactView {
    live: Mutex<Option<Live>>,
    /// Bumped by every show and close: a window finished building under an
    /// older generation was overtaken and is dropped.
    generation: AtomicU64,
    /// A layer of main is open over the panel. Kept apart from `live`: it can
    /// arrive before the window exists, which is then built hidden.
    hidden: AtomicBool,
}

struct Live {
    label: String,
    account: String,
    bounds: Bounds,
}

/// A fresh label per window: closing one is asynchronous, so reusing its
/// label right away could collide with the one still being torn down.
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// The panel body, in physical pixels relative to main's client area.
#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Whether a webview may call app commands: the windows of
/// `capabilities/default.json`, which load Arkadia's own pages. Plugins are
/// already refused to any other window, but Tauri checks app commands only
/// when the app ships an ACL manifest, which Arkadia does not.
pub fn ipc_allowed(webview_label: &str) -> bool {
    webview_label == "main" || webview_label.starts_with("popup-")
}

/// Wraps the app's command handler: a call from a webview `ipc_allowed`
/// refuses is rejected before any command runs.
pub fn guard<R: Runtime>(
    commands: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        if !ipc_allowed(invoke.message.webview_ref().label()) {
            invoke
                .resolver
                .reject("this window may not call Arkadia commands");
            return true;
        }
        commands(invoke)
    }
}

/// `https://claude.ai/artifact/<id>` or `https://claude.ai/code/artifact/<id>`.
fn is_artifact_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("claude.ai")
        && url.path().contains("/artifact/")
}

/// Top-level pages the panel may show: Claude and the sign-in pages it
/// redirects to. Anything else leaves for the default browser.
fn stays_in_panel(url: &Url) -> bool {
    if matches!(url.scheme(), "about" | "blob" | "data") {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    const DOMAINS: [&str; 3] = ["claude.ai", "claude.com", "anthropic.com"];
    const SIGN_IN_HOSTS: [&str; 3] = [
        "accounts.google.com",
        "accounts.youtube.com",
        "appleid.apple.com",
    ];
    DOMAINS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
        || SIGN_IN_HOSTS.contains(&host)
}

/// Folder name for an account id, safe on disk whatever the registry holds.
fn account_key(account: &str) -> String {
    let key: String = account
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if key.is_empty() {
        "main".into()
    } else {
        key
    }
}

fn data_dir(key: &str) -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("artifact-sessions")
        .join(key)
}

fn open_outside(url: &Url) {
    let _ = open::that_detached(url.as_str());
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())
}

/// Lays `window` over `bounds` of main's client area.
fn place(main: &WebviewWindow, window: &WebviewWindow, bounds: Bounds) -> tauri::Result<()> {
    let origin = main.inner_position()?;
    window.set_position(PhysicalPosition::new(
        origin.x + bounds.x.round() as i32,
        origin.y + bounds.y.round() as i32,
    ))?;
    window.set_size(PhysicalSize::new(
        bounds.width.round().max(1.0) as u32,
        bounds.height.round().max(1.0) as u32,
    ))
}

fn take_live(app: &AppHandle, state: &ArtifactView) {
    state.generation.fetch_add(1, Ordering::SeqCst);
    let old = state.live.lock().ok().and_then(|mut live| live.take());
    if let Some(window) = old.and_then(|l| app.get_webview_window(&l.label)) {
        // `destroy`, not `close`: the window refuses close requests (Alt+F4).
        let _ = window.destroy();
    }
}

/// Shows `url` beside the terminals, signed in as `account`. Async, like every
/// command here: building a window waits on the main thread, which runs the
/// sync commands, and no lock is held while it does.
#[tauri::command]
pub async fn artifact_view_show(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    url: String,
    account: String,
    bounds: Bounds,
) -> Result<(), String> {
    let url: Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    if !is_artifact_url(&url) {
        return Err(format!("not a claude.ai artifact: {url}"));
    }
    let key = account_key(&account);
    let main = main_window(&app)?;

    // Same account: its window navigates.
    let reuse = {
        let mut live = state.live.lock().map_err(|e| e.to_string())?;
        match live.as_mut() {
            Some(l) if l.account == key => {
                l.bounds = bounds;
                app.get_webview_window(&l.label)
            }
            _ => None,
        }
    };
    if let Some(window) = reuse {
        window.navigate(url).map_err(|e| e.to_string())?;
        return place(&main, &window, bounds).map_err(|e| e.to_string());
    }

    // Another account, or none yet: a new window on that account's folder.
    take_live(&app, &state);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main.inner_position().map_err(|e| e.to_string())?;
    let label = format!("{LABEL_PREFIX}{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .parent(&main)
        .map_err(|e| e.to_string())?
        .data_directory(data_dir(&key))
        .title("Artefact")
        .decorations(false)
        .shadow(false)
        .resizable(false)
        // Win+Up/Down or Alt+F4 would detach it from the panel for good.
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .visible(!state.hidden.load(Ordering::SeqCst))
        // Shown without taking the keyboard from the terminal that was clicked.
        .focused(false)
        .position(
            (origin.x as f64 + bounds.x) / scale,
            (origin.y as f64 + bounds.y) / scale,
        )
        .inner_size(bounds.width.max(1.0) / scale, bounds.height.max(1.0) / scale)
        .on_navigation(|url| {
            let keep = stays_in_panel(url);
            if !keep {
                open_outside(url);
            }
            keep
        })
        .on_new_window(|url, _features| {
            // Sign-in popups stay in WebView2; any other link opens outside.
            if stays_in_panel(&url) {
                NewWindowResponse::Allow
            } else {
                open_outside(&url);
                NewWindowResponse::Deny
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    // Alt+F4 in the page: the panel's own Close button is the way out.
    window.on_window_event(|event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });

    {
        // Never held across a call that waits on the main thread: `follow`
        // runs there and takes this lock.
        let mut live = state.live.lock().map_err(|e| e.to_string())?;
        if state.generation.load(Ordering::SeqCst) != generation {
            // A newer show or a close came in while this window was being built.
            drop(live);
            let _ = window.destroy();
            return Ok(());
        }
        *live = Some(Live {
            label,
            account: key,
            bounds,
        });
    }
    // The builder works in logical units: settle on the exact physical pixels.
    place(&main, &window, bounds).map_err(|e| e.to_string())?;
    // A layer may have opened or closed over the panel during the build.
    apply_hidden(&window, state.hidden.load(Ordering::SeqCst))
}

/// Shows or hides the window. Showing does not activate it: it was built
/// with `focused(false)`, which tao keeps for every later show.
fn apply_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
    if hidden {
        window.hide().map_err(|e| e.to_string())
    } else {
        window.show().map_err(|e| e.to_string())
    }
}

/// Follows the panel body when it is resized or the scale changes.
#[tauri::command]
pub async fn artifact_view_place(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    bounds: Bounds,
) -> Result<(), String> {
    let window = {
        let mut live = state.live.lock().map_err(|e| e.to_string())?;
        let Some(l) = live.as_mut() else {
            return Ok(());
        };
        l.bounds = bounds;
        app.get_webview_window(&l.label)
    };
    match window {
        Some(window) => place(&main_window(&app)?, &window, bounds).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Moves the window along with `main` (its move and resize events).
pub fn follow(app: &AppHandle) {
    let Some(state) = app.try_state::<ArtifactView>() else {
        return;
    };
    let target = state.live.lock().ok().and_then(|live| {
        live.as_ref()
            .and_then(|l| app.get_webview_window(&l.label).map(|w| (w, l.bounds)))
    });
    if let (Some((window, bounds)), Ok(main)) = (target, main_window(app)) {
        let _ = place(&main, &window, bounds);
    }
}

/// Whether the artifact window has the keyboard: Arkadia is then in front.
pub fn has_focus(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<ArtifactView>() else {
        return false;
    };
    let label = state
        .live
        .lock()
        .ok()
        .and_then(|live| live.as_ref().map(|l| l.label.clone()));
    label
        .and_then(|label| app.get_webview_window(&label))
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

/// Hides the window while a layer of `main` (dialog, menu, image viewer,
/// notepad) is open, since a separate window always covers it.
#[tauri::command]
pub async fn artifact_view_set_hidden(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    hidden: bool,
) -> Result<(), String> {
    state.hidden.store(hidden, Ordering::SeqCst);
    let label = state
        .live
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|l| l.label.clone());
    match label.and_then(|label| app.get_webview_window(&label)) {
        Some(window) => apply_hidden(&window, hidden),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn artifact_view_reload(
    app: AppHandle,
    state: State<'_, ArtifactView>,
) -> Result<(), String> {
    let label = state
        .live
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|l| l.label.clone());
    match label.and_then(|label| app.get_webview_window(&label)) {
        Some(window) => window.reload().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Closes the window with the panel; the account's sign-in stays on disk.
#[tauri::command]
pub async fn artifact_view_close(
    app: AppHandle,
    state: State<'_, ArtifactView>,
) -> Result<(), String> {
    take_live(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn recognises_both_artifact_link_shapes_only() {
        assert!(is_artifact_url(&url(
            "https://claude.ai/artifact/QXVbCtb1dyAMJHWDbZpB4d"
        )));
        assert!(is_artifact_url(&url("https://claude.ai/code/artifact/0b4f-uuid")));
        assert!(!is_artifact_url(&url("https://claude.ai/chat/123")));
        assert!(!is_artifact_url(&url("http://claude.ai/artifact/x")));
        assert!(!is_artifact_url(&url("https://claude.ai.evil.com/artifact/x")));
    }

    #[test]
    fn keeps_claude_and_sign_in_pages_sends_the_rest_outside() {
        assert!(stays_in_panel(&url("https://claude.ai/login")));
        assert!(stays_in_panel(&url("https://accounts.google.com/o/oauth2")));
        assert!(!stays_in_panel(&url("https://mail.google.com/")));
        assert!(!stays_in_panel(&url("https://abc.claudeusercontent.com/x")));
        assert!(!stays_in_panel(&url("https://github.com/TRINITXX")));
        assert!(!stays_in_panel(&url("https://evilclaude.ai/")));
        assert!(!stays_in_panel(&url("http://claude.ai/")));
    }

    #[test]
    fn account_folder_names_cannot_escape_the_sessions_dir() {
        assert_eq!(account_key("6c78197d"), "6c78197d");
        assert_eq!(account_key("main"), "main");
        assert_eq!(account_key("../../x"), "x");
        assert_eq!(account_key(""), "main");
    }

    #[test]
    fn only_arkadia_own_windows_may_call_app_commands() {
        assert!(ipc_allowed("main"));
        assert!(ipc_allowed("popup-12"));
        assert!(!ipc_allowed("artifact-view-3"));
        assert!(!ipc_allowed("any-future-window"));
    }
}
