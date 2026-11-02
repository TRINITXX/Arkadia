//! The iPhone's Live Activity (Lock Screen and Dynamic Island): one row per
//! listed tab, in the projects' order, with a dot green when Claude waits for
//! him, orange when it works, and the project and tab names (choice of
//! 25/10/2026; the island shows one dot). Which tabs (`live_panes`, choice of
//! 02/11/2026): away from home, every tab where Claude works or waits; at
//! home, none; while the box can't tell, the tabs Alexis drives from the
//! phone (`phone`). The phones get the same list (`follow`). The app starts
//! the activity while in front and hands over its push token; from then on
//! Arkadia keeps it current through APNs, and ends it when no tab is listed.
//!
//! APNs wants HTTP/2 and a JWT signed with the team's key, kept outside the
//! repository in `%LOCALAPPDATA%\Arkadia\apns\` (`apns.json` + the `.p8`).

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use super::phone::FOLLOW;
use super::presence::{self, Mode};
use super::RemoteHub;
use crate::popup::log_line;

/// Must match `createLiveActivity`'s name in the app (`iphone/src/activity`).
const ACTIVITY_NAME: &str = "ClaudeDots";
/// Badges change in bursts (a tab starts, its title follows): one push after.
const SETTLE: Duration = Duration::from_millis(1500);
/// APNs takes a provider token for up to an hour; refreshed well before.
const JWT_LIFETIME: Duration = Duration::from_secs(40 * 60);
const APNS_HOST: &str = "https://api.push.apple.com";

#[derive(Default)]
struct State {
    /// The running activity's push token, from the app.
    token: Option<String>,
    /// The props it last got, so an unchanged state sends nothing.
    sent: Option<String>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Mutex::default);
static JWT: LazyLock<Mutex<Option<(String, Instant)>>> = LazyLock::new(Mutex::default);
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);
/// The panes whose tabs the activity lists (`live_panes`), kept current.
static LIVE: LazyLock<watch::Sender<Vec<String>>> = LazyLock::new(|| watch::channel(Vec::new()).0);

/// The app started (`Some`) or ended (`None`) its activity.
pub fn set_token(token: Option<String>) {
    let mut state = STATE.lock();
    state.token = token.filter(|t| t.chars().all(|c| c.is_ascii_hexdigit()) && !t.is_empty());
    // A new activity starts from the props the app gave it.
    state.sent = None;
}

/// One followed tab, as `followRows` (src/lib/followRows.ts) builds it.
#[derive(Serialize, Debug, PartialEq)]
pub struct Row {
    /// `w` = Claude waits, `b` = it works, `i` = neither.
    s: &'static str,
    /// Project name.
    p: String,
    /// Tab title.
    t: String,
}

