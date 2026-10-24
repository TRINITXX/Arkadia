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
//!
//! The heartbeat is a sync command, answered on the main thread. A main thread
//! busy for seconds therefore silences a healthy page, and a reload posted then
//! only runs once it is free again — on a page that was fine. So the watchdog
//! also times the main thread, and never judges the page while it lags.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Silence after which the webview is declared wedged. Well above any legitimate
/// stall: a busy frame or a long GC pause costs tens of milliseconds, not seconds.
const WEDGE_AFTER: Duration = Duration::from_secs(5);

/// How long a repair is given to bring the heartbeat back before escalating.
const REPAIR_GRACE: Duration = Duration::from_secs(6);

/// Repairs attempted per wedge before giving up and leaving the window alone.
const MAX_ATTEMPTS: u32 = 2;

const POLL: Duration = Duration::from_millis(500);

/// Grace given to a fresh page (app start, rebuilt window) before its silence
/// counts against it.
const BOOT_GRACE: Duration = Duration::from_secs(15);

/// Main-thread lag past which the page's silence says nothing about the page.
const HOST_STALL: Duration = Duration::from_secs(2);

/// Span the load line in the log averages over.
const LOAD_WINDOW: Duration = Duration::from_secs(10);

/// How often a rebuild still waiting on the old window says so in the log.
const WAIT_LOG_EVERY: Duration = Duration::from_secs(10);

/// Attempt count meaning "stopped trying until the page comes back on its own".
const GAVE_UP: u32 = u32::MAX;

