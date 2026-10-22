//! Artifact panel: claude.ai artifacts open beside the terminals instead of
//! the default browser, one tab of the panel per artifact.
//!
//! Each artifact is a borderless window owned by `main`, laid exactly over
//! the empty body of the React panel (the frontend reports that body in
//! physical pixels of main's client area) and moved along with `main`
//! (`follow`). Only the artifact of the panel's active tab is shown; the
//! others stay built and hidden, so switching tabs keeps their page as it
//! was. An owned window stays above its owner, hides when it is minimised and
//! dies with it. Separate windows rather than child webviews: child webviews
//! need Tauri's `unstable` feature, which turns every window into a
//! multi-webview one and breaks `get_webview_window("main")` and the keyboard
//! focus of the terminals.
//!
//! Each Claude account gets its own WebView2 data folder, so a window is
//! signed in to the account that published its artifact: an artifact is
//! private to that account. The pages are remote: `ipc_allowed` refuses every
//! app command from them, and no capability lists them, which keeps plugins
//! out.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Invoke;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

const LABEL_PREFIX: &str = "artifact-view-";

#[derive(Default)]
pub struct ArtifactView {
    inner: Mutex<Inner>,
    /// A layer of main is open over the panel. Kept apart from `inner`: it
    /// can arrive while a window is being built, which is then shown hidden.
    hidden: AtomicBool,
}

#[derive(Default)]
struct Inner {
    /// Built windows by artifact key (one per tab of the panel): their labels.
    windows: HashMap<String, String>,
    /// Builds in flight by key, with their ticket: a close (or a newer open of
    /// the same key) while a window is being built drops that window.
    building: HashMap<String, u64>,
    /// The artifact on screen, if the panel shows one.
    active: Option<String>,
    /// The panel body, for windows built or shown later.
    bounds: Option<Bounds>,
}

/// Tickets of builds, and suffixes of labels: closing a window is
/// asynchronous, so a label is never reused.
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// The panel body, in physical pixels relative to main's client area.
#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize, Clone)]
struct TitleChanged {
    key: String,
    title: String,
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
pub(crate) fn is_artifact_url(url: &Url) -> bool {
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

/// Host of the signal an artifact sends once a reply went to Claude: a link
/// that never loads (`.invalid`), caught by `on_new_window`.
const SENT_HOST: &str = "arkadia.invalid";

/// Runs in claude.ai's page and in the artifact's frames. The artifact kit
/// (`artefact-visuel`) fires `k:sent` once a reply reached Claude; the frame
/// passes it up to claude.ai's page, which opens the signal link. A window,
/// not a navigation: leaving claude.ai's page could ask to confirm.
const SENT_BRIDGE: &str = r#"(() => {
  if (window.top === window) {
    addEventListener('message', (e) => {
      if (e.data && e.data.arkadia === 'k:sent') window.open('https://arkadia.invalid/artifact-sent');
    });
  } else {
    addEventListener('k:sent', () => window.top.postMessage({ arkadia: 'k:sent' }, '*'));
  }
})();"#;

fn is_sent_signal(url: &Url) -> bool {
    url.host_str() == Some(SENT_HOST)
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

/// Shows or hides a window. Showing does not activate it: it was built with
/// `focused(false)`, which tao keeps for every later show.
fn apply_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
    if hidden {
        window.hide().map_err(|e| e.to_string())
    } else {
        window.show().map_err(|e| e.to_string())
    }
}

