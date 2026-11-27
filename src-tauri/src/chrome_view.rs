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
//! - OpenCLI (`opencli`, X and Reddit) has an « X / Reddit » tab of its own
//!   (`opencli:<paneId>`). Its extension opens and reuses its own windows,
//!   in a profile of its own: Arkadia adopts them (`watch_opencli`) and lays
//!   the one OpenCLI used last in the tab of the session that ran an opencli
//!   command last (`OpenCli::owner`). They are never closed, only parked.

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

/// A window laid out in screen pixels, with the corner its region cuts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Layout {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    /// The top-right corner left out: Chrome's caption buttons.
    notch_width: i32,
    notch_height: i32,
}

/// Chrome's three caption buttons, in device-independent pixels (46 wide
/// each, measured on Chrome 156), plus a margin. Their height stays inside
/// the tab strip (41.6 dip measured): the toolbar below, its extensions and
/// its menu included, stays whole.
const CAPTION_BUTTONS_DIP: i32 = 3 * 46 + 2;
const CAPTION_HEIGHT_DIP: i32 = 40;

/// Where `bounds` (relative to main's client origin `origin`) lays a Chrome
/// window at `dpi`: exactly the panel body, its caption buttons under a
/// cover (`win::cover_set`). A window wider than the panel pushed the
/// toolbar's right end (menu, extensions) out of view too, and a window
/// region made Chrome paint that corner white (both seen 05/11/2026).
fn layout(origin: (i32, i32), bounds: Bounds, dpi: u32) -> Layout {
    let scale = |dip: i32| dip * dpi.max(96) as i32 / 96;
    let width = bounds.width.round().max(1.0) as i32;
    Layout {
        x: origin.0 + bounds.x.round() as i32,
        y: origin.1 + bounds.y.round() as i32,
        width,
        height: bounds.height.round().max(1.0) as i32,
        notch_width: scale(CAPTION_BUTTONS_DIP).min(width),
        notch_height: scale(CAPTION_HEIGHT_DIP),
    }
}

/// A parked window's top-left: below and right of the whole virtual screen
/// (`virtual` = left, top, width, height), so no monitor ever shows it.
///
/// Bottom-right, not left: Chrome opens a new window where the profile's
/// last active window is, kept at least 30 px on a monitor. Parked on the
/// left, a new window flashed as a full-height strip (or full screen); here
/// it is a 30 px square in the screen's corner, then parked (05/11/2026).
fn park_position(virtual_screen: (i32, i32, i32, i32)) -> (i32, i32) {
    let (left, top, width, height) = virtual_screen;
    (left + width + 400, top + height + 400)
}

/// Whether a window rect lies wholly off the virtual screen, where
/// `park_position` puts it.
fn parked_rect(rect: (i32, i32, i32, i32), virtual_screen: (i32, i32, i32, i32)) -> bool {
    let (left, top, width, height) = virtual_screen;
    rect.0 >= left + width || rect.1 >= top + height || rect.0 + rect.2 <= left
}

