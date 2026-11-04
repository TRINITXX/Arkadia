//! Chrome panel: the real Chrome window of a session (the Chrome profile
//! paired with the pane's Claude account) laid over the artifact panel's
//! body, as a tab of that panel, instead of Claude in Chrome pulling Chrome
//! in front. Design and the facts measured before building it:
//! `docs/superpowers/specs/2026-11-04-chrome-panel-design.md`.
//!
//! - One window per pane (`key` = `chrome:<paneId>`), launched by Arkadia in
//!   the pane's profile. Only the window on screen is owned by main (owned
//!   windows hide with their owner, and Chrome draws nothing hidden or
//!   minimized: Claude's screenshots would time out). Every other one is
//!   parked off-screen, unowned, where Chrome still draws it.
//! - Claude in Chrome puts a session's tab group in the profile's last
//!   focused window. Before the session's tool calls (`chrome-inbox`), the
//!   pane's window is "steered" to be that window: activated an instant,
//!   only while an Arkadia window has the foreground, never over another app.
//! - The window is laid wider than the panel by its caption buttons, which
//!   a window region clips: Chrome draws its own minimize/maximize/close.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// The panel body, in physical pixels relative to main's client area.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// A window laid out in screen pixels, with the width its region shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Layout {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    /// The visible part, from the window's left edge: the rest holds
    /// Chrome's caption buttons.
    shown: i32,
}

/// Width of Chrome's three caption buttons, in device-independent pixels
/// (46 each, measured on Chrome 156), plus a margin.
const CAPTION_BUTTONS_DIP: i32 = 3 * 46 + 4;

/// Where `bounds` (relative to main's client origin `origin`) lays a Chrome
/// window at `dpi`: as wide as the panel plus the caption buttons, which the
/// region leaves out.
fn layout(origin: (i32, i32), bounds: Bounds, dpi: u32) -> Layout {
    let shown = bounds.width.round().max(1.0) as i32;
    let buttons = CAPTION_BUTTONS_DIP * dpi.max(96) as i32 / 96;
    Layout {
        x: origin.0 + bounds.x.round() as i32,
        y: origin.1 + bounds.y.round() as i32,
        width: shown + buttons,
        height: bounds.height.round().max(1.0) as i32,
        shown,
    }
}

/// A parked window's top-left: left of the whole virtual screen, so no
/// monitor ever shows it, at the same size Chrome keeps drawing at.
fn park_position(virtual_left: i32, virtual_top: i32, width: i32) -> (i32, i32) {
    (virtual_left - width - 400, virtual_top)
}

/// Chrome's AppUserModelID for a profile folder: its windows carry it.
fn app_id_of(profile_dir: &str) -> String {
    if profile_dir == "Default" {
        "Chrome".into()
    } else {
        format!("Chrome.UserData.{}", profile_dir.replace(' ', ""))
    }
}

/// A request id from the inbox: it names files, so only plain characters.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Launches so far, for a unique first page per launched window.
static NEXT_LAUNCH: AtomicU64 = AtomicU64::new(1);

/// The title of a launched window's first page: unique to this launch.
fn launch_title(pid: u32, n: u64) -> String {
    format!("Arkadia-{pid}-{n}")
}

/// Whether a window title is that page's: Chrome shows "<page> - Google
/// Chrome", with the profile's name after it when several exist.
fn is_launched_window(window_title: &str, page_title: &str) -> bool {
    window_title == page_title || window_title.starts_with(&format!("{page_title} - "))
}

/// Whether a request must steer the pane's window before Claude's call: a
/// new window, a profile used outside Arkadia since, or another window of
/// the profile steered last (another session's).
fn needs_steer(created: bool, dirty: bool, last_steered: Option<isize>, hwnd: isize) -> bool {
    created || dirty || last_steered != Some(hwnd)
}

#[derive(Clone, Debug)]
struct Win {
    hwnd: isize,
    profile_dir: String,
    /// Where it was last laid, to tell Chrome's own moves from ours.
    at: Option<Layout>,
}

#[derive(Default)]
struct Inner {
    windows: HashMap<String, Win>,
    /// The pane whose window the panel shows.
    active: Option<String>,
    bounds: Option<Bounds>,
    /// A layer of main covers the panel.
    hidden: bool,
    /// Per profile folder: the window last made its last-focused one.
    steered: HashMap<String, isize>,
    /// Profile folders whose window Alexis used outside Arkadia since.
    dirty: HashSet<String>,
    /// Panes closed while their window was still launching: it closes as
    /// soon as it appears.
    closed: HashSet<String>,
}

