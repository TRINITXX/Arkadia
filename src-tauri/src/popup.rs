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

/// Mirror-popup window logical size. Width matches the user's requested ~600px
/// panel; height is a fixed band — the mirrored pane is scaled to fit the width
/// and the bottom (latest output + input box) is kept in view.
const POPUP_W: f64 = 470.0;
const POPUP_H: f64 = 380.0;
/// Compact-notification window: default width (overridable via the settings
/// slider) and a fixed two-line height (project on top, tab below).
const NOTIF_W: f64 = 360.0;
const NOTIF_H: f64 = 76.0;
/// Width slider bounds — must match `NOTIF_WIDTH_MIN`/`MAX` in `types.ts`.
const NOTIF_W_MIN: u32 = 260;
const NOTIF_W_MAX: u32 = 560;
/// Cascade offset (logical px) per stack level, so a window behind the active
/// one peeks out to the upper-left instead of hiding completely.
const CASCADE_DX: f64 = 16.0;
const CASCADE_DY: f64 = 32.0;

/// Notification style (mirrors the frontend `notifStyle` setting), stored in the
/// queue as an `AtomicU8`.
const STYLE_OFF: u8 = 0;
const STYLE_MIRROR: u8 = 1;
const STYLE_COMPACT: u8 = 2;

fn style_from_str(s: &str) -> u8 {
    match s {
        "off" => STYLE_OFF,
        "compact" => STYLE_COMPACT,
        _ => STYLE_MIRROR,
    }
}

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
    /// Arkadia project display name (frontend-registered). Empty when unknown;
    /// the compact notification then falls back to the cwd folder name.
    pub project_name: String,
    /// Live terminal title of the pane (the tab name), used by the compact
    /// notification. Empty when the session isn't in the live map.
    pub tab_title: String,
}

/// Managed FIFO of panes awaiting the user. Front (`items[0]`) is shown.
pub struct PopupQueue {
    pub items: parking_lot::Mutex<Vec<WaitingItem>>,
    /// Notification style (`STYLE_OFF` / `STYLE_MIRROR` / `STYLE_COMPACT`),
    /// mirroring the frontend `notifStyle` setting.
    pub style: std::sync::atomic::AtomicU8,
    /// Whether the notification may show even over a fullscreen app (game/video).
    pub fullscreen: std::sync::atomic::AtomicBool,
    /// Compact-notification window width in logical px (user-tunable slider).
    pub notif_width: std::sync::atomic::AtomicU32,
    /// Whether to auto-scroll the terminal to the reply start when Claude
    /// finishes while Arkadia is foreground (mirrors the frontend setting).
    pub auto_scroll: std::sync::atomic::AtomicBool,
}

