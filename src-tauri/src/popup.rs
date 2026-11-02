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
//!
//! Arkadia Lab watches its own folder (`notify-lab`), so neither instance
//! takes the other's signals. A chat pane (Lab) has no hook signal: its page
//! reports the same two moments (`popup_chat_signal`), always shown as the
//! compact toast whatever the style, the tab named by the chat's title.
//!
//! No grace delay (31/10/2026): a signal is decided and shown at once.

use std::collections::HashSet;
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

/// Debounce for the completion chime: Claude Code fires several hooks around one
/// event, each landing a signal, so without this the pane would chime two or
/// three times. Mirrors `notify-done.ps1`: a `done` (Stop) is the primary sound
/// and only guards against a true rapid double, while a `question` also arrives
/// as a `Notification` hook ~8.6s after its `PreToolUse` — the 15s window
/// collapses that pair into one chime, and a genuine idle reminder (~60s later)
/// still gets through.
const SOUND_DEBOUNCE_DONE: Duration = Duration::from_secs(3);
const SOUND_DEBOUNCE_QUESTION: Duration = Duration::from_secs(15);

/// Whether a chime may play `elapsed_since_last` after the previous one, for a
/// signal of the given kind. `None` = no sound has played yet.
fn chime_allowed(elapsed_since_last: Option<Duration>, kind: &str) -> bool {
    let window = if kind == "question" {
        SOUND_DEBOUNCE_QUESTION
    } else {
        SOUND_DEBOUNCE_DONE
    };
    match elapsed_since_last {
        Some(elapsed) => elapsed >= window,
        None => true,
    }
}

/// One notification per pane while the user is away: a turn Claude started on
/// its own (a background task ended, another session wrote, a scheduled wakeup)
/// stays silent — no chime, no popup — when that pane already notified since
/// Arkadia's main window last had focus. Coming back shows its latest reply.
fn mute_self_woken(self_woken: bool, foreground: bool, already_told: bool) -> bool {
    self_woken && !foreground && already_told
}

/// Records a pane that just rang: a finished turn while the user is away arms
/// `mute_self_woken`. A question disarms it: the user may answer it from the popup
/// or the phone without focusing Arkadia, and Claude's next turn answers them.
fn note_told(told: &mut HashSet<String>, pane_id: &str, kind: &str, away: bool) {
    if kind == "question" {
        told.remove(pane_id);
    } else if away {
        told.insert(pane_id.to_string());
    }
}

/// What a chat pane's page says of its signal: a chat has no hook nor PTY
/// title (`popup_chat_signal`).
struct ChatInfo {
    /// The tab name: the chat's title.
    tab: String,
    /// A ❓ round in Claude's last words: it rings as a question, but arms the
    /// one notice per tab like an end (`told_kind`).
    round: bool,
}

/// The kind `note_told` records. A terminal pane's ❓ round comes as a Stop
/// (`done`) and arms the mute; a chat's comes as a `question`, so it is told
/// as the end it also is. Only a real ask lifts the mute.
fn told_kind(kind: &str, round: bool) -> &str {
    if round {
        "done"
    } else {
        kind
    }
}

/// Completion chime, played by Arkadia itself (for Arkadia panes) so it follows
/// the popup's own gates (`mute_self_woken`, debounce). Non-Arkadia Claude
/// sessions keep sounding from `notify-done.ps1`. Matches the file that hook used.
#[cfg(windows)]
const NOTIFY_SOUND: &str = r"C:\Windows\Media\Windows Hardware Fail.wav";

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

/// Whether an item shows as the compact toast: every item in compact style,
/// and a chat pane's whatever the style (it has no terminal to mirror).
/// `off` never queues anything.
fn compact_for(style: u8, chat: bool) -> bool {
    chat || style == STYLE_COMPACT
}

/// Whether the toast is kept built for the style: any but `off`, since chat
/// panes use it whatever the style (`compact_for`). Built on demand, its
/// first notification would freeze the main thread (REVIEW.md).
fn toast_wanted(style: u8) -> bool {
    style != STYLE_OFF
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
    /// notification. Empty when the session isn't in the live map. A chat
    /// pane's comes from its page: the chat's title.
    pub tab_title: String,
    /// A chat pane (Arkadia Lab): always the compact toast (`compact_for`).
    pub chat: bool,
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
    /// Last time the completion chime played. Collapses the several hooks Claude
    /// Code fires around one completion (Stop, then Notification) into a single
    /// chime — see `chime_allowed`.
    pub last_sound: parking_lot::Mutex<Option<Instant>>,
    /// Panes that notified while the user was away, cleared when Arkadia's main
    /// window regains focus — see `mute_self_woken`.
    pub told_while_away: parking_lot::Mutex<HashSet<String>>,
    /// True while a thread builds the compact window. Tauri only refuses a
    /// label once its window exists, so a second build started meanwhile
    /// would make a twin.
    notif_building: std::sync::atomic::AtomicBool,
}