#[derive(Default)]
pub struct ChromeView {
    inner: Mutex<Inner>,
    /// One launch at a time: a new window is found by what it adds.
    launching: Mutex<()>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    /// The Chrome profile's display name, for the panel's tab.
    profile: String,
    /// Whether Claude's tab group lands in this window: false when Arkadia
    /// could not make it the profile's last-focused window (not in front).
    steered: bool,
    /// No window of the profile was open: its extension is only starting.
    profile_started: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChromeRequest {
    id: String,
    pane_id: String,
}

#[derive(Serialize, Clone)]
struct ChromeClosed {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestFile {
    id: String,
    pane_id: String,
}

fn inbox_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join(if crate::lab::LAB {
            "chrome-inbox-lab"
        } else {
            "chrome-inbox"
        })
}

/// Answers the hook waiting on request `id`.
fn write_ack(id: &str, prepared: Option<&Prepared>) {
    if !valid_id(id) {
        return;
    }
    let body = match prepared {
        Some(p) => serde_json::to_string(p).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    };
    let dir = inbox_dir();
    let tmp = dir.join(format!("{id}.ack.tmp"));
    if std::fs::write(&tmp, body).is_ok() {
        let _ = std::fs::rename(&tmp, dir.join(format!("{id}.ack")));
    }
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

/// Main's client origin in screen pixels, or None while it can't show the
/// panel (minimized, gone).
fn main_origin(app: &AppHandle) -> Option<(i32, i32)> {
    let main = main_window(app)?;
    if main.is_minimized().unwrap_or(true) {
        return None;
    }
    let p = main.inner_position().ok()?;
    Some((p.x, p.y))
}

/// Main's window handle, for every thread: Tauri's `hwnd()` waits on the
/// main thread, which the hook thread must never do while it holds the
/// lock. Set when main is wired, cleared when it goes (watchdog rebuild).
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn set_main(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    if let Ok(h) = window.hwnd() {
        MAIN_HWND.store(h.0 as isize, Ordering::SeqCst);
    }
    #[cfg(not(windows))]
    let _ = window;
}

fn main_hwnd(_: &AppHandle) -> Option<isize> {
    let h = MAIN_HWND.load(Ordering::SeqCst);
    (h != 0).then_some(h)
}

/// Lays every window where it belongs: the active one over the panel
/// (owned by main), the others parked.
fn arrange(app: &AppHandle, state: &ChromeView) {
    #[cfg(windows)]
    {
        let owner = main_hwnd(app);
        let origin = main_origin(app);
        let Ok(mut inner) = state.inner.lock() else {
            return;
        };
        let show = match (&inner.active, inner.bounds, origin, inner.hidden) {
            (Some(key), Some(bounds), Some(origin), false) => Some((key.clone(), bounds, origin)),
            _ => None,
        };
        let keys: Vec<String> = inner.windows.keys().cloned().collect();
        for key in keys {
            let Some(win) = inner.windows.get_mut(&key) else {
                continue;
            };
            match (&show, owner) {
                (Some((active, bounds, origin)), Some(owner)) if *active == key => {
                    let dpi = win::dpi(win.hwnd);
                    let at = layout(*origin, *bounds, dpi);
                    win::lay(win.hwnd, owner, at);
                    win.at = Some(at);
                }
                _ => {
                    win::park(win.hwnd);
                    win.at = None;
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
    }
}

/// The window of pane `key`, launched in the profile of `account` when it
/// has none (or its window was closed). Returns it with whether it is new
/// and whether no window of the profile was open before.
fn ensure(
    app: &AppHandle,
    state: &ChromeView,
    key: &str,
    account: &str,
) -> Result<(Win, bool, bool), String> {
    if let Some(win) = state
        .inner
        .lock()
        .ok()
        .and_then(|i| i.windows.get(key).cloned())
    {
        if win::alive(win.hwnd) {
            return Ok((win, false, false));
        }
    }
    if state.inner.lock().is_ok_and(|i| i.closed.contains(key)) {
        return Err("pane closed".into());
    }
    let dir = crate::chrome_profile::profile_dir_for_account(account)
        .ok_or_else(|| "no Chrome profile paired with this account".to_string())?;
    let _launch = state.launching.lock().map_err(|e| e.to_string())?;
    // Another call may have launched it while this one waited.
    if let Some(win) = state
        .inner
        .lock()
        .ok()
        .and_then(|i| i.windows.get(key).cloned())
    {
        if win::alive(win.hwnd) {
            return Ok((win, false, false));
        }
    }
    let app_id = app_id_of(&dir);
    let profile_started = !win::browser_windows()
        .iter()
        .any(|(_, id, _)| id.as_deref() == Some(&app_id));
    // The new window is found by the title of its first page, unique to this
    // launch: a window Chrome restores, or one Alexis opens meanwhile, is not it.
    let title = launch_title(
        std::process::id(),
        NEXT_LAUNCH.fetch_add(1, Ordering::Relaxed),
    );
    if !crate::chrome_profile::launch_window(&dir, &title) {
        return Err("Chrome could not be started".into());
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let hwnd = loop {
        let found = win::browser_windows()
            .into_iter()
            .find(|(_, _, text)| is_launched_window(text, &title));
        if let Some((h, _, _)) = found {
            break h;
        }
        if std::time::Instant::now() > deadline {
            return Err("Chrome opened no window".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    };
    win::adopt(hwnd);
    win::park(hwnd);
    let win = Win {
        hwnd,
        profile_dir: dir,
        at: None,
    };
    let pane_gone = state.inner.lock().is_ok_and(|mut inner| {
        if inner.closed.remove(key) {
            return true;
        }
        inner.windows.insert(key.to_string(), win.clone());
        false
    });
    if pane_gone {
        win::close(hwnd);
        return Err("pane closed".into());
    }
    win::watch_process(hwnd);
    arrange(app, state);
    Ok((win, true, profile_started))
}

/// Makes `win` its profile's last-focused window when that may be needed
/// and Arkadia is in front. Returns whether Claude's group lands there.
fn steer(state: &ChromeView, win: &Win, created: bool) -> bool {
    let (dirty, last) = match state.inner.lock() {
        Ok(inner) => (
            inner.dirty.contains(&win.profile_dir),
            inner.steered.get(&win.profile_dir).copied(),
        ),
        Err(_) => return false,
    };
    if !needs_steer(created, dirty, last, win.hwnd) {
        return true;
    }
    // The profile's only window: Claude's group can land nowhere else.
    let app_id = app_id_of(&win.profile_dir);
    let alone = win::browser_windows()
        .iter()
        .filter(|(_, id, _)| id.as_deref() == Some(app_id.as_str()))
        .all(|(h, _, _)| *h == win.hwnd);
    if !alone && !win::activate_briefly(win.hwnd) {
        return false;
    }
    if let Ok(mut inner) = state.inner.lock() {
        inner.dirty.remove(&win.profile_dir);
        inner.steered.insert(win.profile_dir.clone(), win.hwnd);
    }
    true
}

fn profile_label(account: &str) -> String {
    crate::chrome_profile::profile_name_for_account(account).unwrap_or_else(|| "Chrome".into())
}

/// The panel shows pane `key`'s window (launched on first show).
#[tauri::command]
pub async fn chrome_view_show(
    app: AppHandle,
    key: String,
    account: String,
    bounds: Bounds,
    hidden: bool,
) -> Result<Prepared, String> {
    {
        let state = app.state::<ChromeView>();
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.active = Some(key.clone());
        inner.bounds = Some(bounds);
        inner.hidden = hidden;
    }
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<ChromeView>();
        let ensured = ensure(&worker, &state, &key, &account);
        // Even on a failure: the window shown before leaves the body.
        arrange(&worker, &state);
        let (win, created, profile_started) = ensured?;
        // Alexis just asked for it: Arkadia is in front, the group of the
        // next Claude call lands here.
        let steered = steer(&state, &win, created);
        Ok(Prepared {
            profile: profile_label(&account),
            steered,
            profile_started,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Before Claude's tool call in pane `key` (inbox request `id`): the pane's
/// window exists and is steered; the waiting hook gets its answer.
#[tauri::command]
pub async fn chrome_view_prepare(
    app: AppHandle,
    id: String,
    key: String,
    account: String,
) -> Result<Prepared, String> {
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<ChromeView>();
        let (win, created, profile_started) = ensure(&worker, &state, &key, &account)?;
        let steered = steer(&state, &win, created);
        Ok::<_, String>(Prepared {
            profile: profile_label(&account),
            steered,
            profile_started,
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    // This instance owns the pane: the request is answered and taken.
    if valid_id(&id) {
        let _ = std::fs::remove_file(inbox_dir().join(format!("{id}.json")));
    }
    write_ack(&id, result.as_ref().ok());
    result
}

/// Lays the windows out again on a worker thread: laying a window out may
/// wait on Chrome's thread, never on Arkadia's main thread (window events
/// run there).
fn spawn_arrange(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(state) = app.try_state::<ChromeView>() {
            arrange(&app, &state);
        }
    });
}

/// Applies `change` now, in the order the commands came (a hide then a
/// show must end shown), then lays the windows out. Commands only: they
/// run off the main thread, which never waits on this lock.
fn rearrange(app: &AppHandle, change: impl FnOnce(&mut Inner)) {
    if let Some(state) = app.try_state::<ChromeView>() {
        if let Ok(mut inner) = state.inner.lock() {
            change(&mut inner);
        }
    }
    spawn_arrange(app);
}

#[tauri::command]
pub async fn chrome_view_place(app: AppHandle, bounds: Bounds) {
    rearrange(&app, move |inner| inner.bounds = Some(bounds));
}

/// The panel shows something else, or closed: every window is parked.
#[tauri::command]
pub async fn chrome_view_hide(app: AppHandle) {
    rearrange(&app, |inner| inner.active = None);
}

/// A layer of main covers the panel (dialog, menu, image viewer).
#[tauri::command]
pub async fn chrome_view_set_hidden(app: AppHandle, hidden: bool) {
    rearrange(&app, move |inner| inner.hidden = hidden);
}

/// Pane `key` closed: its window closes (connections stay in the profile).
#[tauri::command]
pub async fn chrome_view_close(app: AppHandle, key: String) {
    let state = app.state::<ChromeView>();
    let win = state.inner.lock().ok().and_then(|mut inner| {
        if inner.active.as_deref() == Some(key.as_str()) {
            inner.active = None;
        }
        let win = inner.windows.remove(&key);
        if win.is_none() {
            // Maybe still launching: it closes when it appears.
            inner.closed.insert(key.clone());
        }
        win
    });
    if let Some(win) = win {
        win::close(win.hwnd);
    }
}

/// The panes that have a window: a reloaded page learns them again, so they
/// still close with their pane.
#[tauri::command]
pub async fn chrome_view_keys(app: AppHandle) -> Vec<String> {
    app.state::<ChromeView>()
        .inner
        .lock()
        .map(|inner| inner.windows.keys().cloned().collect())
        .unwrap_or_default()
}

/// Every window closes (page reload, Arkadia exit).
#[tauri::command]
pub async fn chrome_view_close_all(app: AppHandle) {
    close_all(&app.state::<ChromeView>());
}

fn close_all(state: &ChromeView) {
    let wins: Vec<Win> = state
        .inner
        .lock()
        .map(|mut inner| {
            inner.active = None;
            inner.windows.drain().map(|(_, w)| w).collect()
        })
        .unwrap_or_default();
    for win in wins {
        win::close(win.hwnd);
    }
}

/// Main moved, resized, minimized or restored: the windows follow.
pub fn follow(app: &AppHandle) {
    spawn_arrange(app);
}

/// Main was destroyed (watchdog rebuild): no window stays owned by it. With
/// no main handle, the layout parks every window, off the main thread.
pub fn release(app: &AppHandle) {
    MAIN_HWND.store(0, Ordering::SeqCst);
    spawn_arrange(app);
}

/// Whether the foreground window is the panel's Chrome on screen: Alexis is
/// in Arkadia, typing in it.
pub fn shown_has_foreground(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<ChromeView>() else {
        return false;
    };
    let shown: Vec<isize> = state
        .inner
        .lock()
        .map(|inner| {
            inner
                .windows
                .values()
                .filter(|w| w.at.is_some())
                .map(|w| w.hwnd)
                .collect()
        })
        .unwrap_or_default();
    win::foreground().is_some_and(|fg| shown.contains(&fg))
}

pub fn on_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<ChromeView>() {
        close_all(&state);
    }
    // Another Arkadia sharing the folder may have written it since.
    let ready = inbox_dir().join("ready");
    let ours = std::fs::read_to_string(&ready)
        .is_ok_and(|pid| pid.trim() == std::process::id().to_string());
    if ours {
        let _ = std::fs::remove_file(ready);
    }
}

// ---- Events from the hook thread (`win`) ----------------------------------

/// The foreground went to a Chrome window: one of the panel's (it is now
/// its profile's last-focused window), or one of Alexis's (its profile is
/// dirty until the next steer).
fn on_foreground(app: &AppHandle, hwnd: isize, app_id: Option<String>) {
    let Some(state) = app.try_state::<ChromeView>() else {
        return;
    };
    let Ok(mut inner) = state.inner.lock() else {
        return;
    };
    if let Some(dir) = inner
        .windows
        .values()
        .find(|w| w.hwnd == hwnd)
        .map(|w| w.profile_dir.clone())
    {
        inner.dirty.remove(&dir);
        inner.steered.insert(dir, hwnd);
        return;
    }
    let Some(app_id) = app_id else {
        return;
    };
    let dirs: Vec<String> = inner
        .windows
        .values()
        .map(|w| w.profile_dir.clone())
        .filter(|d| app_id_of(d) == app_id)
        .collect();
    inner.dirty.extend(dirs);
}

/// A panel window moved by itself (the extension resizes it, a drag on its
/// tab strip): back where Arkadia laid it.
fn on_moved(app: &AppHandle, hwnd: isize, rect: (i32, i32, i32, i32)) {
    let Some(state) = app.try_state::<ChromeView>() else {
        return;
    };
    let Some((owner, at)) = state.inner.lock().ok().and_then(|inner| {
        let win = inner.windows.values().find(|w| w.hwnd == hwnd)?;
        Some((main_hwnd(app), win.at))
    }) else {
        return;
    };
    match (at, owner) {
        (Some(at), Some(owner)) => {
            if rect != (at.x, at.y, at.width, at.height) {
                win::relay(hwnd, owner, at);
            }
        }
        _ => {
            if !win::is_parked(rect) {
                win::park(hwnd);
            }
        }
    }
}

/// A panel window was closed in Chrome (Ctrl+Shift+W, last tab closed).
fn on_destroyed(app: &AppHandle, hwnd: isize) {
    let Some(state) = app.try_state::<ChromeView>() else {
        return;
    };
    let key = state.inner.lock().ok().and_then(|mut inner| {
        let key = inner
            .windows
            .iter()
            .find(|(_, w)| w.hwnd == hwnd)
            .map(|(k, _)| k.clone())?;
        inner.windows.remove(&key);
        Some(key)
    });
    if let Some(key) = key {
        let _ = app.emit_to("main", "chrome-closed", ChromeClosed { key });
    }
}

/// Starts the inbox watcher and the window hooks. Windows a crashed
/// Arkadia left behind (they carry its mark) close first.
pub fn spawn(app: AppHandle) {
    win::close_orphans();
    let hooks_app = app.clone();
    std::thread::spawn(move || win::run_hooks(hooks_app));
    std::thread::spawn(move || {
        if let Err(e) = run_inbox(app) {
            eprintln!("[arkadia chrome] inbox watcher stopped: {e}");
        }
    });
}

fn run_inbox(app: AppHandle) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};

    let dir = inbox_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Requests a minute old: their hooks gave up long ago. Newer ones may
    // belong to another Arkadia sharing the folder (`tauri dev`).
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_none_or(|age| age > std::time::Duration::from_secs(60));
            if stale && entry.file_name() != "ready" {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let ready = dir.join("ready");
    std::fs::write(&ready, std::process::id().to_string()).map_err(|e| e.to_string())?;

    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    let mut seen: HashSet<String> = HashSet::new();
    loop {
        let event = match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(event) => event,
            // Another Arkadia sharing the folder removed it when it quit.
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !ready.exists() {
                    let _ = std::fs::write(&ready, std::process::id().to_string());
                }
                continue;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let Ok(event) = event else { continue };
        for path in event.paths {
            let is_request = path.extension().and_then(|e| e.to_str()) == Some("json");
            if !is_request || !path.exists() {
                continue;
            }
            // Left in place: the instance owning the pane takes it
            // (`chrome_view_prepare`); another Arkadia sharing the folder
            // ignores it.
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(request) =
                serde_json::from_str::<RequestFile>(raw.trim_start_matches('\u{feff}'))
            else {
                continue;
            };
            if !valid_id(&request.id) || !seen.insert(request.id.clone()) {
                continue;
            }
            let _ = app.emit_to(
                "main",
                "chrome-request",
                ChromeRequest {
                    id: request.id,
                    pane_id: request.pane_id,
                },
            );
        }
    }
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::Layout;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Mutex, OnceLock};

    use tauri::AppHandle;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, PROPERTYKEY, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, GetExitCodeProcess, OpenProcess,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreForWindow,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EnumWindows, GetClassNameW, GetForegroundWindow, GetMessageW, GetPropW,
        GetSystemMetrics, GetWindow, GetWindowLongPtrW, GetWindowPlacement, GetWindowRect,
        GetWindowThreadProcessId, InternalGetWindowText, IsIconic, IsWindow, IsWindowVisible,
        IsZoomed, PostMessageW, PostThreadMessageW, SendMessageTimeoutW, SetForegroundWindow,
        SetPropW, SetWindowLongPtrW, SetWindowPlacement, SetWindowPos, EVENT_OBJECT_DESTROY,
        EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND, GWLP_HWNDPARENT, GWL_EXSTYLE,
        GWL_STYLE, GW_HWNDPREV, HWND_TOP, MSG, OBJID_WINDOW, SMTO_ABORTIFHUNG, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
        SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WINDOWPLACEMENT, WINEVENT_OUTOFCONTEXT, WM_APP,
        WM_CLOSE, WM_NULL, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };

    fn hwnd(raw: isize) -> HWND {
        HWND(raw as *mut core::ffi::c_void)
    }

    /// The mark of this Arkadia (daily or Lab) on the windows it laid out:
    /// its pid, so a later run knows them as left behind.
    fn mark_name() -> PCWSTR {
        if crate::lab::LAB {
            w!("ArkadiaLabChromePanel")
        } else {
            w!("ArkadiaChromePanel")
        }
    }

    /// Chrome's AppUserModelID of a window (which profile it belongs to).
    fn app_id(h: HWND) -> Option<String> {
        // SAFETY: COM calls on this thread, the string freed once copied.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let store: IPropertyStore = SHGetPropertyStoreForWindow(h).ok()?;
            let key = PROPERTYKEY {
                fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
                pid: 5,
            };
            let value = store.GetValue(&key).ok()?;
            let text = PropVariantToStringAlloc(&value).ok()?;
            let out = text.to_string().ok();
            CoTaskMemFree(Some(text.0 as *const _));
            out.filter(|s| !s.is_empty())
        }
    }

    fn is_chrome_class(h: HWND) -> bool {
        let mut buf = [0u16; 64];
        // SAFETY: the buffer outlives the call.
        let n = unsafe { GetClassNameW(h, &mut buf) };
        n > 0 && String::from_utf16_lossy(&buf[..n as usize]) == "Chrome_WidgetWin_1"
    }

    fn is_browser_frame(h: HWND) -> bool {
        // SAFETY: plain reads of a window's state.
        unsafe {
            if !IsWindowVisible(h).as_bool() || !is_chrome_class(h) {
                return false;
            }
            let style = GetWindowLongPtrW(h, GWL_STYLE) as u32;
            style & WS_CAPTION.0 == WS_CAPTION.0 && style & WS_SYSMENU.0 != 0
        }
    }

    /// A window's title, read without sending it a message.
    fn title(h: HWND) -> String {
        let mut buf = [0u16; 512];
        // SAFETY: the buffer outlives the call.
        let n = unsafe { InternalGetWindowText(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    /// Chrome's browser windows, with their profile's AppUserModelID and
    /// their title.
    pub(super) fn browser_windows() -> Vec<(isize, Option<String>, String)> {
        unsafe extern "system" fn cb(h: HWND, lp: LPARAM) -> windows::core::BOOL {
            // SAFETY: lp points at the Vec below, alive during EnumWindows.
            let out = unsafe { &mut *(lp.0 as *mut Vec<isize>) };
            if is_browser_frame(h) {
                out.push(h.0 as isize);
            }
            true.into()
        }
        let mut raw: Vec<isize> = Vec::new();
        // SAFETY: the callback only touches `raw`.
        unsafe {
            let _ = EnumWindows(Some(cb), LPARAM(&mut raw as *mut _ as isize));
        }
        raw.into_iter()
            .map(|h| (h, app_id(hwnd(h)), title(hwnd(h))))
            .collect()
    }

    pub(super) fn alive(raw: isize) -> bool {
        // SAFETY: IsWindow accepts any value.
        unsafe { IsWindow(Some(hwnd(raw))).as_bool() }
    }

    pub(super) fn dpi(raw: isize) -> u32 {
        // SAFETY: plain read.
        unsafe { GetDpiForWindow(hwnd(raw)) }
    }

    /// A launched window becomes the panel's: restored if Chrome opened it
    /// maximized or minimized, no resize border nor taskbar button, marked.
    pub(super) fn adopt(raw: isize) {
        let h = hwnd(raw);
        // SAFETY: style and placement changes on a window that exists.
        unsafe {
            if IsZoomed(h).as_bool() || IsIconic(h).as_bool() {
                let mut wp = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    ..Default::default()
                };
                if GetWindowPlacement(h, &mut wp).is_ok() {
                    wp.showCmd = SW_SHOWNOACTIVATE.0 as u32;
                    wp.flags = Default::default();
                    let _ = SetWindowPlacement(h, &wp);
                }
            }
            let style = GetWindowLongPtrW(h, GWL_STYLE) as u32;
            let style = style & !(WS_THICKFRAME.0 | WS_MAXIMIZEBOX.0 | WS_MINIMIZEBOX.0);
            SetWindowLongPtrW(h, GWL_STYLE, style as isize);
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let ex = (ex | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
            SetWindowLongPtrW(h, GWL_EXSTYLE, ex as isize);
            let _ = SetPropW(
                h,
                mark_name(),
                Some(HANDLE(std::process::id() as usize as *mut _)),
            );
        }
    }

    fn is_topmost(h: HWND) -> bool {
        // SAFETY: plain read.
        let ex = unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } as u32;
        ex & WS_EX_TOPMOST.0 != 0
    }

    /// Whether the window's thread answers: an owned window attaches its
    /// input queue to main's, so a hung Chrome must never be owned.
    fn responsive(h: HWND) -> bool {
        // SAFETY: a bounded, harmless message.
        unsafe {
            SendMessageTimeoutW(
                h,
                WM_NULL,
                WPARAM(0),
                LPARAM(0),
                SMTO_ABORTIFHUNG,
                300,
                None,
            )
            .0 != 0
        }
    }

    fn set_owner(h: HWND, owner: isize) {
        // SAFETY: the owner link of a window that exists.
        unsafe {
            if GetWindowLongPtrW(h, GWLP_HWNDPARENT) != owner {
                SetWindowLongPtrW(h, GWLP_HWNDPARENT, owner);
            }
        }
    }

    /// Lays a window over the panel, owned by main, its caption buttons
    /// clipped. Async: Chrome's thread does the move, Arkadia never waits.
    pub(super) fn lay(raw: isize, owner: isize, at: Layout) {
        let h = hwnd(raw);
        if !responsive(h) {
            park(raw);
            return;
        }
        set_owner(h, owner);
        // Right above main in the z-order, not where Chrome left it: a
        // freshly launched window sits on top of every app, the one Alexis
        // uses included. Inserted after the window just above main (Arkadia
        // behind another app), or on top when main is the top window.
        // SAFETY: region and position of a window that exists; the system
        // owns the region once set.
        unsafe {
            // A topmost window above main (Arkadia's hidden notification,
            // a tooltip, the taskbar) would make Chrome topmost too: main
            // tops the normal windows then, and HWND_TOP lays Chrome right
            // above it.
            let (after, order) = match GetWindow(hwnd(owner), GW_HWNDPREV) {
                Ok(prev) if prev == h => (None, SWP_NOZORDER),
                Ok(prev) if !is_topmost(prev) => (Some(prev), Default::default()),
                _ => (Some(HWND_TOP), Default::default()),
            };
            let region = CreateRectRgn(0, 0, at.shown, at.height);
            let _ = SetWindowRgn(h, Some(region), true);
            let _ = SetWindowPos(
                h,
                after,
                at.x,
                at.y,
                at.width,
                at.height,
                SWP_NOACTIVATE | order | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    /// Moves a laid window back (from the hook: no wait, no region).
    pub(super) fn relay(raw: isize, owner: isize, at: Layout) {
        let h = hwnd(raw);
        set_owner(h, owner);
        // SAFETY: an async move of a window that exists.
        unsafe {
            let _ = SetWindowPos(
                h,
                None,
                at.x,
                at.y,
                at.width,
                at.height,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    fn virtual_origin() -> (i32, i32) {
        // SAFETY: plain reads.
        unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
            )
        }
    }

    /// Off every monitor, unowned (main may minimize), still drawn.
    pub(super) fn park(raw: isize) {
        let h = hwnd(raw);
        set_owner(h, 0);
        let mut rect = RECT::default();
        // SAFETY: plain read then an async move.
        unsafe {
            let _ = GetWindowRect(h, &mut rect);
            let width = (rect.right - rect.left).max(800);
            let height = (rect.bottom - rect.top).max(600);
            let (vx, vy) = virtual_origin();
            let (x, y) = super::park_position(vx, vy, width);
            let _ = SetWindowPos(
                h,
                None,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    pub(super) fn is_parked(rect: (i32, i32, i32, i32)) -> bool {
        let (vx, _) = virtual_origin();
        rect.0 + rect.2 <= vx
    }

    pub(super) fn close(raw: isize) {
        // SAFETY: a posted message, never waited on.
        unsafe {
            let _ = PostMessageW(Some(hwnd(raw)), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }

    fn own_process(h: HWND) -> bool {
        let mut pid = 0u32;
        // SAFETY: plain read.
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        pid == std::process::id()
    }

    /// Activates the window an instant (it becomes its profile's last
    /// focused one), then gives the foreground back to the Arkadia window
    /// that had it. Never while another app is in front.
    pub(super) fn activate_briefly(raw: isize) -> bool {
        // SAFETY: foreground changes allowed to the foreground process.
        unsafe {
            let before = GetForegroundWindow();
            if before.0.is_null() || !own_process(before) {
                return false;
            }
            if !SetForegroundWindow(hwnd(raw)).as_bool() {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
            if !SetForegroundWindow(before).as_bool() || GetForegroundWindow() != before {
                // Chrome holds the foreground now: borrow its input state to
                // hand it back, or the keyboard stays in a hidden window.
                let chrome_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
                let ours = GetCurrentThreadId();
                let attached = AttachThreadInput(ours, chrome_thread, true).as_bool();
                let _ = SetForegroundWindow(before);
                if attached {
                    let _ = AttachThreadInput(ours, chrome_thread, false);
                }
            }
            true
        }
    }

    /// Whether process `pid` still runs.
    fn running(pid: u32) -> bool {
        // SAFETY: a handle opened, read and closed here.
        unsafe {
            let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return false;
            };
            let mut code = 0u32;
            let alive = GetExitCodeProcess(process, &mut code).is_ok() && code == 259;
            let _ = CloseHandle(process);
            alive
        }
    }

    /// Windows a crashed run of this Arkadia left: closed. Those of an
    /// instance still running (`tauri dev` beside the daily) are left alone.
    pub(super) fn close_orphans() {
        for (raw, _, _) in browser_windows() {
            // SAFETY: plain read of a window property.
            let mark = unsafe { GetPropW(hwnd(raw), mark_name()) };
            let pid = mark.0 as usize as u32;
            if pid != 0 && pid != std::process::id() && !running(pid) {
                close(raw);
            }
        }
    }

    pub(super) fn foreground() -> Option<isize> {
        // SAFETY: plain read.
        let h = unsafe { GetForegroundWindow() };
        (!h.0.is_null()).then_some(h.0 as isize)
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
    static WATCHED: Mutex<Option<HashSet<u32>>> = Mutex::new(None);
    const WM_WATCH_PROCESS: u32 = WM_APP + 41;

    /// Chrome's browser process (pid of a window) gets location and destroy
    /// hooks, on the hook thread.
    pub(super) fn watch_process(raw: isize) {
        let mut pid = 0u32;
        // SAFETY: plain read.
        unsafe { GetWindowThreadProcessId(hwnd(raw), Some(&mut pid)) };
        let thread = HOOK_THREAD.load(Ordering::SeqCst);
        if pid == 0 || thread == 0 {
            return;
        }
        // SAFETY: a posted message to the hook thread.
        unsafe {
            let _ = PostThreadMessageW(thread, WM_WATCH_PROCESS, WPARAM(pid as usize), LPARAM(0));
        }
    }

    pub(super) fn run_hooks(app: AppHandle) {
        let _ = APP.set(app);
        // SAFETY: the hooks call back on this thread, from the loop below;
        // the callbacks never pump messages (async moves only).
        unsafe {
            HOOK_THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
            let _ = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.hwnd.0.is_null() && msg.message == WM_WATCH_PROCESS {
                    let pid = msg.wParam.0 as u32;
                    let mut watched = WATCHED.lock().unwrap_or_else(|e| e.into_inner());
                    if watched.get_or_insert_with(HashSet::new).insert(pid) {
                        for event in [EVENT_OBJECT_DESTROY, EVENT_OBJECT_LOCATIONCHANGE] {
                            let _ = SetWinEventHook(
                                event,
                                event,
                                None,
                                Some(on_event),
                                pid,
                                0,
                                WINEVENT_OUTOFCONTEXT,
                            );
                        }
                    }
                    continue;
                }
                DispatchMessageW(&msg);
            }
        }
    }

    unsafe extern "system" fn on_event(
        _hook: HWINEVENTHOOK,
        event: u32,
        h: HWND,
        id_object: i32,
        id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        let Some(app) = APP.get() else { return };
        if h.0.is_null() || id_object != OBJID_WINDOW.0 || id_child != 0 {
            return;
        }
        match event {
            EVENT_SYSTEM_FOREGROUND => {
                if is_chrome_class(h) {
                    super::on_foreground(app, h.0 as isize, app_id(h));
                }
            }
            EVENT_OBJECT_LOCATIONCHANGE => {
                let mut r = RECT::default();
                // SAFETY: plain read.
                if unsafe { GetWindowRect(h, &mut r) }.is_ok() {
                    super::on_moved(
                        app,
                        h.0 as isize,
                        (r.left, r.top, r.right - r.left, r.bottom - r.top),
                    );
                }
            }
            EVENT_OBJECT_DESTROY => super::on_destroyed(app, h.0 as isize),
            _ => {}
        }
    }
}

#[cfg(not(windows))]
mod win {
    use super::Layout;
    use tauri::AppHandle;
    pub(super) fn browser_windows() -> Vec<(isize, Option<String>, String)> {
        Vec::new()
    }
    pub(super) fn foreground() -> Option<isize> {
        None
    }
    pub(super) fn alive(_: isize) -> bool {
        false
    }
    pub(super) fn dpi(_: isize) -> u32 {
        96
    }
    pub(super) fn adopt(_: isize) {}
    pub(super) fn lay(_: isize, _: isize, _: Layout) {}
    pub(super) fn park(_: isize) {}
    pub(super) fn relay(_: isize, _: isize, _: Layout) {}
    pub(super) fn is_parked(_: (i32, i32, i32, i32)) -> bool {
        true
    }
    pub(super) fn close(_: isize) {}
    pub(super) fn activate_briefly(_: isize) -> bool {
        false
    }
    pub(super) fn close_orphans() {}
    pub(super) fn watch_process(_: isize) {}
    pub(super) fn run_hooks(_: AppHandle) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn lays_the_window_wider_than_the_panel_by_its_caption_buttons() {
        let at = layout((-18, 0), b(2227.4, 153.0, 1613.0, 2025.0), 288);
        assert_eq!((at.x, at.y), (2209, 153));
        assert_eq!(at.shown, 1613);
        // 142 dip at 300 %.
        assert_eq!(at.width, 1613 + 426);
        assert_eq!(at.height, 2025);
        // A 96 dpi screen, and a dpi Windows failed to report.
        assert_eq!(layout((0, 0), b(0.0, 0.0, 500.0, 400.0), 96).width, 642);
        assert_eq!(layout((0, 0), b(0.0, 0.0, 500.0, 400.0), 0).width, 642);
    }

    #[test]
    fn parks_left_of_every_monitor() {
        let (x, y) = park_position(-3840, -200, 1600);
        assert!(x + 1600 < -3840);
        assert_eq!(y, -200);
    }

    #[test]
    fn names_a_profile_the_way_chrome_tags_its_windows() {
        assert_eq!(app_id_of("Default"), "Chrome");
        assert_eq!(app_id_of("Profile 3"), "Chrome.UserData.Profile3");
    }

    #[test]
    fn knows_its_launched_window_by_its_first_page() {
        let title = launch_title(42, 7);
        assert!(is_launched_window(
            &format!("{title} - Google Chrome"),
            &title
        ));
        assert!(is_launched_window(
            &format!("{title} - Google Chrome - Minifashion"),
            &title
        ));
        // Another launch's window, or Alexis's own.
        assert!(!is_launched_window(
            &format!("{}7 - Google Chrome", launch_title(42, 7)),
            &title
        ));
        assert!(!is_launched_window("Twitch - Google Chrome", &title));
    }

    #[test]
    fn accepts_only_plain_request_ids() {
        assert!(valid_id("1793831-abc_9"));
        assert!(!valid_id(""));
        assert!(!valid_id("../ready"));
        assert!(!valid_id("a b"));
        assert!(!valid_id(&"x".repeat(65)));
    }

    #[test]
    fn steers_only_when_the_group_could_land_elsewhere() {
        // Already the profile's last-focused window, and nobody used it since.
        assert!(!needs_steer(false, false, Some(7), 7));
        assert!(needs_steer(true, false, Some(7), 7));
        assert!(needs_steer(false, true, Some(7), 7));
        assert!(needs_steer(false, false, Some(8), 7));
        assert!(needs_steer(false, false, None, 7));
    }

    #[test]
    fn reads_a_request_dropped_by_powershell_with_a_bom() {
        let raw = "\u{feff}{\"id\":\"r1\",\"paneId\":\"p1\"}";
        let r: RequestFile = serde_json::from_str(raw.trim_start_matches('\u{feff}')).unwrap();
        assert_eq!((r.id.as_str(), r.pane_id.as_str()), ("r1", "p1"));
    }
}