impl Default for PopupQueue {
    fn default() -> Self {
        Self {
            items: parking_lot::Mutex::new(Vec::new()),
            style: std::sync::atomic::AtomicU8::new(STYLE_MIRROR),
            fullscreen: std::sync::atomic::AtomicBool::new(false),
            notif_width: std::sync::atomic::AtomicU32::new(NOTIF_W as u32),
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

    // Backgrounded → show the notification (it has its own scroll); leave the
    // terminal alone. Gated on the notification style setting.
    let queue = app.state::<PopupQueue>();
    let style = queue.style.load(Ordering::Acquire);
    if style == STYLE_OFF {
        log_line("notifications disabled in settings — ignoring");
        return;
    }

    // Don't interrupt a fullscreen game/video unless the user opted in. An
    // EXCLUSIVE D3D fullscreen (a real game) is suppressed even with the opt-in:
    // showing a topmost window above an exclusive swap chain kicks the game out
    // of fullscreen (minimize / back to desktop), and the toast wouldn't be
    // visible over it anyway. The opt-in only covers "soft" fullscreen
    // (borderless games, fullscreen video, presentations), where a topmost
    // toast overlays harmlessly.
    let fullscreen_opt_in = queue.fullscreen.load(Ordering::Acquire);
    let fs_kind = fullscreen_kind();
    if suppress_for_fullscreen(fullscreen_opt_in, fs_kind) {
        log_line(&format!(
            "fullscreen app foreground ({fs_kind:?}, opt_in={fullscreen_opt_in}) — notification suppressed"
        ));
        return;
    }

    // Enrich with the labels the compact notification shows (the mirror popup
    // ignores them). Project name is frontend-registered; the tab title is the
    // pane's live terminal title.
    let project_name = uuid::Uuid::parse_str(&pane_id)
        .ok()
        .and_then(|u| registry.project_name_for_pane(u))
        .unwrap_or_default();
    let sessions = app.state::<crate::terminal::SessionMap>();
    let tab_title =
        crate::terminal::session_title(sessions.inner(), &pane_id).unwrap_or_default();

    // Compact style shows ONE notification at a time: while one is up for another
    // pane, drop the rest (nothing re-appears when it's closed).
    if style == STYLE_COMPACT && queue.items.lock().iter().any(|i| i.pane_id != pane_id) {
        log_line("compact notification busy — dropping this signal");
        return;
    }

    log_line(&format!("showing notification (style {style}) for pane {pane_id}"));

    let item = WaitingItem {
        pane_id,
        kind: derive_kind(sig),
        cwd: cwd.to_string(),
        ts: sig.ts.unwrap_or(0),
        project_name,
        tab_title,
    };

    {
        let mut q = queue.items.lock();
        if let Some(existing) = q.iter_mut().find(|i| i.pane_id == item.pane_id) {
            // Same pane re-notified: refresh in place, keep its stack slot so an
            // active popup the user is reading isn't shuffled.
            existing.kind = item.kind.clone();
            existing.ts = item.ts;
            existing.project_name = item.project_name.clone();
            existing.tab_title = item.tab_title.clone();
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

/// What kind of fullscreen app currently owns the screen, per the Shell's own
/// "is it OK to notify" query (`SHQueryUserNotificationState`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FullscreenKind {
    /// No fullscreen app in front.
    None,
    /// "Soft" fullscreen: borderless-fullscreen game, fullscreen video/F11
    /// (`QUNS_BUSY`) or presentation mode. A topmost toast overlays harmlessly.
    Soft,
    /// Exclusive D3D fullscreen (`QUNS_RUNNING_D3D_FULL_SCREEN`): a real game
    /// owns the swap chain; showing any topmost window kicks it back to the
    /// desktop.
    Exclusive,
}

/// Whether to suppress the notification for the current fullscreen state.
/// Exclusive fullscreen is always suppressed — the "show over fullscreen"
/// opt-in only lifts the suppression for soft fullscreen.
fn suppress_for_fullscreen(opt_in: bool, kind: FullscreenKind) -> bool {
    match kind {
        FullscreenKind::Exclusive => true,
        FullscreenKind::Soft => !opt_in,
        FullscreenKind::None => false,
    }
}

#[cfg(windows)]
fn fullscreen_kind() -> FullscreenKind {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    // SAFETY: SHQueryUserNotificationState only writes its out-param and returns
    // an HRESULT; no pointers we own are involved.
    unsafe {
        match SHQueryUserNotificationState() {
            Ok(state) if state == QUNS_RUNNING_D3D_FULL_SCREEN => FullscreenKind::Exclusive,
            // QUNS_BUSY = a fullscreen app owns the screen without an exclusive
            // swap chain (borderless game, fullscreen video, F11 browser).
            Ok(state) if state == QUNS_BUSY || state == QUNS_PRESENTATION_MODE => {
                FullscreenKind::Soft
            }
            _ => FullscreenKind::None,
        }
    }
}

#[cfg(not(windows))]
fn fullscreen_kind() -> FullscreenKind {
    FullscreenKind::None
}

/// Window label for a pane's popup. Pane ids are UUIDs (`[0-9a-f-]`), which are
/// valid Tauri window labels.
fn popup_label(pane_id: &str) -> String {
    format!("popup-{pane_id}")
}

/// Logical (width, height) for a notification window of the given style. For the
/// compact toast the width comes from the settings slider (`notif_w`).
fn popup_dims(compact: bool, notif_w: f64) -> (f64, f64) {
    if compact {
        (notif_w, NOTIF_H)
    } else {
        (POPUP_W, POPUP_H)
    }
}

/// Creates the notification window for a pane, or returns the existing one.
/// `compact` picks the two-line toast (`window=notif`) vs the terminal-mirror
/// popup (`window=popup`); both share the `popup-<id>` label so dismiss/open and
/// the cleanup sweeps work regardless of style.
fn ensure_pane_window(
    app: &AppHandle,
    pane_id: &str,
    compact: bool,
    notif_w: f64,
) -> tauri::Result<WebviewWindow> {
    let label = popup_label(pane_id);
    if let Some(w) = app.get_webview_window(&label) {
        return Ok(w);
    }
    let (w, h) = popup_dims(compact, notif_w);
    let kind = if compact { "notif" } else { "popup" };
    let url = format!("index.html?window={kind}&pane={pane_id}");
    let (min_w, min_h) = if compact { (240.0, 52.0) } else { (320.0, 160.0) };
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Arkadia")
        .inner_size(w, h)
        .min_inner_size(min_w, min_h)
        .decorations(false)
        // Mirror popup is resizable (draws its own drag handles); the compact
        // toast is a fixed one-liner.
        .resizable(!compact)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    // A notification must NEVER take activation when it appears: stealing the
    // foreground from an exclusive-fullscreen game minimizes it back to the
    // desktop. `focused(false)` only covers the first show; WS_EX_NOACTIVATE
    // makes the window structurally non-activating (clicks still deliver mouse
    // events, so the toast's open/dismiss keep working). The mirror popup
    // re-activates itself explicitly on user interaction (`setFocus()` in the
    // frontend), which is a deliberate user action and still allowed.
    #[cfg(windows)]
    if let Ok(hwnd) = win.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
        };
        // SAFETY: reading/writing our own window's style bits on a valid HWND.
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE.0 as isize);
        }
    }
    Ok(win)
}