impl Default for PopupQueue {
    fn default() -> Self {
        Self {
            items: parking_lot::Mutex::new(Vec::new()),
            style: std::sync::atomic::AtomicU8::new(STYLE_MIRROR),
            fullscreen: std::sync::atomic::AtomicBool::new(false),
            notif_width: std::sync::atomic::AtomicU32::new(NOTIF_W as u32),
            auto_scroll: std::sync::atomic::AtomicBool::new(true),
            last_sound: parking_lot::Mutex::new(None),
            told_while_away: parking_lot::Mutex::new(HashSet::new()),
            notif_building: std::sync::atomic::AtomicBool::new(false),
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
    /// `done` only: Claude started this turn on its own, not the user (see
    /// `mute_self_woken`). Absent → the user's turn.
    #[serde(rename = "selfWoken")]
    self_woken: Option<bool>,
}

/// `%LOCALAPPDATA%/Arkadia/notify` — the directory the hook drops signals into.
/// Arkadia Lab's panes carry `ARKADIA_LAB`, and the hook drops theirs into
/// `notify-lab`: each instance only hears its own tabs.
pub fn signal_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join(signal_folder(crate::lab::LAB))
}

fn signal_folder(lab: bool) -> &'static str {
    if lab {
        "notify-lab"
    } else {
        "notify"
    }
}

/// Size past which `popup.log` moves to `popup.old.log` and starts over.
const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

/// Appends a diagnostic line to `%LOCALAPPDATA%/Arkadia/popup.log` (and stderr).
/// Lets us trace the popup decision path without a visible dev console. Each
/// line carries its time: without it, a freeze could only be dated from the
/// notification timestamps around it. Arkadia Lab keeps its own pair of files,
/// so its freezes never count as the daily instance's.
pub(crate) fn log_line(msg: &str) {
    eprintln!("[arkadia popup] {msg}");
    let (name, old) = if crate::lab::LAB {
        ("popup.lab.log", "popup.lab.old.log")
    } else {
        ("popup.log", "popup.old.log")
    };
    let path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    // Built before taking the lock: the panic hook logs through here, so
    // nothing that can panic (the clock reads the time zone) may run while it
    // is held — a panic there would deadlock the hook on the same thread.
    let line = format!(
        "{} {msg}\n",
        chrono::Local::now().format("%m-%d %H:%M:%S%.3f")
    );
    // Several threads log at once during a freeze: without this, two could
    // both see the file full and the second would rotate the fresh one-line
    // file over the history just saved.
    static LOG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_ROTATE_BYTES) {
        let _ = std::fs::rename(&path, path.with_file_name(old));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
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
    let pane_id: String = match sig
        .pane_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && uuid::Uuid::parse_str(s).is_ok())
    {
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

    // If the user is looking at Arkadia right now, auto-scroll the terminal to the
    // start of the reply immediately (nice while you're watching; done directly off
    // the Stop/PreToolUse hook — reliable, no frontend round-trip). We do NOT scroll
    // when backgrounded: the popup mirrors the same Claude Code screen, so scrolling
    // would move what the popup shows. This never suppresses the notification — the
    // chime still fires regardless of focus.
    if main_is_foreground(app)
        && app
            .state::<PopupQueue>()
            .auto_scroll
            .load(Ordering::Acquire)
    {
        log_line("Arkadia foreground — scrolling terminal to reply");
        let sessions = app.state::<crate::terminal::SessionMap>();
        crate::terminal::scroll_pane_to_reply_top(app, &pane_id, sessions.inner());
    }

    // At once, no grace (31/10/2026): chime unconditionally, and the popup if the
    // user is away. On a thread of its own: the chime blocks it while it plays.
    let app = app.clone();
    let registry = Arc::clone(registry);
    let kind = derive_kind(sig);
    let self_woken = kind == "done" && sig.self_woken.unwrap_or(false);
    let cwd = cwd.to_string();
    let ts = sig.ts.unwrap_or(0);
    log_line(&format!(
        "pane {pane_id} — chiming now; popup too unless Arkadia has focus"
    ));
    std::thread::spawn(move || {
        show_signal(&app, &registry, pane_id, kind, self_woken, cwd, ts, None);
    });
}