/// Hidden placeholder window kept alive across the rebuild so the runtime
/// never sees an empty window map (which it answers with an exit request).
const KEEPALIVE_LABEL: &str = "uiwatch-keepalive";

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
/// `attempts` is 0). `host_stalled` says the main thread itself lags, which
/// alone explains a silent page.
pub fn decide(
    silence: Duration,
    attempts: u32,
    since_attempt: Duration,
    host_stalled: bool,
) -> Action {
    if silence < WEDGE_AFTER || host_stalled {
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

/// What a tick does when the page is not to blame: its silence, net of the
/// main thread's stalls, is short, or a rebuilt page is still booting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Calm {
    /// The page really beat: the episode is over, frames flow, repairs reset.
    Back,
    /// A rebuilt page has not beaten yet but is within its grace: it gets
    /// frames, nothing is judged.
    Booting,
    /// The main thread just came back and the page has not beaten since:
    /// frames stay held and the repair count stands until it does.
    Waiting,
}

/// `beat_silence` is the raw time since the page's last beat — never the
/// stall-adjusted silence, which drops to zero when the main thread comes back
/// whether or not the page is alive (that mix-up reset the repair count on a
/// dead page, review of 24/10/2026).
pub fn calm(beat_silence: Duration, in_grace: bool) -> Calm {
    if beat_silence < WEDGE_AFTER {
        Calm::Back
    } else if in_grace {
        Calm::Booting
    } else {
        Calm::Waiting
    }
}

/// Liveness of the main webview, shared between the heartbeat command, the
/// watchdog thread and the per-pane frame emitters.
pub struct UiHealth {
    /// Milliseconds since `started` at the last heartbeat.
    last_beat_ms: AtomicU64,
    started: Instant,
    /// True while frames must not be sent: the page is deaf, or the main thread
    /// that relays them lags. Read by every flush thread, hence an `Arc` handed
    /// out at spawn time rather than a managed-state lookup on each 16 ms tick.
    frames_held: Arc<AtomicBool>,
    /// Repairs attempted for the current wedge; reset when the page comes back.
    attempts: AtomicU32,
    /// True from the moment a rebuild destroys the old main window until the
    /// new one exists. The runtime asks the app to exit the moment its last
    /// window is gone, and that request must be refused meanwhile.
    rebuilding: AtomicBool,
}

impl Default for UiHealth {
    fn default() -> Self {
        Self {
            last_beat_ms: AtomicU64::new(0),
            started: Instant::now(),
            frames_held: Arc::new(AtomicBool::new(false)),
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

    /// Handed to the per-pane flush threads so they can skip emitting while
    /// frames are held, without paying a state lookup every frame.
    pub fn frames_held_flag(&self) -> Arc<AtomicBool> {
        self.frames_held.clone()
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

/// Times the main thread: a no-op posted to it, and how long it waits to run.
#[derive(Default)]
struct HostProbe {
    posted: Option<Instant>,
    ran: Arc<Mutex<Option<Instant>>>,
    stalled: bool,
    /// When the last stall ended. The page's queued beats only get answered
    /// after it, so its silence cannot count from before.
    stall_ended: Option<Instant>,
}

impl HostProbe {
    /// The part of the page's silence the main thread cannot explain.
    fn page_silence(&self, silence: Duration) -> Duration {
        match self.stall_ended {
            Some(t) => silence.min(t.elapsed()),
            None => silence,
        }
    }

    /// How long the pending probe has waited (zero once it ran). Posts a fresh
    /// probe whenever the last one has run.
    fn lag(&mut self, app: &AppHandle, load: &str) -> Duration {
        if let Some(posted) = self.posted {
            let Some(ran) = *self.ran.lock() else {
                let lag = posted.elapsed();
                if lag >= HOST_STALL && !self.stalled {
                    self.stalled = true;
                    crate::popup::log_line(&format!(
                        "[uiwatch] main thread busy for {}ms - holding frames, page not judged ({load})",
                        lag.as_millis()
                    ));
                }
                return lag;
            };
            if self.stalled {
                self.stalled = false;
                self.stall_ended = Some(ran);
                crate::popup::log_line(&format!(
                    "[uiwatch] main thread free again after {}ms",
                    ran.duration_since(posted).as_millis()
                ));
            }
        }
        *self.ran.lock() = None;
        let ran = self.ran.clone();
        self.posted = Some(Instant::now());
        if app
            .run_on_main_thread(move || *ran.lock() = Some(Instant::now()))
            .is_err()
        {
            self.posted = None;
        }
        Duration::ZERO
    }
}

/// Frames sent per second over the last `LOAD_WINDOW`, for the log.
#[derive(Default)]
struct LoadMeter {
    samples: VecDeque<(Instant, u64)>,
}

impl LoadMeter {
    fn sample(&mut self, frames: u64) {
        let now = Instant::now();
        self.samples.push_back((now, frames));
        while self
            .samples
            .front()
            .is_some_and(|(t, _)| now.duration_since(*t) > LOAD_WINDOW)
        {
            self.samples.pop_front();
        }
    }

    fn per_sec(&self) -> u64 {
        match (self.samples.front(), self.samples.back()) {
            (Some((t0, n0)), Some((t1, n1))) if t1 > t0 => {
                (n1 - n0) * 1000 / t1.duration_since(*t0).as_millis().max(1) as u64
            }
            _ => 0,
        }
    }
}

fn load_line(app: &AppHandle, meter: &LoadMeter) -> String {
    let panes = match app.state::<crate::terminal::SessionMap>().try_counts() {
        Some((panes, shown)) => format!("{panes} panes, {shown} on screen"),
        None => "pane list busy".to_string(),
    };
    format!("load: {} frames/s, {panes}", meter.per_sec())
}

/// Starts the watchdog. Called from `setup`, alongside the other background
/// threads; never returns.
pub fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(BOOT_GRACE);
        app.state::<UiHealth>().beat();

        let mut host = HostProbe::default();
        let mut meter = LoadMeter::default();
        // Set while a rebuild waits for the old window to go: (destroy posted
        // at, last "still waiting" line).
        let mut rebuild: Option<(Instant, Instant)> = None;
        // A rebuilt window's page gets the same grace as at app start.
        let mut grace_until: Option<Instant> = None;
        // The current silence already has its "no heartbeat" line.
        let mut wedge_logged = false;
        let mut last_attempt = Instant::now();
        loop {
            std::thread::sleep(POLL);
            meter.sample(crate::terminal::frames_emitted());
            let load = load_line(&app, &meter);
            let host_stalled = host.lag(&app, &load) >= HOST_STALL;

            let health = app.state::<UiHealth>();
            let held = health.frames_held_flag();

            if let Some((since, last_log)) = rebuild {
                if finish_rebuild(&app) {
                    crate::popup::log_line(&format!(
                        "[uiwatch] window rebuilt ({}ms since destroy)",
                        since.elapsed().as_millis()
                    ));
                    rebuild = None;
                    grace_until = Some(Instant::now() + BOOT_GRACE);
                    wedge_logged = false;
                    last_attempt = Instant::now();
                    // The new page asks for whatever it missed on mount.
                    held.store(false, Ordering::Release);
                } else if last_log.elapsed() >= WAIT_LOG_EVERY {
                    crate::popup::log_line(&format!(
                        "[uiwatch] still waiting for the old window to close ({}s)",
                        since.elapsed().as_secs()
                    ));
                    rebuild = Some((since, Instant::now()));
                }
                continue;
            }

            // `beat_silence` says whether the page really beat; `silence` only
            // stops a main-thread stall from counting against it.
            let beat_silence = health.silence();
            let silence = host.page_silence(beat_silence);
            let attempts = health.attempts.load(Ordering::Acquire);
            let in_grace = grace_until.is_some_and(|t| Instant::now() < t);

            if !host_stalled && (silence < WEDGE_AFTER || in_grace) {
                match calm(beat_silence, in_grace) {
                    Calm::Back => {
                        grace_until = None;
                        wedge_logged = false;
                        let was_held = held.swap(false, Ordering::AcqRel);
                        if was_held || attempts != 0 {
                            health.attempts.store(0, Ordering::Release);
                            crate::popup::log_line("[uiwatch] webview back, frames resumed");
                        }
                    }
                    Calm::Booting => held.store(false, Ordering::Release),
                    Calm::Waiting => {}
                }
                continue;
            }

            // Past here: the page is silent, or the main thread lags.
            held.store(true, Ordering::Release);
            if !host_stalled && !wedge_logged {
                wedge_logged = true;
                crate::popup::log_line(&format!(
                    "[uiwatch] no heartbeat for {}ms - webview wedged, holding frames back ({load})",
                    beat_silence.as_millis()
                ));
            }

            match decide(silence, attempts, last_attempt.elapsed(), host_stalled) {
                Action::Wait => {}
                Action::Reload => {
                    health.attempts.store(1, Ordering::Release);
                    last_attempt = Instant::now();
                    crate::popup::log_line("[uiwatch] repair 1/2: reloading the webview");
                    if let Some(win) = app.get_webview_window("main") {
                        if let Err(e) = win.reload() {
                            crate::popup::log_line(&format!("[uiwatch] reload failed: {e}"));
                        }
                    }
                }
                Action::Rebuild => {
                    health.attempts.store(2, Ordering::Release);
                    last_attempt = Instant::now();
                    crate::popup::log_line(
                        "[uiwatch] repair 2/2: rebuilding the window on a fresh renderer",
                    );
                    if start_rebuild(&app) {
                        rebuild = Some((Instant::now(), Instant::now()));
                    }
                }
                Action::GiveUp => {
                    // Latch it: `decide` keeps answering GiveUp every tick, and
                    // the log would fill up twice a second.
                    if attempts != GAVE_UP {
                        health.attempts.store(GAVE_UP, Ordering::Release);
                        crate::popup::log_line("[uiwatch] both repairs failed - leaving it alone");
                    }
                }
            }
        }
    });
}

/// Puts up the keepalive window and posts the destruction of `main`. Returns
/// whether a rebuild is now under way; `finish_rebuild` completes it.
///
/// The PTYs live in this process, so the new page re-attaches to them on boot
/// (see `list_live_panes`).
fn start_rebuild(app: &AppHandle) -> bool {
    // Between `destroy` and `build` the app has no window at all, and the
    // runtime answers that with an exit request (tauri-runtime-wry: empty
    // window map => `ExitRequested { code: None }`). The handler in `lib.rs`
    // refuses it while this flag is up — without it the first real rebuild
    // logged "window rebuilt" and the process quit a moment later.
    let health = app.state::<UiHealth>();
    health.set_rebuilding(true);

    // Belt and braces with the flag above: a hidden window that exists for the
    // whole rebuild, so there is never a moment with zero windows at all.
    match WebviewWindowBuilder::new(
        app,
        KEEPALIVE_LABEL,
        WebviewUrl::External("about:blank".parse().expect("static url")),
    )
    .visible(false)
    .skip_taskbar(true)
    .inner_size(1.0, 1.0)
    .build()
    {
        Ok(_) => crate::popup::log_line("[uiwatch] keepalive window up"),
        Err(e) => crate::popup::log_line(&format!(
            "[uiwatch] keepalive window failed: {e} - continuing without it"
        )),
    }

    match app.get_webview_window("main").map(|old| old.destroy()) {
        Some(Ok(())) => crate::popup::log_line("[uiwatch] destroy posted for 'main'"),
        None => crate::popup::log_line("[uiwatch] 'main' already gone before destroy"),
        Some(Err(e)) => {
            // Nothing was posted: the old window stays, and stays the app's.
            crate::popup::log_line(&format!("[uiwatch] destroy failed: {e} - rebuild dropped"));
            end_rebuild(app);
            return false;
        }
    }
    true
}

/// Builds the new main window once the old one is gone. Returns whether the
/// rebuild is over.
///
/// `destroy` only posts the teardown to the main thread, and the label stays
/// taken until it runs — 4.2 s, 5.8 s and several times over 6.5 s on the
/// wedges of 22-23/10/2026. The old code gave up after 6.5 s, closed the
/// keepalive, and the late teardown then left the app without any window: it
/// quit, terminals and all, four times in two days. So this waits as long as it
/// takes, the keepalive up throughout.
fn finish_rebuild(app: &AppHandle) -> bool {
    if app.get_webview_window("main").is_some() {
        return false;
    }
    let Some(cfg) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        crate::popup::log_line("[uiwatch] no 'main' window in the config, cannot rebuild");
        end_rebuild(app);
        return true;
    };
    match WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
        Ok(win) => {
            crate::wire_main_window(app, &win);
            let _ = win.set_focus();
            end_rebuild(app);
            true
        }
        Err(e) => {
            // Retried on the next poll, keepalive still up.
            crate::popup::log_line(&format!("[uiwatch] rebuild attempt failed: {e}"));
            false
        }
    }
}

