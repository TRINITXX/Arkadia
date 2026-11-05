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
    /// The tab of the page it was launched on, still open.
    launch: Option<LaunchTab>,
}

/// Claude in Chrome adds its own tab (in the background) to the window:
/// the launch page's tab closes once Claude Code reports a call that ran
/// (PostToolUse), so the window holds Claude's tabs only (Alexis,
/// 05/11/2026). A guess on timing could close the window's last tab, and
/// the window with it (third review of 05/11/2026).
#[derive(Clone, Debug)]
struct LaunchTab {
    title: String,
    /// Claude's group lands in this window: steered there, or the profile's
    /// only window, when its first call was let through.
    landed: bool,
}

/// Whether the launch tab may close after one of Claude's calls ran: its
/// group is in this window (so is its tab), and the launch page is still
/// the window's active tab (Chrome closes the active tab).
fn may_close_launch_tab(landed: bool, window_title: &str, page_title: &str) -> bool {
    landed && is_launched_window(window_title, page_title)
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
    /// screen: a corner (both measured 05/11/2026).
    spares: HashMap<String, Win>,
    /// Launch tabs just closed: their window going away means it was its
    /// last tab (Claude's group was elsewhere). Never again for that pane.
    closing: HashMap<String, std::time::Instant>,
    no_autoclose: HashSet<String>,
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
    /// Claude Code's PostToolUse: one of the pane's calls ran, its tab
    /// exists (`note_ran`). Nothing to answer.
    #[serde(default)]
    ran: bool,
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
    // The profile's anchor first (`Inner::spares`), never taken by a
    // session: the profile is never left with no window (Chrome closing the
    // session's last tab, the pane closing), so the session's window opens
    // next to a parked one, in the corner. And launched last, the session's
    // window is the profile's last focused one, where Claude's tabs go: a
    // spare launched after it took them (05/11/2026).
    let anchored = state.inner.lock().is_ok_and(|inner| {
        inner
            .spares
            .get(&dir)
            .is_some_and(|anchor| win::alive(anchor.hwnd))
    });
    let mut profile_started = false;
    if !anchored {
        if let Ok((anchor, started)) = launch(state, &dir) {
            profile_started = started;
            if let Ok(mut inner) = state.inner.lock() {
                inner.spares.insert(dir.clone(), anchor);
            }
        }
    }
    let (win, started) = launch(state, &dir)?;
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

/// Launches a window in profile folder `dir` and makes it the panel's:
/// found by its first page's unique title, parked, shown again only once
/// off-screen. The caller holds `state.launching`. Returns it with whether
/// no window of the profile was open before.
fn launch(state: &ChromeView, dir: &str) -> Result<(Win, bool), String> {
    let dir = dir.to_string();
    // The new window opens where the profile's last active window is: off
    // the screen while Arkadia launches (arrange lays them back after).
    let shown: Vec<isize> = state
        .inner
        .lock()
        .map(|inner| {
            inner
                .windows
                .values()
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
    // Chrome puts a window launched from the command line in front, over
    // whatever Alexis uses: the foreground goes back to it.
    let before = win::foreground();
    let _launching = win::Launching::start();
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
    // The park is async on Chrome's thread: the window shows again only
    // once it is off every monitor for sure (the others launched meanwhile
    // come back when the launch ends, `Launching`'s drop).
    win::wait_parked(hwnd, std::time::Duration::from_secs(1));
    win::unveil(hwnd);
    win::hand_back(hwnd, before);
    win::watch_process(hwnd);
    let win = Win {
        hwnd,
        profile_dir: dir,
        at: None,
        launch: Some(LaunchTab {
            title: title.clone(),
            landed: false,
        }),
    };
    Ok((win, profile_started))
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
        note_landed(&state, &key, steered);
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

/// Claude's call in pane `key` is let through: when its group lands in
/// the pane's window, the launch tab may go once a call ran.
fn note_landed(state: &ChromeView, key: &str, steered: bool) {
    if !steered {
        return;
    }
    if let Some(launch) = state
        .inner
        .lock()
        .ok()
        .as_mut()
        .and_then(|inner| inner.windows.get_mut(key))
        .and_then(|win| win.launch.as_mut())
    {
        launch.landed = true;
    }
}

/// One of Claude's calls in pane `key` ran (PostToolUse): its tab is in the
/// window, the launch tab closes. Any other tab in front (Alexis clicked
/// one): the launch tab stays, Chrome would close that other tab.
fn note_ran(state: &ChromeView, key: &str) {
    let Ok(mut inner) = state.inner.lock() else {
        return;
    };
    if inner.no_autoclose.contains(key) {
        return;
    }
    let Some(win) = inner.windows.get_mut(key) else {
        return;
    };
    let hwnd = win.hwnd;
    let Some(launch) = win.launch.take() else {
        return;
    };
    if !launch.landed {
        // Its group went elsewhere: this window may hold the launch tab
        // only. Kept for a later call that lands here.
        win.launch = Some(launch);
        return;
    }
    if may_close_launch_tab(launch.landed, &win::window_title(hwnd), &launch.title) {
        win::close_active_tab(hwnd);
        inner
            .closing
            .insert(key.to_string(), std::time::Instant::now());
    } else {
        // Another tab in front: tried again after the next call.
        win.launch = Some(launch);
    }
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
    if let Ok((spare, _)) = launch(state, &closing.profile_dir) {
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
            let spares: Vec<Win> = inner.spares.drain().map(|(_, w)| w).collect();
            inner
                .windows
                .drain()
                .map(|(_, w)| w)
                .chain(spares)
                .collect()
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
/// Returns whether the window is one of the panel's.
fn on_foreground(app: &AppHandle, hwnd: isize, app_id: Option<String>) -> bool {
    let Some(state) = app.try_state::<ChromeView>() else {
        return false;
    };
    let Ok(mut inner) = state.inner.lock() else {
        return false;
    };
    if let Some(dir) = inner
        .windows
        .values()
        .find(|w| w.hwnd == hwnd)
        .map(|w| w.profile_dir.clone())
    {
        inner.dirty.remove(&dir);
        inner.steered.insert(dir, hwnd);
        return true;
    }
    let Some(app_id) = app_id else {
        return false;
    };
    let dirs: Vec<String> = inner
        .windows
        .values()
        .map(|w| w.profile_dir.clone())
        .filter(|d| app_id_of(d) == app_id)
        .collect();
    inner.dirty.extend(dirs);
    false
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
        inner.spares.retain(|_, w| w.hwnd != hwnd);
        let key = inner
            .windows
            .iter()
            .find(|(_, w)| w.hwnd == hwnd)
            .map(|(k, _)| k.clone())?;
        inner.windows.remove(&key);
        let closed_launch_tab = inner
            .closing
            .remove(&key)
            .is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(3));
        if closed_launch_tab {
            inner.no_autoclose.insert(key.clone());
        }
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
    std::thread::spawn(win::run_covers);
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
                    note_ran(&state, &key);
                }
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
        EndPaint, FillRect, GetDC, GetPixel, InvalidateRect, ReleaseDC, SelectObject, PAINTSTRUCT,
    };
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
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
        GetAncestor, GetCursorPos, WindowFromPoint, GA_ROOT, WM_APPCOMMAND,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetLayeredWindowAttributes, LAYERED_WINDOW_ATTRIBUTES_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetLayeredWindowAttributes, EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW, LWA_ALPHA,
        WS_EX_LAYERED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{SC_RESTORE, WM_SYSCOMMAND};
    use windows::Win32::UI::WindowsAndMessaging::{SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN};

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
    fn is_front_side(h: HWND) -> bool {
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

    /// Windows a crashed run of this Arkadia left: closed. Those of an
    /// instance still running (`tauri dev` beside the daily) are left alone.
    pub(super) fn close_orphans() {
        unveil_leftovers();
        for (raw, _, _) in browser_windows() {
            // SAFETY: plain read of a window property.
            let mark = unsafe { GetPropW(hwnd(raw), mark_name()) };
            let pid = mark.0 as usize as u32;
            if pid != 0 && pid != std::process::id() && !running(pid) {
                close(raw);
            }
        }
    }

    pub(super) fn window_title(raw: isize) -> String {
        title(hwnd(raw))
    }

    /// Closes the window's active tab: Chrome maps APPCOMMAND_CLOSE to
    /// "close tab", with no foreground nor keyboard needed (verified
    /// 05/11/2026 on Chrome 156).
    pub(super) fn close_active_tab(raw: isize) {
        const APPCOMMAND_CLOSE: isize = 31;
        // SAFETY: a posted message, never waited on.
        unsafe {
            let _ = PostMessageW(
                Some(hwnd(raw)),
                WM_APPCOMMAND,
                WPARAM(raw as usize),
                LPARAM(APPCOMMAND_CLOSE << 16),
            );
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

    /// A launch in progress. Chrome shows the new window at once, often
    /// maximized, before Arkadia finds and parks it: a full-screen flash,
    /// over whatever app is in front (Alexis, 05/11/2026). While a launch
    /// lives, every new Chrome frame is made fully transparent as soon as
    /// it is created (`veil`); the panel's window is unveiled once parked
    /// off-screen, any other (Alexis opening one meanwhile) when it ends.
    pub(super) struct Launching;
    impl Launching {
        pub(super) fn start() -> Self {
            LAUNCHES.fetch_add(1, Ordering::SeqCst);
            post_watch(1);
            Launching
        }
    }
    impl Drop for Launching {
        fn drop(&mut self) {
            if LAUNCHES.fetch_sub(1, Ordering::SeqCst) == 1 {
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

    /// After a launch: the new window took the foreground, which goes back
    /// to the window Alexis used last (the launch can take seconds: the one
    /// in front before it may be stale), else to the one before the launch.
    pub(super) fn hand_back(raw: isize, before: Option<isize>) {
        if foreground() != Some(raw) {
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
                    if !(chrome && (LAUNCHES.load(Ordering::SeqCst) > 0 || is_panel_window(h))) {
                        LAST_OTHER.store(raw, Ordering::SeqCst);
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
    pub(super) fn close_active_tab(_: isize) {}
    pub(super) fn hand_back(_: isize, _: Option<isize>) {}
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
    fn closes_the_launch_tab_only_when_claude_s_tab_is_there() {
        let page = "Arkadia-1-2";
        assert!(may_close_launch_tab(
            true,
            "Arkadia-1-2 - Google Chrome",
            page
        ));
        // Claude's group went elsewhere: the launch tab is the only one.
        assert!(!may_close_launch_tab(
            false,
            "Arkadia-1-2 - Google Chrome",
            page
        ));
        // Another tab is in front: closing would close that one.
        assert!(!may_close_launch_tab(true, "Stripe - Google Chrome", page));
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
