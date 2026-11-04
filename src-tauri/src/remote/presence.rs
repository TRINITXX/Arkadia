//! Whether Alexis is home, read from the Livebox (choices of 28/10 and
//! 02/11/2026): every 30 s the PC asks the box whether the iPhone is on the
//! home Wi-Fi. Off it for two minutes (an iPhone asleep drops the Wi-Fi for
//! a few seconds), he is away: every tab rings the iPhone. Back on it, he is
//! home at once: the iPhone rings for nothing, the PC takes it all. When the
//! box can't tell for two minutes (no password, unreachable, refused, the
//! iPhone's address missing from its list), the older rule holds: the tabs
//! he drives from the iPhone ring it (`phone`). A change of mode rings
//! nothing by itself.
//!
//! Outside the repository, in `%LOCALAPPDATA%\Arkadia\livebox\`:
//! `password.txt` (the box's admin password) and `phone.txt` (the iPhone's
//! Wi-Fi address, with its private address set to « Fixe » on the iPhone).
//! Both are read again at each poll: a fix needs no restart.

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, SET_COOKIE};
use serde_json::Value;
use tokio::sync::watch;

use crate::popup::log_line;

const BOX_URL: &str = "http://192.168.1.1/ws";
const POLL_EVERY: Duration = Duration::from_secs(30);
const AWAY_AFTER: Duration = Duration::from_secs(120);
/// How long the box may fail to answer before the older rule takes over.
const FAILING_AFTER: Duration = Duration::from_secs(120);
const BOX_TIMEOUT: Duration = Duration::from_secs(8);
const SAH_JSON: &str = "application/x-sah-ws-4-call+json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    /// The box can't tell: the tabs driven from the iPhone ring it.
    #[default]
    Unknown,
    /// On the home Wi-Fi: the iPhone rings for nothing.
    Home,
    /// Off it for two minutes: every tab rings the iPhone.
    Away,
}

static MODE: LazyLock<watch::Sender<Mode>> = LazyLock::new(|| watch::channel(Mode::Unknown).0);

/// Where Alexis is now.
pub fn current() -> Mode {
    *MODE.borrow()
}

#[derive(Default)]
struct Detector {
    mode: Mode,
    /// Since when the box hasn't seen the iPhone. Kept through a failed poll,
    /// which says nothing of the iPhone.
    absent_since: Option<Instant>,
    /// Since when the box can't tell. A short failure (a slow answer, the
    /// box restarting, the PC waking up) keeps the mode.
    failing_since: Option<Instant>,
}

impl Detector {
    /// `seen`: whether the box sees the iPhone, `None` when it can't tell.
    fn observe(&mut self, seen: Option<bool>, now: Instant) -> Mode {
        match seen {
            Some(true) => {
                self.failing_since = None;
                self.absent_since = None;
                self.mode = Mode::Home;
            }
            Some(false) => {
                self.failing_since = None;
                let since = *self.absent_since.get_or_insert(now);
                if now.duration_since(since) >= AWAY_AFTER {
                    self.mode = Mode::Away;
                }
            }
            None => {
                let since = *self.failing_since.get_or_insert(now);
                if now.duration_since(since) >= FAILING_AFTER {
                    self.mode = Mode::Unknown;
                }
            }
        }
        self.mode
    }
}

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(BOX_TIMEOUT)
        .no_proxy()
        .build()
        .unwrap_or_default()
});

/// A session on the box, kept until it refuses it.
struct Session {
    context: String,
    cookie: String,
}

/// Why the box couldn't tell.
#[derive(Debug, PartialEq)]
enum Failure {
    /// The password of `password.txt`: sent again only later (`Refusal`).
    Refused,
    Other(String),
}

impl Failure {
    fn text(&self) -> String {
        match self {
            Failure::Refused => "the box refused the password of password.txt".to_string(),
            Failure::Other(e) => e.clone(),
        }
    }
}

