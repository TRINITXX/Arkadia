//! Background-notification popup.
//!
//! When Claude Code finishes a response (`Stop` hook) or asks the user
//! (`PreToolUse` on `AskUserQuestion`/`ExitPlanMode`), the user's hook scripts
//! drop a JSON signal file into `%LOCALAPPDATA%/Arkadia/notify`. We watch that
//! directory, map the signal's `cwd` back to the Arkadia pane running that
//! session, and — only while the main window is NOT focused — surface a small
//! always-on-top popup (the `popup` window) pinned bottom-right that mirrors
//! the waiting pane and lets the user reply without switching to Arkadia.
//!
//! The popup shows one pane at a time with a queue counter; replying or
//! dismissing advances to the next waiting pane.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::agent_registry::AgentRegistry;

/// Popup window logical size. Width matches the user's requested ~600px panel;
/// height is a fixed band — the mirrored pane is scaled to fit the width and
/// the bottom (latest output + input box) is kept in view.
const POPUP_W: f64 = 470.0;
const POPUP_H: f64 = 380.0;
/// Cascade offset (logical px) per stack level, so a window behind the active
/// one peeks out to the upper-left instead of hiding completely.
const CASCADE_DX: f64 = 16.0;
const CASCADE_DY: f64 = 32.0;

/// One waiting pane shown (or queued) in the popup. `pane_id` is the Arkadia
/// pane UUID, which is also the PTY session id (`send_input` target) and the
/// frontend `pane.id`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WaitingItem {
    pub pane_id: String,
    /// "done" = Claude finished a response, "question" = Claude is asking.
    pub kind: String,
    pub cwd: String,
    /// Hook timestamp (ms). Changes on every fresh signal for a pane, so the
    /// popup UI can detect a re-appearance and re-run its open-time scroll.
    pub ts: u64,
}

/// Managed FIFO of panes awaiting the user. Front (`items[0]`) is shown.
pub struct PopupQueue {
    pub items: parking_lot::Mutex<Vec<WaitingItem>>,
    /// Whether the popup is enabled (mirrors the frontend setting).
    pub enabled: std::sync::atomic::AtomicBool,
    /// Whether to auto-scroll the terminal to the reply start when Claude
    /// finishes while Arkadia is foreground (mirrors the frontend setting).
    pub auto_scroll: std::sync::atomic::AtomicBool,
}

impl Default for PopupQueue {
    fn default() -> Self {
        Self {
            items: parking_lot::Mutex::new(Vec::new()),
            enabled: std::sync::atomic::AtomicBool::new(true),
            auto_scroll: std::sync::atomic::AtomicBool::new(true),
        }
    }
}

#[derive(Serialize, Clone)]
struct PopupStatePayload {
    items: Vec<WaitingItem>,
}

/// Raw hook signal as written by `arkadia-notify.ps1`.
/// Raw hook signal as written by `arkadia-notify.ps1`: the project cwd and the
/// kind ("done" | "question").
#[derive(Deserialize)]
struct Signal {
    cwd: Option<String>,
    kind: Option<String>,
    /// Arkadia pane UUID, echoed by the hook from `ARKADIA_PANE_ID`. When set,
    /// it routes the signal directly — no cwd guessing. Empty/absent → cwd match.
    #[serde(rename = "paneId")]
    pane_id: Option<String>,
    /// Hook timestamp in ms (used as a per-signal nonce).
    ts: Option<u64>,
}

/// `%LOCALAPPDATA%/Arkadia/notify` — the directory the hook drops signals into.
pub fn signal_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("notify")
}

/// Appends a diagnostic line to `%LOCALAPPDATA%/Arkadia/popup.log` (and stderr).
/// Lets us trace the popup decision path without a visible dev console.
pub(crate) fn log_line(msg: &str) {
    eprintln!("[arkadia popup] {msg}");
    let path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("popup.log");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        let _ = writeln!(f, "{msg}");
    }
}