fn overlap(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> i64 {
    let width = (a.0 + a.2).min(b.0 + b.2) - a.0.max(b.0);
    let height = (a.1 + a.3).min(b.1 + b.3) - a.1.max(b.1);
    if width > 0 && height > 0 {
        width as i64 * height as i64
    } else {
        0
    }
}

/// Whether a window shows less than a tenth of itself on the monitors
/// (their rects): where Chrome opens a window of Alexis's after one of the
/// panel's parked windows was its last active one, 30 px in a corner.
fn lost_off_screen(rect: (i32, i32, i32, i32), monitors: &[(i32, i32, i32, i32)]) -> bool {
    let area = rect.2.max(0) as i64 * rect.3.max(0) as i64;
    area > 0 && monitors.iter().map(|m| overlap(rect, *m)).sum::<i64>() * 10 < area
}

/// Whether a window has the panel's place (`laid`), as Chrome gives a new
/// window after the panel's was its last active one: shifted 10 dip down
/// and right, give or take its resize borders.
fn copies_laid(rect: (i32, i32, i32, i32), laid: Layout, dpi: u32) -> bool {
    let tolerance = 48 * dpi.max(96) as i32 / 96;
    (rect.0 - laid.x).abs() <= tolerance
        && (rect.1 - laid.y).abs() <= tolerance
        && (rect.2 - laid.width).abs() <= tolerance
        && (rect.3 - laid.height).abs() <= tolerance
}

/// A rescued window's restored place: 80 % of the work area, centered. It
/// is maximized right after; this is where « restore down » takes it.
fn rescue_rect(work_area: (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    let (left, top, width, height) = work_area;
    let (w, h) = (width * 4 / 5, height * 4 / 5);
    (left + (width - w) / 2, top + (height - h) / 2, w, h)
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

/// How long a launch waits for its window. A profile with no window open
/// starts first, extensions and all: its window came after 10 s, Chrome
/// left it on Alexis's screen and Claude's tabs went there (13/11/2026,
/// Chrome reopened after it went down).
fn launch_deadline(profile_started: bool) -> std::time::Duration {
    std::time::Duration::from_secs(if profile_started { 40 } else { 10 })
}

/// A launch that gave up on its window (`launch_deadline`).
const NO_WINDOW: &str = "Chrome opened no window";

/// How long a window is still looked for once its launch gave up: caught,
/// it is parked instead of staying on Alexis's screen (`catch_late`).
const LATE_WINDOW_WATCH: std::time::Duration = std::time::Duration::from_secs(60);

/// The app, for threads that outlive the command that started them.
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// The panel's lines in `popup.log`: each request, launch, steer and call
/// that ran, so a Chrome that opened outside the panel can be explained
/// after the fact (nothing was logged before 13/11/2026).
fn log(msg: &str) {
    crate::popup::log_line(&format!("[chrome] {msg}"));
}

/// The start of an id or a pane key, enough to follow it in the log.
fn short(id: &str) -> &str {
    let id = id
        .strip_prefix("chrome:")
        .or_else(|| id.strip_prefix(OPENCLI_PREFIX))
        .unwrap_or(id);
    id.get(..8).unwrap_or(id)
}

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
    /// The tab of the page it was launched on, still open.
    launch: Option<LaunchTab>,
    /// A thread is closing or replacing the launch tab: it alone decides.
    launch_busy: bool,
    /// A tab of Claude's was seen beside the launch tab: its group stays
    /// in this window, whatever a later steer finds.
    proven: bool,
    /// The last steer made it the profile's last-focused window: Claude's
    /// group lands here. All a call can go by once the launch tab was
    /// replaced by a new tab page (`clear_launch_page`).
    steered: bool,
    /// A call that ran found Claude's group in another window: a group
    /// stays where it was born, whatever a later steer finds.
    elsewhere: bool,
}

/// Claude in Chrome adds its own tab to the window: the launch page's tab
/// closes once Claude Code reports a call that ran (PostToolUse), so the
/// window holds Claude's tabs only (Alexis, 05/11/2026). Closed by its own
/// button (UI Automation), in front or not: Claude's tab comes forward by
/// itself, and closing the active tab left the launch tab beside it, or
/// alone once Claude closed its own (12/11/2026).
#[derive(Clone, Debug)]
struct LaunchTab {
    title: String,
}

/// What a window's tabs say of its launch tab.
#[derive(Debug, PartialEq, Eq)]
enum LaunchTabState {
    /// At this index, beside another tab: it may close, the window stays.
    Beside(usize),
    /// The window's only tab: closing it would close the window.
    Alone,
    /// Closed already (by hand): the window holds other tabs only.
    Gone,
}

/// Where the launch page's tab is among a window's tabs (their UI
/// Automation names, "<page> - <memory used>…" when Chrome adds to them).
/// None when no tab was seen at all: nothing is known then.
fn launch_tab_state(tab_names: &[String], page_title: &str) -> Option<LaunchTabState> {
    if tab_names.is_empty() {
        return None;
    }
    Some(
        match tab_names
            .iter()
            .position(|name| is_launched_window(name, page_title))
        {
            None => LaunchTabState::Gone,
            Some(_) if tab_names.len() < 2 => LaunchTabState::Alone,
            Some(i) => LaunchTabState::Beside(i),
        },
    )
}

/// The key of an « X / Reddit » tab: `opencli:<paneId>`.
const OPENCLI_PREFIX: &str = "opencli:";

/// How long OpenCLI's windows are looked for after a command asked
/// (`watch_opencli`): its window comes with the command, seconds later.
const OPENCLI_WATCH: std::time::Duration = std::time::Duration::from_secs(60);

/// The longest a watch lasts, skipped looks included: a launch that waits
/// its longest, then its window caught late.
const OPENCLI_WATCH_MAX: std::time::Duration = std::time::Duration::from_secs(60 + 40 + 60);

/// How often its windows' titles are read meanwhile: a window OpenCLI opens
/// shows on Alexis's screen until it is adopted.
const OPENCLI_POLL: std::time::Duration = std::time::Duration::from_millis(150);

/// OpenCLI's windows. Its extension opens them itself (`chrome.windows.create`,
/// 1280 x 900 dip: the whole screen at 300 %) and reuses them for good, one
/// per role: site commands (`opencli twitter search`) in one that goes back
/// to about:blank after each command, `opencli browser` in one that goes back
/// to its « OpenCLI Browser » page (both measured 27/11/2026, extension
/// 1.0.27). Arkadia cannot make it use a window of its own: it adopts them.
#[derive(Default)]
struct OpenCli {
    /// Adopted, laid or parked like the panes' windows.
    windows: Vec<Win>,
    /// The tab they show in (`opencli:<paneId>`): the session that ran an
    /// opencli command last. None: a session Arkadia does not run, or none.
    owner: Option<String>,
    /// The one on screen: the one OpenCLI took to a page last.
    shown: Option<isize>,
    /// Until when they are looked for, and whether a thread does. Skipped
    /// looks push the end, never past the cap (`OPENCLI_WATCH_MAX`).
    watch_until: Option<std::time::Instant>,
    watch_cap: Option<std::time::Instant>,
    watching: bool,
}

impl OpenCli {
    /// A session ran an opencli command (`key` its tab, None: a session
    /// Arkadia does not run): OpenCLI's one window is its now, whichever
    /// session had it (Alexis, 27/11/2026). Whether the owner changed.
    fn claim(&mut self, key: Option<String>) -> bool {
        if self.owner == key {
            return false;
        }
        self.owner = key;
        true
    }

    /// Pane `key` closed: its tab leaves. The windows stay open, parked:
    /// OpenCLI reuses them, another session may need them. Whether the
    /// owner changed.
    fn release(&mut self, key: &str) -> bool {
        if self.owner.as_deref() != Some(key) {
            return false;
        }
        self.owner = None;
        true
    }

    /// The window laid on the panel while it shows tab `active`: only the
    /// owner's tab shows one, another session's says it is used elsewhere.
    fn on_screen(&self, active: &str) -> Option<isize> {
        if !active.starts_with(OPENCLI_PREFIX) || self.owner.as_deref() != Some(active) {
            return None;
        }
        self.shown
    }

    fn adopted(&self, hwnd: isize) -> bool {
        self.windows.iter().any(|w| w.hwnd == hwnd)
    }

    fn add(&mut self, win: Win, show: bool) {
        if show || self.shown.is_none() {
            self.shown = Some(win.hwnd);
        }
        if !self.adopted(win.hwnd) {
            self.windows.push(win);
        }
    }

    /// A window gone (Chrome closed it): whether it was one of them.
    fn remove(&mut self, hwnd: isize) -> bool {
        let before = self.windows.len();
        self.windows.retain(|w| w.hwnd != hwnd);
        if self.shown == Some(hwnd) {
            self.shown = self.windows.last().map(|w| w.hwnd);
        }
        self.windows.len() != before
    }
}

/// Whether a window title is an OpenCLI window waiting for its next command
/// (its page about:blank or « OpenCLI Browser »): nothing to watch there.
fn opencli_idle(window_title: &str) -> bool {
    let page = window_title.split(" - Google Chrome").next().unwrap_or("");
    matches!(page.trim(), "" | "about:blank" | "OpenCLI Browser")
}

/// What a window of OpenCLI's profile seen while its commands run becomes.
#[derive(Debug, PartialEq, Eq)]
enum Sighting {
    Nothing,
    /// OpenCLI's: adopted, on screen in its tab when `show`.
    Adopt {
        show: bool,
    },
    /// Adopted already, taken to a page: on screen in its tab.
    Show,
}

/// `adopted`: Arkadia has the window already. `before`: its title at the
/// last look, None when it was not there yet (OpenCLI just opened it). A
/// window there before the command is OpenCLI's only once the command takes
/// it from its idle page to another (OpenCLI's windows wait on one between
/// commands): Alexis's own windows of the profile (the Web Store page he
/// installed the extension from, an x.com tab whose count changes) stay his.
fn sighting(adopted: bool, before: Option<&str>, title: &str) -> Sighting {
    let changed = before.is_some_and(|b| b != title);
    let busy = !opencli_idle(title);
    match (adopted, before) {
        (false, None) => Sighting::Adopt { show: busy },
        (false, Some(b)) if changed && opencli_idle(b) => Sighting::Adopt { show: busy },
        (true, Some(_)) if changed && busy => Sighting::Show,
        _ => Sighting::Nothing,
    }
}

#[derive(Default)]
struct Inner {
    windows: HashMap<String, Win>,
    /// The pane whose window the panel shows.
    active: Option<String>,
    bounds: Option<Bounds>,
    /// A layer of main covers the panel.
    hidden: bool,
    /// Another app is in front (`win::note_front`). The window on screen is
    /// parked then too: Chrome raises its window by itself (the extension's
    /// focus, a download bubble), and an owned window drags main up with it,
    /// over the app Alexis uses (05/11/2026). Off-screen, nothing shows.
    away: bool,
    /// Per profile folder: the window last made its last-focused one.
    steered: HashMap<String, isize>,
    /// Profile folders whose window Alexis used outside Arkadia since.
    dirty: HashSet<String>,
    /// Panes closed while their window was still launching: it closes as
    /// soon as it appears.
    closed: HashSet<String>,
    /// Per profile folder: its anchor, a parked window on its blank launch
    /// page. With no window of the profile open, Chrome opens the next one
    /// as it last saved it, often maximized: a full-screen flash. Next to a
    /// parked window, it opens at that window's place, kept 30 px on
    /// screen: a corner (both measured 05/11/2026). The tabs of a session
    /// Arkadia does not run (a scheduled task, another terminal) go there
    /// too: nothing shows (`prepare_outside`).
    spares: HashMap<String, Win>,
    /// The panel's place, last time a window was laid there: a window of
    /// Alexis's opened at it (`copies_laid`) is moved and maximized.
    last_laid: Option<Layout>,
    opencli: OpenCli,
}

impl Inner {
    /// Every window Arkadia lays or parks: the panes', OpenCLI's.
    fn laid_windows(&self) -> impl Iterator<Item = &Win> {
        self.windows.values().chain(self.opencli.windows.iter())
    }
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
    /// The Chrome profile's display name, for the panel's tab; its folder
    /// for a session Arkadia does not run (its hook only checks it is set).
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

/// `chrome-closed`, and `chrome-ready`: a tab of Claude's is in the pane's
/// window, which may come forward (never on its launch page alone).
#[derive(Serialize, Clone)]
struct ChromeKey {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestFile {
    id: String,
    #[serde(default)]
    pane_id: String,
    /// A session Arkadia does not run (no pane): its account's email, for
    /// its profile's parked anchor (`prepare_outside`).
    #[serde(default)]
    email: Option<String>,
    /// Claude Code's PostToolUse: one of the pane's calls ran, its tab
    /// exists (`note_ran`). Nothing to answer.
    #[serde(default)]
    ran: bool,
    /// An opencli command is about to run (`~/.claude/hooks/opencli-panel.mjs`):
    /// OpenCLI's windows go to this pane's « X / Reddit » tab, or off-screen
    /// for a session Arkadia does not run (no pane).
    #[serde(default)]
    opencli: bool,
}

/// What an opencli request's hook is told: it waits a moment more when the
/// profile was not running (its extension only starting).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenCliPrepared {
    profile_started: bool,
}

/// `opencli-owner`: the tab OpenCLI's window now shows in, None for none.
#[derive(Serialize, Clone)]
struct OpenCliOwner {
    key: Option<String>,
}

/// In the inbox, the pid of an Arkadia that takes opencli requests: an older
/// one would take them for Claude in Chrome's and open a Chrome window for
/// the pane. The hook asks nothing without it.
const OPENCLI_MARKER: &str = "opencli";

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
fn write_ack<T: Serialize>(id: &str, prepared: Option<&T>) {
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

/// Tells the hook waiting on request `id` that a window is being launched:
/// it waits for the answer longer than 12 s then (a profile that is not
/// running takes seconds to start), and never opens Chrome itself.
fn write_wait(id: &str) {
    if valid_id(id) {
        let _ = std::fs::write(inbox_dir().join(format!("{id}.wait")), "");
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
        let show = match (
            &inner.active,
            inner.bounds,
            origin,
            inner.hidden || inner.away,
        ) {
            (Some(key), Some(bounds), Some(origin), false) => Some((key.clone(), bounds, origin)),
            _ => None,
        };
        let keys: Vec<String> = inner.windows.keys().cloned().collect();
        let mut laid = None;
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
                    laid = Some(at);
                }
                _ => {
                    win::park(win.hwnd);
                    win.at = None;
                }
            }
        }
        // OpenCLI's window on screen in its owner's tab only.
        let opencli_shown = show
            .as_ref()
            .and_then(|(active, _, _)| inner.opencli.on_screen(active));
        for win in inner.opencli.windows.iter_mut() {
            match (&show, owner) {
                (Some((_, bounds, origin)), Some(owner)) if opencli_shown == Some(win.hwnd) => {
                    let at = layout(*origin, *bounds, win::dpi(win.hwnd));
                    win::lay(win.hwnd, owner, at);
                    win.at = Some(at);
                    laid = Some(at);
                }
                _ => {
                    win::park(win.hwnd);
                    win.at = None;
                }
            }
        }
        if laid.is_some() {
            inner.last_laid = laid;
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
    // The profile's anchor first (`Inner::spares`), never taken by a
    // session: the profile is never left with no window (Chrome closing the
    // session's last tab, the pane closing), so the session's window opens
    // next to a parked one, in the corner. And launched last, the session's
    // window is the profile's last focused one, where Claude's tabs go: a
    // spare launched after it took them (05/11/2026).
    let profile_started = match anchor_of(state, &dir) {
        Ok((_, _, started)) => started,
        // Chrome too slow to open the anchor: the pane's window would wait
        // as long again, past what the hooks wait. The anchor is caught when
        // it comes (`catch_late`), the next call launches the pane's window.
        Err(e) if e == NO_WINDOW => return Err(e),
        Err(_) => false,
    };
    let (win, started) = launch(state, &dir, Some(key))?;
    let profile_started = profile_started || started;
    let hwnd = win.hwnd;
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
    arrange(app, state);
    Ok((win, true, profile_started))
}

/// Profile folder `dir`'s anchor (`Inner::spares`), launched when it has
/// none. The caller holds `state.launching`. Returns it with whether it is
/// new and whether no window of the profile was open before.
fn anchor_of(state: &ChromeView, dir: &str) -> Result<(Win, bool, bool), String> {
    let existing = state
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.spares.get(dir).cloned())
        .filter(|anchor| win::alive(anchor.hwnd));
    if let Some(anchor) = existing {
        return Ok((anchor, false, false));
    }
    let (anchor, started) = launch(state, dir, None)?;
    if let Ok(mut inner) = state.inner.lock() {
        inner.spares.insert(dir.to_string(), anchor.clone());
    }
    Ok((anchor, true, started))
}

/// The profile folder of a Chrome AppUserModelID (`app_id_of` reversed):
/// "Chrome" is "Default", "Chrome.UserData.Profile3" is "Profile 3".
fn profile_dir_of_app_id(app_id: &str) -> Option<String> {
    if app_id == "Chrome" {
        return Some("Default".into());
    }
    let digits = app_id.strip_prefix("Chrome.UserData.Profile")?;
    (!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
        .then(|| format!("Profile {digits}"))
}

/// Whether a window title is still a launch page's (`launch_title`), of
/// any run: an anchor's, never a session's once Claude used it.
fn on_launch_page(window_title: &str) -> bool {
    let Some(rest) = window_title.strip_prefix("Arkadia-") else {
        return false;
    };
    let mut parts = rest.splitn(3, |c: char| !c.is_ascii_digit());
    let pid = parts.next().unwrap_or("");
    let n = parts.next().unwrap_or("");
    !pid.is_empty() && !n.is_empty() && rest[pid.len()..].starts_with('-')
}

/// A Chrome window an ended run of this Arkadia left.
#[derive(Clone, Debug)]
struct LeftWindow {
    hwnd: isize,
    app_id: Option<String>,
    parked: bool,
    /// Still on its launch page: an anchor, not a session's window.
    launch_page: bool,
}

/// The windows an ended run left: per profile paired in `paired` (its
/// folders), the one kept as its anchor, and the others, to close. A parked
/// window on its launch page wins: a crashed run also left its sessions'
/// windows, with a dead session's tabs. A window of a profile no account
/// uses any more closes, so it does not keep that profile loaded for good.
fn sort_left_behind(left: &[LeftWindow], paired: &[String]) -> (Vec<(String, isize)>, Vec<isize>) {
    let rank = |w: &LeftWindow| (w.parked, w.launch_page);
    let mut anchors: Vec<(String, &LeftWindow)> = Vec::new();
    let mut extra = Vec::new();
    for w in left {
        let Some(dir) = w
            .app_id
            .as_deref()
            .and_then(profile_dir_of_app_id)
            .filter(|d| paired.contains(d))
        else {
            extra.push(w.hwnd);
            continue;
        };
        match anchors.iter_mut().find(|(d, _)| *d == dir) {
            Some(kept) if rank(w) > rank(kept.1) => {
                extra.push(kept.1.hwnd);
                kept.1 = w;
            }
            Some(_) => extra.push(w.hwnd),
            None => anchors.push((dir, w)),
        }
    }
    let anchors = anchors.into_iter().map(|(dir, w)| (dir, w.hwnd)).collect();
    (anchors, extra)
}

/// OpenCLI's windows among those an ended run left (`profile`: OpenCLI's
/// profile folder, None when no profile has its extension any more): of its
/// profile, off their launch page. They stay OpenCLI's, never closed: it
/// would open new ones, on Alexis's screen. The one on its launch page stays
/// in `left`: the profile's anchor. Its profile unknown (Chrome's `Local
/// State` unread, Err): every window off its launch page of a profile not
/// in the pairing table (`paired`, None when unread) may be one, it is left
/// as it is, neither kept nor closed.
fn split_opencli(
    left: Vec<LeftWindow>,
    profile: &Result<Option<String>, String>,
    paired: Option<&[String]>,
) -> (Vec<LeftWindow>, Vec<isize>) {
    let app_id = match profile {
        Ok(Some(dir)) => app_id_of(dir),
        Ok(None) => return (left, Vec::new()),
        Err(_) => {
            let maybe_opencli = |w: &LeftWindow| {
                let dir = w.app_id.as_deref().and_then(profile_dir_of_app_id);
                !w.launch_page && paired.is_none_or(|p| dir.is_none_or(|d| !p.contains(&d)))
            };
            return (
                left.into_iter().filter(|w| !maybe_opencli(w)).collect(),
                Vec::new(),
            );
        }
    };
    let (opencli, rest): (Vec<LeftWindow>, Vec<LeftWindow>) = left
        .into_iter()
        .partition(|w| w.app_id.as_deref() == Some(app_id.as_str()) && !w.launch_page);
    (rest, opencli.into_iter().map(|w| w.hwnd).collect())
}

/// A window Arkadia takes as it is, with no launch tab: an anchor kept, or
/// an OpenCLI window.
fn adopted_win(hwnd: isize, dir: &str) -> Win {
    Win {
        hwnd,
        profile_dir: dir.to_string(),
        at: None,
        launch: None,
        launch_busy: false,
        proven: false,
        steered: false,
        elsewhere: false,
    }
}

/// At startup: the anchors the last run left stay their profile's anchor.
/// Closing them unloaded the profile, and the next session that needed it
/// started it cold: Chrome then froze Alexis's own window 10 to 20 s (every
/// freeze he dated, 16 and 17/11/2026, fell on such a start). The rest of
/// what it left (a crashed run's session windows) closes. Under the launch
/// lock: a request of a session Arkadia does not run may come meanwhile
/// (`prepare_outside`), and its anchor, if it launched one first, stays.
fn keep_left_behind(app: &AppHandle) {
    let state = app.state::<ChromeView>();
    let Ok(_launch) = state.launching.lock() else {
        return;
    };
    // Watching a kept window needs the hook thread; the lock is held from
    // the start, so no request launches an anchor meanwhile.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while !win::hooks_ready() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let left = win::left_behind();
    let profile = crate::chrome_profile::opencli_profile();
    let table = crate::chrome_profile::paired_profile_dirs();
    let (left, opencli_left) = split_opencli(left, &profile, table.as_deref());
    let opencli = profile.ok().flatten();
    // The table unreadable: every profile a window was left for counts.
    let mut paired = table.unwrap_or_else(|| {
        left.iter()
            .filter_map(|w| w.app_id.as_deref().and_then(profile_dir_of_app_id))
            .collect()
    });
    // OpenCLI's profile keeps its anchor too.
    if let Some(dir) = opencli.as_ref().filter(|d| !paired.contains(d)) {
        paired.push(dir.clone());
    }
    let (anchors, mut extra) = sort_left_behind(&left, &paired);
    let anchors: Vec<(String, isize)> = anchors
        .into_iter()
        .filter(|(dir, raw)| {
            let taken = state
                .inner
                .lock()
                .is_ok_and(|inner| inner.spares.get(dir).is_some_and(|a| win::alive(a.hwnd)));
            if taken {
                extra.push(*raw);
            }
            !taken
        })
        .collect();
    for raw in extra {
        win::close(raw);
    }
    for (dir, raw) in anchors {
        win::adopt(raw);
        win::park(raw);
        win::watch_process(raw);
        if let Ok(mut inner) = state.inner.lock() {
            inner.spares.insert(
                dir.clone(),
                Win {
                    hwnd: raw,
                    profile_dir: dir.clone(),
                    at: None,
                    launch: None,
                    launch_busy: false,
                    proven: false,
                    steered: false,
                    elsewhere: false,
                },
            );
        }
        log(&format!("anchor of {dir} kept from the last run"));
    }
    if let Some(dir) = opencli {
        for raw in opencli_left {
            // The other Arkadia's watcher may have taken it since.
            if !win::adopt_opencli(raw) {
                continue;
            }
            win::park(raw);
            win::watch_process(raw);
            if let Ok(mut inner) = state.inner.lock() {
                inner.opencli.add(adopted_win(raw, &dir), false);
            }
            log("OpenCLI window kept from the last run");
        }
    }
}

/// At startup: the profiles paired with a Claude account, and OpenCLI's,
/// that have no anchor start now, parked, rather than cold when a session first needs
/// one, maybe while Alexis browses (see `keep_left_behind`). After a reboot
/// Arkadia starts before he opens his Chrome.
fn prestart(app: &AppHandle) {
    let state = app.state::<ChromeView>();
    let mut dirs = crate::chrome_profile::paired_profile_dirs().unwrap_or_default();
    // OpenCLI's too: its extension only runs while a window of it is open.
    if let Some(dir) = crate::chrome_profile::opencli_profile_dir().filter(|d| !dirs.contains(d)) {
        dirs.push(dir);
    }
    for dir in dirs {
        let Ok(_launch) = state.launching.lock() else {
            return;
        };
        match anchor_of(&state, &dir) {
            Ok((_, true, _)) => log(&format!("anchor of {dir} started ahead")),
            Ok(_) => {}
            Err(e) => log(&format!("anchor of {dir} not started ahead: {e}")),
        }
    }
}

/// A Claude session Arkadia does not run (a scheduled task, another
/// terminal) is about to use Claude in Chrome: its profile's anchor, parked
/// off-screen, becomes the profile's last-focused window, where the
/// extension puts the session's tabs. Nothing shows; Chrome opened in
/// Windows before (Alexis, 06/11/2026). Not steered (Arkadia behind
/// another app, the anchor steered by nobody): the tabs go to the profile's
/// last-focused window, as before; the hook does not look. Known limits: a
/// launch here borrows the foreground as every launch does
/// (`make_most_recent`). The anchor, its tabs with it, outlives Arkadia
/// (exit, rebuild): the next run takes it back (`keep_left_behind`).
fn prepare_outside(state: &ChromeView, email: &str, id: &str) -> Result<Prepared, String> {
    let dir = crate::chrome_profile::profile_dir_for_email(email)
        .ok_or_else(|| "no Chrome profile paired with this account".to_string())?;
    let has_anchor = state
        .inner
        .lock()
        .is_ok_and(|inner| inner.spares.get(&dir).is_some_and(|a| win::alive(a.hwnd)));
    if !has_anchor {
        write_wait(id);
    }
    let (anchor, created, profile_started) = {
        let _launch = state.launching.lock().map_err(|e| e.to_string())?;
        anchor_of(state, &dir)?
    };
    let steered = steer(state, &anchor, created);
    log(&format!(
        "request {} outside Arkadia: anchor of {dir}, steered {steered}",
        short(id)
    ));
    Ok(Prepared {
        profile: dir,
        steered,
        profile_started,
    })
}

/// Launches a window in profile folder `dir` and makes it the panel's:
/// found by its first page's unique title, parked, shown again only once
/// off-screen. The caller holds `state.launching`. Returns it with whether
/// no window of the profile was open before. `pane`: the pane key it is
/// for, None for an anchor (where a window that comes too late goes).
fn launch(state: &ChromeView, dir: &str, pane: Option<&str>) -> Result<(Win, bool), String> {
    let dir = dir.to_string();
    // The new window opens where the profile's last active window is: off
    // the screen while Arkadia launches (arrange lays them back after).
    let shown: Vec<isize> = state
        .inner
        .lock()
        .map(|inner| {
            inner
                .laid_windows()
                .filter(|w| w.profile_dir == dir && w.at.is_some())
                .map(|w| w.hwnd)
                .collect()
        })
        .unwrap_or_default();
    for raw in shown {
        win::park(raw);
        win::wait_parked(raw, std::time::Duration::from_millis(500));
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
    log(&format!(
        "launch {title} in {dir} for {}{}",
        pane.map_or("an anchor", short),
        if profile_started {
            ", profile not running"
        } else {
            ""
        }
    ));
    // Chrome cannot have the profile's sync store open: the only moment its
    // saved Claude groups can go and its default zoom be set
    // (`chrome_tab_groups`).
    if profile_started {
        match crate::chrome_profile::profile_path(&dir)
            .ok_or_else(|| "no Chrome folder".to_string())
            .and_then(|path| crate::chrome_tab_groups::tidy_isolated(&path))
        {
            Ok(t) => {
                let mut done = Vec::new();
                if t.groups + t.tabs > 0 {
                    done.push(format!(
                        "{} Claude groups and {} tabs deleted",
                        t.groups, t.tabs
                    ));
                }
                if t.sync_turned_off {
                    done.push("tab sync turned off".to_string());
                }
                if t.zoom_set {
                    done.push(format!(
                        "default zoom set to {} %",
                        crate::chrome_tab_groups::PANEL_ZOOM_PERCENT
                    ));
                }
                if !done.is_empty() {
                    log(&format!("profile {dir} before launch: {}", done.join(", ")));
                }
            }
            Err(e) => log(&format!("profile {dir} left as is before launch: {e}")),
        }
    }
    // Chrome puts a window launched from the command line in front, over
    // whatever Alexis uses: the foreground goes back to it.
    let before = win::foreground();
    let _launching = win::Launching::start();
    // Chrome sizes a new window like the most recently active normal Chrome
    // window, whatever its profile (`WindowSizer`, read 05/11/2026): most
    // often Alexis's own, maximized, hence a full-screen flash. One of the
    // panel's parked windows is made that window first: the new one opens
    // at its place, off-screen but for a corner. Chrome takes the
    // foreground at the launch anyway; it goes back right after.
    let reference = state.inner.lock().ok().and_then(|inner| {
        inner
            .spares
            .values()
            .chain(inner.windows.values())
            .find(|w| w.at.is_none() && win::alive(w.hwnd))
            .map(|w| w.hwnd)
    });
    if let Some(reference) = reference {
        win::make_most_recent(reference);
    }
    if !crate::chrome_profile::launch_window(&dir, &title) {
        win::steering_done();
        log(&format!("launch {title}: Chrome could not be started"));
        return Err("Chrome could not be started".into());
    }
    let started = std::time::Instant::now();
    let deadline = started + launch_deadline(profile_started);
    let hwnd = loop {
        let found = win::browser_windows()
            .into_iter()
            .find(|(h, _, text)| is_launched_window(text, &title) && !win::marked(*h));
        if let Some((h, _, _)) = found {
            break h;
        }
        if std::time::Instant::now() > deadline {
            win::steering_done();
            log(&format!(
                "launch {title}: no window after {} s",
                started.elapsed().as_secs()
            ));
            catch_late(dir, title, pane.map(str::to_owned), before);
            return Err(NO_WINDOW.into());
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    };
    log(&format!(
        "launch {title}: window in {} ms",
        started.elapsed().as_millis()
    ));
    win::adopt(hwnd);
    win::park(hwnd);
    // The park is async on Chrome's thread: the window shows again only
    // once it is off every monitor for sure (the others launched meanwhile
    // come back when the launch ends, `Launching`'s drop).
    win::wait_parked(hwnd, std::time::Duration::from_secs(1));
    win::unveil(hwnd);
    win::hand_back(hwnd, before);
    win::steering_done();
    win::watch_process(hwnd);
    let win = Win {
        hwnd,
        profile_dir: dir,
        at: None,
        launch: Some(LaunchTab {
            title: title.clone(),
        }),
        launch_busy: false,
        proven: false,
        steered: false,
        elsewhere: false,
    };
    Ok((win, profile_started))
}

/// Profile folders with a window `catch_late` still waits for: its frame
/// has no mark nor launch page yet, the OpenCLI watcher must not take it.
static LATE_PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct LatePending(String);

impl LatePending {
    fn new(dir: &str) -> Self {
        LATE_PENDING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(dir.to_string());
        // The other Arkadia's watcher too (`win::other_late`).
        win::late_started();
        LatePending(dir.to_string())
    }
}

impl Drop for LatePending {
    fn drop(&mut self) {
        let mut pending = LATE_PENDING.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(i) = pending.iter().position(|d| *d == self.0) {
            pending.remove(i);
        }
        win::late_ended();
    }
}

fn late_pending(dir: &str) -> bool {
    LATE_PENDING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .any(|d| d == dir)
}

/// What a window that came after its launch gave up becomes.
#[derive(Debug, PartialEq, Eq)]
enum LateFate {
    /// The pane's window, which it still lacks.
    Pane,
    /// Its profile's anchor, which it still lacks.
    Anchor,
    /// Not needed any more: it closes, parked first.
    Close,
}

/// `pane`: the pane the launch was for (None: an anchor). The window a
/// later request launched, or a closed pane, wins over the late one.
fn late_fate(
    pane: Option<&str>,
    pane_has_window: bool,
    pane_closed: bool,
    has_anchor: bool,
) -> LateFate {
    match pane {
        Some(_) if !pane_has_window && !pane_closed => LateFate::Pane,
        None if !has_anchor => LateFate::Anchor,
        _ => LateFate::Close,
    }
}

/// A launch gave up on its window (`launch_deadline`): Chrome may still
/// open it, on Alexis's screen, and the extension put Claude's tabs in it,
/// Chrome having activated it (13/11/2026). Found by its title within
/// `LATE_WINDOW_WATCH`, it is parked like any launched window and kept by
/// its pane or as its profile's anchor, else closed. Until then, a new
/// window of the profile counts as a launch's (`win::expect_late`): the
/// foreground never goes back to it, nor is it rescued full screen.
fn catch_late(dir: String, title: String, pane: Option<String>, before: Option<isize>) {
    let app_id = app_id_of(&dir);
    win::expect_late(&app_id);
    let pending = LatePending::new(&dir);
    std::thread::spawn(move || {
        let _pending = pending;
        let started = std::time::Instant::now();
        let hwnd = loop {
            let found = win::browser_windows()
                .into_iter()
                .find(|(h, _, text)| is_launched_window(text, &title) && !win::marked(*h));
            if let Some((h, _, _)) = found {
                break h;
            }
            if started.elapsed() > LATE_WINDOW_WATCH {
                win::late_done(&app_id);
                log(&format!("launch {title}: never came"));
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        };
        win::adopt(hwnd);
        win::late_done(&app_id);
        win::park(hwnd);
        win::wait_parked(hwnd, std::time::Duration::from_secs(1));
        win::unveil(hwnd);
        win::hand_back(hwnd, before);
        win::watch_process(hwnd);
        let Some(app) = APP.get() else {
            win::close(hwnd);
            return;
        };
        let state = app.state::<ChromeView>();
        let late = Win {
            hwnd,
            profile_dir: dir.clone(),
            at: None,
            launch: Some(LaunchTab {
                title: title.clone(),
            }),
            launch_busy: false,
            proven: false,
            steered: false,
            elsewhere: false,
        };
        // Decided under the launch lock, as every other write to `windows`
        // and `spares`: a launch for the same pane or profile that runs
        // meanwhile either finds this window or makes it the extra one.
        let Ok(launching) = state.launching.lock() else {
            win::close(hwnd);
            return;
        };
        let fate = state.inner.lock().map_or(LateFate::Close, |mut inner| {
            let pane_has_window = pane
                .as_ref()
                .is_some_and(|key| inner.windows.get(key).is_some_and(|w| win::alive(w.hwnd)));
            let pane_closed = pane.as_ref().is_some_and(|key| inner.closed.contains(key));
            let has_anchor = inner.spares.get(&dir).is_some_and(|a| win::alive(a.hwnd));
            let fate = late_fate(pane.as_deref(), pane_has_window, pane_closed, has_anchor);
            match (&fate, &pane) {
                (LateFate::Pane, Some(key)) => {
                    inner.windows.insert(key.clone(), late);
                }
                (LateFate::Anchor, _) => {
                    inner.spares.insert(dir.clone(), late);
                }
                _ => {}
            }
            fate
        });
        drop(launching);
        log(&format!(
            "launch {title}: window came {} s after the launch gave up, {fate:?}",
            started.elapsed().as_secs()
        ));
        match fate {
            LateFate::Close => win::close(hwnd),
            // Its next call asks at once, and is steered to it.
            LateFate::Pane => {
                if let Some(id) = pane.as_deref().and_then(|k| k.strip_prefix("chrome:")) {
                    forget_asked(id);
                }
            }
            LateFate::Anchor => {}
        }
    });
}

/// Makes `win` its profile's last-focused window when that may be needed
/// and Arkadia is in front. Returns whether Claude's group lands there.
fn steer(state: &ChromeView, win: &Win, created: bool) -> bool {
    // Chrome activates the window it launches (seen at every launch): it is
    // the profile's last focused one, Arkadia in front or not.
    if created {
        if let Ok(mut inner) = state.inner.lock() {
            inner.dirty.remove(&win.profile_dir);
            inner.steered.insert(win.profile_dir.clone(), win.hwnd);
        }
        return true;
    }
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
        log(&format!(
            "steer {}: not steered, Arkadia not in front",
            win.profile_dir
        ));
        return false;
    }
    if let Ok(mut inner) = state.inner.lock() {
        inner.dirty.remove(&win.profile_dir);
        inner.steered.insert(win.profile_dir.clone(), win.hwnd);
    }
    log(&format!(
        "steer {}: {}",
        win.profile_dir,
        if alone {
            "the profile's only window"
        } else {
            "activated"
        }
    ));
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
        note_steered(&state, &key, steered);
        clear_launch_page(&state, &key);
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
    let wait_id = id.clone();
    let pane = key.clone();
    let asked = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<ChromeView>();
        // A window to launch: the hook waits for it (`write_wait`).
        let has_window = state
            .inner
            .lock()
            .is_ok_and(|inner| inner.windows.get(&key).is_some_and(|w| win::alive(w.hwnd)));
        if !has_window {
            write_wait(&wait_id);
        }
        let (win, created, profile_started) = ensure(&worker, &state, &key, &account)?;
        let steered = steer(&state, &win, created);
        note_steered(&state, &key, steered);
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
    let elapsed = asked.elapsed().as_millis();
    match &result {
        Ok(p) => log(&format!(
            "request {} of pane {}: answered in {elapsed} ms, steered {}, profile started {}",
            short(&id),
            short(&pane),
            p.steered,
            p.profile_started
        )),
        Err(e) => log(&format!(
            "request {} of pane {}: failed in {elapsed} ms: {e}",
            short(&id),
            short(&pane)
        )),
    }
    result
}

/// One of Claude's calls in pane `key` ran (PostToolUse): its tab exists.
/// The launch tab closes once another tab keeps the window open, and the
/// pane's window may come forward (`chrome-ready`). Holding its launch tab
/// alone (Claude's group went elsewhere, or no tab yet), it stays parked:
/// the panel never shows that page by itself (Alexis, 12/11/2026).
fn note_ran(app: &AppHandle, key: String) {
    let app = app.clone();
    // Off the inbox watcher: UI Automation waits on Chrome.
    std::thread::spawn(move || {
        let state = app.state::<ChromeView>();
        // Another thread holds the launch tab (the panel's new tab page,
        // 3 s at most): this call's proof waits for it.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        let (hwnd, taken) = loop {
            match take_launch_tab(&state, &key) {
                None => return,
                Some((_, Taken::Busy)) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Some(found) => break found,
            }
        };
        let ready = match taken {
            Taken::Busy => return,
            Taken::Settled(here) => {
                // This call ran: its group is not here, for good.
                if !here {
                    release_launch_tab(&state, &key, hwnd, None, false, true);
                }
                here
            }
            Taken::Launch(launch) => {
                let found = win::close_launch_tab(hwnd, &launch.title);
                let ready = match found {
                    Some(LaunchTabState::Alone) => false,
                    Some(_) => true,
                    // UI Automation failed: another tab in front means the
                    // window holds one; the launch tab is tried again later.
                    None => !is_launched_window(&win::window_title(hwnd), &launch.title),
                };
                let proven = matches!(found, Some(LaunchTabState::Beside(_)));
                let elsewhere = found == Some(LaunchTabState::Alone);
                let left = (!launch_tab_gone(&found)).then_some(launch);
                release_launch_tab(&state, &key, hwnd, left, proven, elsewhere);
                ready
            }
        };
        log(&format!(
            "call ran in pane {}: Claude's tab {}",
            short(&key),
            if ready {
                "in its window"
            } else {
                "not in its window"
            }
        ));
        // Its window may be gone meanwhile (Claude closed its last tab):
        // `chrome-closed` has the last word, nothing comes forward.
        let alive = state
            .inner
            .lock()
            .is_ok_and(|inner| inner.windows.get(&key).is_some_and(|w| w.hwnd == hwnd));
        if ready && alive && win::alive(hwnd) {
            let _ = app.emit_to("main", "chrome-ready", ChromeKey { key });
        }
    });
}

/// A pane's launch tab, as `take_launch_tab` finds it.
enum Taken {
    /// Another thread holds it.
    Busy,
    /// Taken by this thread, which closes it, then `release_launch_tab`.
    Launch(LaunchTab),
    /// Closed or replaced already: whether Claude's group is in the window.
    Settled(bool),
}

/// Pane `key`'s window and its launch tab, taken: one thread at a time
/// closes it. A second press on a closing tab's button closes the next
/// tab, Claude's (Chromium's `TabContainer`, read 12/11/2026).
fn take_launch_tab(state: &ChromeView, key: &str) -> Option<(isize, Taken)> {
    let mut inner = state.inner.lock().ok()?;
    let win = inner.windows.get_mut(key)?;
    let taken = if win.launch_busy {
        Taken::Busy
    } else if let Some(launch) = win.launch.take() {
        win.launch_busy = true;
        Taken::Launch(launch)
    } else {
        Taken::Settled(win.proven || (win.steered && !win.elsewhere))
    };
    Some((win.hwnd, taken))
}

/// The thread holding the launch tab is done: still open (`left`), it is
/// tried again later.
fn release_launch_tab(
    state: &ChromeView,
    key: &str,
    hwnd: isize,
    left: Option<LaunchTab>,
    proven: bool,
    elsewhere: bool,
) {
    if let Ok(mut inner) = state.inner.lock() {
        if let Some(win) = inner.windows.get_mut(key).filter(|w| w.hwnd == hwnd) {
            win.launch_busy = false;
            win.launch = left;
            win.proven |= proven;
            win.elsewhere |= elsewhere;
        }
    }
}

fn launch_tab_gone(found: &Option<LaunchTabState>) -> bool {
    matches!(
        found,
        Some(LaunchTabState::Beside(_) | LaunchTabState::Gone)
    )
}

/// Pane `key`'s window was steered, or could not be: where Claude's group
/// goes when nothing else tells (`Taken::Settled`).
fn note_steered(state: &ChromeView, key: &str, steered: bool) {
    if let Ok(mut inner) = state.inner.lock() {
        if let Some(win) = inner.windows.get_mut(key) {
            win.steered = steered;
        }
    }
}

/// The panel shows pane `key`'s window, never on its launch page: beside
/// another tab, the launch tab closes; alone (the globe's empty window, or
/// Claude's tab not there yet), Chrome's new tab page comes in front first
/// (Alexis, 12/11/2026).
fn clear_launch_page(state: &ChromeView, key: &str) {
    let Some((hwnd, Taken::Launch(launch))) = take_launch_tab(state, key) else {
        return;
    };
    let mut found = win::close_launch_tab(hwnd, &launch.title);
    if found == Some(LaunchTabState::Alone) {
        win::new_tab(hwnd);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while is_launched_window(&win::window_title(hwnd), &launch.title)
            && std::time::Instant::now() < deadline
        {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        found = win::close_launch_tab(hwnd, &launch.title);
    }
    let left = (!launch_tab_gone(&found)).then_some(launch);
    release_launch_tab(state, key, hwnd, left, false, false);
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
    let worker = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<ChromeView>();
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
        let Some(win) = win else { return };
        keep_a_spare(&state, &win);
        win::close(win.hwnd);
    })
    .await;
}

/// Before the profile's last window closes: a spare is launched next to it,
/// parked, born in the screen's corner (see `Inner::spares`).
fn keep_a_spare(state: &ChromeView, closing: &Win) {
    let Ok(_launch) = state.launching.lock() else {
        return;
    };
    let others = state.inner.lock().is_ok_and(|inner| {
        inner
            .windows
            .values()
            .chain(inner.spares.values())
            .any(|w| w.profile_dir == closing.profile_dir && w.hwnd != closing.hwnd)
    });
    if others {
        return;
    }
    // The new window opens where this one is: off the screen.
    win::park(closing.hwnd);
    win::wait_parked(closing.hwnd, std::time::Duration::from_millis(500));
    if let Ok((spare, _)) = launch(state, &closing.profile_dir, None) {
        if let Ok(mut inner) = state.inner.lock() {
            inner.spares.insert(closing.profile_dir.clone(), spare);
        }
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

// ---- OpenCLI's « X / Reddit » tab -----------------------------------------

fn emit_opencli_owner(app: &AppHandle, key: Option<String>) {
    let _ = app.emit_to("main", "opencli-owner", OpenCliOwner { key });
}

/// Before an opencli command (inbox request `id`) of the session whose tab
/// is `owner` (None: a session Arkadia does not run, the window stays
/// parked): OpenCLI's windows are that session's now, its profile runs (its
/// extension only does while a window of it is open: the anchor, which
/// `opencli-ready.sh` opened on the desktop before), and the windows its
/// command opens or uses are looked for.
fn prepare_opencli(
    app: &AppHandle,
    state: &ChromeView,
    id: &str,
    owner: Option<String>,
) -> Result<OpenCliPrepared, String> {
    let dir = crate::chrome_profile::opencli_profile_dir()
        .ok_or_else(|| "no Chrome profile has OpenCLI's extension".to_string())?;
    if state
        .inner
        .lock()
        .is_ok_and(|mut inner| inner.opencli.claim(owner.clone()))
    {
        emit_opencli_owner(app, owner);
    }
    // Before any wait on the launch lock: the hook may give up meanwhile and
    // the command run, its window then counts as born during the watch.
    watch_opencli(app, state, &dir);
    let has_anchor = state
        .inner
        .lock()
        .is_ok_and(|inner| inner.spares.get(&dir).is_some_and(|a| win::alive(a.hwnd)));
    let profile_started = if has_anchor {
        Ok(false)
    } else {
        write_wait(id);
        match state.launching.lock() {
            Ok(_launch) => anchor_of(state, &dir).map(|(_, _, started)| started),
            Err(e) => Err(e.to_string()),
        }
    };
    // Even without its anchor: OpenCLI's windows may keep the profile up.
    arrange(app, state);
    Ok(OpenCliPrepared {
        profile_started: profile_started?,
    })
}

/// The windows of OpenCLI's profile (`app_id`) with their titles: those
/// Arkadia adopted, and those no other running Arkadia has. Never its anchor,
/// a pane's window, or a window still on its launch page (being launched).
fn opencli_titles(state: &ChromeView, app_id: &str) -> HashMap<isize, String> {
    let (adopted, others): (Vec<isize>, Vec<isize>) = state
        .inner
        .lock()
        .map(|inner| {
            (
                inner.opencli.windows.iter().map(|w| w.hwnd).collect(),
                inner
                    .spares
                    .values()
                    .chain(inner.windows.values())
                    .map(|w| w.hwnd)
                    .collect(),
            )
        })
        .unwrap_or_default();
    win::browser_windows()
        .into_iter()
        .filter(|(h, id, title)| {
            id.as_deref() == Some(app_id)
                && !others.contains(h)
                && !on_launch_page(title)
                && (adopted.contains(h) || win::adoptable(*h))
        })
        .map(|(h, _, title)| (h, title))
        .collect()
}

/// OpenCLI's windows while its commands run: one it opens, or one it takes
/// to another page, becomes the panel's (laid in its owner's tab, else
/// parked), and the one it took to a page last is the one shown. Until
/// `OPENCLI_WATCH` after the last command, on a thread of its own: reading a
/// title sends Chrome nothing. Known limit: a window Alexis opens in that
/// profile during that minute is taken as OpenCLI's.
fn watch_opencli(app: &AppHandle, state: &ChromeView, dir: &str) {
    let start = state.inner.lock().is_ok_and(|mut inner| {
        let now = std::time::Instant::now();
        inner.opencli.watch_until = Some(now + OPENCLI_WATCH);
        inner.opencli.watch_cap = Some(now + OPENCLI_WATCH_MAX);
        !std::mem::replace(&mut inner.opencli.watching, true)
    });
    if !start {
        return;
    }
    let app_id = app_id_of(dir);
    // Before the command runs: a window of before is known by its next page.
    let mut seen = opencli_titles(state, &app_id);
    // A window born meanwhile is OpenCLI's to be: the foreground never goes
    // back to it, nor is it rescued full screen (`win::late_launch`).
    win::expect_late(&app_id);
    let before = win::foreground();
    let app = app.clone();
    let dir = dir.to_string();
    std::thread::spawn(move || {
        let state = app.state::<ChromeView>();
        loop {
            std::thread::sleep(OPENCLI_POLL);
            let done = state.inner.lock().map_or(true, |mut inner| {
                let done = inner
                    .opencli
                    .watch_until
                    .is_none_or(|t| std::time::Instant::now() >= t);
                if done {
                    inner.opencli.watching = false;
                }
                done
            });
            if done {
                break;
            }
            // A launch finds its window by what it adds, and that window is
            // not on its launch page at once: nothing is taken meanwhile,
            // this Arkadia's or the other's, a late window included. The
            // watch's end moves as much: OpenCLI's window may come then.
            let launch = if win::other_launching() || win::other_late() || late_pending(&dir) {
                None
            } else {
                match state.launching.try_lock() {
                    Ok(guard) => Some(guard),
                    Err(std::sync::TryLockError::WouldBlock) => None,
                    // A launch panicked: as everywhere else, nothing more.
                    Err(std::sync::TryLockError::Poisoned(_)) => {
                        if let Ok(mut inner) = state.inner.lock() {
                            inner.opencli.watching = false;
                        }
                        break;
                    }
                }
            };
            let Some(_launch) = launch else {
                if let Ok(mut inner) = state.inner.lock() {
                    let cap = inner.opencli.watch_cap;
                    if let (Some(until), Some(cap)) = (inner.opencli.watch_until.as_mut(), cap) {
                        *until = (*until + OPENCLI_POLL).min(cap);
                    }
                }
                continue;
            };
            let mut now = opencli_titles(&state, &app_id);
            let mut adopted = Vec::new();
            let mut refused = Vec::new();
            let mut changed = false;
            let mut browsed = false;
            for (hwnd, title) in &now {
                let known = state
                    .inner
                    .lock()
                    .is_ok_and(|inner| inner.opencli.adopted(*hwnd));
                match sighting(known, seen.get(hwnd).map(String::as_str), title) {
                    Sighting::Adopt { show } => {
                        if !win::adopt_opencli(*hwnd) {
                            refused.push(*hwnd);
                            continue;
                        }
                        win::watch_process(*hwnd);
                        if let Ok(mut inner) = state.inner.lock() {
                            inner.opencli.add(adopted_win(*hwnd, &dir), show);
                        }
                        log(&format!("OpenCLI window adopted, shown {show}"));
                        adopted.push(*hwnd);
                        changed = true;
                        browsed |= show;
                    }
                    Sighting::Show => {
                        changed |= state.inner.lock().is_ok_and(|mut inner| {
                            inner.opencli.shown.replace(*hwnd) != Some(*hwnd)
                        });
                        browsed = true;
                    }
                    Sighting::Nothing => {}
                }
            }
            // Refused (the other Arkadia's, or its lock not had): its title
            // of before stays, the next look tries again if it is still free.
            for hwnd in refused {
                now.remove(&hwnd);
            }
            // A window missing from one look (its profile unread) keeps its
            // title: back, it is not taken for one OpenCLI just opened.
            seen.retain(|h, _| win::alive(*h));
            seen.extend(now);
            if changed {
                arrange(&app, &state);
            }
            // OpenCLI browses: its owner's tab may come forward (once).
            if browsed {
                let owner = state
                    .inner
                    .lock()
                    .ok()
                    .and_then(|inner| inner.opencli.owner.clone());
                if let Some(key) = owner {
                    let _ = app.emit_to("main", "opencli-ready", ChromeKey { key });
                }
            }
            // OpenCLI opens `opencli browser`'s window in front: the
            // foreground goes back to the window Alexis used. Only from it:
            // Alexis may be typing in Claude in Chrome's window meanwhile.
            for hwnd in adopted {
                if win::foreground() == Some(hwnd) {
                    win::hand_back(hwnd, before);
                }
            }
        }
        win::late_done(&app_id);
    });
}

/// Before an opencli command in pane `key`'s session (inbox request `id`):
/// OpenCLI's windows are this session's now; the waiting hook is answered.
#[tauri::command]
pub async fn opencli_view_prepare(app: AppHandle, id: String, key: String) -> Result<(), String> {
    let worker = app.clone();
    let wait_id = id.clone();
    let pane = key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        prepare_opencli(&worker, &worker.state::<ChromeView>(), &wait_id, Some(key))
    })
    .await
    .map_err(|e| e.to_string())?;
    // This instance owns the pane: the request is answered and taken.
    if valid_id(&id) {
        let _ = std::fs::remove_file(inbox_dir().join(format!("{id}.json")));
    }
    write_ack(&id, result.as_ref().ok());
    match &result {
        Ok(p) => log(&format!(
            "OpenCLI request {} of pane {}: profile started {}",
            short(&id),
            short(&pane),
            p.profile_started
        )),
        Err(e) => log(&format!(
            "OpenCLI request {} of pane {} failed: {e}",
            short(&id),
            short(&pane)
        )),
    }
    result.map(|_| ())
}

/// The panel shows pane `key`'s « X / Reddit » tab: OpenCLI's window when
/// the pane's session ran an opencli command last, else nothing (the tab
/// says another session uses it).
#[tauri::command]
pub async fn opencli_view_show(app: AppHandle, key: String, bounds: Bounds, hidden: bool) {
    rearrange(&app, move |inner| {
        inner.active = Some(key);
        inner.bounds = Some(bounds);
        inner.hidden = hidden;
    });
}

/// Pane `key` closed, its session with it: its tab leaves, OpenCLI's windows
/// stay open, parked (Alexis, 27/11/2026).
#[tauri::command]
pub async fn opencli_view_close(app: AppHandle, key: String) {
    let released = app
        .state::<ChromeView>()
        .inner
        .lock()
        .is_ok_and(|mut inner| {
            if inner.active.as_deref() == Some(key.as_str()) {
                inner.active = None;
            }
            inner.opencli.release(&key)
        });
    if released {
        emit_opencli_owner(&app, None);
    }
    spawn_arrange(&app);
}

/// The tab OpenCLI's window shows in: a reloaded page learns it again.
#[tauri::command]
pub async fn opencli_view_owner(app: AppHandle) -> Option<String> {
    app.state::<ChromeView>()
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.opencli.owner.clone())
}

/// Every session's window closes (Arkadia exit, `on_exit`; the page no
/// longer calls it). The daily's anchors stay, parked: its next run takes
/// them back (`keep_left_behind`). The Lab's close: started for tests only,
/// left behind they would hold Claude's tabs nobody steers for days.
#[tauri::command]
pub async fn chrome_view_close_all(app: AppHandle) {
    close_all(&app.state::<ChromeView>());
}

fn close_all(state: &ChromeView) {
    let keep_anchors = !crate::lab::LAB;
    let (wins, anchors, opencli): (Vec<Win>, Vec<isize>, Vec<isize>) = state
        .inner
        .lock()
        .map(|mut inner| {
            inner.active = None;
            inner.opencli.owner = None;
            let anchors = if keep_anchors {
                inner.spares.values().map(|w| w.hwnd).collect()
            } else {
                inner.spares.drain().map(|(_, w)| w.hwnd).collect()
            };
            let opencli = inner.opencli.windows.iter().map(|w| w.hwnd).collect();
            (
                inner.windows.drain().map(|(_, w)| w).collect(),
                anchors,
                opencli,
            )
        })
        .unwrap_or_default();
    for win in wins {
        win::close(win.hwnd);
    }
    // OpenCLI's stay open, the Lab's too: OpenCLI reuses them, and a closed
    // one comes back on Alexis's screen (`split_opencli`).
    for raw in opencli {
        win::park(raw);
    }
    for raw in anchors {
        if keep_anchors {
            win::park(raw);
        } else {
            win::close(raw);
        }
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

/// Arkadia (or the panel's Chrome) came in front, or another app did.
fn set_away(app: &AppHandle, away: bool) {
    rearrange(app, move |inner| inner.away = away);
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
                .laid_windows()
                .filter(|w| w.at.is_some())
                .map(|w| w.hwnd)
                .collect()
        })
        .unwrap_or_default();
    win::foreground().is_some_and(|fg| shown.contains(&fg))
}

/// Arkadia's side: one of its windows, a panel's Chrome, or a popup of it.
#[cfg(windows)]
pub fn is_front_side(raw: isize) -> bool {
    win::is_front_side(win::hwnd(raw))
}

pub fn on_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<ChromeView>() {
        close_all(&state);
    }
    // Another Arkadia sharing the folder may have written them since.
    for name in ["ready", OPENCLI_MARKER] {
        let file = inbox_dir().join(name);
        let ours = std::fs::read_to_string(&file)
            .is_ok_and(|pid| pid.trim() == std::process::id().to_string());
        if ours {
            let _ = std::fs::remove_file(file);
        }
    }
}

// ---- Events from the hook thread (`win`) ----------------------------------

/// The foreground went to a Chrome window: one of the panel's or an anchor
/// (it is now its profile's last-focused window), or one of Alexis's (its
/// profile is dirty until the next steer).
/// Returns whether the window is one of the panel's or an anchor.
fn on_foreground(app: &AppHandle, hwnd: isize, app_id: Option<String>) -> bool {
    let Some(state) = app.try_state::<ChromeView>() else {
        return false;
    };
    let Ok(mut inner) = state.inner.lock() else {
        return false;
    };
    // An anchor too: the extension focuses the window that holds the tabs
    // of a session Arkadia does not run, and the foreground goes back. And
    // OpenCLI's, which `opencli browser` focuses.
    let found = inner
        .laid_windows()
        .chain(inner.spares.values())
        .find(|w| w.hwnd == hwnd)
        .map(|w| w.profile_dir.clone());
    if let Some(dir) = found {
        inner.dirty.remove(&dir);
        inner.steered.insert(dir, hwnd);
        return true;
    }
    let Some(app_id) = app_id else {
        return false;
    };
    // A profile with its anchor only (a scheduled task's) too: else an
    // anchor steered earlier still looked last-focused, and the task's tabs
    // went to Alexis's window.
    let dirs: Vec<String> = inner
        .windows
        .values()
        .chain(inner.spares.values())
        .map(|w| w.profile_dir.clone())
        .filter(|d| app_id_of(d) == app_id)
        .collect();
    inner.dirty.extend(dirs);
    false
}

/// The panel's place, last time a window was laid there.
fn last_laid(app: &AppHandle) -> Option<Layout> {
    let state = app.try_state::<ChromeView>()?;
    let inner = state.inner.lock().ok()?;
    inner.last_laid
}

/// A panel window or an anchor moved by itself (the extension resizes it, a
/// drag on its tab strip): back where Arkadia laid or parked it.
fn on_moved(app: &AppHandle, hwnd: isize, rect: (i32, i32, i32, i32)) {
    let Some(state) = app.try_state::<ChromeView>() else {
        return;
    };
    let Some((owner, at)) = state.inner.lock().ok().and_then(|inner| {
        // An anchor is never laid: the extension moving it parks it again.
        let at = match inner.laid_windows().find(|w| w.hwnd == hwnd) {
            Some(win) => win.at,
            None => {
                inner.spares.values().find(|w| w.hwnd == hwnd)?;
                None
            }
        };
        Some((main_hwnd(app), at))
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
    // OpenCLI's: its tab stays, OpenCLI opens a new one at its next command.
    if state
        .inner
        .lock()
        .is_ok_and(|mut inner| inner.opencli.remove(hwnd))
    {
        log("OpenCLI window closed in Chrome");
        spawn_arrange(app);
        return;
    }
    let key = state.inner.lock().ok().and_then(|mut inner| {
        inner.spares.retain(|_, w| w.hwnd != hwnd);
        let key = inner
            .windows
            .iter()
            .find(|(_, w)| w.hwnd == hwnd)
            .map(|(k, _)| k.clone())?;
        inner.windows.remove(&key);
        Some(key)
    });
    if let Some(key) = key {
        log(&format!("window of pane {} closed in Chrome", short(&key)));
        if let Some(pane) = key.strip_prefix("chrome:") {
            forget_asked(pane);
        }
        let _ = app.emit_to("main", "chrome-closed", ChromeKey { key });
    }
}

/// The file whose age lets pane `pane_id` ask for its window at most every
/// 20 s (`chrome-profile-open.ps1`, the chat server's `askedMarker`): its
/// name is the pane's id stripped of all but `[\w-]`.
fn asked_marker(temp: &std::path::Path, pane_id: &str) -> PathBuf {
    let name: String = pane_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    temp.join("claude-chrome-panel").join(name)
}

/// Pane `pane_id`'s window closed (Claude closed its last tab, or Alexis
/// did): its next call asks for a new window at once. Within the 20 s, it
/// asked nothing and the extension put its new group in the profile's
/// last-focused window, the parked anchor or another session's (12/11/2026).
fn forget_asked(pane_id: &str) {
    let temp = std::env::var_os("TEMP")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let _ = std::fs::remove_file(asked_marker(&temp, pane_id));
}

/// Starts the inbox watcher and the window hooks, then takes back the
/// anchors the last run left and starts the paired profiles that have none
/// (`keep_left_behind`, `prestart`).
pub fn spawn(app: AppHandle) {
    let _ = APP.set(app.clone());
    let hooks_app = app.clone();
    std::thread::spawn(move || win::run_hooks(hooks_app));
    std::thread::spawn(win::run_covers);
    let start_app = app.clone();
    std::thread::spawn(move || {
        keep_left_behind(&start_app);
        if !crate::lab::LAB {
            prestart(&start_app);
        }
    });
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
            if stale && entry.file_name() != "ready" && entry.file_name() != OPENCLI_MARKER {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let ready = dir.join("ready");
    std::fs::write(&ready, std::process::id().to_string()).map_err(|e| e.to_string())?;
    let opencli_marker = dir.join(OPENCLI_MARKER);
    let _ = std::fs::write(&opencli_marker, std::process::id().to_string());

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
                for file in [&ready, &opencli_marker] {
                    if !file.exists() {
                        let _ = std::fs::write(file, std::process::id().to_string());
                    }
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
            if request.opencli {
                if request.pane_id.is_empty() {
                    // A session Arkadia does not run: taken by the Arkadia the
                    // hook asked only (its pid in the marker).
                    let ours = std::fs::read_to_string(&opencli_marker)
                        .is_ok_and(|pid| pid.trim() == std::process::id().to_string());
                    if ours {
                        let _ = std::fs::remove_file(&path);
                        let app = app.clone();
                        let id = request.id;
                        // Off the watcher: a launch takes seconds.
                        std::thread::spawn(move || {
                            let prepared =
                                prepare_opencli(&app, &app.state::<ChromeView>(), &id, None);
                            match &prepared {
                                Ok(_) => log(&format!(
                                    "OpenCLI request {} outside Arkadia: parked",
                                    short(&id)
                                )),
                                Err(e) => log(&format!(
                                    "OpenCLI request {} outside Arkadia failed: {e}",
                                    short(&id)
                                )),
                            }
                            write_ack(&id, prepared.as_ref().ok());
                        });
                    }
                } else {
                    log(&format!(
                        "OpenCLI request {} of pane {}",
                        short(&request.id),
                        short(&request.pane_id)
                    ));
                    // Left in place: the instance owning the pane takes it.
                    let _ = app.emit_to(
                        "main",
                        "opencli-request",
                        ChromeRequest {
                            id: request.id,
                            pane_id: request.pane_id,
                        },
                    );
                }
                continue;
            }
            if let Some(email) = request.email.filter(|_| request.pane_id.is_empty()) {
                // Taken by the Arkadia the hook asked only (its pid in `ready`).
                let ours = std::fs::read_to_string(&ready)
                    .is_ok_and(|pid| pid.trim() == std::process::id().to_string());
                if ours {
                    let _ = std::fs::remove_file(&path);
                    let app = app.clone();
                    let id = request.id;
                    // Off the watcher: a launch takes seconds.
                    std::thread::spawn(move || {
                        let prepared = prepare_outside(&app.state::<ChromeView>(), &email, &id);
                        if let Err(e) = &prepared {
                            log(&format!(
                                "request {} outside Arkadia failed: {e}",
                                short(&id)
                            ));
                        }
                        write_ack(&id, prepared.as_ref().ok());
                    });
                }
                continue;
            }
            if request.ran {
                let state = app.state::<ChromeView>();
                let key = format!("chrome:{}", request.pane_id);
                // Taken only by the instance that has the pane's window.
                if state
                    .inner
                    .lock()
                    .is_ok_and(|inner| inner.windows.contains_key(&key))
                {
                    let _ = std::fs::remove_file(&path);
                    note_ran(&app, key);
                }
                continue;
            }
            log(&format!(
                "request {} of pane {}",
                short(&request.id),
                short(&request.pane_id)
            ));
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
    use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    use tauri::AppHandle;
    use windows::core::PWSTR;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, PROPERTYKEY, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
        EndPaint, EnumDisplayMonitors, FillRect, GetDC, GetMonitorInfoW, GetPixel, InvalidateRect,
        MonitorFromPoint, ReleaseDC, SelectObject, HDC, HMONITOR, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, PAINTSTRUCT,
    };
    use windows::Win32::Foundation::WAIT_OBJECT_0;
    use windows::Win32::Foundation::WAIT_ABANDONED_0;
    use windows::Win32::System::Threading::{
        CreateEventW, OpenEventW, ResetEvent, SetEvent, WaitForSingleObject,
        SYNCHRONIZATION_SYNCHRONIZE,
    };
    use windows::Win32::System::Threading::{CreateMutexW, ReleaseMutex};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList, TaskbarList};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, GetExitCodeProcess, OpenProcess,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::Threading::{QueryFullProcessImageNameW, PROCESS_NAME_WIN32};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreForWindow,
    };
    use windows::Win32::UI::WindowsAndMessaging::GW_OWNER;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, LoadCursorW, RegisterClassW,
        ShowWindowAsync, GWLP_USERDATA, IDC_ARROW, MA_NOACTIVATE, SW_HIDE, WM_ERASEBKGND,
        WM_MOUSEACTIVATE, WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE, WS_POPUP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EnumWindows, GetClassNameW, GetForegroundWindow, GetMessageW, GetPropW,
        GetSystemMetrics, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
        InternalGetWindowText, IsIconic, IsWindow, IsWindowVisible, IsZoomed, PostMessageW,
        PostThreadMessageW, SendMessageTimeoutW, SetForegroundWindow, SetPropW, SetWindowLongPtrW,
        SetWindowPos, EVENT_OBJECT_DESTROY, EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND,
        GWLP_HWNDPARENT, GWL_EXSTYLE, GWL_STYLE, GW_HWNDPREV, HWND_TOP, MSG, OBJID_WINDOW,
        SMTO_ABORTIFHUNG, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_ASYNCWINDOWPOS,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, WINEVENT_OUTOFCONTEXT,
        WM_APP, WM_CLOSE, WM_NULL, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetCursorPos, RemovePropW, WindowFromPoint, GA_ROOT, WM_APPCOMMAND,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetLayeredWindowAttributes, LAYERED_WINDOW_ATTRIBUTES_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetLayeredWindowAttributes, EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW, LWA_ALPHA,
        WS_EX_LAYERED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{SC_MAXIMIZE, SC_RESTORE, WM_SYSCOMMAND};
    use windows::Win32::UI::WindowsAndMessaging::{SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN};

    pub(super) fn hwnd(raw: isize) -> HWND {
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
                // Chrome restores it itself, as on a click of its button:
                // restored from outside, Chrome still saved the profile as
                // maximized, and its next first window opened full screen
                // (measured 05/11/2026). Posted before the park, done first.
                let _ = PostMessageW(
                    Some(h),
                    WM_SYSCOMMAND,
                    WPARAM(SC_RESTORE as usize),
                    LPARAM(0),
                );
            }
            let style = GetWindowLongPtrW(h, GWL_STYLE) as u32;
            let style = style & !(WS_THICKFRAME.0 | WS_MAXIMIZEBOX.0 | WS_MINIMIZEBOX.0);
            SetWindowLongPtrW(h, GWL_STYLE, style as isize);
            let _styles = VEILED.lock().unwrap_or_else(|e| e.into_inner());
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let ex = (ex | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
            SetWindowLongPtrW(h, GWL_EXSTYLE, ex as isize);
            let _ = SetPropW(
                h,
                mark_name(),
                Some(HANDLE(std::process::id() as usize as *mut _)),
            );
        }
        // Out of the style lock: it waits on Explorer.
        drop_taskbar_button(h);
    }

    /// The shell gave the window its taskbar button when Chrome showed it,
    /// before its tool-window style: a style changed on a visible window
    /// never takes the button away (Microsoft, « Managing Taskbar
    /// Buttons »). Alexis saw the profile's Chrome in his taskbar and took
    /// it for a window opened outside Arkadia (06/11/2026).
    fn drop_taskbar_button(h: HWND) {
        // SAFETY: COM calls on this thread, on a window that exists.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let Ok(list) =
                CoCreateInstance::<_, ITaskbarList>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
            else {
                return;
            };
            if list.HrInit().is_ok() {
                let _ = list.DeleteTab(h);
            }
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
        // SAFETY: position of a window that exists.
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
        cover_set(raw, Some(at), true);
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
        // From the hook: no new color sample (it waits on Chrome).
        cover_set(raw, Some(at), false);
    }

    fn virtual_screen() -> (i32, i32, i32, i32) {
        // SAFETY: plain reads.
        unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        }
    }

    fn monitors() -> Vec<(i32, i32, i32, i32)> {
        unsafe extern "system" fn cb(
            _monitor: HMONITOR,
            _dc: HDC,
            rect: *mut RECT,
            lp: LPARAM,
        ) -> windows::core::BOOL {
            // SAFETY: lp points at the Vec below, alive during the call;
            // rect is the monitor's, given by Windows.
            unsafe {
                let out = &mut *(lp.0 as *mut Vec<(i32, i32, i32, i32)>);
                let r = *rect;
                out.push((r.left, r.top, r.right - r.left, r.bottom - r.top));
            }
            true.into()
        }
        let mut out: Vec<(i32, i32, i32, i32)> = Vec::new();
        // SAFETY: the callback only touches `out`.
        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut out as *mut _ as isize));
        }
        out
    }

    /// The work area of the monitor under the cursor.
    fn cursor_work_area() -> Option<(i32, i32, i32, i32)> {
        // SAFETY: plain reads.
        unsafe {
            let mut cursor = POINT::default();
            GetCursorPos(&mut cursor).ok()?;
            let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return None;
            }
            let r = info.rcWork;
            Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
        }
    }

    /// A Chrome window of Alexis's came in front where Chrome put it by
    /// copying one of the panel's (the most recently active Chrome window,
    /// `make_most_recent` or the extension's focus): 30 px in the screen's
    /// corner, or over the panel. It goes maximized on the monitor under
    /// the cursor, where he just clicked (Alexis, 07/11/2026).
    fn rescue_soon(h: HWND) {
        static RESCUING: Mutex<Vec<isize>> = Mutex::new(Vec::new());
        let raw = h.0 as isize;
        if !misplaced(h) {
            return;
        }
        {
            let mut rescuing = RESCUING.lock().unwrap_or_else(|e| e.into_inner());
            // Two foreground events for one new window: one rescue.
            if rescuing.contains(&raw) {
                return;
            }
            rescuing.push(raw);
        }
        std::thread::spawn(move || {
            let h = hwnd(raw);
            // Checked again a moment later: the other Arkadia may have made
            // it its own meanwhile, or Alexis maximized it.
            std::thread::sleep(std::time::Duration::from_millis(150));
            if misplaced(h) && responsive(h) {
                if let Some(work) = cursor_work_area() {
                    let (x, y, width, height) = super::rescue_rect(work);
                    // SAFETY: a move then a posted command, on a window that
                    // exists. The move is synchronous so the maximize happens
                    // on its monitor; Chrome maximizes itself, as on a click
                    // of its button, and saves the profile maximized.
                    unsafe {
                        let _ = SetWindowPos(
                            h,
                            None,
                            x,
                            y,
                            width,
                            height,
                            SWP_NOACTIVATE | SWP_NOZORDER,
                        );
                        let _ = PostMessageW(
                            Some(h),
                            WM_SYSCOMMAND,
                            WPARAM(SC_MAXIMIZE as usize),
                            LPARAM(0),
                        );
                    }
                }
            }
            RESCUING
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|w| *w != raw);
        });
    }

    /// Whether a Chrome window is Alexis's and sits where only Chrome
    /// copying one of the panel's puts it. Reads only: safe from the hook.
    fn misplaced(h: HWND) -> bool {
        // A launch's new frame (this Arkadia's or the other's) is the
        // panel's to be; a tab dragged out of the panel's window is a new
        // frame at its place, the button still down.
        if is_panel_window(h)
            || LAUNCHES.load(Ordering::SeqCst) > 0
            || other_launching()
            || left_button_down()
            || !is_chrome_exe(h)
            || late_launch(h)
        {
            return false;
        }
        // SAFETY: plain reads of a window's state.
        let rect = unsafe {
            if !is_browser_frame(h) || IsZoomed(h).as_bool() || IsIconic(h).as_bool() {
                return false;
            }
            let mut r = RECT::default();
            if GetWindowRect(h, &mut r).is_err() {
                return false;
            }
            (r.left, r.top, r.right - r.left, r.bottom - r.top)
        };
        let laid = APP.get().and_then(super::last_laid);
        super::lost_off_screen(rect, &monitors())
            || laid.is_some_and(|at| super::copies_laid(rect, at, dpi(h.0 as isize)))
    }

    fn left_button_down() -> bool {
        // SAFETY: plain read.
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
    }

    /// A launch in progress, seen by the other Arkadia (daily, Lab): its
    /// new frame shows in the corner, unmarked until adopted.
    fn launch_event(lab: bool) -> PCWSTR {
        if lab {
            w!("Local\\ArkadiaLabChromeLaunching")
        } else {
            w!("Local\\ArkadiaChromeLaunching")
        }
    }

    fn set_launching(on: bool) {
        static OWN: OnceLock<isize> = OnceLock::new();
        let raw = *OWN.get_or_init(|| {
            // SAFETY: a named event, kept for the process's life.
            unsafe { CreateEventW(None, true, false, launch_event(crate::lab::LAB)) }
                .map(|h| h.0 as isize)
                .unwrap_or(0)
        });
        if raw == 0 {
            return;
        }
        let event = HANDLE(raw as *mut _);
        // SAFETY: the event created above, never closed.
        unsafe {
            let _ = if on {
                SetEvent(event)
            } else {
                ResetEvent(event)
            };
        }
    }

    /// A window `catch_late` still waits for, seen by the other Arkadia:
    /// its launch's event is reset by then, its frame still unmarked.
    fn late_event(lab: bool) -> PCWSTR {
        if lab {
            w!("Local\\ArkadiaLabChromeLate")
        } else {
            w!("Local\\ArkadiaChromeLate")
        }
    }

    /// Late windows waited for; changed with the event, under its lock.
    static LATE_WAITING: Mutex<u32> = Mutex::new(0);

    fn set_late(on: bool) {
        static OWN: OnceLock<isize> = OnceLock::new();
        let raw = *OWN.get_or_init(|| {
            // SAFETY: a named event, kept for the process's life.
            unsafe { CreateEventW(None, true, false, late_event(crate::lab::LAB)) }
                .map(|h| h.0 as isize)
                .unwrap_or(0)
        });
        if raw == 0 {
            return;
        }
        // SAFETY: the event created above, never closed.
        unsafe {
            let event = HANDLE(raw as *mut _);
            let _ = if on {
                SetEvent(event)
            } else {
                ResetEvent(event)
            };
        }
    }

    pub(super) fn late_started() {
        let mut waiting = LATE_WAITING.lock().unwrap_or_else(|e| e.into_inner());
        *waiting += 1;
        if *waiting == 1 {
            set_late(true);
        }
    }

    pub(super) fn late_ended() {
        let mut waiting = LATE_WAITING.lock().unwrap_or_else(|e| e.into_inner());
        *waiting = waiting.saturating_sub(1);
        if *waiting == 0 {
            set_late(false);
        }
    }

    pub(super) fn other_late() -> bool {
        // SAFETY: a handle opened, waited on without blocking, and closed.
        unsafe {
            let Ok(event) = OpenEventW(
                SYNCHRONIZATION_SYNCHRONIZE,
                false,
                late_event(!crate::lab::LAB),
            ) else {
                return false;
            };
            let set = WaitForSingleObject(event, 0) == WAIT_OBJECT_0;
            let _ = CloseHandle(event);
            set
        }
    }

    pub(super) fn other_launching() -> bool {
        // SAFETY: a handle opened, waited on without blocking, and closed.
        unsafe {
            let Ok(event) = OpenEventW(
                SYNCHRONIZATION_SYNCHRONIZE,
                false,
                launch_event(!crate::lab::LAB),
            ) else {
                return false;
            };
            let set = WaitForSingleObject(event, 0) == WAIT_OBJECT_0;
            let _ = CloseHandle(event);
            set
        }
    }

    /// Off every monitor, unowned (main may minimize), still drawn.
    pub(super) fn park(raw: isize) {
        let h = hwnd(raw);
        cover_set(raw, None, false);
        set_owner(h, 0);
        let mut rect = RECT::default();
        // SAFETY: plain read then an async move.
        unsafe {
            let _ = GetWindowRect(h, &mut rect);
            let width = (rect.right - rect.left).max(800);
            let height = (rect.bottom - rect.top).max(600);
            let (x, y) = super::park_position(virtual_screen());
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
        super::parked_rect(rect, virtual_screen())
    }

    pub(super) fn close(raw: isize) {
        cover_drop(raw);
        // Chrome saves a closing window's place for the profile's next
        // first window: off-screen, a later launch flashes at most a corner.
        // Both messages are posted to its thread, in this order.
        park(raw);
        // SAFETY: a posted message, never waited on.
        unsafe {
            let _ = PostMessageW(Some(hwnd(raw)), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }

    // ---- The cover over Chrome's caption buttons ---------------------------
    //
    // Chrome draws its minimize/maximize/close itself, whatever the window's
    // styles (WS_SYSMENU, boxes: tried 05/11/2026), and a window region makes
    // it paint that corner white. A small window of Arkadia's lies on them
    // instead, painted the tab strip's own color (read from Chrome's render):
    // owned by the Chrome window, it always stays above it, and it takes no
    // click and no focus. Created and destroyed on the hook thread, which
    // pumps its messages.

    struct Cover {
        chrome: isize,
        /// 0 until the hook thread created it.
        cover: isize,
        /// Where it goes (screen pixels), None while the window is parked.
        rect: Option<(i32, i32, i32, i32)>,
        color: u32,
        /// The window's layout, for a sample outside a layout pass.
        layout: Option<Layout>,
        /// Chrome renders the whole window for a sample: at most this
        /// often while the panel is dragged or the window moves.
        sampled: Option<std::time::Instant>,
    }

    const SAMPLE_EVERY: std::time::Duration = std::time::Duration::from_secs(3);

    static COVERS: Mutex<Vec<Cover>> = Mutex::new(Vec::new());
    const WM_COVER: u32 = WM_APP + 43;
    const COVER_CLASS: PCWSTR = w!("ArkadiaChromeCover");
    /// Black (the tab strip of Alexis's dark Chrome), until the first sample.
    const DEFAULT_STRIP: u32 = 0x0000_0000;

    fn cover_rect(at: Layout) -> (i32, i32, i32, i32) {
        (
            at.x + at.width - at.notch_width,
            at.y,
            at.notch_width,
            at.notch_height,
        )
    }

    /// The tab strip's color: a corner pixel of the minimize button, whose
    /// background is the strip's (its glyph sits in its middle). Chrome
    /// renders the window into a bitmap: no screen needed, any z-order.
    fn sample_strip(raw: isize, at: Layout) -> Option<u32> {
        // SAFETY: a memory DC and bitmap made, used and freed here.
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let dc = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, at.width.max(1), at.height.max(1));
            let old = SelectObject(dc, bitmap.into());
            let painted = PrintWindow(hwnd(raw), dc, PRINT_WINDOW_FLAGS(2)).as_bool();
            let pixel = GetPixel(dc, at.width - at.notch_width + 4, 4);
            SelectObject(dc, old);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(dc);
            ReleaseDC(None, screen);
            (painted && pixel.0 != 0xFFFF_FFFF).then_some(pixel.0)
        }
    }

    /// The cover of Chrome window `raw` goes to `at` (None: hidden). With
    /// `sample`, its color is read again soon if due: never here, where a
    /// layout pass holds the panel's lock (Chrome renders for a sample),
    /// and once Chrome has done the async move (the pixel at the new size).
    fn cover_set(raw: isize, at: Option<Layout>, sample: bool) {
        let mut due = false;
        let (cover, rect, color) = {
            let mut covers = COVERS.lock().unwrap_or_else(|e| e.into_inner());
            let entry = match covers.iter().position(|c| c.chrome == raw) {
                Some(i) => &mut covers[i],
                None => {
                    if at.is_none() {
                        return;
                    }
                    covers.push(Cover {
                        chrome: raw,
                        cover: 0,
                        rect: None,
                        color: DEFAULT_STRIP,
                        layout: None,
                        sampled: None,
                    });
                    covers.last_mut().expect("just pushed")
                }
            };
            entry.rect = at.map(cover_rect);
            if at.is_some() {
                entry.layout = at;
                if sample && entry.sampled.is_none_or(|t| t.elapsed() >= SAMPLE_EVERY) {
                    entry.sampled = Some(std::time::Instant::now());
                    due = true;
                }
            }
            (entry.cover, entry.rect, entry.color)
        };
        if due {
            resample_soon(raw);
        }
        if cover == 0 {
            post_cover(raw, 0);
            return;
        }
        apply_cover(cover, rect, color);
    }

    fn apply_cover(cover: isize, rect: Option<(i32, i32, i32, i32)>, color: u32) {
        let h = hwnd(cover);
        // SAFETY: Arkadia's own window, moved async, repainted.
        unsafe {
            match rect {
                Some((x, y, w, hgt)) => {
                    if GetWindowLongPtrW(h, GWLP_USERDATA) as u32 != color {
                        SetWindowLongPtrW(h, GWLP_USERDATA, color as isize);
                        let _ = InvalidateRect(Some(h), None, true);
                    }
                    let _ = SetWindowPos(
                        h,
                        None,
                        x,
                        y,
                        w,
                        hgt,
                        SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
                    );
                }
                None => {
                    let _ = ShowWindowAsync(h, SW_HIDE);
                }
            }
        }
    }

    /// Chrome repaints its tab strip when it gains or loses the foreground
    /// (themes color an inactive window differently): the cover follows.
    fn cover_resample(raw: isize) {
        let layout = COVERS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|c| c.chrome == raw && c.rect.is_some())
            .and_then(|c| c.layout);
        let Some(at) = layout else { return };
        // PrintWindow waits on Chrome with no limit: never on a hung one.
        if !responsive(hwnd(raw)) {
            return;
        }
        let Some(color) = sample_strip(raw, at) else {
            return;
        };
        let target = {
            let mut covers = COVERS.lock().unwrap_or_else(|e| e.into_inner());
            covers.iter_mut().find(|c| c.chrome == raw).map(|c| {
                c.color = color;
                c.sampled = Some(std::time::Instant::now());
                (c.cover, c.rect, c.color)
            })
        };
        if let Some((cover, rect, color)) = target.filter(|t| t.0 != 0) {
            apply_cover(cover, rect, color);
        }
    }

    /// Whether Arkadia's side has the foreground: an Arkadia window, the
    /// panel's Chrome, or a popup of it (download bubble, translation).
    static FRONT: AtomicBool = AtomicBool::new(true);
    static FRONT_TURN: AtomicU64 = AtomicU64::new(0);
    /// The taskbar and Alt+Tab take the foreground an instant between two
    /// windows (as for `pip_follow`): leaving counts after this.
    const AWAY_AFTER: std::time::Duration = std::time::Duration::from_millis(250);

    fn note_front(app: &AppHandle, front: bool) {
        let turn = FRONT_TURN.fetch_add(1, Ordering::SeqCst) + 1;
        if front {
            if !FRONT.swap(true, Ordering::SeqCst) {
                let app = app.clone();
                std::thread::spawn(move || super::set_away(&app, false));
            }
        } else if FRONT.load(Ordering::SeqCst) {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(AWAY_AFTER);
                // What is in front now, not what the event said: a window
                // that takes the foreground an instant (Chrome's, Windows')
                // parked the panel while Arkadia stayed in front.
                // SAFETY: plain read.
                let now = unsafe { GetForegroundWindow() };
                if is_front_side(now) {
                    return;
                }
                if FRONT_TURN.load(Ordering::SeqCst) == turn && FRONT.swap(false, Ordering::SeqCst)
                {
                    super::set_away(&app, true);
                }
            });
        }
    }

    /// Arkadia's side: one of its windows, a panel's Chrome, or a popup of it.
    pub(super) fn is_front_side(h: HWND) -> bool {
        !h.0.is_null() && (own_process(h) || is_panel_window(h) || owned_by_panel(h))
    }

    fn owned_by_panel(h: HWND) -> bool {
        // SAFETY: plain read.
        unsafe { GetWindow(h, GW_OWNER) }.is_ok_and(is_panel_window)
    }

    /// The last foreground window, to resample a panel window losing it.
    static PREV_FG: AtomicIsize = AtomicIsize::new(0);

    fn resample_soon(raw: isize) {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            cover_resample(raw);
        });
    }

    fn cover_drop(raw: isize) {
        let found = {
            let mut covers = COVERS.lock().unwrap_or_else(|e| e.into_inner());
            covers
                .iter()
                .position(|c| c.chrome == raw)
                .map(|i| covers.remove(i))
        };
        if let Some(c) = found.filter(|c| c.cover != 0) {
            post_cover(c.cover, 1);
        }
    }

    /// The covers' own thread. A window owned by Chrome's attaches its
    /// input queue to Chrome's UI thread: a frozen Chrome blocks only this
    /// thread, never the hook thread nor the foreground handovers.
    static COVER_THREAD: AtomicU32 = AtomicU32::new(0);

    pub(super) fn run_covers() {
        // SAFETY: the covers are made, painted and destroyed on this thread,
        // from the loop below.
        unsafe {
            COVER_THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.hwnd.0.is_null() && msg.message == WM_COVER {
                    match msg.lParam.0 {
                        0 => create_cover(msg.wParam.0 as isize),
                        _ => {
                            let _ = DestroyWindow(hwnd(msg.wParam.0 as isize));
                        }
                    }
                    continue;
                }
                DispatchMessageW(&msg);
            }
        }
    }

    /// To the covers' thread: create the cover of a Chrome window (0), or
    /// destroy a cover (1).
    fn post_cover(raw: isize, what: isize) {
        let thread = COVER_THREAD.load(Ordering::SeqCst);
        if thread == 0 {
            return;
        }
        // SAFETY: a posted message to the hook thread.
        unsafe {
            let _ = PostThreadMessageW(thread, WM_COVER, WPARAM(raw as usize), LPARAM(what));
        }
    }

    unsafe extern "system" fn cover_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        // SAFETY: the cover's own messages, on the thread that made it.
        unsafe {
            match msg {
                WM_PAINT => {
                    let mut ps = PAINTSTRUCT::default();
                    let dc = BeginPaint(h, &mut ps);
                    let brush =
                        CreateSolidBrush(COLORREF(GetWindowLongPtrW(h, GWLP_USERDATA) as u32));
                    FillRect(dc, &ps.rcPaint, brush);
                    let _ = DeleteObject(brush.into());
                    let _ = EndPaint(h, &ps);
                    LRESULT(0)
                }
                WM_ERASEBKGND => LRESULT(1),
                // A click on it neither activates it nor reaches Chrome.
                WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
                _ => DefWindowProcW(h, msg, wp, lp),
            }
        }
    }

    /// On the covers' thread: a cover made for Chrome window `chrome`, then laid
    /// where it should be.
    fn create_cover(chrome: isize) {
        static REGISTERED: std::sync::Once = std::sync::Once::new();
        // SAFETY: class and window of this thread, owned by a live window.
        unsafe {
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            REGISTERED.call_once(|| {
                let class = WNDCLASSW {
                    lpfnWndProc: Some(cover_proc),
                    hInstance: module.into(),
                    lpszClassName: COVER_CLASS,
                    hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
                    ..Default::default()
                };
                RegisterClassW(&class);
            });
            if !IsWindow(Some(hwnd(chrome))).as_bool() {
                return;
            }
            let Ok(cover) = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                COVER_CLASS,
                w!(""),
                WS_POPUP,
                -32000,
                -32000,
                1,
                1,
                Some(hwnd(chrome)),
                None,
                Some(module.into()),
                None,
            ) else {
                return;
            };
            let raw = cover.0 as isize;
            let state = {
                let mut covers = COVERS.lock().unwrap_or_else(|e| e.into_inner());
                match covers.iter_mut().find(|c| c.chrome == chrome) {
                    Some(c) if c.cover == 0 => {
                        c.cover = raw;
                        Some((c.rect, c.color))
                    }
                    _ => None,
                }
            };
            match state {
                Some((rect, color)) => apply_cover(raw, rect, color),
                // Dropped meanwhile, or already made.
                None => {
                    let _ = DestroyWindow(cover);
                }
            }
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
            STEER_UNTIL.store(now_ms() + 1_000, Ordering::SeqCst);
            if !SetForegroundWindow(hwnd(raw)).as_bool() {
                STEER_UNTIL.store(0, Ordering::SeqCst);
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

    /// Windows an ended run of this Arkadia left (its anchors, kept on
    /// purpose, or all of a crashed run's), with their profile's
    /// AppUserModelID and whether they are parked. Those of an instance
    /// still running (`tauri dev` beside the daily) are left alone.
    pub(super) fn left_behind() -> Vec<super::LeftWindow> {
        unveil_leftovers();
        browser_windows()
            .into_iter()
            .filter(|(raw, _, _)| {
                // SAFETY: plain read of a window property.
                let mark = unsafe { GetPropW(hwnd(*raw), mark_name()) };
                let pid = mark.0 as usize as u32;
                pid != 0 && pid != std::process::id() && !running(pid)
            })
            .map(|(raw, app_id, title)| {
                let mut r = RECT::default();
                // SAFETY: plain read.
                let read = unsafe { GetWindowRect(hwnd(raw), &mut r) }.is_ok();
                super::LeftWindow {
                    hwnd: raw,
                    app_id,
                    parked: read
                        && is_parked((r.left, r.top, r.right - r.left, r.bottom - r.top)),
                    launch_page: super::on_launch_page(&title),
                }
            })
            .collect()
    }

    /// Whether a window carries a panel's mark (this Arkadia's or the
    /// other's, of any run): a launch's new window never does yet.
    pub(super) fn marked(raw: isize) -> bool {
        is_panel_window(hwnd(raw))
    }

    /// The pid in mark `name` of a window, 0 for none.
    fn mark_pid(h: HWND, name: PCWSTR) -> u32 {
        // SAFETY: plain read of a window property.
        unsafe { GetPropW(h, name) }.0 as usize as u32
    }

    /// The other Arkadia's mark (daily, Lab).
    fn other_mark_name() -> PCWSTR {
        if crate::lab::LAB {
            w!("ArkadiaChromePanel")
        } else {
            w!("ArkadiaLabChromePanel")
        }
    }

    /// Whether this Arkadia may take a window as OpenCLI's: no other
    /// running Arkadia has it. One left by a run that ended may be taken.
    pub(super) fn adoptable(raw: isize) -> bool {
        let h = hwnd(raw);
        [mark_name(), other_mark_name()].into_iter().all(|name| {
            let pid = mark_pid(h, name);
            pid == 0 || pid == std::process::id() || !running(pid)
        })
    }

    /// Taking an OpenCLI window, one Arkadia at a time (daily, Lab): both
    /// may watch its profile, and a window both found free in the same poll
    /// would be laid by one and parked by the other forever (`on_moved`).
    fn adopt_lock() -> Option<HANDLE> {
        static LOCK: OnceLock<isize> = OnceLock::new();
        let raw = *LOCK.get_or_init(|| {
            // SAFETY: a named mutex, kept for the process's life.
            unsafe { CreateMutexW(None, false, w!("Local\\ArkadiaOpenCliAdopt")) }
                .map(|h| h.0 as isize)
                .unwrap_or(0)
        });
        (raw != 0).then(|| HANDLE(raw as *mut _))
    }

    /// An OpenCLI window becomes this Arkadia's (`adopt`), if still free
    /// once the other Arkadia cannot take it meanwhile. The mark the other
    /// left on it, its run ended, goes: its next run would take it back.
    /// Whether it is this Arkadia's.
    pub(super) fn adopt_opencli(raw: isize) -> bool {
        let h = hwnd(raw);
        let Some(lock) = adopt_lock() else {
            return false;
        };
        // SAFETY: the mutex above, released on this same thread; the marks
        // are properties of a window that exists.
        let free = unsafe {
            let waited = WaitForSingleObject(lock, 2_000);
            if waited != WAIT_OBJECT_0 && waited != WAIT_ABANDONED_0 {
                return false;
            }
            let free = adoptable(raw);
            if free {
                if mark_pid(h, other_mark_name()) != 0 {
                    let _ = RemovePropW(h, other_mark_name());
                }
                let _ = SetPropW(
                    h,
                    mark_name(),
                    Some(HANDLE(std::process::id() as usize as *mut _)),
                );
            }
            let _ = ReleaseMutex(lock);
            free
        };
        // Out of the lock: its styles wait on Chrome's thread.
        if free {
            adopt(raw);
        }
        free
    }

    /// The hook thread runs: a window can be watched.
    pub(super) fn hooks_ready() -> bool {
        HOOK_THREAD.load(Ordering::SeqCst) != 0
    }

    pub(super) fn window_title(raw: isize) -> String {
        title(hwnd(raw))
    }

    /// Opens Chrome's new tab page in front: Chrome maps APPCOMMAND_NEW to
    /// "new tab", with no foreground nor keyboard needed (verified
    /// 12/11/2026 on Chrome 157, in a parked window).
    pub(super) fn new_tab(raw: isize) {
        const APPCOMMAND_NEW: isize = 29;
        // SAFETY: a posted message, never waited on.
        unsafe {
            let _ = PostMessageW(
                Some(hwnd(raw)),
                WM_APPCOMMAND,
                WPARAM(raw as usize),
                LPARAM(APPCOMMAND_NEW << 16),
            );
        }
    }

    /// Closes the launch page's tab by its own close button (UI
    /// Automation), in front or not, only beside another tab: the window
    /// stays. No foreground, no keyboard (verified 12/11/2026 on Chrome 157,
    /// in a parked window). Returns what was found; None when UI Automation
    /// saw no tab or failed.
    pub(super) fn close_launch_tab(raw: isize, page_title: &str) -> Option<super::LaunchTabState> {
        use windows::Win32::System::Variant::VARIANT;
        use windows::Win32::UI::Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
            TreeScope_Children, TreeScope_Descendants, UIA_ButtonControlTypeId,
            UIA_ControlTypePropertyId, UIA_InvokePatternId, UIA_TabControlTypeId,
            UIA_TabItemControlTypeId,
        };
        // SAFETY: COM calls on this thread's apartment, on objects it holds.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let uia =
                CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .ok()?;
            let of_type = |id: i32| {
                uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(id))
            };
            let root = uia.ElementFromHandle(hwnd(raw)).ok()?;
            // The tab strip comes before the page in the tree: the search
            // stops there, never walking a page's own tabs.
            let strip = root
                .FindFirst(TreeScope_Descendants, &of_type(UIA_TabControlTypeId.0).ok()?)
                .ok()?;
            let found = strip
                .FindAll(TreeScope_Descendants, &of_type(UIA_TabItemControlTypeId.0).ok()?)
                .ok()?;
            let tabs: Vec<IUIAutomationElement> = (0..found.Length().ok()?)
                .map(|i| found.GetElement(i).ok())
                .collect::<Option<Vec<_>>>()?;
            // A name unread would pass for another page's: nothing known.
            let names = tabs
                .iter()
                .map(|t| t.CurrentName().ok().map(|n| n.to_string()))
                .collect::<Option<Vec<String>>>()?;
            let state = super::launch_tab_state(&names, page_title)?;
            if let super::LaunchTabState::Beside(i) = state {
                let close = tabs[i]
                    .FindFirst(TreeScope_Children, &of_type(UIA_ButtonControlTypeId.0).ok()?)
                    .ok()?;
                close
                    .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    .ok()?
                    .Invoke()
                    .ok()?;
            }
            Some(state)
        }
    }

    /// The last foreground window that was none of the panel's: where the
    /// foreground goes back when Chrome takes it by itself.
    static LAST_OTHER: AtomicIsize = AtomicIsize::new(0);
    /// Until when (GetTickCount64) the panel's windows may take the
    /// foreground: Arkadia steering one (`activate_briefly`).
    static STEER_UNTIL: AtomicU64 = AtomicU64::new(0);
    /// Chrome windows taking the foreground during a launch are the new
    /// window, never a place to go back to.
    static LAUNCHES: AtomicU32 = AtomicU32::new(0);
    /// Profiles (their AppUserModelID) with a launch that gave up while its
    /// window may still come (`catch_late`), with the windows they had then:
    /// until it is caught, a window of theirs born since is that launch's,
    /// neither the place the foreground goes back to nor one of Alexis's to
    /// rescue full screen. His windows open before stay his.
    static LATE: Mutex<Vec<(String, Vec<isize>)>> = Mutex::new(Vec::new());

    pub(super) fn expect_late(app_id: &str) {
        let before: Vec<isize> = browser_windows()
            .into_iter()
            .filter(|(_, id, _)| id.as_deref() == Some(app_id))
            .map(|(h, _, _)| h)
            .collect();
        LATE.lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((app_id.to_owned(), before));
    }

    pub(super) fn late_done(app_id: &str) {
        let mut late = LATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(i) = late.iter().position(|(a, _)| a == app_id) {
            late.remove(i);
        }
    }

    /// A Chrome window not adopted yet, born after a launch of its profile
    /// gave up while that launch's window is awaited.
    fn late_launch(h: HWND) -> bool {
        if is_panel_window(h) {
            return false;
        }
        let Some(id) = app_id(h) else { return false };
        let raw = h.0 as isize;
        LATE.lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|(a, before)| *a == id && !before.contains(&raw))
    }

    /// A launch in progress. Chrome shows the new window at once, often
    /// maximized, before Arkadia finds and parks it: a full-screen flash,
    /// over whatever app is in front (Alexis, 05/11/2026). While a launch
    /// lives, every new Chrome frame is made fully transparent as soon as
    /// it is created (`veil`); the panel's window is unveiled once parked
    /// off-screen, any other (Alexis opening one meanwhile) when it ends.
    pub(super) struct Launching;
    impl Launching {
        pub(super) fn start() -> Self {
            if LAUNCHES.fetch_add(1, Ordering::SeqCst) == 0 {
                set_launching(true);
            }
            post_watch(1);
            Launching
        }
    }
    impl Drop for Launching {
        fn drop(&mut self) {
            if LAUNCHES.fetch_sub(1, Ordering::SeqCst) == 1 {
                set_launching(false);
                post_watch(0);
                unveil_all();
            }
        }
    }

    /// Frames made transparent during a launch. Its lock also covers every
    /// change of a Chrome window's extended style (`adopt`), so a late veil
    /// never undoes a style set meanwhile, nor comes after the unveil.
    static VEILED: Mutex<Vec<isize>> = Mutex::new(Vec::new());
    const WM_LAUNCH_WATCH: u32 = WM_APP + 42;

    fn post_watch(on: usize) {
        let thread = HOOK_THREAD.load(Ordering::SeqCst);
        if thread == 0 {
            return;
        }
        // SAFETY: a posted message to the hook thread.
        unsafe {
            let _ = PostThreadMessageW(thread, WM_LAUNCH_WATCH, WPARAM(on), LPARAM(0));
        }
    }

    /// A Chrome browser frame, visible or not yet (at its creation). Its
    /// class is shared by every Chromium app (VS Code, Discord, Edge): only
    /// chrome.exe's.
    fn is_new_frame(h: HWND) -> bool {
        // SAFETY: plain reads of a window's state.
        let frame = unsafe {
            is_chrome_class(h)
                && GetAncestor(h, GA_ROOT) == h
                && GetWindowLongPtrW(h, GWL_STYLE) as u32 & WS_CAPTION.0 == WS_CAPTION.0
        };
        frame && !is_panel_window(h) && is_chrome_exe(h)
    }

    /// Whether the window belongs to chrome.exe (answers kept per pid).
    fn is_chrome_exe(h: HWND) -> bool {
        static KNOWN: Mutex<Vec<(u32, bool)>> = Mutex::new(Vec::new());
        let mut pid = 0u32;
        // SAFETY: plain read.
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        if pid == 0 {
            return false;
        }
        if let Some((_, known)) = KNOWN
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|(p, _)| *p == pid)
        {
            return *known;
        }
        // SAFETY: the process handle is closed before returning.
        let chrome = unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).is_ok_and(|process| {
                let mut buf = [0u16; 512];
                let mut len = buf.len() as u32;
                let read = QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    PWSTR(buf.as_mut_ptr()),
                    &mut len,
                )
                .is_ok();
                let _ = CloseHandle(process);
                read && String::from_utf16_lossy(&buf[..len as usize])
                    .to_ascii_lowercase()
                    .ends_with("\\chrome.exe")
            })
        };
        let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
        if known.len() > 64 {
            known.clear();
        }
        known.push((pid, chrome));
        chrome
    }

    fn veil(raw: isize) {
        let h = hwnd(raw);
        let mut veiled = VEILED.lock().unwrap_or_else(|e| e.into_inner());
        // The launch ended meanwhile (nobody would unveil it), it is already
        // the panel's (it would stay invisible in the panel), or veiled.
        if LAUNCHES.load(Ordering::SeqCst) == 0 || is_panel_window(h) || veiled.contains(&raw) {
            return;
        }
        // SAFETY: style and opacity of a window that exists.
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            SetWindowLongPtrW(h, GWL_EXSTYLE, ex | WS_EX_LAYERED.0 as isize);
            let _ = SetLayeredWindowAttributes(h, COLORREF(0), 0, LWA_ALPHA);
        }
        veiled.push(raw);
    }

    fn drop_layered(h: HWND) {
        // SAFETY: style of a window that may be gone (then it fails).
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            if ex & WS_EX_LAYERED.0 as isize != 0 {
                SetWindowLongPtrW(h, GWL_EXSTYLE, ex & !(WS_EX_LAYERED.0 as isize));
            }
        }
    }

    /// Visible again, veiled or not (a late veil cannot have come after:
    /// the window is the panel's now).
    pub(super) fn unveil(raw: isize) {
        let mut veiled = VEILED.lock().unwrap_or_else(|e| e.into_inner());
        veiled.retain(|w| *w != raw);
        drop_layered(hwnd(raw));
    }

    fn unveil_all() {
        let mut veiled = VEILED.lock().unwrap_or_else(|e| e.into_inner());
        for raw in veiled.drain(..) {
            drop_layered(hwnd(raw));
        }
    }

    /// Waits (bounded) until Chrome moved the window off every monitor.
    pub(super) fn wait_parked(raw: isize, at_most: std::time::Duration) {
        let deadline = std::time::Instant::now() + at_most;
        loop {
            let mut r = RECT::default();
            // SAFETY: plain read.
            let read = unsafe { GetWindowRect(hwnd(raw), &mut r) }.is_ok();
            if !read || is_parked((r.left, r.top, r.right - r.left, r.bottom - r.top)) {
                return;
            }
            if std::time::Instant::now() >= deadline {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }

    /// A window Arkadia was killed with while it was veiled (a launch cut
    /// short): Chrome frames never use full transparency themselves.
    fn unveil_leftovers() {
        for (raw, _, _) in browser_windows() {
            let h = hwnd(raw);
            let mut alpha = 255u8;
            let mut flags = LAYERED_WINDOW_ATTRIBUTES_FLAGS(0);
            // SAFETY: plain reads.
            let veiled = unsafe {
                GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_LAYERED.0 as isize != 0
                    && GetLayeredWindowAttributes(h, None, Some(&mut alpha), Some(&mut flags))
                        .is_ok()
                    && flags.0 & LWA_ALPHA.0 != 0
                    && alpha == 0
            };
            if veiled {
                drop_layered(h);
            }
        }
    }

    fn now_ms() -> u64 {
        // SAFETY: plain read.
        unsafe { GetTickCount64() }
    }

    /// Whether Alexis just clicked in the window himself: it is the top
    /// window under the cursor (a game over it is not), and input just came.
    fn user_caused(h: HWND) -> bool {
        // SAFETY: plain reads.
        unsafe {
            let mut cursor = POINT::default();
            if GetCursorPos(&mut cursor).is_err() {
                return false;
            }
            let under = GetAncestor(WindowFromPoint(cursor), GA_ROOT);
            if under != h {
                return false;
            }
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            GetLastInputInfo(&mut info).as_bool()
                && (now_ms() as u32).wrapping_sub(info.dwTime) < 500
        }
    }

    /// Gives the foreground to `target`, borrowing the input state of the
    /// thread that holds it (Arkadia is not the foreground process then).
    fn force_foreground(target: HWND) {
        // SAFETY: foreground handover with the holder's input attached.
        unsafe {
            if !IsWindow(Some(target)).as_bool() {
                return;
            }
            let holder = GetWindowThreadProcessId(GetForegroundWindow(), None);
            let ours = GetCurrentThreadId();
            let attached =
                holder != 0 && holder != ours && AttachThreadInput(ours, holder, true).as_bool();
            let _ = SetForegroundWindow(target);
            if attached {
                let _ = AttachThreadInput(ours, holder, false);
            }
        }
    }

    /// A window of a panel, this Arkadia's or the other's (daily, Lab).
    fn is_panel_window(h: HWND) -> bool {
        // SAFETY: plain reads of window properties.
        unsafe {
            !GetPropW(h, w!("ArkadiaChromePanel")).0.is_null()
                || !GetPropW(h, w!("ArkadiaLabChromePanel")).0.is_null()
        }
    }

    /// Activates a parked window an instant before a launch, so Chrome sizes
    /// the new window like it (see `launch`). The guard lets it be.
    pub(super) fn make_most_recent(raw: isize) {
        STEER_UNTIL.store(now_ms() + 15_000, Ordering::SeqCst);
        force_foreground(hwnd(raw));
        // Chrome records the activation on its own thread.
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    /// The launch is over: the guard watches the panel's windows again.
    pub(super) fn steering_done() {
        STEER_UNTIL.store(0, Ordering::SeqCst);
    }

    /// After a launch: the new window took the foreground, which goes back
    /// to the window Alexis used last (the launch can take seconds: the one
    /// in front before it may be stale), else to the one before the launch.
    pub(super) fn hand_back(raw: isize, before: Option<isize>) {
        // The new window, or the parked one activated before the launch.
        let fg = foreground();
        if fg != Some(raw) && !fg.is_some_and(|f| is_panel_window(hwnd(f))) {
            return;
        }
        let last = LAST_OTHER.load(Ordering::SeqCst);
        let target = if last != 0 && last != raw {
            Some(last)
        } else {
            before
        };
        if let Some(target) = target.filter(|t| *t != raw) {
            force_foreground(hwnd(target));
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
            let mut launch_hook: Option<HWINEVENTHOOK> = None;
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.hwnd.0.is_null() && msg.message == WM_LAUNCH_WATCH {
                    // Every process: a cold start has no Chrome pid yet.
                    // Only while a launch lives, which lasts seconds. The
                    // range also brings DESTROY (0x8001): ignored.
                    if msg.wParam.0 == 1 && launch_hook.is_none() {
                        let hook = SetWinEventHook(
                            EVENT_OBJECT_CREATE,
                            EVENT_OBJECT_SHOW,
                            None,
                            Some(on_launch_event),
                            0,
                            0,
                            WINEVENT_OUTOFCONTEXT,
                        );
                        if !hook.is_invalid() {
                            launch_hook = Some(hook);
                        }
                    } else if msg.wParam.0 == 0 && LAUNCHES.load(Ordering::SeqCst) == 0 {
                        if let Some(hook) = launch_hook.take() {
                            let _ = UnhookWinEvent(hook);
                        }
                    }
                    continue;
                }
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

    /// During a launch: a new Chrome frame turns transparent at once (off
    /// the hook: changing its style waits on Chrome's thread).
    unsafe extern "system" fn on_launch_event(
        _hook: HWINEVENTHOOK,
        _event: u32,
        h: HWND,
        id_object: i32,
        id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if h.0.is_null() || id_object != OBJID_WINDOW.0 || id_child != 0 {
            return;
        }
        if LAUNCHES.load(Ordering::SeqCst) == 0 || !is_new_frame(h) {
            return;
        }
        let raw = h.0 as isize;
        std::thread::spawn(move || veil(raw));
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
                let raw = h.0 as isize;
                let prev = PREV_FG.swap(raw, Ordering::SeqCst);
                if prev != 0 && prev != raw && is_panel_window(hwnd(prev)) {
                    resample_soon(prev);
                }
                if is_panel_window(h) {
                    resample_soon(raw);
                }
                let ours = is_chrome_class(h) && super::on_foreground(app, raw, app_id(h));
                note_front(app, ours || own_process(h) || owned_by_panel(h));
                if !ours {
                    // Neither a window being launched nor another Arkadia's
                    // panel window (the daily and the Lab side by side would
                    // hand the foreground to each other forever).
                    let chrome = is_chrome_class(h);
                    if !(chrome
                        && (LAUNCHES.load(Ordering::SeqCst) > 0
                            || is_panel_window(h)
                            || late_launch(h)))
                    {
                        LAST_OTHER.store(raw, Ordering::SeqCst);
                    }
                    if chrome {
                        rescue_soon(h);
                    }
                    return;
                }
                // Chrome took it by itself (the extension focuses its window):
                // it goes back, unless Alexis clicked in it or Arkadia steers.
                let steering = now_ms() < STEER_UNTIL.load(Ordering::SeqCst);
                let back = LAST_OTHER.load(Ordering::SeqCst);
                if !steering && back != 0 && !user_caused(h) {
                    // Off the hook: handing over sends messages.
                    std::thread::spawn(move || force_foreground(hwnd(back)));
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
            EVENT_OBJECT_DESTROY => {
                cover_drop(h.0 as isize);
                super::on_destroyed(app, h.0 as isize);
            }
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
    pub(super) fn window_title(_: isize) -> String {
        String::new()
    }
    pub(super) fn new_tab(_: isize) {}
    pub(super) fn close_launch_tab(_: isize, _: &str) -> Option<super::LaunchTabState> {
        None
    }
    pub(super) fn hand_back(_: isize, _: Option<isize>) {}
    pub(super) fn make_most_recent(_: isize) {}
    pub(super) fn steering_done() {}
    pub(super) fn unveil(_: isize) {}
    pub(super) fn wait_parked(_: isize, _: std::time::Duration) {}
    pub(super) fn run_covers() {}
    pub(super) struct Launching;
    impl Launching {
        pub(super) fn start() -> Self {
            Launching
        }
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
    pub(super) fn left_behind() -> Vec<super::LeftWindow> {
        Vec::new()
    }
    pub(super) fn marked(_: isize) -> bool {
        false
    }
    pub(super) fn adoptable(_: isize) -> bool {
        false
    }
    pub(super) fn adopt_opencli(_: isize) -> bool {
        false
    }
    pub(super) fn other_launching() -> bool {
        false
    }
    pub(super) fn other_late() -> bool {
        false
    }
    pub(super) fn late_started() {}
    pub(super) fn late_ended() {}
    pub(super) fn hooks_ready() -> bool {
        true
    }
    pub(super) fn watch_process(_: isize) {}
    pub(super) fn expect_late(_: &str) {}
    pub(super) fn late_done(_: &str) {}
    pub(super) fn run_hooks(_: AppHandle) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_dir_of_app_id_reverses_app_id_of() {
        for dir in ["Default", "Profile 3", "Profile 12"] {
            assert_eq!(profile_dir_of_app_id(&app_id_of(dir)).as_deref(), Some(dir));
        }
        assert_eq!(profile_dir_of_app_id("Chrome.UserData.GuestProfile"), None);
        assert_eq!(profile_dir_of_app_id("Chrome.UserData.Profile"), None);
        assert_eq!(profile_dir_of_app_id("Msedge"), None);
    }

    #[test]
    fn sort_left_behind_keeps_one_anchor_per_paired_profile() {
        let w = |hwnd, profile: &str, parked, launch_page| LeftWindow {
            hwnd,
            app_id: Some(format!("Chrome.UserData.{profile}")),
            parked,
            launch_page,
        };
        let left = vec![
            w(1, "Profile3", false, true),
            w(2, "Profile3", true, false),
            w(3, "Profile3", true, true),
            w(4, "Profile7", false, false),
            w(5, "Profile9", true, true),
            LeftWindow {
                hwnd: 6,
                app_id: None,
                parked: true,
                launch_page: true,
            },
        ];
        let paired = vec!["Profile 3".to_string(), "Profile 7".to_string()];
        let (anchors, extra) = sort_left_behind(&left, &paired);
        // Parked on its launch page wins; an unpaired or unknown profile closes.
        assert_eq!(
            anchors,
            vec![("Profile 3".to_string(), 3), ("Profile 7".to_string(), 4)]
        );
        assert_eq!(extra, vec![1, 2, 5, 6]);
    }

    #[test]
    fn knows_a_launch_page_of_any_run() {
        assert!(on_launch_page("Arkadia-15492-3"));
        assert!(on_launch_page("Arkadia-15492-3 - Google Chrome - Minifashion"));
        assert!(!on_launch_page("Arkadia - adsense.google.com"));
        assert!(!on_launch_page("Arkadia-15492 - Google Chrome"));
        assert!(!on_launch_page("Nouvel onglet - Google Chrome"));
    }

    fn b(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn lays_the_window_on_the_panel_its_caption_buttons_cut_out() {
        let at = layout((-18, 0), b(2227.4, 153.0, 1613.0, 2025.0), 288);
        assert_eq!((at.x, at.y, at.width, at.height), (2209, 153, 1613, 2025));
        // 140 x 40 dip at 300 %: the toolbar row (41.6 dip down) stays whole.
        assert_eq!((at.notch_width, at.notch_height), (420, 120));
        // A 96 dpi screen, a dpi Windows failed to report, a tiny panel.
        assert_eq!(
            layout((0, 0), b(0.0, 0.0, 500.0, 400.0), 96).notch_width,
            140
        );
        assert_eq!(
            layout((0, 0), b(0.0, 0.0, 500.0, 400.0), 0).notch_height,
            40
        );
        assert_eq!(layout((0, 0), b(0.0, 0.0, 90.0, 400.0), 96).notch_width, 90);
    }

    #[test]
    fn parks_below_right_of_every_monitor() {
        // A 4K screen with a second one on its left.
        let screen = (-1920, 0, 1920 + 3840, 2160);
        let (x, y) = park_position(screen);
        assert!(x >= 3840 && y >= 2160);
        assert!(parked_rect((x, y, 2400, 2000), screen));
        // On a monitor, even in part: not parked.
        assert!(!parked_rect((3000, 1000, 2400, 2000), screen));
        // The old place, left of every monitor, still counts as parked.
        assert!(parked_rect((-6000, 0, 2400, 2000), screen));
    }

    #[test]
    fn finds_a_window_chrome_opened_next_to_a_parked_one() {
        // A 1440p screen with a second one on its left.
        let monitors = [(0, 0, 2560, 1440), (-1920, 0, 1920, 1080)];
        // 30 px in the corner of the work area.
        assert!(lost_off_screen((2530, 1340, 2520, 1400), &monitors));
        // Alexis's own windows: maximized, half off the edge, on the other
        // screen.
        assert!(!lost_off_screen((-12, -12, 2584, 1404), &monitors));
        assert!(!lost_off_screen((1800, 200, 1400, 900), &monitors));
        assert!(!lost_off_screen((-1900, 100, 1200, 800), &monitors));
    }

    #[test]
    fn finds_a_window_chrome_opened_at_the_panel_s_place() {
        let panel = Bounds {
            x: 1500.0,
            y: 120.0,
            width: 1060.0,
            height: 1280.0,
        };
        let laid = layout((0, 0), panel, 192);
        // 10 dip down-right at 200 %.
        assert!(copies_laid((1520, 140, 1060, 1280), laid, 192));
        assert!(!copies_laid((0, 0, 2560, 1400), laid, 192));
    }

    #[test]
    fn restores_a_rescued_window_down_to_the_middle_of_its_screen() {
        assert_eq!(rescue_rect((0, 0, 2560, 1392)), (256, 139, 2048, 1113));
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
    fn closes_the_launch_tab_only_beside_another_one() {
        let page = "Arkadia-1-2";
        let tabs = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        // Claude's tab in front, the launch tab behind it (seen 12/11/2026),
        // its name lengthened by Chrome's memory figure.
        assert_eq!(
            launch_tab_state(
                &tabs(&["Arkadia-1-2 - Utilisation de la mémoire - 19,1 Mo", "KDP Connexion"]),
                page
            ),
            Some(LaunchTabState::Beside(0))
        );
        // Claude's group went elsewhere: closing it would close the window.
        assert_eq!(launch_tab_state(&tabs(&["Arkadia-1-2"]), page), Some(LaunchTabState::Alone));
        // Another launch's page is no match.
        assert_eq!(
            launch_tab_state(&tabs(&["Arkadia-1-22", "Stripe"]), page),
            Some(LaunchTabState::Gone)
        );
        // UI Automation saw no tab: nothing is known.
        assert_eq!(launch_tab_state(&[], page), None);
    }

    #[test]
    fn names_the_ask_marker_as_the_hook_does() {
        // `$env:ARKADIA_PANE_ID -replace '[^\w-]', ''` in the PowerShell hook.
        let temp = std::path::Path::new("T");
        assert_eq!(
            asked_marker(temp, "631e166b-34b4-424e-81da-6deed7dea66e"),
            temp.join("claude-chrome-panel")
                .join("631e166b-34b4-424e-81da-6deed7dea66e")
        );
        assert_eq!(
            asked_marker(temp, "../a b"),
            temp.join("claude-chrome-panel").join("ab")
        );
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
        assert_eq!(r.email, None);
    }

    #[test]
    fn reads_the_request_of_a_session_arkadia_does_not_run() {
        // A scheduled task's hook: no pane, its account's email.
        let raw = "{\"email\":\"minifashion83@hotmail.fr\",\"id\":\"r2\"}";
        let r: RequestFile = serde_json::from_str(raw).unwrap();
        assert_eq!(r.pane_id, "");
        assert_eq!(r.email.as_deref(), Some("minifashion83@hotmail.fr"));
        assert!(!r.ran);
    }

    #[test]
    fn waits_longer_for_a_profile_that_is_not_running() {
        // Chrome reopened after going down: the profile's first window came
        // after 10 s and stayed on Alexis's screen (13/11/2026).
        assert!(launch_deadline(true) >= std::time::Duration::from_secs(25));
        assert_eq!(launch_deadline(false), std::time::Duration::from_secs(10));
    }

    fn opencli_with(hwnds: &[isize]) -> OpenCli {
        let mut opencli = OpenCli::default();
        for &h in hwnds {
            opencli.add(adopted_win(h, "Profile 10"), false);
        }
        opencli
    }

    #[test]
    fn knows_opencli_s_windows_by_what_its_command_does() {
        // Opened while its command runs: OpenCLI's, shown once on a page.
        assert_eq!(
            sighting(false, None, "about:blank - Google Chrome"),
            Sighting::Adopt { show: false }
        );
        assert_eq!(
            sighting(false, None, "x.com - Google Chrome"),
            Sighting::Adopt { show: true }
        );
        // There before: OpenCLI's once the command takes it to a page
        // (measured 27/11/2026: about:blank, then x.com).
        assert_eq!(
            sighting(
                false,
                Some("about:blank - Google Chrome"),
                "x.com - Google Chrome"
            ),
            Sighting::Adopt { show: true }
        );
        // Alexis's own windows of the profile, left as they are, even when
        // their page changes: OpenCLI's leave an idle page.
        let store = "OpenCLI - Chrome Web Store - Google Chrome";
        assert_eq!(sighting(false, Some(store), store), Sighting::Nothing);
        assert_eq!(
            sighting(false, Some("(1) Accueil / X - Google Chrome"), store),
            Sighting::Nothing
        );
        // Adopted: comes on screen on a page, never for its idle page.
        assert_eq!(
            sighting(
                true,
                Some("OpenCLI Browser - Google Chrome"),
                "ClaudeAI - Google Chrome"
            ),
            Sighting::Show
        );
        assert_eq!(
            sighting(
                true,
                Some("x.com - Google Chrome"),
                "about:blank - Google Chrome"
            ),
            Sighting::Nothing
        );
        assert_eq!(
            sighting(
                true,
                Some("ClaudeAI - Google Chrome"),
                "OpenCLI Browser - Google Chrome"
            ),
            Sighting::Nothing
        );
        assert!(opencli_idle("about:blank - Google Chrome"));
        assert!(!opencli_idle(
            "Reddit - The heart of the internet - Google Chrome"
        ));
    }

    #[test]
    fn opencli_s_window_goes_to_the_last_session_that_ran_a_command() {
        let mut opencli = opencli_with(&[7]);
        assert!(opencli.claim(Some("opencli:a".into())));
        assert_eq!(opencli.on_screen("opencli:a"), Some(7));
        // Told again: nothing changes, no event.
        assert!(!opencli.claim(Some("opencli:a".into())));
        assert!(opencli.claim(Some("opencli:b".into())));
        assert_eq!(opencli.on_screen("opencli:b"), Some(7));
        // A session Arkadia does not run: nobody's tab shows it, it is parked.
        assert!(opencli.claim(None));
        assert_eq!(opencli.on_screen("opencli:b"), None);
    }

    #[test]
    fn another_session_s_tab_shows_no_window() {
        let mut opencli = opencli_with(&[7, 8]);
        opencli.claim(Some("opencli:b".into()));
        // Its tab says the window is used elsewhere: nothing laid.
        assert_eq!(opencli.on_screen("opencli:a"), None);
        // Claude in Chrome's tab of the owner's pane is not OpenCLI's.
        assert_eq!(opencli.on_screen("chrome:b"), None);
        // The window OpenCLI took to a page last is the one shown.
        opencli.add(adopted_win(9, "Profile 10"), true);
        assert_eq!(opencli.on_screen("opencli:b"), Some(9));
        opencli.add(adopted_win(9, "Profile 10"), true);
        assert_eq!(opencli.windows.len(), 3);
    }

    #[test]
    fn a_session_that_ends_leaves_opencli_s_windows_open() {
        let mut opencli = opencli_with(&[7, 8]);
        opencli.claim(Some("opencli:a".into()));
        // Another pane closing changes nothing.
        assert!(!opencli.release("opencli:b"));
        assert_eq!(opencli.owner.as_deref(), Some("opencli:a"));
        // Its owner closing: no owner, every window kept (parked).
        assert!(opencli.release("opencli:a"));
        assert_eq!(opencli.owner, None);
        assert_eq!(
            opencli.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>(),
            vec![7, 8]
        );
        // Only Chrome closing one takes it away; another one is shown then.
        assert!(opencli.remove(7));
        assert_eq!(opencli.shown, Some(8));
        assert!(!opencli.remove(7));
    }

    #[test]
    fn keeps_opencli_s_windows_left_by_the_last_run() {
        let w = |hwnd, profile: &str, launch_page| LeftWindow {
            hwnd,
            app_id: Some(format!("Chrome.UserData.{profile}")),
            parked: true,
            launch_page,
        };
        let left = vec![
            w(1, "Profile10", true),
            w(2, "Profile10", false),
            w(3, "Profile3", false),
        ];
        let hwnds = |w: &[LeftWindow]| w.iter().map(|w| w.hwnd).collect::<Vec<_>>();
        let paired = vec!["Profile 3".to_string()];
        let known = Ok(Some("Profile 10".to_string()));
        let (rest, opencli) = split_opencli(left.clone(), &known, Some(&paired));
        // Its anchor stays with the others, to be kept as the profile's.
        assert_eq!(hwnds(&rest), vec![1, 3]);
        assert_eq!(opencli, vec![2]);
        // Its extension gone: nothing reopens them, they are sorted as ever.
        let (rest, opencli) = split_opencli(left.clone(), &Ok(None), Some(&paired));
        assert_eq!((hwnds(&rest), opencli), (vec![1, 2, 3], vec![]));
        // Its profile unread: a window that may be OpenCLI's is never
        // closed, left as it is; a paired profile's window is sorted as ever.
        let unread = Err("Local State".to_string());
        let (rest, opencli) = split_opencli(left.clone(), &unread, Some(&paired));
        assert_eq!((hwnds(&rest), opencli), (vec![1, 3], vec![]));
        // The pairing table unread too: only launch pages are sorted.
        assert_eq!(hwnds(&split_opencli(left, &unread, None).0), vec![1]);
    }

    #[test]
    fn reads_an_opencli_request() {
        let r: RequestFile =
            serde_json::from_str("{\"id\":\"r3\",\"paneId\":\"p1\",\"opencli\":true}").unwrap();
        assert!(r.opencli && !r.ran);
        assert_eq!(short("opencli:631e166b-34b4"), "631e166b");
    }

    #[test]
    fn a_late_window_is_kept_only_where_one_is_missing() {
        let pane = Some("chrome:p1");
        assert_eq!(late_fate(pane, false, false, true), LateFate::Pane);
        // A later request launched the pane's window, or the pane closed.
        assert_eq!(late_fate(pane, true, false, true), LateFate::Close);
        assert_eq!(late_fate(pane, false, true, true), LateFate::Close);
        assert_eq!(late_fate(None, false, false, false), LateFate::Anchor);
        assert_eq!(late_fate(None, false, false, true), LateFate::Close);
    }
}