/// Each tab of the snapshot with its project, in the sidebar's order.
fn tabs(value: &serde_json::Value) -> Vec<(&serde_json::Value, &serde_json::Value)> {
    let groups = value["groups"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|g| g["projects"].as_array().into_iter().flatten());
    let projects = value["active"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(groups);
    let mut out = Vec::new();
    for project in projects {
        for tab in project["tabs"].as_array().into_iter().flatten() {
            out.push((project, tab));
        }
    }
    out
}

fn pane_ids(tab: &serde_json::Value) -> impl Iterator<Item = &str> {
    tab["panes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| p["id"].as_str())
}

/// The panes whose tabs the activity lists, with Alexis at `mode`: away,
/// those of every tab where Claude works or waits (it has a badge); home,
/// none; unknown, the panes he drives from the phone.
pub fn live_panes(mode: Mode, followed: &[String], snapshot: Option<&str>) -> Vec<String> {
    match mode {
        Mode::Unknown => followed.to_vec(),
        Mode::Home => Vec::new(),
        Mode::Away => {
            let Some(value) = snapshot.and_then(|s| serde_json::from_str(s).ok()) else {
                return Vec::new();
            };
            let mut out = Vec::new();
            for (_, tab) in tabs(&value) {
                if tab["badge"].is_string() {
                    out.extend(pane_ids(tab).map(str::to_string));
                }
            }
            out
        }
    }
}

/// The listed panes now, then on every change: the phones get them too.
pub fn live() -> watch::Receiver<Vec<String>> {
    LIVE.subscribe()
}

/// The listed tabs, in the snapshot's order. Empty when none is listed.
pub fn rows(snapshot: &str, listed: &HashSet<String>) -> Vec<Row> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(snapshot) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (project, tab) in tabs(&value) {
        if !pane_ids(tab).any(|id| listed.contains(id)) {
            continue;
        }
        let s = match tab["badge"].as_str() {
            Some(b) if b.starts_with("busy") => "b",
            Some(b) if b.starts_with("waiting") => "w",
            _ => "i",
        };
        let name = |v: &serde_json::Value| v.as_str().unwrap_or_default().to_string();
        out.push(Row {
            s,
            p: name(&project["name"]),
            t: name(&tab["title"]),
        });
    }
    out
}

/// The activity's props, as the app's `ClaudeDotsProps`.
fn props(rows: &[Row]) -> String {
    serde_json::json!({ "tabs": rows }).to_string()
}

/// Keeps `LIVE` current from where Alexis is, the followed panes and the
/// desktop's badges.
fn spawn_live(hub: Arc<RemoteHub>) {
    tauri::async_runtime::spawn(async move {
        let mut state_rx = hub.watch_state();
        let mut follow_rx = FOLLOW.subscribe();
        let mut mode_rx = presence::subscribe();
        loop {
            let panes = {
                let snapshot = state_rx.borrow_and_update().clone();
                let followed = follow_rx.borrow_and_update().clone();
                let mode = *mode_rx.borrow_and_update();
                live_panes(mode, &followed, snapshot.as_deref())
            };
            LIVE.send_if_modified(|cur| {
                if *cur == panes {
                    return false;
                }
                *cur = panes;
                true
            });
            tokio::select! {
                changed = state_rx.changed() => if changed.is_err() { break },
                changed = follow_rx.changed() => if changed.is_err() { break },
                changed = mode_rx.changed() => if changed.is_err() { break },
            }
        }
    });
}

/// Follows the desktop's badges and the listed tabs, and pushes the rows to
/// the running activity whenever they change.
pub fn spawn(hub: Arc<RemoteHub>) {
    spawn_live(hub.clone());
    tauri::async_runtime::spawn(async move {
        let mut state_rx = hub.watch_state();
        let mut live_rx = live();
        loop {
            tokio::select! {
                changed = state_rx.changed() => if changed.is_err() { break },
                changed = live_rx.changed() => if changed.is_err() { break },
            }
            tokio::time::sleep(SETTLE).await;
            let snapshot = state_rx.borrow_and_update().clone();
            let listed: HashSet<String> = live_rx.borrow_and_update().iter().cloned().collect();
            let now = snapshot.map(|s| rows(&s, &listed)).unwrap_or_default();
            push(props(&now), now.is_empty()).await;
        }
    });
}

async fn push(props: String, end: bool) {
    let token = {
        let state = STATE.lock();
        match &state.token {
            Some(t) if state.sent.as_deref() != Some(props.as_str()) => t.clone(),
            _ => return,
        }
    };
    match send(&token, &props, end).await {
        Ok(()) => {
            let mut state = STATE.lock();
            if state.token.as_deref() == Some(token.as_str()) {
                state.sent = Some(props);
                if end {
                    state.token = None;
                }
            }
        }
        Err(Gone) => {
            log_line("[activity] the activity is gone: forgetting its token");
            set_token(None);
        }
    }
}

/// The token no longer names a running activity (ended on the phone).
struct Gone;

#[derive(Deserialize)]
struct ApnsConfig {
    key_id: String,
    team_id: String,
    topic: String,
    key_file: String,
}

fn apns_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Arkadia")
        .join("apns")
}

fn config() -> Result<ApnsConfig, String> {
    let raw = std::fs::read_to_string(apns_dir().join("apns.json"))
        .map_err(|e| format!("apns.json: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("apns.json: {e}"))
}

/// The provider token: ES256 over `{alg, kid}.{iss, iat}`, reused 40 min.
fn provider_token(config: &ApnsConfig) -> Result<String, String> {
    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::{Signature, SigningKey};
    use p256::pkcs8::DecodePrivateKey;

    let mut cached = JWT.lock();
    if let Some((jwt, at)) = cached.as_ref() {
        if at.elapsed() < JWT_LIFETIME {
            return Ok(jwt.clone());
        }
    }
    let pem = std::fs::read_to_string(apns_dir().join(&config.key_file))
        .map_err(|e| format!("APNs key: {e}"))?;
    let key = SigningKey::from_pkcs8_pem(&pem).map_err(|e| format!("APNs key: {e}"))?;
    let iat = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let header = serde_json::json!({ "alg": "ES256", "kid": config.key_id });
    let claims = serde_json::json!({ "iss": config.team_id, "iat": iat });
    let signed = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let signature: Signature = key.sign(signed.as_bytes());
    let jwt = format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()));
    *cached = Some((jwt.clone(), Instant::now()));
    Ok(jwt)
}

/// The APNs body: the activity's new props, or its end (dismissed at once).
fn payload(props: &str, end: bool, now: u64) -> serde_json::Value {
    let mut aps = serde_json::json!({
        "timestamp": now,
        "event": if end { "end" } else { "update" },
        "content-state": { "name": ACTIVITY_NAME, "props": props },
    });
    if end {
        aps["dismissal-date"] = serde_json::json!(now);
    }
    serde_json::json!({ "aps": aps })
}

