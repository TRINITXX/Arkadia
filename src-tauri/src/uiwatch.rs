//! Watching the webview from outside, and repairing it when it wedges.
//!
//! The WebGPU renderer can deadlock the WebView2 GPU channel: the page main
//! thread stops executing entirely — measured at 0% CPU, never recovering —
//! while this process stays perfectly healthy. Nothing inside the page can heal
//! that: no timer fires, no `device.lost` handler runs, no event is drained. The
//! only place left to act from is here.
//!
//! Two things follow. The frontend beats once a second and a thread watches the
//! silence; and the frame emitters stop pushing while the page is deaf, since a
//! wedged webview never drains its event queue (measured: +7 MB/s in the
//! renderer and +4 MB/s in the browser process until the app is killed).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindowBuilder};

/// Silence after which the webview is declared wedged. Well above any legitimate
/// stall: a busy frame or a long GC pause costs tens of milliseconds, not seconds.
const WEDGE_AFTER: Duration = Duration::from_secs(5);

/// How long a repair is given to bring the heartbeat back before escalating.
const REPAIR_GRACE: Duration = Duration::from_secs(6);

/// Repairs attempted per wedge before giving up and leaving the window alone.
const MAX_ATTEMPTS: u32 = 2;

const POLL: Duration = Duration::from_millis(500);

/// Grace given to the frontend at startup, before the clock counts against it.
const BOOT_GRACE: Duration = Duration::from_secs(15);

/// How long to wait for a destroyed window to actually release its label.
const LABEL_RELEASE_TIMEOUT: Duration = Duration::from_secs(5);

/// Attempt count meaning "stopped trying until the page comes back on its own".
const GAVE_UP: u32 = u32::MAX;

/// What the watchdog should do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// The page is alive, or a repair still has time to land.
    Wait,
    /// Ask WebView2 to reload the page — cheapest repair, keeps the window.
    Reload,
    /// Reload did not bring the page back: tear the window down and rebuild it
    /// on a fresh renderer process.
    Rebuild,
    /// Nothing worked. Stop touching the window so we do not loop forever.
    GiveUp,
}

/// Pure decision, so the escalation can be tested without a webview.
///
/// `attempts` counts repairs already made for the CURRENT wedge, and
/// `since_attempt` is the time since the last one (meaningless when
/// `attempts` is 0).
pub fn decide(silence: Duration, attempts: u32, since_attempt: Duration) -> Action {
    if silence < WEDGE_AFTER {
        return Action::Wait;
    }
    if attempts == 0 {
        return Action::Reload;
    }
    if since_attempt < REPAIR_GRACE {
        return Action::Wait;
    }
    if attempts >= MAX_ATTEMPTS {
        return Action::GiveUp;
    }
    Action::Rebuild
}

/// Liveness of the main webview, shared between the heartbeat command, the
/// watchdog thread and the per-pane frame emitters.
pub struct UiHealth {
    /// Milliseconds since `started` at the last heartbeat.
    last_beat_ms: AtomicU64,
    started: Instant,
    /// True between "declared wedged" and the first heartbeat afterwards. Read
    /// by every flush thread, hence an `Arc` handed out at spawn time rather
    /// than a managed-state lookup on each 16 ms tick.
    wedged: Arc<AtomicBool>,
    /// Repairs attempted for the current wedge; reset when the page comes back.
    attempts: AtomicU32,
    /// True while `rebuild_main_window` has torn the old window down and not
    /// yet built the new one. The runtime asks the app to exit the moment its
    /// last window is gone, and that request must be refused for this window.
    rebuilding: AtomicBool,
}

impl Default for UiHealth {
    fn default() -> Self {
        Self {
            last_beat_ms: AtomicU64::new(0),
            started: Instant::now(),
            wedged: Arc::new(AtomicBool::new(false)),
            attempts: AtomicU32::new(0),
            rebuilding: AtomicBool::new(false),
        }
    }
}

impl UiHealth {
    pub fn beat(&self) {
        let ms = self.started.elapsed().as_millis() as u64;
        self.last_beat_ms.store(ms, Ordering::Release);
    }

    pub fn silence(&self) -> Duration {
        let now = self.started.elapsed().as_millis() as u64;
        Duration::from_millis(now.saturating_sub(self.last_beat_ms.load(Ordering::Acquire)))
    }

    /// Handed to the per-pane flush threads so they can skip emitting while the
    /// page is deaf, without paying a state lookup every frame.
    pub fn wedged_flag(&self) -> Arc<AtomicBool> {
        self.wedged.clone()
    }

    /// Whether the main window is between teardown and rebuild right now.
    /// Checked by the exit handler in `lib.rs` before letting the app quit.
    pub fn is_rebuilding(&self) -> bool {
        self.rebuilding.load(Ordering::Acquire)
    }

    fn set_rebuilding(&self, on: bool) {
        self.rebuilding.store(on, Ordering::Release);
    }
}

/// Beat from the frontend. Its only job is to prove the page main thread is
/// still running JavaScript.
#[tauri::command]
pub fn ui_heartbeat(state: tauri::State<'_, UiHealth>) {
    state.beat();
}