fn hide_label(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

/// `destroy`, not `close`: the windows refuse close requests (Alt+F4).
fn destroy_label(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
}

/// The window of the artifact on screen, if the panel shows one.
pub(crate) fn active_window(app: &AppHandle, state: &ArtifactView) -> Option<WebviewWindow> {
    let label = {
        let inner = state.inner.lock().ok()?;
        let key = inner.active.as_ref()?;
        inner.windows.get(key).cloned()?
    };
    app.get_webview_window(&label)
}

/// Puts artifact `key` on screen, signed in as `account`: built on first
/// show, reloaded when `reload` (Claude published it again),
/// otherwise shown as it was left. Async, like the other commands here:
/// building a window waits on the main thread, and no lock is held while it
/// does, since `follow` runs there and takes the lock.
// Tauri commands take each argument from the page as its own parameter, like
// `terminal.rs`'s commands.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn artifact_view_show(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    key: String,
    url: String,
    account: String,
    bounds: Bounds,
    reload: bool,
    // Whether a layer of main covers the panel right now: the panel sends it
    // with each show, so a show never acts on a stale value.
    hidden: bool,
) -> Result<(), String> {
    let url: Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    if !is_artifact_url(&url) {
        return Err(format!("not a claude.ai artifact: {url}"));
    }
    let main = main_window(&app)?;
    state.hidden.store(hidden, Ordering::SeqCst);

    let (existing, previous) = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.bounds = Some(bounds);
        let previous = inner
            .active
            .replace(key.clone())
            .filter(|k| *k != key)
            .and_then(|k| inner.windows.get(&k).cloned());
        (inner.windows.get(&key).cloned(), previous)
    };
    if let Some(label) = previous {
        hide_label(&app, &label);
    }
    if let Some(window) = existing.and_then(|label| app.get_webview_window(&label)) {
        if reload {
            window.navigate(url).map_err(|e| e.to_string())?;
        }
        place(&main, &window, bounds).map_err(|e| e.to_string())?;
        // Placing waited on the main thread: decide on what holds now (the
        // panel may have left, another artifact come forward, a layer opened).
        return show_if_current(&state, &key, &window);
    }

    // First show of this artifact: a window on its account's folder.
    let ticket = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    state
        .inner
        .lock()
        .map_err(|e| e.to_string())?
        .building
        .insert(key.clone(), ticket);
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main.inner_position().map_err(|e| e.to_string())?;
    let label = format!("{LABEL_PREFIX}{ticket}");
    let title_app = app.clone();
    let title_key = key.clone();
    let sent_app = app.clone();
    let sent_key = key.clone();
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .parent(&main)
        .map_err(|e| e.to_string())?
        .data_directory(data_dir(&account_key(&account)))
        .title("Artefact")
        .decorations(false)
        .shadow(false)
        .resizable(false)
        // Win+Up/Down or Alt+F4 would detach it from the panel for good.
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .visible(false)
        // Shown without taking the keyboard from the terminal in use.
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
        .initialization_script_for_all_frames(SENT_BRIDGE)
        .on_new_window(move |url, _features| {
            // The artifact sent its reply to Claude: the panel closes it.
            if is_sent_signal(&url) {
                let _ = sent_app.emit_to("main", "artifact-sent", sent_key.clone());
                return NewWindowResponse::Deny;
            }
            // Sign-in popups stay in WebView2; any other link opens outside.
            if stays_in_panel(&url) {
                NewWindowResponse::Allow
            } else {
                open_outside(&url);
                NewWindowResponse::Deny
            }
        })
        // The tab of the panel shows the page's own title.
        .on_document_title_changed(move |_window, title| {
            let _ = title_app.emit_to(
                "main",
                "artifact-title",
                TitleChanged {
                    key: title_key.clone(),
                    title,
                },
            );
        })
        .build()
        .map_err(|e| e.to_string())?;
    window.on_window_event(|event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });

    let (on_screen, bounds) = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        if inner.building.get(&key) != Some(&ticket) {
            // Closed, or opened again, while this window was being built.
            drop(inner);
            let _ = window.destroy();
            return Ok(());
        }
        inner.building.remove(&key);
        inner.windows.insert(key.clone(), label);
        (
            inner.active.as_deref() == Some(key.as_str()),
            inner.bounds.unwrap_or(bounds),
        )
    };
    // The builder works in logical units: settle on the exact physical pixels.
    place(&main, &window, bounds).map_err(|e| e.to_string())?;
    if !on_screen {
        return Ok(());
    }
    // A layer may have opened or the panel left during the build and placing.
    show_if_current(&state, &key, &window)
}