fn derive_kind(sig: &Signal) -> String {
    match sig.kind.as_deref() {
        Some("question") => "question".to_string(),
        _ => "done".to_string(),
    }
}

/// Watches the signal directory; for each dropped file, routes it to the popup.
/// Runs on its own thread for the lifetime of the app.
pub fn run_notify_watcher(app: AppHandle, registry: Arc<AgentRegistry>) -> notify::Result<()> {
    let root = signal_dir();
    if !root.exists() {
        std::fs::create_dir_all(&root).ok();
    }
    // Clear any stale signals left over from a previous run so we don't pop up
    // for conversations that are long since answered.
    if let Ok(entries) = std::fs::read_dir(&root) {
        for e in entries.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&root, RecursiveMode::NonRecursive)?;
    log_line(&format!("watching {}", root.display()));

    // Grace window after startup: signals that land while the app is still
    // booting (stale, or fired during launch) are consumed but not shown, so we
    // don't pop an empty/irrelevant window on launch.
    let started = Instant::now();
    const STARTUP_GRACE: Duration = Duration::from_secs(2);

    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    let suppress = started.elapsed() < STARTUP_GRACE;
                    for path in event.paths {
                        process_signal_file(&path, &app, &registry, suppress);
                    }
                }
            }
            Ok(Err(e)) => eprintln!("[arkadia popup] notify error: {e}"),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

fn process_signal_file(
    path: &Path,
    app: &AppHandle,
    registry: &Arc<AgentRegistry>,
    suppress: bool,
) {
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
        return;
    }
    let raw = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return, // still being written / already consumed
    };
    // One-shot: remove so a later Modify event for the same file is a no-op.
    let _ = std::fs::remove_file(path);
    // Strip a leading UTF-8 BOM — PowerShell's `Set-Content -Encoding utf8`
    // (PS 5.1) prepends one, and serde_json rejects it ("expected value at
    // line 1 column 1").
    let content = raw.trim_start_matches('\u{feff}').trim();
    log_line(&format!("signal file received: {content}"));
    let sig: Signal = match serde_json::from_str(content) {
        Ok(s) => s,
        Err(e) => {
            log_line(&format!("bad signal json ({e}): {content}"));
            return;
        }
    };
    let Some(cwd) = sig.cwd.clone() else {
        return;
    };
    handle_signal(&sig, &cwd, app, registry, suppress);
}