/// True when Arkadia's main window is focused, or is the front-most real window
/// with only an always-on-top overlay (PiP) above it.
fn main_is_foreground(app: &AppHandle) -> bool {
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    // Reading an artifact beside the terminals is being in Arkadia too.
    focused || crate::artifact_view::has_focus(app) || main_is_effective_foreground(app)
}

/// Runs as soon as a signal lands (no grace since 31/10/2026), on a throwaway
/// thread: the chime blocks it while it plays. The chime plays (debounced)
/// whatever the focus, style or fullscreen — the user wants an audible cue —
/// unless `mute_self_woken` silences the whole signal. The POPUP appears only
/// while the user is away and notifications are on/allowed. Every gate reads
/// the state now. `chat`: a chat pane's signal, from its page: always the
/// compact toast, never the phone.
#[allow(clippy::too_many_arguments)]
fn show_signal(
    app: &AppHandle,
    registry: &Arc<AgentRegistry>,
    pane_id: String,
    kind: String,
    self_woken: bool,
    cwd: String,
    ts: u64,
    chat: Option<ChatInfo>,
) {
    let round = chat.as_ref().is_some_and(|c| c.round);
    let chat_tab = chat.map(|c| c.tab);
    let queue = app.state::<PopupQueue>();
    let already_told = queue.told_while_away.lock().contains(&pane_id);
    if mute_self_woken(self_woken, main_is_foreground(app), already_told) {
        log_line(&format!(
            "pane {pane_id} restarted on its own and already notified while away — silent"
        ));
        return;
    }

    // The iPhone rings for the panes Alexis drives from it, whatever the PC
    // shows (`remote::phone`): he is away from the PC then. A chat names its
    // tab itself: its shell's title is the idle shell's.
    if crate::remote::phone::FOLLOW.should_notify(&pane_id) {
        let project = uuid::Uuid::parse_str(&pane_id)
            .ok()
            .and_then(|u| registry.project_name_for_pane(u))
            .unwrap_or_default();
        let tab = match &chat_tab {
            Some(tab) => tab.clone(),
            None => {
                let sessions = app.state::<crate::terminal::SessionMap>();
                crate::terminal::session_title(sessions.inner(), &pane_id).unwrap_or_default()
            }
        };
        crate::remote::phone::notify(&pane_id, &kind, self_woken, &project, &tab);
    }

    // Sound first (debounced against the multi-hook double-fire). It ignores
    // focus, notification style and fullscreen on purpose — "quoi qu'il arrive".
    maybe_play_sound(app, &kind);

    // The popup, however, only while the user is away from Arkadia. Read after
    // the chime, which blocks ~0.7 s: the user may come back while it plays.
    let away = !main_is_foreground(app);
    note_told(
        &mut queue.told_while_away.lock(),
        &pane_id,
        told_kind(&kind, round),
        away,
    );
    if !away {
        log_line(&format!(
            "Arkadia has focus — chimed, no popup for pane {pane_id}"
        ));
        return;
    }

    let style = queue.style.load(Ordering::Acquire);
    if style == STYLE_OFF {
        log_line("notifications off — chimed, no popup");
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
    // pane's live terminal title, or a chat's title from its page.
    let project_name = uuid::Uuid::parse_str(&pane_id)
        .ok()
        .and_then(|u| registry.project_name_for_pane(u))
        .unwrap_or_default();
    let chat = chat_tab.is_some();
    let tab_title = chat_tab.unwrap_or_else(|| {
        let sessions = app.state::<crate::terminal::SessionMap>();
        crate::terminal::session_title(sessions.inner(), &pane_id).unwrap_or_default()
    });

    // The compact toast shows ONE notification at a time: while it is up for
    // another pane, drop the rest (nothing re-appears when it's closed).
    if compact_for(style, chat)
        && queue
            .items
            .lock()
            .iter()
            .any(|i| i.pane_id != pane_id && compact_for(style, i.chat))
    {
        log_line("compact notification busy — dropping this signal");
        return;
    }

    log_line(&format!(
        "showing notification (style {style}, chat {chat}) for pane {pane_id}"
    ));

    let item = WaitingItem {
        pane_id,
        kind,
        cwd,
        ts,
        project_name,
        tab_title,
        chat,
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
            // Switched between chat and terminal since: its window changes.
            existing.chat = item.chat;
        } else {
            // A new conversation goes BEHIND the others, in arrival order — the
            // active (front) popup is never disrupted by a fresh notification.
            q.push(item);
        }
    }
    sync_popups(app);
}

