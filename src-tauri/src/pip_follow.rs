//! Twitch picture-in-picture window that follows Arkadia: while an Arkadia
//! window (daily or Lab) is the foreground window, Chrome's Twitch PiP window
//! (TRINITX extension) moves to the place Alexis saved in the settings; when
//! another app takes the foreground, it goes back where it was just before
//! (Alexis, 31/10/2026). Nothing moves until a place is saved.
//!
//! - A click in the PiP window itself keeps the placement: the extension hands
//!   the keyboard back to the window below right after. While Arkadia stays in
//!   front (`away`), the PiP never moves again: Alexis can drag it to a new
//!   place and save it.
//! - The place to go back to (`origin`) belongs to no window handle: Chrome
//!   reopens a closed PiP at its last place (the target), and the new window
//!   must still go back. It is never the target itself, and it survives a
//!   restart or crash in a file; a normal exit puts the PiP back.
//! - Going back waits `RESTORE_DELAY_MS`: the taskbar and the Alt+Tab
//!   switcher take the foreground for an instant between two Arkadia windows.
//! - The hook never pumps messages (async SetWindowPos, InternalGetWindowText):
//!   an out-of-context WinEvent hook is re-entered during any SendMessage, and
//!   an inner event would finish before the outer move and lose to it.
//!
//! Only the daily release build runs it (`ENABLED`), never Arkadia Lab nor
//! `tauri dev`: two instances would each save the rect the other already
//! moved, both being `arkadia.exe` to each other.

use serde::Serialize;

/// Whether this instance moves the PiP: see the module's last paragraph.
pub const ENABLED: bool = cfg!(windows) && !crate::lab::LAB && !cfg!(debug_assertions);

const RESTORE_DELAY_MS: u32 = 250;

/// Two rects closer than this (each side, px) are the same place: the
/// extension's 16/9 snap may nudge the PiP a few pixels after a move.
const SAME_PLACE_PX: i32 = 6;

/// A window rect in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Rect {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

impl Rect {
    fn near(self, other: Rect) -> bool {
        (self.left - other.left).abs() <= SAME_PLACE_PX
            && (self.top - other.top).abs() <= SAME_PLACE_PX
            && (self.width - other.width).abs() <= SAME_PLACE_PX
            && (self.height - other.height).abs() <= SAME_PLACE_PX
    }

    fn to_line(self) -> String {
        format!("{} {} {} {}", self.left, self.top, self.width, self.height)
    }

    fn from_line(line: &str) -> Option<Rect> {
        let mut n = line.split_whitespace().map(|v| v.parse::<i32>().ok());
        let r = Rect {
            left: n.next()??,
            top: n.next()??,
            width: n.next()??,
            height: n.next()??,
        };
        (n.next().is_none() && r.width > 0 && r.height > 0).then_some(r)
    }
}

/// Who owns the new foreground window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Foreground {
    Arkadia,
    Pip,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    /// Remember where the PiP is, then move it to the target.
    Move,
    /// Put the PiP back at its origin (after `RESTORE_DELAY_MS`).
    Restore,
    Nothing,
}

/// `away`: Arkadia came in front and the PiP was sent to the target.
fn next_action(away: bool, fg: Foreground) -> Action {
    match (fg, away) {
        (Foreground::Arkadia, false) => Action::Move,
        (Foreground::Other, true) => Action::Restore,
        _ => Action::Nothing,
    }
}

/// Arkadia comes in front from another app (not back from a click in the
/// PiP): the place the PiP has now is where it goes back to.
fn came_back(last_side: Option<Foreground>, fg: Foreground) -> bool {
    fg == Foreground::Arkadia && last_side != Some(Foreground::Arkadia)
}

fn is_arkadia_exe(exe: &str) -> bool {
    let exe = exe.to_ascii_lowercase();
    exe == "arkadia.exe" || exe == "arkadia-lab.exe"
}

/// The extension's PiP window is a topmost Chrome window titled after the
/// Twitch tab ("Kamet0 - Twitch", "(3) Ibai - Twitch").
fn is_twitch_pip(exe: &str, topmost: bool, title: &str) -> bool {
    topmost && exe.eq_ignore_ascii_case("chrome.exe") && title.trim_end().ends_with("Twitch")
}

/// For the settings: whether this instance moves the PiP, and to where.
#[derive(Serialize)]
pub struct PipFollowStatus {
    enabled: bool,
    target: Option<Rect>,
}

#[tauri::command]
pub async fn pip_follow_status() -> PipFollowStatus {
    PipFollowStatus {
        enabled: ENABLED,
        target: imp::target(),
    }
}

/// Saves the PiP's current place as the place to go while Arkadia is in
/// front. `None`: no Twitch PiP window open.
#[tauri::command]
pub async fn pip_follow_save_target() -> Option<Rect> {
    imp::save_target()
}