fn handle_signal(
    sig: &Signal,
    cwd: &str,
    app: &AppHandle,
    registry: &Arc<AgentRegistry>,
    suppress: bool,
) {
    if suppress {
        log_line("startup grace — signal consumed but not shown");
        return;
    }
    // Prefer the exact pane id the hook echoed from `ARKADIA_PANE_ID` — it's
    // unambiguous even with several Claude tabs in one folder. Fall back to cwd
    // matching for shells that predate this (env var not set on those PTYs).
    let pane_id: String = match sig.pane_id.as_deref().map(str::trim).filter(|s| {
        !s.is_empty() && uuid::Uuid::parse_str(s).is_ok()
    }) {
        Some(pid) => {
            log_line(&format!("signal routed by pane id {pid} (direct)"));
            pid.to_string()
        }
        None => {
            let panes = registry.panes_for_cwd(cwd);
            log_line(&format!(
                "signal cwd={cwd:?} → {} matching pane(s)",
                panes.len()
            ));
            match panes.into_iter().next() {
                Some(u) => u.to_string(),
                None => {
                    log_line(&format!(
                        "no pane matches this cwd — known pane cwds: {:?}",
                        registry.all_cwds()
                    ));
                    return;
                }
            }
        }
    };

    // Foreground = the main window has focus, or is the front-most real window
    // with only an always-on-top overlay (Picture-in-Picture) above it.
    let main_focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if main_focused || main_is_effective_foreground(&app) {
        // The user is looking at Arkadia → auto-scroll the terminal to the start
        // of the reply (done directly here off the Stop/PreToolUse hook — reliable
        // and no frontend round-trip), and don't pop up. We deliberately do NOT
        // scroll when backgrounded: the popup mirrors the same Claude Code screen,
        // so scrolling it would move what the popup is showing.
        if app
            .state::<PopupQueue>()
            .auto_scroll
            .load(Ordering::Acquire)
        {
            log_line("Arkadia foreground — scrolling terminal to reply, no popup");
            let sessions = app.state::<crate::terminal::SessionMap>();
            crate::terminal::scroll_pane_to_reply_top(&app, &pane_id, sessions.inner());
        } else {
            log_line("Arkadia foreground — auto-scroll off, no popup");
        }
        return;
    }

    // Backgrounded → show the popup (it has its own scroll); leave the terminal
    // alone. The popup window is gated on its on/off setting.
    if !app.state::<PopupQueue>().enabled.load(Ordering::Acquire) {
        log_line("popup disabled in settings — ignoring");
        return;
    }
    log_line(&format!("showing popup for pane {pane_id}"));

    let item = WaitingItem {
        pane_id,
        kind: derive_kind(sig),
        cwd: cwd.to_string(),
        ts: sig.ts.unwrap_or(0),
    };

    {
        let queue = app.state::<PopupQueue>();
        let mut q = queue.items.lock();
        if let Some(existing) = q.iter_mut().find(|i| i.pane_id == item.pane_id) {
            // Same pane re-notified: refresh kind/ts in place, keep its stack
            // slot so an active popup the user is reading isn't shuffled.
            existing.kind = item.kind.clone();
            existing.ts = item.ts;
        } else {
            // A new conversation goes BEHIND the others, in arrival order — the
            // active (front) popup is never disrupted by a fresh notification.
            q.push(item);
        }
    }
    sync_popups(app);
}

/// True when Arkadia's main window is the front-most *real* application window —
/// i.e. ignoring always-on-top overlays (Chrome / sfvip-player Picture-in-Picture
/// and Arkadia's own popups, all `WS_EX_TOPMOST`). Walks the desktop z-order from
/// the top: the first visible, non-cloaked, titled, non-tool window that is NOT a
/// topmost overlay is the effective foreground. So "Arkadia behind only a PiP"
/// reads as foreground (suppress the popup), while "Arkadia behind a full window"
/// does not (show it).
#[cfg(windows)]
fn main_is_effective_foreground(app: &AppHandle) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetTopWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, IsIconic,
        IsWindowVisible, GWL_EXSTYLE, GW_HWNDNEXT, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    };

    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    // Minimized → the user can't see Arkadia, so it's not the foreground.
    if main.is_minimized().unwrap_or(false) {
        return false;
    }
    let Ok(main_hwnd) = main.hwnd() else {
        return false;
    };
    let main_raw = main_hwnd.0 as isize;

    unsafe {
        let mut hwnd = match GetTopWindow(None) {
            Ok(h) => h,
            Err(_) => return false,
        };
        // Bounded walk (defensive against a malformed z-order chain).
        for _ in 0..2000 {
            if hwnd.0 as isize == 0 {
                break;
            }
            if IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() {
                let mut cloaked: u32 = 0;
                let _ = DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_CLOAKED,
                    &mut cloaked as *mut u32 as *mut core::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                );
                let exstyle = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
                let is_tool = exstyle & WS_EX_TOOLWINDOW.0 != 0;
                let titled = GetWindowTextLengthW(hwnd) > 0 || hwnd.0 as isize == main_raw;
                let mut rect = RECT::default();
                let has_area = GetWindowRect(hwnd, &mut rect).is_ok()
                    && rect.right > rect.left
                    && rect.bottom > rect.top;
                if cloaked == 0 && !is_tool && titled && has_area {
                    if hwnd.0 as isize == main_raw {
                        return true; // Arkadia is the front-most real window
                    }
                    if exstyle & WS_EX_TOPMOST.0 == 0 {
                        return false; // a real, non-overlay window is in front
                    }
                    // else: an always-on-top overlay (PiP / our popup) → skip it.
                }
            }
            hwnd = match GetWindow(hwnd, GW_HWNDNEXT) {
                Ok(h) => h,
                Err(_) => break,
            };
        }
    }
    false
}