/// Plays the completion chime unless one already played within the kind's
/// debounce window (see `chime_allowed`), which collapses the several hooks
/// Claude Code fires for one completion into a single chime.
fn maybe_play_sound(app: &AppHandle, kind: &str) {
    let queue = app.state::<PopupQueue>();
    {
        let mut last = queue.last_sound.lock();
        if !chime_allowed(last.map(|prev| prev.elapsed()), kind) {
            log_line("chime debounced (recent sound)");
            return;
        }
        *last = Some(Instant::now());
    }
    play_notification_sound();
}

/// Plays the completion chime synchronously: called from a throwaway signal
/// thread, so `SND_SYNC` blocks only that disposable thread and keeps the path
/// string alive for the whole call. Arkadia panes sound from here; non-Arkadia
/// sessions still sound from `notify-done.ps1`.
#[cfg(windows)]
fn play_notification_sound() {
    use windows::core::HSTRING;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_FILENAME, SND_NODEFAULT, SND_SYNC};
    let path = HSTRING::from(NOTIFY_SOUND);
    // SAFETY: PlaySoundW reads the (null-terminated, valid-for-the-call) path and
    // plays a system .wav; no owned resources are handed off.
    unsafe {
        let _ = PlaySoundW(&path, None, SND_FILENAME | SND_SYNC | SND_NODEFAULT);
    }
}