/// The iPhone in the box's Wi-Fi list.
#[derive(Debug, PartialEq)]
enum Listed {
    On,
    Off,
    /// Not in the list: the box keeps a device gone (`Active: false`), so
    /// this is a wrong address in `phone.txt` or a private address that
    /// changed, not a departure.
    Missing,
}

/// The box's cookies, as a `Cookie` header sends them back.
fn cookies(headers: &HeaderMap) -> String {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Where the box's Wi-Fi device list puts `mac`; `None` when the answer is
/// no list (a refused or expired session).
fn listed(answer: &Value, mac: &str) -> Option<Listed> {
    let devices = answer["status"].as_array()?;
    let mut mine = devices.iter().filter(|d| {
        ["Key", "PhysAddress"]
            .iter()
            .any(|k| d[*k].as_str().is_some_and(|a| a.eq_ignore_ascii_case(mac)))
    });
    let Some(first) = mine.next() else {
        return Some(Listed::Missing);
    };
    let active = |d: &Value| d["Active"].as_bool() == Some(true);
    Some(if active(first) || mine.any(active) {
        Listed::On
    } else {
        Listed::Off
    })
}

fn seen(listed: Listed) -> Result<bool, Failure> {
    match listed {
        Listed::On => Ok(true),
        Listed::Off => Ok(false),
        Listed::Missing => Err(Failure::Other(
            "the address of phone.txt is not in the box's Wi-Fi list".to_string(),
        )),
    }
}

async fn login(password: &str) -> Result<Session, Failure> {
    let body = serde_json::json!({
        "service": "sah.Device.Information",
        "method": "createContext",
        "parameters": { "applicationName": "webui", "username": "admin", "password": password },
    });
    let res = CLIENT
        .post(BOX_URL)
        .header("Content-Type", SAH_JSON)
        .header("Authorization", "X-Sah-Login")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| Failure::Other(format!("box unreachable: {e}")))?;
    let cookie = cookies(res.headers());
    let answer: Value = res
        .json()
        .await
        .map_err(|e| Failure::Other(format!("box answer: {e}")))?;
    match answer["data"]["contextID"].as_str() {
        Some(context) if !context.is_empty() => Ok(Session {
            context: context.to_string(),
            cookie,
        }),
        _ => Err(Failure::Refused),
    }
}

async fn devices(session: &Session) -> Result<Value, Failure> {
    let body = serde_json::json!({
        "service": "Devices",
        "method": "get",
        "parameters": { "expression": "wifi" },
    });
    let mut req = CLIENT
        .post(BOX_URL)
        .header("Content-Type", SAH_JSON)
        .header("Authorization", format!("X-Sah {}", session.context))
        .header("X-Context", &session.context)
        .body(body.to_string());
    if !session.cookie.is_empty() {
        req = req.header("Cookie", &session.cookie);
    }
    let res = req
        .send()
        .await
        .map_err(|e| Failure::Other(format!("box unreachable: {e}")))?;
    res.json()
        .await
        .map_err(|e| Failure::Other(format!("box answer: {e}")))
}

/// Whether the box sees the iPhone now. Reuses the session, and logs in
/// again once when the box no longer takes it.
async fn sees(session: &mut Option<Session>, password: &str, mac: &str) -> Result<bool, Failure> {
    if let Some(s) = session.as_ref() {
        if let Some(l) = devices(s).await.ok().and_then(|a| listed(&a, mac)) {
            return seen(l);
        }
        *session = None;
    }
    let fresh = login(password).await?;
    let answer = devices(&fresh).await?;
    let l = listed(&answer, mac)
        .ok_or_else(|| Failure::Other("the box refused the device list".to_string()))?;
    *session = Some(fresh);
    seen(l)
}

fn livebox_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Arkadia")
        .join("livebox")
}

/// A one-value file's first line (Notepad may start it with a BOM).
fn first_line(name: &str) -> Option<String> {
    let raw = std::fs::read_to_string(livebox_dir().join(name)).ok()?;
    let line = raw.trim_start_matches('\u{feff}').lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_string())
}