/// Shows `window` only if its artifact is still the one on screen and no
/// layer covers the panel; hides it otherwise. Decided and sent under the
/// lock, so a `hide_all` cannot slip in between: show and hide only post a
/// message to the main thread, they never wait on it.
fn show_if_current(state: &ArtifactView, key: &str, window: &WebviewWindow) -> Result<(), String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let current = inner.active.as_deref() == Some(key);
    apply_hidden(window, !current || state.hidden.load(Ordering::SeqCst))
}

/// The panel left the screen (its tab has no artifact, or it closed): every
/// artifact window hides and keeps its page for when the tab comes back.
#[tauri::command]
pub async fn artifact_view_hide_all(
    app: AppHandle,
    state: State<'_, ArtifactView>,
) -> Result<(), String> {
    let labels: Vec<String> = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.active = None;
        inner.windows.values().cloned().collect()
    };
    for label in labels {
        hide_label(&app, &label);
    }
    Ok(())
}

/// Follows the panel body when it is resized or the scale changes.
#[tauri::command]
pub async fn artifact_view_place(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    bounds: Bounds,
) -> Result<(), String> {
    let label = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.bounds = Some(bounds);
        let active = inner.active.clone();
        active.and_then(|k| inner.windows.get(&k).cloned())
    };
    match label.and_then(|label| app.get_webview_window(&label)) {
        Some(window) => place(&main_window(&app)?, &window, bounds).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Moves the artifact on screen along with `main` (its move and resize events).
pub fn follow(app: &AppHandle) {
    let Some(state) = app.try_state::<ArtifactView>() else {
        return;
    };
    let target = state.inner.lock().ok().and_then(|inner| {
        let label = inner
            .active
            .as_ref()
            .and_then(|k| inner.windows.get(k).cloned())?;
        Some((label, inner.bounds?))
    });
    let Some((label, bounds)) = target else {
        return;
    };
    if let (Some(window), Ok(main)) = (app.get_webview_window(&label), main_window(app)) {
        let _ = place(&main, &window, bounds);
    }
}

/// Whether an artifact window has the keyboard: Arkadia is then in front.
pub fn has_focus(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<ArtifactView>() else {
        return false;
    };
    let labels: Vec<String> = state
        .inner
        .lock()
        .map(|inner| inner.windows.values().cloned().collect())
        .unwrap_or_default();
    labels.iter().any(|label| {
        app.get_webview_window(label)
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
    })
}

/// Hides the artifact on screen while a layer of `main` (dialog, menu, image
/// viewer, notepad) is open, since a separate window always covers it.
#[tauri::command]
pub async fn artifact_view_set_hidden(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    hidden: bool,
) -> Result<(), String> {
    state.hidden.store(hidden, Ordering::SeqCst);
    let label = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner
            .active
            .as_ref()
            .and_then(|k| inner.windows.get(k).cloned())
    };
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
    let label = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner
            .active
            .as_ref()
            .and_then(|k| inner.windows.get(k).cloned())
    };
    match label.and_then(|label| app.get_webview_window(&label)) {
        Some(window) => window.reload().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Closes one artifact for good (its tab was closed); the account's sign-in
/// stays on disk.
#[tauri::command]
pub async fn artifact_view_close(
    app: AppHandle,
    state: State<'_, ArtifactView>,
    key: String,
) -> Result<(), String> {
    let label = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.building.remove(&key);
        if inner.active.as_deref() == Some(key.as_str()) {
            inner.active = None;
        }
        inner.windows.remove(&key)
    };
    if let Some(label) = label {
        destroy_label(&app, &label);
    }
    Ok(())
}

/// Closes every artifact: a reload of main's page forgets the panel.
#[tauri::command]
pub async fn artifact_view_close_all(
    app: AppHandle,
    state: State<'_, ArtifactView>,
) -> Result<(), String> {
    let labels: Vec<String> = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.building.clear();
        inner.active = None;
        inner.windows.drain().map(|(_, label)| label).collect()
    };
    for label in labels {
        destroy_label(&app, &label);
    }
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
    fn the_bridge_opens_the_link_the_panel_catches() {
        let link = SENT_BRIDGE
            .split('\'')
            .find(|s| s.starts_with("https://"))
            .unwrap();
        assert!(is_sent_signal(&url(link)));
        assert!(!is_sent_signal(&url("https://claude.ai/artifact/x")));
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