#[cfg(not(windows))]
fn main_is_effective_foreground(_app: &AppHandle) -> bool {
    false
}

/// Window label for a pane's popup. Pane ids are UUIDs (`[0-9a-f-]`), which are
/// valid Tauri window labels.
fn popup_label(pane_id: &str) -> String {
    format!("popup-{pane_id}")
}

/// Creates the popup window for a pane, or returns the existing one.
fn ensure_pane_window(app: &AppHandle, pane_id: &str) -> tauri::Result<WebviewWindow> {
    let label = popup_label(pane_id);
    if let Some(w) = app.get_webview_window(&label) {
        return Ok(w);
    }
    let url = format!("index.html?window=popup&pane={pane_id}");
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Arkadia")
        .inner_size(POPUP_W, POPUP_H)
        .min_inner_size(320.0, 160.0)
        .decorations(false)
        // Resizable: the frameless window has no OS resize borders, so the popup
        // UI draws its own drag handles (startResizeDragging).
        .resizable(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
}

/// Positions a popup at its stack `index`: index 0 (active) sits bottom-right;
/// each one further back is offset up-left so it peeks out behind. Clamped to the
/// monitor. Best-effort — keeps the default placement if the monitor is unknown.
fn cascade_position(win: &WebviewWindow, index: usize) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        let msize = monitor.size();
        let mpos = monitor.position();
        let margin = (16.0 * scale) as i32;
        // Reserve a typical taskbar height so the popup isn't hidden behind it.
        let taskbar = (56.0 * scale) as i32;
        // Anchor on the window's ACTUAL outer size, not the default POPUP_W/H:
        // the user can resize a popup (drag handles) and the window persists
        // across re-notifications, so assuming 470px would let a widened popup
        // hang off the right edge and clip the ✕. Fall back to the defaults when
        // the size isn't available yet (a freshly built window).
        let (ww, wh) = match win.outer_size() {
            Ok(s) => (s.width as i32, s.height as i32),
            Err(_) => ((POPUP_W * scale) as i32, (POPUP_H * scale) as i32),
        };
        let dx = (CASCADE_DX * scale) as i32 * index as i32;
        let dy = (CASCADE_DY * scale) as i32 * index as i32;
        // Right/bottom edges keep a margin; left/top are clamped too so even a
        // popup larger than the work area still shows its top-right controls.
        let x =
            (mpos.x + msize.width as i32 - ww - margin - dx).max(mpos.x + margin);
        let y =
            (mpos.y + msize.height as i32 - wh - taskbar - dy).max(mpos.y + margin);
        log_line(&format!(
            "cascade[{index}]: mon=({},{})+{}x{} scale={scale} win={ww}x{wh} -> ({x},{y}) right_edge={}",
            mpos.x,
            mpos.y,
            msize.width,
            msize.height,
            x + ww,
        ));
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

/// Reconciles popup windows with the queue: one window per item, cascaded by
/// stack index (0 = active, in front), windows for dismissed panes closed, and
/// the z-order re-asserted so the active one sits on top. Toggling always-on-top
/// re-raises a window in place WITHOUT stealing OS focus, so a fresh notification
/// never pulls focus away from whatever the user is doing.
fn sync_popups(app: &AppHandle) {
    let items = {
        let queue = app.state::<PopupQueue>();
        let q = queue.items.lock();
        q.clone()
    };
    let wanted: std::collections::HashSet<String> =
        items.iter().map(|i| popup_label(&i.pane_id)).collect();
    // Close windows whose pane is no longer queued.
    for (label, win) in app.webview_windows() {
        if label.starts_with("popup-") && !wanted.contains(&label) {
            let _ = win.close();
        }
    }
    // Create / position / show each queued window by its stack index.
    for (index, item) in items.iter().enumerate() {
        match ensure_pane_window(app, &item.pane_id) {
            Ok(win) => {
                let fresh = !win.is_visible().unwrap_or(false);
                if fresh {
                    let _ = win.set_size(tauri::LogicalSize::new(POPUP_W, POPUP_H));
                }
                cascade_position(&win, index);
                if fresh {
                    let _ = win.show();
                }
            }
            Err(e) => log_line(&format!("popup window create failed: {e}")),
        }
    }
    // Re-raise z-order back-to-front so index 0 ends up on top of the stack.
    for item in items.iter().rev() {
        if let Some(win) = app.get_webview_window(&popup_label(&item.pane_id)) {
            let _ = win.set_always_on_top(false);
            let _ = win.set_always_on_top(true);
        }
    }
    log_line(&format!("sync_popups: {} window(s)", items.len()));
    emit_state(app);
}

fn emit_state(app: &AppHandle) {
    let items = {
        let queue = app.state::<PopupQueue>();
        let q = queue.items.lock();
        q.clone()
    };
    let payload = PopupStatePayload { items };
    // Each popup window filters the queue down to its own pane.
    for (label, win) in app.webview_windows() {
        if label.starts_with("popup-") {
            let _ = win.emit("popup-state", payload.clone());
        }
    }
}

/// Closes every popup window (used when the feature is turned off).
fn close_all_popups(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("popup-") {
            let _ = win.close();
        }
    }
}