fn end_rebuild(app: &AppHandle) {
    app.state::<UiHealth>().set_rebuilding(false);
    if let Some(k) = app.get_webview_window(KEEPALIVE_LABEL) {
        let _ = k.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_beating_page_is_left_alone() {
        assert_eq!(
            decide(Duration::from_secs(1), 0, Duration::ZERO, false),
            Action::Wait
        );
    }

    #[test]
    fn silence_past_the_threshold_reloads_first() {
        assert_eq!(
            decide(Duration::from_secs(6), 0, Duration::ZERO, false),
            Action::Reload
        );
    }

    #[test]
    fn a_silent_page_is_not_judged_while_the_main_thread_lags() {
        assert_eq!(
            decide(Duration::from_secs(20), 0, Duration::ZERO, true),
            Action::Wait
        );
        assert_eq!(
            decide(Duration::from_secs(20), 1, Duration::from_secs(7), true),
            Action::Wait
        );
    }

    #[test]
    fn a_repair_is_given_time_to_land_before_escalating() {
        assert_eq!(
            decide(Duration::from_secs(9), 1, Duration::from_secs(2), false),
            Action::Wait
        );
    }

    #[test]
    fn a_reload_that_did_not_help_escalates_to_a_rebuild() {
        assert_eq!(
            decide(Duration::from_secs(20), 1, Duration::from_secs(7), false),
            Action::Rebuild
        );
    }

    #[test]
    fn the_watchdog_stops_after_the_last_attempt_rather_than_looping() {
        assert_eq!(
            decide(
                Duration::from_secs(60),
                MAX_ATTEMPTS,
                Duration::from_secs(7),
                false
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

    #[test]
    fn a_page_is_not_blamed_for_silence_while_the_main_thread_was_stuck() {
        let mut probe = HostProbe::default();
        assert_eq!(
            probe.page_silence(Duration::from_secs(9)),
            Duration::from_secs(9)
        );
        probe.stall_ended = Some(Instant::now());
        assert!(probe.page_silence(Duration::from_secs(9)) < Duration::from_secs(1));
    }

    #[test]
    fn a_main_thread_coming_back_is_not_a_beat() {
        let mut probe = HostProbe::default();
        probe.stall_ended = Some(Instant::now());
        let beat_silence = Duration::from_secs(9);
        // The stall-adjusted silence looks fine...
        assert!(probe.page_silence(beat_silence) < WEDGE_AFTER);
        // ...but without a real beat the episode stays open.
        assert_eq!(calm(beat_silence, false), Calm::Waiting);
    }

    #[test]
    fn a_real_beat_closes_the_episode() {
        assert_eq!(calm(Duration::from_secs(1), false), Calm::Back);
        assert_eq!(calm(Duration::from_secs(1), true), Calm::Back);
    }

    #[test]
    fn a_rebuilt_page_gets_frames_while_it_boots() {
        assert_eq!(calm(Duration::from_secs(9), true), Calm::Booting);
    }

    #[test]
    fn the_load_meter_reports_frames_per_second() {
        let mut meter = LoadMeter::default();
        let t0 = Instant::now();
        meter.samples.push_back((t0, 100));
        meter.samples.push_back((t0 + Duration::from_secs(2), 300));
        assert_eq!(meter.per_sec(), 100);
    }
}