/// Starts the watchdog. Called from `setup`, alongside the other background
/// threads; never returns.
pub fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(BOOT_GRACE);
        app.state::<UiHealth>().beat();

        let mut last_attempt = Instant::now();
        loop {
            std::thread::sleep(POLL);

            let (silence, attempts, wedged) = {
                let health = app.state::<UiHealth>();
                (
                    health.silence(),
                    health.attempts.load(Ordering::Acquire),
                    health.wedged_flag(),
                )
            };

            if silence < WEDGE_AFTER {
                if wedged.swap(false, Ordering::AcqRel) {
                    app.state::<UiHealth>().attempts.store(0, Ordering::Release);
                    crate::popup::log_line("[uiwatch] webview back, frames resumed");
                }
                continue;
            }

            if !wedged.swap(true, Ordering::AcqRel) {
                crate::popup::log_line(&format!(
                    "[uiwatch] no heartbeat for {}ms - webview wedged, holding frames back",
                    silence.as_millis()
                ));
            }

            match decide(silence, attempts, last_attempt.elapsed()) {
                Action::Wait => {}
                Action::Reload => {
                    app.state::<UiHealth>().attempts.store(1, Ordering::Release);
                    last_attempt = Instant::now();
                    crate::popup::log_line("[uiwatch] repair 1/2: reloading the webview");
                    if let Some(win) = app.get_webview_window("main") {
                        if let Err(e) = win.reload() {
                            crate::popup::log_line(&format!("[uiwatch] reload failed: {e}"));
                        }
                    }
                }
                Action::Rebuild => {
                    app.state::<UiHealth>().attempts.store(2, Ordering::Release);
                    last_attempt = Instant::now();
                    crate::popup::log_line(
                        "[uiwatch] repair 2/2: rebuilding the window on a fresh renderer",
                    );
                    rebuild_main_window(&app);
                }
                Action::GiveUp => {
                    // Latch it: `decide` keeps answering GiveUp every tick, and
                    // the log would fill up twice a second.
                    if attempts != GAVE_UP {
                        app.state::<UiHealth>()
                            .attempts
                            .store(GAVE_UP, Ordering::Release);
                        crate::popup::log_line("[uiwatch] both repairs failed - leaving it alone");
                    }
                }
            }
        }
    });
}

/// Closes the main window and rebuilds it from its `tauri.conf.json` definition,
/// which gets a brand-new renderer process. The PTYs live in this process, so
/// the frontend re-attaches to them on boot (see `list_live_panes`).
fn rebuild_main_window(app: &AppHandle) {
    let Some(cfg) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        crate::popup::log_line("[uiwatch] no 'main' window in the config, cannot rebuild");
        return;
    };

    // Between `destroy` and `build` the app has no window at all, and the
    // runtime answers that with an exit request (tauri-runtime-wry: empty
    // window map => `ExitRequested { code: None }`). The handler in `lib.rs`
    // refuses it while this flag is up — without it the first real rebuild
    // logged "window rebuilt" and the process quit a moment later.
    let health = app.state::<UiHealth>();
    health.set_rebuilding(true);

    if let Some(old) = app.get_webview_window("main") {
        let _ = old.destroy();
    }

    // `destroy` only posts the teardown to the event loop; the label stays taken
    // until that runs. Building right away fails with "a webview with label
    // `main` already exists" — which is exactly what happened on the first real
    // wedge this watchdog caught.
    if !wait_for_label_release(app, "main", LABEL_RELEASE_TIMEOUT) {
        crate::popup::log_line("[uiwatch] 'main' still registered, rebuilding anyway");
    }

    // One retry: the label can free up a few milliseconds after the wait gave
    // up, and leaving the app with no window at all is worse than a frozen one.
    for attempt in 1..=2 {
        match WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
            Ok(win) => {
                health.set_rebuilding(false);
                crate::wire_main_window(app, &win);
                let _ = win.set_focus();
                crate::popup::log_line("[uiwatch] window rebuilt");
                return;
            }
            Err(e) => {
                crate::popup::log_line(&format!(
                    "[uiwatch] rebuild attempt {attempt}/2 failed: {e}"
                ));
                std::thread::sleep(Duration::from_millis(750));
            }
        }
    }
    health.set_rebuilding(false);
    crate::popup::log_line("[uiwatch] could not rebuild the window - app left without one");
}

/// Polls until `label` is free, or the timeout expires. Returns whether it was
/// actually released.
fn wait_for_label_release(app: &AppHandle, label: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if app.get_webview_window(label).is_none() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    app.get_webview_window(label).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_beating_page_is_left_alone() {
        assert_eq!(
            decide(Duration::from_secs(1), 0, Duration::ZERO),
            Action::Wait
        );
    }

    #[test]
    fn silence_past_the_threshold_reloads_first() {
        assert_eq!(
            decide(Duration::from_secs(6), 0, Duration::ZERO),
            Action::Reload
        );
    }

    #[test]
    fn a_repair_is_given_time_to_land_before_escalating() {
        assert_eq!(
            decide(Duration::from_secs(9), 1, Duration::from_secs(2)),
            Action::Wait
        );
    }

    #[test]
    fn a_reload_that_did_not_help_escalates_to_a_rebuild() {
        assert_eq!(
            decide(Duration::from_secs(20), 1, Duration::from_secs(7)),
            Action::Rebuild
        );
    }

    #[test]
    fn the_watchdog_stops_after_the_last_attempt_rather_than_looping() {
        assert_eq!(
            decide(
                Duration::from_secs(60),
                MAX_ATTEMPTS,
                Duration::from_secs(7)
            ),
            Action::GiveUp
        );
    }

    #[test]
    fn a_rebuild_in_progress_is_visible_to_the_exit_handler() {
        let health = UiHealth::default();
        assert!(!health.is_rebuilding());
        health.set_rebuilding(true);
        assert!(health.is_rebuilding());
        health.set_rebuilding(false);
        assert!(!health.is_rebuilding());
    }

    #[test]
    fn silence_is_measured_from_the_last_beat() {
        let health = UiHealth::default();
        health.beat();
        assert!(health.silence() < Duration::from_secs(1));
    }
}