/// Positions a popup at its stack `index`: index 0 (active) sits bottom-right;
/// each one further back is offset up-left so it peeks out behind. Clamped to the
/// monitor. Best-effort — keeps the default placement if the monitor is unknown.
fn cascade_position(win: &WebviewWindow, index: usize) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        // The work area already excludes the taskbar (and adapts to its size,
        // side, and auto-hide), so no hard-coded taskbar height to guess.
        let wa = monitor.work_area();
        let margin = (16.0 * scale) as i32;
        // Sit close above the taskbar — a small gap, not the side margin.
        let bottom_gap = (8.0 * scale) as i32;
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
        // Right/bottom edges keep their gap; left/top are clamped too so even a
        // popup larger than the work area still shows its top-right controls.
        let x = (wa.position.x + wa.size.width as i32 - ww - margin - dx)
            .max(wa.position.x + margin);
        let y = (wa.position.y + wa.size.height as i32 - wh - bottom_gap - dy)
            .max(wa.position.y + margin);
        log_line(&format!(
            "cascade[{index}]: work_area=({},{})+{}x{} scale={scale} win={ww}x{wh} -> ({x},{y}) right_edge={}",
            wa.position.x,
            wa.position.y,
            wa.size.width,
            wa.size.height,
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
    let (items, compact, notif_w) = {
        let queue = app.state::<PopupQueue>();
        let compact = queue.style.load(Ordering::Acquire) == STYLE_COMPACT;
        let notif_w = queue.notif_width.load(Ordering::Acquire) as f64;
        let q = queue.items.lock();
        (q.clone(), compact, notif_w)
    };
    let (fresh_w, fresh_h) = popup_dims(compact, notif_w);
    let wanted: std::collections::HashSet<String> =
        items.iter().map(|i| popup_label(&i.pane_id)).collect();
    // Close windows whose pane is no longer queued.
    for (label, win) in app.webview_windows() {
        if label.starts_with("popup-") && !wanted.contains(&label) {
            let _ = win.close();
        }
    }
    // Create / position / show each queued window by its stack index. (Compact
    // style keeps at most one item, so this is a single bottom-right window.)
    for (index, item) in items.iter().enumerate() {
        match ensure_pane_window(app, &item.pane_id, compact, notif_w) {
            Ok(win) => {
                let fresh = !win.is_visible().unwrap_or(false);
                if fresh {
                    let _ = win.set_size(tauri::LogicalSize::new(fresh_w, fresh_h));
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

/// Dismiss every notification and clear the queue. Called when Arkadia's main
/// window regains focus (the user alt-tabbed back), so a pending notification
/// doesn't linger once they're already looking at Arkadia. No-op (and silent)
/// when nothing is queued — `Focused(true)` fires on every normal focus gain.
pub fn dismiss_all(app: &AppHandle) {
    let had = {
        let queue = app.state::<PopupQueue>();
        let mut items = queue.items.lock();
        let n = items.len();
        items.clear();
        n
    };
    if had > 0 {
        close_all_popups(app);
        emit_state(app);
        log_line("main window focused — dismissed all notifications");
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

/// Set the notification style from the frontend (`off` / `mirror` / `compact`).
/// On an actual change we clear the queue and close any open windows, so we
/// never leave a stale window of the previous style around.
#[tauri::command]
pub fn popup_set_style(style: String, app: AppHandle, queue: State<'_, PopupQueue>) {
    let next = style_from_str(&style);
    let prev = queue.style.swap(next, Ordering::Release);
    if prev != next {
        queue.items.lock().clear();
        close_all_popups(&app);
    }
}

/// Mirror the "show even over a fullscreen app" frontend setting into the queue.
#[tauri::command]
pub fn popup_set_fullscreen(enabled: bool, queue: State<'_, PopupQueue>) {
    queue.fullscreen.store(enabled, Ordering::Release);
}

/// Set the compact-notification width (px) from the settings slider. Live-resizes
/// an open compact notification and re-anchors it bottom-right.
#[tauri::command]
pub fn popup_set_notif_width(width: u32, app: AppHandle, queue: State<'_, PopupQueue>) {
    let clamped = width.clamp(NOTIF_W_MIN, NOTIF_W_MAX);
    queue.notif_width.store(clamped, Ordering::Release);
    if queue.style.load(Ordering::Acquire) == STYLE_COMPACT {
        for (label, win) in app.webview_windows() {
            if label.starts_with("popup-") {
                let _ = win.set_size(tauri::LogicalSize::new(clamped as f64, NOTIF_H));
                cascade_position(&win, 0);
            }
        }
    }
}

/// One pane → project-name pair, as pushed by the frontend.
#[derive(Deserialize)]
pub struct PaneProject {
    #[serde(rename = "paneId")]
    pane_id: String,
    #[serde(rename = "projectName")]
    project_name: String,
}

/// Register the full pane → Arkadia-project-name map (used to label the compact
/// notification). The frontend pushes the whole map whenever tabs/projects
/// change, so this replaces the previous map wholesale.
#[tauri::command]
pub fn set_pane_projects(entries: Vec<PaneProject>, registry: State<'_, Arc<AgentRegistry>>) {
    let parsed = entries
        .into_iter()
        .filter_map(|e| uuid::Uuid::parse_str(&e.pane_id).ok().map(|u| (u, e.project_name)))
        .collect();
    registry.set_pane_projects(parsed);
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

#[cfg(test)]
mod tests {
    use super::{suppress_for_fullscreen, FullscreenKind};

    #[test]
    fn exclusive_fullscreen_is_always_suppressed() {
        // Even with the "show over fullscreen" opt-in: a topmost window over an
        // exclusive swap chain kicks the game back to the desktop.
        assert!(suppress_for_fullscreen(true, FullscreenKind::Exclusive));
        assert!(suppress_for_fullscreen(false, FullscreenKind::Exclusive));
    }

    #[test]
    fn soft_fullscreen_follows_the_opt_in() {
        assert!(suppress_for_fullscreen(false, FullscreenKind::Soft));
        assert!(!suppress_for_fullscreen(true, FullscreenKind::Soft));
    }

    #[test]
    fn no_fullscreen_never_suppresses() {
        assert!(!suppress_for_fullscreen(true, FullscreenKind::None));
        assert!(!suppress_for_fullscreen(false, FullscreenKind::None));
    }
}