/// A password the box refused, and when to send it again. The box makes
/// each refusal wait longer, and a refusal may come from such a wait (wrong
/// tries in the browser), not from the password: tried again after 30 min,
/// then twice as long each time, up to 8 h, or at once if the file changes.
struct Refusal {
    password: String,
    retry_at: Instant,
    wait: Duration,
}

const FIRST_RETRY: Duration = Duration::from_secs(30 * 60);
const LONGEST_RETRY: Duration = Duration::from_secs(8 * 60 * 60);

fn next_wait(before: Option<Duration>) -> Duration {
    before.map_or(FIRST_RETRY, |w| (w * 2).min(LONGEST_RETRY))
}

/// Asks the box every 30 s and publishes where Alexis is. Call once.
pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        let mut session: Option<Session> = None;
        let mut detector = Detector::default();
        let mut last_error: Option<String> = None;
        let mut refusal: Option<Refusal> = None;
        let mut tick = tokio::time::interval(POLL_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let result = match (first_line("password.txt"), first_line("phone.txt")) {
                (Some(password), _)
                    if refusal
                        .as_ref()
                        .is_some_and(|r| r.password == password && Instant::now() < r.retry_at) =>
                {
                    Err(Failure::Refused)
                }
                (Some(password), Some(mac)) => {
                    let result = sees(&mut session, &password, &mac).await;
                    match &result {
                        Err(Failure::Refused) => {
                            let before = refusal
                                .as_ref()
                                .filter(|r| r.password == password)
                                .map(|r| r.wait);
                            let wait = next_wait(before);
                            refusal = Some(Refusal {
                                password,
                                retry_at: Instant::now() + wait,
                                wait,
                            });
                        }
                        Ok(_) => refusal = None,
                        Err(Failure::Other(_)) => {}
                    }
                    result
                }
                _ => Err(Failure::Other(
                    "no password.txt or phone.txt in the livebox folder".to_string(),
                )),
            };
            let seen = match result {
                Ok(seen) => {
                    last_error = None;
                    Some(seen)
                }
                Err(e) => {
                    let e = e.text();
                    if last_error.as_deref() != Some(e.as_str()) {
                        log_line(&format!("[presence] {e}"));
                    }
                    last_error = Some(e);
                    None
                }
            };
            let mode = detector.observe(seen, Instant::now());
            let before = current();
            if before != mode {
                MODE.send_replace(mode);
                log_line(&format!("[presence] {before:?} -> {mode:?}"));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC: &str = "BE:B7:93:F9:66:60";

    #[test]
    fn back_on_the_wifi_is_home_at_once() {
        let mut d = Detector::default();
        let t = Instant::now();
        assert_eq!(d.observe(Some(true), t), Mode::Home);
    }

    #[test]
    fn away_only_after_two_minutes_off_the_wifi() {
        let mut d = Detector::default();
        let t = Instant::now();
        d.observe(Some(true), t);
        assert_eq!(d.observe(Some(false), t), Mode::Home);
        assert_eq!(
            d.observe(Some(false), t + Duration::from_secs(90)),
            Mode::Home
        );
        assert_eq!(d.observe(Some(false), t + AWAY_AFTER), Mode::Away);
        assert_eq!(
            d.observe(Some(true), t + AWAY_AFTER + POLL_EVERY),
            Mode::Home
        );
    }

    #[test]
    fn a_short_drop_of_the_wifi_starts_the_count_again() {
        let mut d = Detector::default();
        let t = Instant::now();
        d.observe(Some(false), t);
        d.observe(Some(true), t + Duration::from_secs(60));
        let back = t + Duration::from_secs(90);
        assert_eq!(d.observe(Some(false), back), Mode::Home);
        assert_eq!(
            d.observe(Some(false), back + Duration::from_secs(90)),
            Mode::Home
        );
        assert_eq!(d.observe(Some(false), back + AWAY_AFTER), Mode::Away);
    }

    #[test]
    fn at_start_with_the_iphone_gone_the_older_rule_holds_two_minutes() {
        let mut d = Detector::default();
        let t = Instant::now();
        assert_eq!(d.observe(Some(false), t), Mode::Unknown);
        assert_eq!(d.observe(Some(false), t + AWAY_AFTER), Mode::Away);
    }

    #[test]
    fn a_short_failure_of_the_box_keeps_the_mode() {
        let mut d = Detector::default();
        let t = Instant::now();
        d.observe(Some(false), t);
        let away = t + AWAY_AFTER;
        assert_eq!(d.observe(Some(false), away), Mode::Away);
        assert_eq!(d.observe(None, away + POLL_EVERY), Mode::Away);
        assert_eq!(d.observe(None, away + POLL_EVERY * 3), Mode::Away);
        // An answer in between starts the count again.
        assert_eq!(d.observe(Some(false), away + POLL_EVERY * 4), Mode::Away);
        let failing = away + POLL_EVERY * 5;
        assert_eq!(d.observe(None, failing), Mode::Away);
        // Two minutes without an answer: the older rule takes over...
        assert_eq!(d.observe(None, failing + FAILING_AFTER), Mode::Unknown);
        // ...and the absence already counted still counts.
        let back = failing + FAILING_AFTER + POLL_EVERY;
        assert_eq!(d.observe(Some(false), back), Mode::Away);
    }

    #[test]
    fn the_iphone_is_found_by_its_address_and_must_be_active() {
        let list = |active: bool| {
            serde_json::json!({ "status": [
                { "Key": "AA:BB:CC:DD:EE:FF", "Active": true },
                { "Key": MAC.to_lowercase(), "Active": active },
            ]})
        };
        assert_eq!(listed(&list(true), MAC), Some(Listed::On));
        assert_eq!(listed(&list(false), MAC), Some(Listed::Off));
        let other = serde_json::json!({ "status": [{ "PhysAddress": MAC, "Active": true }] });
        assert_eq!(listed(&other, MAC), Some(Listed::On));
    }

    #[test]
    fn an_address_missing_from_the_list_is_no_departure() {
        // The box keeps a device gone, with `Active: false` (checked on the
        // real box, 02/11/2026): missing means a wrong address.
        let empty = serde_json::json!({ "status": [] });
        assert_eq!(listed(&empty, MAC), Some(Listed::Missing));
        assert!(seen(Listed::Missing).is_err());
    }

    #[test]
    fn a_refused_password_waits_longer_each_time() {
        assert_eq!(next_wait(None), FIRST_RETRY);
        assert_eq!(next_wait(Some(FIRST_RETRY)), FIRST_RETRY * 2);
        assert_eq!(next_wait(Some(LONGEST_RETRY)), LONGEST_RETRY);
    }

    #[test]
    fn a_refused_session_is_no_answer() {
        let refused = serde_json::json!({ "status": null, "errors": [{ "error": 13 }] });
        assert_eq!(listed(&refused, MAC), None);
    }

    #[test]
    fn the_cookies_go_back_without_their_attributes() {
        let mut h = HeaderMap::new();
        h.append(
            SET_COOKIE,
            "a1b2/sessid=XYZ; path=/; HttpOnly".parse().unwrap(),
        );
        h.append(SET_COOKIE, "sah/contextId=42; path=/".parse().unwrap());
        assert_eq!(cookies(&h), "a1b2/sessid=XYZ; sah/contextId=42");
        assert_eq!(cookies(&HeaderMap::new()), "");
    }

    /// Manual check against the real box, with the files of `livebox_dir`:
    /// `cargo test --lib the_box_answers -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn the_box_answers() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let password = first_line("password.txt").expect("password.txt");
        let mac = first_line("phone.txt").expect("phone.txt");
        let mut session = None;
        let on_wifi = rt.block_on(sees(&mut session, &password, &mac)).unwrap();
        println!("iPhone on the Wi-Fi: {on_wifi}");
        // The box keeps the session: the next poll needs no new login.
        let kept = session.as_ref().expect("a session");
        let answer = rt.block_on(devices(kept)).unwrap();
        let again = listed(&answer, &mac).map(seen).expect("a device list");
        assert_eq!(again, Ok(on_wifi), "{answer}");
    }
}