/// Forgets the saved place: the PiP no longer moves.
#[tauri::command]
pub async fn pip_follow_clear_target() {
    imp::clear_target();
}

#[cfg(windows)]
pub fn spawn() {
    std::thread::spawn(imp::run);
}

/// Normal exit: the PiP goes back where it was before Arkadia came in front.
#[cfg(windows)]
pub fn restore_on_exit() {
    imp::close();
}

#[cfg(not(windows))]
pub fn spawn() {}

#[cfg(not(windows))]
pub fn restore_on_exit() {}

#[cfg(not(windows))]
mod imp {
    use super::Rect;
    pub fn target() -> Option<Rect> {
        None
    }
    pub fn save_target() -> Option<Rect> {
        None
    }
    pub fn clear_target() {}
}

#[cfg(windows)]
mod imp {
    use super::{
        came_back, is_arkadia_exe, is_twitch_pip, next_action, Action, Foreground, Rect,
        RESTORE_DELAY_MS,
    };
    use crate::popup::log_line;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EnumWindows, GetForegroundWindow, GetMessageW, GetWindowLongW,
        GetWindowRect, GetWindowThreadProcessId, InternalGetWindowText, IsWindowVisible, KillTimer,
        SetTimer, SetWindowPos, EVENT_SYSTEM_FOREGROUND, GWL_EXSTYLE, MSG, SWP_ASYNCWINDOWPOS,
        SWP_NOACTIVATE, SWP_NOZORDER, WINEVENT_OUTOFCONTEXT, WS_EX_TOPMOST,
    };

    struct State {
        /// Arkadia is in front and the PiP was sent to the target.
        away: bool,
        /// Where the PiP goes back to. Kept after a restore: Chrome moves the
        /// window later (async), and a Move read before that would still see
        /// the target and must not lose it.
        origin: Option<Rect>,
        /// Where it goes while Arkadia is in front (saved in the settings).
        target: Option<Rect>,
        /// Where the PiP was when Arkadia last came in front from another
        /// app, even without a target: the first "save" goes back there.
        entry: Option<Rect>,
        /// Last foreground side, Arkadia or Other (a click in the PiP is neither).
        last_side: Option<Foreground>,
        /// Pending restore timer of the hook thread (0: none).
        restore_timer: usize,
        /// Arkadia is exiting: the PiP went back, nothing moves it again.
        closing: bool,
    }

    static STATE: Mutex<State> = Mutex::new(State {
        away: false,
        origin: None,
        target: None,
        entry: None,
        last_side: None,
        restore_timer: 0,
        closing: false,
    });

    fn state<T>(f: impl FnOnce(&mut State) -> T) -> Option<T> {
        STATE.lock().ok().map(|mut s| f(&mut s))
    }

    fn file(name: &str) -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Arkadia")
            .join(name)
    }
    const ORIGIN_FILE: &str = "pip-follow-origin.txt";
    const TARGET_FILE: &str = "pip-follow-target.txt";

    fn read_rect(name: &str) -> Option<Rect> {
        std::fs::read_to_string(file(name))
            .ok()
            .and_then(|s| Rect::from_line(&s))
    }

    fn write_rect(name: &str, rect: Option<Rect>) {
        let path = file(name);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = match rect {
            Some(r) => std::fs::write(&path, r.to_line()),
            None => std::fs::remove_file(&path),
        };
    }

    pub fn target() -> Option<Rect> {
        state(|s| s.target)
            .flatten()
            .or_else(|| read_rect(TARGET_FILE))
    }

    pub fn save_target() -> Option<Rect> {
        let rect = rect_of(find_pip()?)?;
        // Saved with Arkadia in front: from now on the PiP is "away", and it
        // goes back to where it was when Arkadia came in front.
        let origin = state(|s| {
            s.target = Some(rect);
            if s.away {
                return None;
            }
            let entry = s.entry.filter(|e| !e.near(rect))?;
            s.origin = Some(entry);
            s.away = true;
            Some(entry)
        })
        .flatten();
        if origin.is_some() {
            write_rect(ORIGIN_FILE, origin);
        }
        write_rect(TARGET_FILE, Some(rect));
        log_line(&format!("[pip] target saved: {}", rect.to_line()));
        Some(rect)
    }

    pub fn clear_target() {
        state(|s| s.target = None);
        write_rect(TARGET_FILE, None);
    }

    pub fn run() {
        // An Arkadia killed while in front left the PiP at the target.
        let origin = read_rect(ORIGIN_FILE);
        let target = read_rect(TARGET_FILE);
        state(|s| {
            s.target = target;
            s.origin = origin;
            s.away = origin.is_some();
        });
        // SAFETY: the hook and the timers call back on this thread, from the
        // message loop below; the callbacks only make plain Win32 calls.
        unsafe {
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.is_invalid() {
                log_line("[pip] foreground hook refused");
                return;
            }
            // Arkadia may already be in front when it starts.
            handle(GetForegroundWindow());
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                DispatchMessageW(&msg);
            }
        }
    }

    unsafe extern "system" fn on_foreground(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        handle(hwnd);
    }

    unsafe extern "system" fn on_restore_timer(_hwnd: HWND, _msg: u32, id: usize, _time: u32) {
        kill_timer(id);
        state(|s| {
            if s.restore_timer == id {
                s.restore_timer = 0;
            }
        });
        // Still not Arkadia (nor the PiP) once the taskbar or Alt+Tab is gone.
        // SAFETY: plain read of the foreground window.
        let fg = unsafe { GetForegroundWindow() };
        if classify(fg) == Foreground::Other {
            restore_now();
        }
    }

    fn handle(fg: HWND) {
        let kind = classify(fg);
        let Some((away, closing, back, pending)) = state(|s| {
            let back = came_back(s.last_side, kind);
            if kind != Foreground::Pip {
                s.last_side = Some(kind);
            }
            // Arkadia (or a click in the PiP) is back: a pending restore no
            // longer applies.
            let pending = if kind == Foreground::Other {
                0
            } else {
                std::mem::take(&mut s.restore_timer)
            };
            (s.away, s.closing, back, pending)
        }) else {
            return;
        };
        kill_timer(pending);
        if closing {
            return;
        }
        if back && !away {
            if let Some(rect) = find_pip().and_then(rect_of) {
                state(|s| s.entry = Some(rect));
            }
        }
        match next_action(away, kind) {
            Action::Move => {
                let Some(target) = target() else { return };
                let Some(pip) = find_pip() else { return };
                let Some(rect) = rect_of(pip) else { return };
                // Already at the target (reopened there, or a restore Chrome
                // has not applied yet): keep the origin known so far.
                let origin = if rect.near(target) {
                    state(|s| s.origin).flatten()
                } else {
                    Some(rect)
                };
                state(|s| {
                    s.origin = origin;
                    s.away = true;
                });
                write_rect(ORIGIN_FILE, origin);
                place(pip, target);
            }
            Action::Restore => schedule_restore(),
            Action::Nothing => {}
        }
    }

    /// Restores `RESTORE_DELAY_MS` after the LAST switch to another app: a
    /// pending timer is reset, not kept.
    fn schedule_restore() {
        state(|s| {
            // SAFETY: a thread timer, dispatched by this thread's message
            // loop; the same id resets its countdown.
            s.restore_timer = unsafe {
                SetTimer(
                    None,
                    s.restore_timer,
                    RESTORE_DELAY_MS,
                    Some(on_restore_timer),
                )
            };
        });
    }

    /// Kills timer `id` (0: none) of this thread.
    fn kill_timer(id: usize) {
        if id != 0 {
            // SAFETY: kills this thread's own timer.
            let _ = unsafe { KillTimer(None, id) };
        }
    }

    /// Puts the PiP back at its origin. The origin stays in memory (see
    /// `State::origin`); only the crash file goes. Without a PiP (closed for
    /// now), the file stays too: Chrome reopens the next one at the target.
    pub fn restore_now() {
        let Some(origin) = state(|s| {
            s.away = false;
            s.origin
        })
        .flatten() else {
            return;
        };
        let Some(pip) = find_pip() else { return };
        place(pip, origin);
        write_rect(ORIGIN_FILE, None);
    }

    /// Arkadia exits: the PiP goes back, and the hook (still running until
    /// the process ends) moves nothing anymore.
    pub fn close() {
        let away = state(|s| {
            s.closing = true;
            s.away
        });
        if away == Some(true) {
            restore_now();
        }
    }

    fn classify(hwnd: HWND) -> Foreground {
        if is_pip(hwnd) {
            return Foreground::Pip;
        }
        let mut pid = 0u32;
        // SAFETY: reads the owner of a window handle.
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let ours = pid == std::process::id();
        if ours || exe_name(pid).is_some_and(|exe| is_arkadia_exe(&exe)) {
            Foreground::Arkadia
        } else {
            Foreground::Other
        }
    }

    fn is_pip(hwnd: HWND) -> bool {
        // SAFETY: read-only queries on a window handle; InternalGetWindowText
        // reads the title without sending WM_GETTEXT (no message pumping).
        unsafe {
            if hwnd.0.is_null() || !IsWindowVisible(hwnd).as_bool() {
                return false;
            }
            let topmost = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0;
            if !topmost {
                return false;
            }
            let mut title = [0u16; 256];
            let n = InternalGetWindowText(hwnd, &mut title).max(0) as usize;
            let title = String::from_utf16_lossy(&title[..n]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            exe_name(pid).is_some_and(|exe| is_twitch_pip(&exe, topmost, &title))
        }
    }

    fn find_pip() -> Option<HWND> {
        unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> windows::core::BOOL {
            // SAFETY: lp points at the Option below, alive during EnumWindows.
            let found = unsafe { &mut *(lp.0 as *mut Option<isize>) };
            if is_pip(hwnd) {
                *found = Some(hwnd.0 as isize);
                return false.into();
            }
            true.into()
        }
        let mut found: Option<isize> = None;
        // SAFETY: the callback only writes into `found`, which outlives the call.
        unsafe {
            let _ = EnumWindows(Some(cb), LPARAM(&mut found as *mut _ as isize));
        }
        found.map(|h| HWND(h as *mut _))
    }

    fn rect_of(hwnd: HWND) -> Option<Rect> {
        let mut r = RECT::default();
        // SAFETY: fills a local RECT.
        unsafe { GetWindowRect(hwnd, &mut r) }.ok()?;
        Some(Rect {
            left: r.left,
            top: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
        })
    }

    fn place(hwnd: HWND, r: Rect) {
        // SAFETY: asks Chrome's thread to move its window, without waiting for
        // it (no re-entry of the hook), activating it or changing its z-order.
        let res = unsafe {
            SetWindowPos(
                hwnd,
                None,
                r.left,
                r.top,
                r.width,
                r.height,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
            )
        };
        if let Err(e) = res {
            log_line(&format!("[pip] move refused: {e}"));
        }
    }

    fn exe_name(pid: u32) -> Option<String> {
        // SAFETY: the process handle is closed before returning.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(process);
            ok.ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            path.rsplit(['\\', '/']).next().map(str::to_owned)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arkadia_in_front_moves_once_and_leaving_restores() {
        assert_eq!(next_action(false, Foreground::Arkadia), Action::Move);
        assert_eq!(next_action(true, Foreground::Arkadia), Action::Nothing);
        assert_eq!(next_action(true, Foreground::Other), Action::Restore);
        assert_eq!(next_action(false, Foreground::Other), Action::Nothing);
    }

    #[test]
    fn a_click_in_the_pip_keeps_the_placement() {
        assert_eq!(next_action(true, Foreground::Pip), Action::Nothing);
        assert_eq!(next_action(false, Foreground::Pip), Action::Nothing);
    }

    #[test]
    fn only_coming_from_another_app_records_the_place_to_go_back_to() {
        assert!(came_back(None, Foreground::Arkadia));
        assert!(came_back(Some(Foreground::Other), Foreground::Arkadia));
        // Back from a click in the PiP: last_side stayed Arkadia.
        assert!(!came_back(Some(Foreground::Arkadia), Foreground::Arkadia));
        assert!(!came_back(Some(Foreground::Arkadia), Foreground::Other));
    }

    #[test]
    fn both_arkadia_builds_count() {
        assert!(is_arkadia_exe("arkadia.exe"));
        assert!(is_arkadia_exe("Arkadia-Lab.exe"));
        assert!(!is_arkadia_exe("arkadia-gate.exe"));
        assert!(!is_arkadia_exe("chrome.exe"));
    }

    #[test]
    fn only_the_topmost_twitch_chrome_window_is_the_pip() {
        assert!(is_twitch_pip("chrome.exe", true, "Kamet0 - Twitch"));
        assert!(is_twitch_pip("chrome.exe", true, "(3) Ibai - Twitch"));
        assert!(!is_twitch_pip("chrome.exe", false, "Kamet0 - Twitch"));
        assert!(!is_twitch_pip(
            "chrome.exe",
            true,
            "Kamet0 - Twitch - Google Chrome"
        ));
        assert!(!is_twitch_pip("msedge.exe", true, "Kamet0 - Twitch"));
    }

    #[test]
    fn a_pip_nudged_by_the_snap_is_still_at_its_place() {
        let target = Rect {
            left: 2397,
            top: 120,
            width: 1431,
            height: 1350,
        };
        let nudged = Rect {
            left: 2399,
            top: 120,
            width: 1426,
            height: 1353,
        };
        assert!(nudged.near(target));
        let elsewhere = Rect {
            left: 100,
            top: 100,
            width: 800,
            height: 600,
        };
        assert!(!elsewhere.near(target));
    }

    #[test]
    fn a_saved_place_reads_back_and_rejects_garbage() {
        let r = Rect {
            left: -7,
            top: 120,
            width: 1431,
            height: 1350,
        };
        assert_eq!(Rect::from_line(&r.to_line()), Some(r));
        assert_eq!(Rect::from_line("1 2 3"), None);
        assert_eq!(Rect::from_line("1 2 3 4 5"), None);
        assert_eq!(Rect::from_line("1 2 0 4"), None);
        assert_eq!(Rect::from_line("a b c d"), None);
    }
}