#[cfg(not(windows))]
fn play_notification_sound() {}

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
        IsWindowVisible, GWL_EXSTYLE, GW_HWNDNEXT, GW_OWNER, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
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
                    // A window main owns (the artifact panel) is Arkadia too.
                    let owner = GetWindow(hwnd, GW_OWNER).map(|h| h.0 as isize).unwrap_or(0);
                    if hwnd.0 as isize == main_raw || owner == main_raw {
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

/// The compact toast is one window for every pane, built once, then only hidden
/// and shown again. Building a webview runs on the main thread and took up to
/// 7.7 s while terminals were busy, every window frozen meanwhile (27/10/2026).
/// Its page shows the queue's single item. Mirror popups keep one window per
/// pane, closed with it.
const NOTIF_LABEL: &str = "popup-notif";

/// Label of the window showing `pane_id` in the given style. The `popup-`
/// prefix is shared, so the sweeps reach every notification window.
fn window_label(pane_id: &str, compact: bool) -> String {
    if compact {
        NOTIF_LABEL.to_string()
    } else {
        popup_label(pane_id)
    }
}

/// Label of the window showing a queued item under the style (`compact_for`).
fn item_label(item: &WaitingItem, style: u8) -> String {
    window_label(&item.pane_id, compact_for(style, item.chat))
}

/// Creates the window showing a pane, or returns the existing one. `compact`
/// picks the two-line toast (`window=notif`, the shared `NOTIF_LABEL` window)
/// vs the terminal-mirror popup (`window=popup`, one per pane). `None` while
/// another thread builds the toast: that thread shows the queue once done.
fn ensure_pane_window(
    app: &AppHandle,
    pane_id: &str,
    compact: bool,
    notif_w: f64,
) -> tauri::Result<Option<WebviewWindow>> {
    let label = window_label(pane_id, compact);
    if let Some(w) = app.get_webview_window(&label) {
        return Ok(Some(w));
    }
    if !compact {
        return build_pane_window(app, &label, pane_id, false, notif_w).map(Some);
    }
    let queue = app.state::<PopupQueue>();
    if queue.notif_building.swap(true, Ordering::AcqRel) {
        return Ok(None);
    }
    let built = build_pane_window(app, &label, pane_id, true, notif_w);
    queue.notif_building.store(false, Ordering::Release);
    built.map(Some)
}

/// Builds a notification window, hidden. On the main thread, however long
/// WebView2 takes: hence the toast built once (`NOTIF_LABEL`).
fn build_pane_window(
    app: &AppHandle,
    label: &str,
    pane_id: &str,
    compact: bool,
    notif_w: f64,
) -> tauri::Result<WebviewWindow> {
    let (w, h) = popup_dims(compact, notif_w);
    let url = if compact {
        "index.html?window=notif".to_string()
    } else {
        format!("index.html?window=popup&pane={pane_id}")
    };
    let (min_w, min_h) = if compact {
        (240.0, 52.0)
    } else {
        (320.0, 160.0)
    };
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
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

/// Shows or hides `win` as the queue stands when the main thread gets to it.
/// `dismiss_all` and the dismiss commands run there: a sync started on an
/// older queue can no longer show a window they just hid (the toast is only
/// hidden now, so a late show brought it back empty), nor hide one a newer
/// notification needs. Showing never activates: built `focused(false)`, the
/// window keeps tao's no-activate show for good.
fn show_if_queued(app: &AppHandle, win: WebviewWindow) {
    let app2 = app.clone();
    let label = win.label().to_string();
    let _ = app.run_on_main_thread(move || {
        let queue = app2.state::<PopupQueue>();
        let style = queue.style.load(Ordering::Acquire);
        let queued = queue
            .items
            .lock()
            .iter()
            .any(|i| item_label(i, style) == label);
        let _ = if queued { win.show() } else { win.hide() };
    });
}

/// Builds the compact toast ahead of its first notification, hidden, so no
/// notification pays the build (`NOTIF_LABEL`). Off the caller's thread: the
/// caller, `popup_set_style`, is a sync command on the main thread.
fn prebuild_notif_window(app: AppHandle) {
    std::thread::spawn(move || {
        let queue = app.state::<PopupQueue>();
        let notif_w = queue.notif_width.load(Ordering::Acquire) as f64;
        match ensure_pane_window(&app, "", true, notif_w) {
            Ok(Some(_)) => log_line("compact notification window ready"),
            Ok(None) => log_line("compact notification window already being built"),
            Err(e) => log_line(&format!("compact notification window build failed: {e}")),
        }
        // The style changed during the build: the toast has no use left.
        if !toast_wanted(queue.style.load(Ordering::Acquire)) {
            if let Some(w) = app.get_webview_window(NOTIF_LABEL) {
                let _ = w.destroy();
            }
            return;
        }
        // A notification that came during the build waited for it.
        if !queue.items.lock().is_empty() {
            sync_popups(&app);
        }
    });
}

/// `main` closed for good (not a watchdog rebuild): the notification windows
/// go with it. The toast lives hidden all session and is not owned by `main`
/// (an owned window hides when `main` is minimized). Left alive, it kept the
/// process running without a window, and the watchdog then rebuilt `main`.
pub fn close_with_main(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("popup-") {
            let _ = win.destroy();
        }
    }
}

/// Gap (logical px) between the compact toast and mirror popups stacked above it.
const TOAST_GAP: f64 = 8.0;

/// How far mirror popups rise (logical px) so the compact toast under them
/// stays visible and clickable: the Lab shows a chat pane's toast beside a
/// terminal pane's mirror popup, both anchored bottom-right.
fn mirror_lift(toast_up: bool) -> f64 {
    if toast_up {
        NOTIF_H + TOAST_GAP
    } else {
        0.0
    }
}

/// Physical top-left of a window of `size` at stack `index` in the work area
/// `wa` (x, y, width, height), raised by `lift` logical px. Right/bottom edges
/// keep their gap; left/top are clamped too so even a popup larger than the
/// work area still shows its top-right controls.
fn cascade_xy(
    wa: (i32, i32, i32, i32),
    scale: f64,
    (ww, wh): (i32, i32),
    index: usize,
    lift: f64,
) -> (i32, i32) {
    let (wx, wy, width, height) = wa;
    let margin = (16.0 * scale) as i32;
    // Sit close above the taskbar — a small gap, not the side margin.
    let bottom_gap = (8.0 * scale) as i32;
    let dx = (CASCADE_DX * scale) as i32 * index as i32;
    let dy = (CASCADE_DY * scale) as i32 * index as i32 + (lift * scale) as i32;
    let x = (wx + width - ww - margin - dx).max(wx + margin);
    let y = (wy + height - wh - bottom_gap - dy).max(wy + margin);
    (x, y)
}

/// Positions a popup at its stack `index`: index 0 (active) sits bottom-right;
/// each one further back is offset up-left so it peeks out behind; `lift`
/// raises it above the toast (`mirror_lift`). Clamped to the monitor.
/// Best-effort — keeps the default placement if the monitor is unknown.
fn cascade_position(win: &WebviewWindow, index: usize, lift: f64) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        // The work area already excludes the taskbar (and adapts to its size,
        // side, and auto-hide), so no hard-coded taskbar height to guess.
        let wa = monitor.work_area();
        // Anchor on the window's ACTUAL outer size, not the default POPUP_W/H:
        // the user can resize a popup (drag handles) and the window persists
        // across re-notifications, so assuming 470px would let a widened popup
        // hang off the right edge and clip the ✕. Fall back to the defaults when
        // the size isn't available yet (a freshly built window).
        let (ww, wh) = match win.outer_size() {
            Ok(s) => (s.width as i32, s.height as i32),
            Err(_) => ((POPUP_W * scale) as i32, (POPUP_H * scale) as i32),
        };
        let area = (
            wa.position.x,
            wa.position.y,
            wa.size.width as i32,
            wa.size.height as i32,
        );
        let (x, y) = cascade_xy(area, scale, (ww, wh), index, lift);
        log_line(&format!(
            "cascade[{index}] lift={lift}: work_area=({},{})+{}x{} scale={scale} win={ww}x{wh} -> ({x},{y}) right_edge={}",
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
    let (items, style, notif_w) = {
        let queue = app.state::<PopupQueue>();
        let style = queue.style.load(Ordering::Acquire);
        let notif_w = queue.notif_width.load(Ordering::Acquire) as f64;
        let q = queue.items.lock();
        (q.clone(), style, notif_w)
    };
    let wanted: std::collections::HashSet<String> =
        items.iter().map(|i| item_label(i, style)).collect();
    // First, so a toast about to hide gets its empty state before it does, and
    // the reused toast never shows its previous pane.
    emit_state(app);
    // Close windows whose pane is no longer queued; the toast only hides.
    for (label, win) in app.webview_windows() {
        if !label.starts_with("popup-") || wanted.contains(&label) {
            continue;
        }
        if label == NOTIF_LABEL {
            show_if_queued(app, win);
        } else {
            let _ = win.close();
        }
    }
    // Create / position / show each queued window. The toast holds a single
    // item, bottom-right; mirror popups cascade by their own stack index,
    // above the toast while it is up (the Lab mixes both: its chat panes
    // always use the toast).
    let lift = mirror_lift(items.iter().any(|i| compact_for(style, i.chat)));
    let mut stack = 0;
    for item in &items {
        let compact = compact_for(style, item.chat);
        let (index, raise) = if compact {
            (0, 0.0)
        } else {
            stack += 1;
            (stack - 1, lift)
        };
        match ensure_pane_window(app, &item.pane_id, compact, notif_w) {
            Ok(Some(win)) => {
                let fresh = !win.is_visible().unwrap_or(false);
                if fresh {
                    let (w, h) = popup_dims(compact, notif_w);
                    let _ = win.set_size(tauri::LogicalSize::new(w, h));
                }
                cascade_position(&win, index, raise);
                if fresh {
                    show_if_queued(app, win);
                }
            }
            Ok(None) => log_line("compact notification window still building"),
            Err(e) => log_line(&format!("popup window create failed: {e}")),
        }
    }
    // Re-raise z-order back-to-front so index 0 ends up on top of the stack.
    for item in items.iter().rev() {
        if let Some(win) = app.get_webview_window(&item_label(item, style)) {
            let _ = win.set_always_on_top(false);
            let _ = win.set_always_on_top(true);
        }
    }
    log_line(&format!("sync_popups: {} window(s)", items.len()));
}

fn emit_state(app: &AppHandle) {
    let (items, style) = {
        let queue = app.state::<PopupQueue>();
        let style = queue.style.load(Ordering::Acquire);
        let q = queue.items.lock();
        (q.clone(), style)
    };
    // Each mirror popup filters the queue down to its own pane; the compact
    // toast shows its single item, so it gets only the items it holds.
    let toast = PopupStatePayload {
        items: items
            .iter()
            .filter(|i| compact_for(style, i.chat))
            .cloned()
            .collect(),
    };
    let payload = PopupStatePayload { items };
    for (label, win) in app.webview_windows() {
        if label == NOTIF_LABEL {
            let _ = win.emit("popup-state", toast.clone());
        } else if label.starts_with("popup-") {
            let _ = win.emit("popup-state", payload.clone());
        }
    }
}

/// Closes every popup window, except the compact toast when `keep_toast`: it
/// only hides, ready for the next notification (`NOTIF_LABEL`).
fn close_all_popups(app: &AppHandle, keep_toast: bool) {
    for (label, win) in app.webview_windows() {
        if !label.starts_with("popup-") {
            continue;
        }
        if keep_toast && label == NOTIF_LABEL {
            let _ = win.hide();
        } else {
            let _ = win.close();
        }
    }
}

/// The user is back in Arkadia (main window or an artifact focused): the next
/// notification of any pane rings again — see `mute_self_woken`.
pub fn user_is_back(app: &AppHandle) {
    app.state::<PopupQueue>().told_while_away.lock().clear();
}

/// Dismiss every notification and clear the queue. Called when Arkadia's main
/// window regains focus (the user alt-tabbed back), so a pending notification
/// doesn't linger once they're already looking at Arkadia. No-op (and silent)
/// when nothing is queued — `Focused(true)` fires on every normal focus gain.
pub fn dismiss_all(app: &AppHandle) {
    user_is_back(app);
    let had = {
        let queue = app.state::<PopupQueue>();
        let mut items = queue.items.lock();
        let n = items.len();
        items.clear();
        n
    };
    if had > 0 {
        // Empty state first, so the toast hides already blank.
        emit_state(app);
        close_all_popups(app, true);
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
/// never leave a stale window of the previous style around (the toast only
/// hides while the new style still wants it). The frontend sends the saved
/// style at startup, which builds the compact toast ahead of time whatever
/// the style but `off`, for the chat panes (`toast_wanted`).
#[tauri::command]
pub fn popup_set_style(style: String, app: AppHandle, queue: State<'_, PopupQueue>) {
    let next = style_from_str(&style);
    let prev = queue.style.swap(next, Ordering::Release);
    let wanted = toast_wanted(next);
    if prev != next {
        queue.items.lock().clear();
        close_all_popups(&app, wanted);
    }
    if wanted && app.get_webview_window(NOTIF_LABEL).is_none() {
        prebuild_notif_window(app);
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
    // The toast alone: the Lab's mirror popups may stand beside it.
    if let Some(win) = app.get_webview_window(NOTIF_LABEL) {
        let _ = win.set_size(tauri::LogicalSize::new(clamped as f64, NOTIF_H));
        cascade_position(&win, 0, 0.0);
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
        .filter_map(|e| {
            uuid::Uuid::parse_str(&e.pane_id)
                .ok()
                .map(|u| (u, e.project_name))
        })
        .collect();
    registry.set_pane_projects(parsed);
}

/// Whether a chat signal counts as self-woken: an end, or a ❓ round (an end
/// that rings as a question), keeps the page's flag; a real ask never mutes.
fn chat_self_woken(kind: &str, round: bool, self_woken: bool) -> bool {
    (kind == "done" || round) && self_woken
}

/// A chat pane's turn ended, or Claude waits on the user there: its page says
/// so (`useChatNotify`), since no hook writes for a chat (`arkadia-notify.ps1`
/// skips `ARKADIA_CHAT`). From here the path of a hook's signal, as the
/// compact toast whatever the style, its tab named `tab_title`. `round`: a
/// ❓ round, sent as a `question` (`told_kind`). Off the main thread: the
/// chime blocks its thread while it plays.
#[tauri::command(async)]
pub fn popup_chat_signal(
    pane_id: String,
    kind: String,
    self_woken: bool,
    round: bool,
    tab_title: String,
    cwd: String,
    app: AppHandle,
) {
    // Window labels and project names go by pane UUID.
    if uuid::Uuid::parse_str(&pane_id).is_err() {
        log_line(&format!(
            "chat signal for an unknown pane {pane_id:?} — ignored"
        ));
        return;
    }
    let kind = if kind == "question" {
        "question"
    } else {
        "done"
    }
    .to_string();
    let self_woken = chat_self_woken(&kind, round, self_woken);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    log_line(&format!(
        "chat signal: pane {pane_id} {kind} selfWoken={self_woken} round={round}"
    ));
    std::thread::spawn(move || {
        let registry = Arc::clone(app.state::<Arc<AgentRegistry>>().inner());
        let chat = ChatInfo {
            tab: tab_title,
            round,
        };
        show_signal(
            &app,
            &registry,
            pane_id,
            kind,
            self_woken,
            cwd,
            ts,
            Some(chat),
        );
    });
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
    use super::{cascade_xy, chat_self_woken, mirror_lift, told_kind, NOTIF_W, POPUP_H, POPUP_W};
    use super::{
        chime_allowed, compact_for, mute_self_woken, note_told, signal_folder,
        suppress_for_fullscreen, toast_wanted, window_label, FullscreenKind, NOTIF_LABEL,
        STYLE_COMPACT, STYLE_MIRROR, STYLE_OFF,
    };
    use std::collections::HashSet;
    use std::time::Duration;

    /// Arkadia shows a chat's toast and a terminal's mirror popup at once,
    /// both bottom-right: the mirror cascade rises above the toast.
    #[test]
    fn a_mirror_popup_never_covers_the_toast() {
        let area = (0, 0, 1920, 1040);
        for scale in [1.0, 1.25, 1.5] {
            let toast = ((NOTIF_W * scale) as i32, (super::NOTIF_H * scale) as i32);
            let mirror = ((POPUP_W * scale) as i32, (POPUP_H * scale) as i32);
            let (_, toast_top) = cascade_xy(area, scale, toast, 0, 0.0);
            let (_, mirror_top) = cascade_xy(area, scale, mirror, 0, mirror_lift(true));
            assert!(mirror_top + mirror.1 <= toast_top, "scale {scale}");
        }
        // Without a toast, the mirror popup keeps its old place.
        assert_eq!(mirror_lift(false), 0.0);
    }

    /// A chat's ❓ round rings as a question but arms the one notice per tab
    /// like a terminal's (a Stop): the next self-woken turn stays silent.
    #[test]
    fn a_chat_round_arms_the_mute_like_an_end() {
        let mut told = HashSet::new();
        note_told(&mut told, "p", told_kind("question", true), true);
        assert!(told.contains("p"));
        assert!(mute_self_woken(true, false, told.contains("p")));
        // A real ask still lifts it.
        note_told(&mut told, "p", told_kind("question", false), true);
        assert!(!told.contains("p"));
    }

    /// A self-woken ❓ round keeps its flag through the command, so the tab
    /// that already rang stays silent; a real ask never counts as self-woken.
    #[test]
    fn a_self_woken_round_keeps_its_flag() {
        assert!(chat_self_woken("question", true, true));
        assert!(chat_self_woken("done", false, true));
        assert!(!chat_self_woken("question", false, true));
        assert!(!chat_self_woken("done", false, false));
    }

    /// The daily instance and the Lab never take each other's signals.
    #[test]
    fn each_instance_watches_its_own_folder() {
        assert_eq!(signal_folder(false), "notify");
        assert_eq!(signal_folder(true), "notify-lab");
    }

    /// A chat pane has no terminal to mirror: the toast, whatever the style.
    #[test]
    fn a_chat_pane_always_gets_the_toast() {
        assert!(compact_for(STYLE_MIRROR, true));
        assert!(!compact_for(STYLE_MIRROR, false));
        assert!(compact_for(STYLE_COMPACT, false));
        // So the toast stays built in mirror style too, never when off.
        assert!(toast_wanted(STYLE_MIRROR));
        assert!(toast_wanted(STYLE_COMPACT));
        assert!(!toast_wanted(STYLE_OFF));
    }

    #[test]
    fn a_question_lifts_the_mute_since_it_can_be_answered_outside_arkadia() {
        let mut told = HashSet::new();
        note_told(&mut told, "p", "done", false);
        assert!(told.is_empty(), "in Arkadia, nothing to remember");
        note_told(&mut told, "p", "done", true);
        assert!(told.contains("p"));
        note_told(&mut told, "p", "question", true);
        assert!(!told.contains("p"));
    }

    #[test]
    fn self_woken_turn_stays_silent_once_the_pane_notified_while_away() {
        assert!(mute_self_woken(true, false, true));
        // First notice of this pane since the user left: it rings.
        assert!(!mute_self_woken(true, false, false));
        // A turn the user started (typed, or an artifact reply) always rings.
        assert!(!mute_self_woken(false, false, true));
        // In Arkadia: the usual chime without popup.
        assert!(!mute_self_woken(true, true, true));
    }

    #[test]
    fn first_chime_always_allowed() {
        assert!(chime_allowed(None, "done"));
        assert!(chime_allowed(None, "question"));
    }

    #[test]
    fn question_pair_from_pretooluse_and_notification_chimes_once() {
        // A question lands twice: PreToolUse, then the Notification hook ~8.6s
        // later. The second signal must stay silent.
        assert!(!chime_allowed(
            Some(Duration::from_millis(8_600)),
            "question"
        ));
        // A genuine idle reminder (~60s later) still gets through.
        assert!(chime_allowed(Some(Duration::from_secs(60)), "question"));
    }

    #[test]
    fn done_only_guards_against_a_rapid_double() {
        assert!(!chime_allowed(Some(Duration::from_secs(2)), "done"));
        // A new completion 8s after the previous chime is a real event.
        assert!(chime_allowed(Some(Duration::from_millis(8_600)), "done"));
    }

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

    /// Every compact notification reuses one window: building one per pane
    /// froze Arkadia up to 7.7 s each time (27/10/2026).
    #[test]
    fn compact_notifications_share_one_window() {
        assert_eq!(window_label("a", true), NOTIF_LABEL);
        assert_eq!(window_label("b", true), NOTIF_LABEL);
        assert_ne!(window_label("a", false), window_label("b", false));
        assert!(NOTIF_LABEL.starts_with("popup-"), "the sweeps match on it");
    }
}