/// Popup asks for the current queue (on mount / reconnect).
#[tauri::command]
pub fn popup_request_state(app: AppHandle) {
    emit_state(&app);
}

/// Diagnostic line from the popup UI → `popup.log` (the popup window has no
/// reachable dev console).
#[tauri::command]
pub fn popup_log_ui(msg: String) {
    log_line(&format!("[ui] {msg}"));
}

/// Enable/disable the popup from the frontend setting. Disabling clears the
/// queue and closes any open popup windows.
#[tauri::command]
pub fn popup_set_enabled(enabled: bool, app: AppHandle, queue: State<'_, PopupQueue>) {
    queue.enabled.store(enabled, Ordering::Release);
    if !enabled {
        queue.items.lock().clear();
        close_all_popups(&app);
    }
}

/// Mirror the "auto-scroll to reply" frontend setting into the backend, which
/// drives the terminal scroll directly from the Stop/PreToolUse hook.
#[tauri::command]
pub fn popup_set_auto_scroll(enabled: bool, queue: State<'_, PopupQueue>) {
    queue.auto_scroll.store(enabled, Ordering::Release);
}

/// Drop the given pane from the queue (the user closed its bubble): close its
/// window and re-tidy the remaining stack.
#[tauri::command]
pub fn popup_dismiss(pane_id: String, app: AppHandle, queue: State<'_, PopupQueue>) {
    queue.items.lock().retain(|i| i.pane_id != pane_id);
    if let Some(w) = app.get_webview_window(&popup_label(&pane_id)) {
        let _ = w.close();
    }
    sync_popups(&app);
}

/// Bring Arkadia's main window to the front, focused on the given pane's
/// conversation, and drop that pane's popup from the stack.
#[tauri::command]
pub fn popup_open_in_main(pane_id: String, app: AppHandle, queue: State<'_, PopupQueue>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.emit("focus-pane", pane_id.clone());
    }
    queue.items.lock().retain(|i| i.pane_id != pane_id);
    if let Some(w) = app.get_webview_window(&popup_label(&pane_id)) {
        let _ = w.close();
    }
    sync_popups(&app);
}