async fn send(token: &str, props: &str, end: bool) -> Result<(), Gone> {
    let attempt = async {
        let config = config()?;
        let jwt = provider_token(&config)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let res = CLIENT
            .post(format!("{APNS_HOST}/3/device/{token}"))
            .header("authorization", format!("bearer {jwt}"))
            .header("apns-push-type", "liveactivity")
            .header("apns-topic", &config.topic)
            .header("apns-priority", "10")
            .json(&payload(props, end, now))
            .send()
            .await
            .map_err(|e| format!("APNs: {e}"))?;
        Ok::<_, String>((res.status(), res.text().await.unwrap_or_default()))
    };
    match attempt.await {
        Ok((status, _)) if status.is_success() => Ok(()),
        // 410: the activity ended; 400 BadDeviceToken: not a token of ours.
        Ok((status, body)) if status.as_u16() == 410 || body.contains("BadDeviceToken") => {
            Err(Gone)
        }
        Ok((status, body)) => {
            log_line(&format!("[activity] APNs answered {status}: {body}"));
            Ok(())
        }
        Err(e) => {
            log_line(&format!("[activity] push failed: {e}"));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNAPSHOT: &str = r#"{
        "active": [
            {"id": "p1", "name": "Arkadia", "tabs": [
                {"id": "t1", "title": "Indicateur violet", "badge": "waiting", "panes": [{"id": "a"}]},
                {"id": "t2", "badge": "busy-artifact", "panes": [{"id": "b"}, {"id": "c"}]},
                {"id": "t3", "badge": null, "panes": [{"id": "d"}]}
            ]}
        ],
        "groups": [
            {"name": "VTC", "projects": [
                {"id": "p2", "name": "VTC-Planner-Mobile", "tabs": [{"id": "t4", "title": "Notifications", "badge": "busy", "panes": [{"id": "e"}]}]}
            ]}
        ]
    }"#;

    fn set(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn one_row_per_followed_tab_in_the_sidebar_order() {
        let states: Vec<&str> = rows(SNAPSHOT, &set(&["e", "a", "c", "d"]))
            .iter()
            .map(|r| r.s)
            .collect();
        assert_eq!(states, ["w", "b", "i", "b"]);
    }

    #[test]
    fn each_row_names_its_project_and_tab() {
        assert_eq!(
            props(&rows(SNAPSHOT, &set(&["a"]))),
            r#"{"tabs":[{"p":"Arkadia","s":"w","t":"Indicateur violet"}]}"#
        );
    }

    #[test]
    fn away_from_home_every_tab_where_claude_works_or_waits_is_listed() {
        let followed = vec!["a".to_string()];
        let away = live_panes(Mode::Away, &followed, Some(SNAPSHOT));
        assert_eq!(away, ["a", "b", "c", "e"], "t3 has no badge");
        let states: Vec<&str> = rows(SNAPSHOT, &away.into_iter().collect())
            .iter()
            .map(|r| r.s)
            .collect();
        assert_eq!(states, ["w", "b", "b"]);
        assert!(live_panes(Mode::Away, &followed, None).is_empty());
    }

    #[test]
    fn at_home_none_is_listed_and_unknown_keeps_the_followed_ones() {
        let followed = vec!["d".to_string()];
        assert!(live_panes(Mode::Home, &followed, Some(SNAPSHOT)).is_empty());
        assert_eq!(live_panes(Mode::Unknown, &followed, Some(SNAPSHOT)), ["d"]);
    }

    #[test]
    fn no_followed_tab_no_rows() {
        assert!(rows(SNAPSHOT, &set(&[])).is_empty());
        assert!(rows("not json", &set(&["a"])).is_empty());
    }

    /// Manual check of the key in `%LOCALAPPDATA%\Arkadia\apns`: Apple must
    /// reject the made-up device token, not our provider token.
    /// `cargo test --lib apns_accepts_our_key -- --ignored`
    #[test]
    #[ignore]
    fn apns_accepts_our_key() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let fake = "00".repeat(32);
        assert!(rt.block_on(send(&fake, r#"{"tabs":[]}"#, false)).is_err());
    }

    #[test]
    fn the_end_dismisses_at_once_and_names_the_activity() {
        let p = payload(r#"{"tabs":[]}"#, true, 1000);
        assert_eq!(p["aps"]["event"], "end");
        assert_eq!(p["aps"]["dismissal-date"], 1000);
        assert_eq!(p["aps"]["content-state"]["name"], ACTIVITY_NAME);
        let update = payload(r#"{"tabs":[]}"#, false, 1000);
        assert_eq!(update["aps"]["content-state"]["props"], r#"{"tabs":[]}"#);
        assert!(update["aps"].get("dismissal-date").is_none());
    }
}
