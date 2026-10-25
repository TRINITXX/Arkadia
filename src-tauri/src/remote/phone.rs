//! Tabs Alexis drives from the iPhone, and the notifications they send it.
//!
//! He works on the PC most of the time and wants the iPhone to ring only
//! when he works from it (choice of 25/10/2026): a pane becomes followed as
//! soon as the phone sends it something (a key, a tap, a prompt button), and
//! stops being followed as soon as he types in it on the PC. When Claude
//! finishes or asks in a followed pane, the phone gets a push, unless it is
//! showing that very pane. As on the PC (REVIEW.md « Notification en
//! double »), a turn Claude restarts on its own rings it once per tab until
//! Alexis comes back to that tab on the phone.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::popup::log_line;

/// A prompt or toolbar button pressed on the phone runs on the desktop, which
/// writes to the pane through the same command as the keyboard: for this
/// long, those writes are the phone's, not Alexis typing on the PC.
const PHONE_ACTION_GRACE: Duration = Duration::from_secs(5);
const EXPO_PUSH_URL: &str = "https://exp.host/--/api/v2/push/send";

pub struct PhoneFollow {
    inner: Mutex<Inner>,
    /// The followed panes, sorted, each time they change: the phones and the
    /// Live Activity (`activity`) follow them.
    changes: watch::Sender<Vec<String>>,
}

impl Default for PhoneFollow {
    fn default() -> Self {
        Self {
            inner: Mutex::default(),
            changes: watch::channel(Vec::new()).0,
        }
    }
}

#[derive(Default)]
struct Inner {
    followed: HashSet<String>,
    /// When the phone last had the desktop act on a pane (button, action).
    acted: HashMap<String, Instant>,
    /// The pane each connected phone shows, while the app is in front.
    watching: HashMap<u64, String>,
    /// Panes the phone was rung for since Alexis last came back to them.
    told: HashSet<String>,
}

impl PhoneFollow {
    /// The phone sent the pane a key or a tap.
    pub fn phone_input(&self, pane: &str) {
        let mut inner = self.inner.lock();
        inner.told.remove(pane);
        if inner.followed.insert(pane.to_string()) {
            self.publish(&inner);
        }
    }

    /// The phone had the desktop act on the pane (a prompt or toolbar button).
    pub fn phone_action(&self, pane: &str, now: Instant) {
        let mut inner = self.inner.lock();
        inner.acted.insert(pane.to_string(), now);
        inner.told.remove(pane);
        if inner.followed.insert(pane.to_string()) {
            self.publish(&inner);
        }
    }

    /// Something was written to the pane from the desktop: Alexis typing, or
    /// the desktop running a button the phone pressed a moment ago.
    pub fn desktop_input(&self, pane: &str, now: Instant) {
        let mut inner = self.inner.lock();
        let by_phone = inner
            .acted
            .get(pane)
            .is_some_and(|at| now.duration_since(*at) < PHONE_ACTION_GRACE);
        if !by_phone {
            inner.acted.remove(pane);
            if inner.followed.remove(pane) {
                self.publish(&inner);
            }
        }
    }

    fn publish(&self, inner: &Inner) {
        let mut panes: Vec<String> = inner.followed.iter().cloned().collect();
        panes.sort();
        self.changes.send_replace(panes);
    }

    /// The followed panes now, then on every change.
    pub fn subscribe(&self) -> watch::Receiver<Vec<String>> {
        self.changes.subscribe()
    }

    /// What a phone shows: `None` when it shows no pane or left the app.
    pub fn set_watching(&self, client: u64, pane: Option<String>) {
        let mut inner = self.inner.lock();
        match pane {
            Some(p) => {
                inner.told.remove(&p);
                inner.watching.insert(client, p);
            }
            None => {
                inner.watching.remove(&client);
            }
        }
    }

    /// The desktop relaunched `old` as `new` (another account): the phone
    /// still drives the same tab.
    pub fn replace(&self, old: &str, new: &str) {
        let mut inner = self.inner.lock();
        if let Some(at) = inner.acted.remove(old) {
            inner.acted.insert(new.to_string(), at);
        }
        if inner.told.remove(old) {
            inner.told.insert(new.to_string());
        }
        if inner.followed.remove(old) {
            inner.followed.insert(new.to_string());
            self.publish(&inner);
        }
    }

    #[cfg(test)]
    fn is_followed(&self, pane: &str) -> bool {
        self.inner.lock().followed.contains(pane)
    }

    /// Whether Claude's finish or question in `pane` should ring the phone.
    pub fn should_notify(&self, pane: &str) -> bool {
        let inner = self.inner.lock();
        inner.followed.contains(pane) && !inner.watching.values().any(|p| p == pane)
    }

    /// Like `should_notify`, and counts the ring: a `done` of a turn Claude
    /// restarted on its own rings once per tab until Alexis comes back.
    pub fn claim_notification(&self, pane: &str, kind: &str, self_woken: bool) -> bool {
        let mut inner = self.inner.lock();
        let shown = inner.watching.values().any(|p| p == pane);
        if !inner.followed.contains(pane) || shown {
            return false;
        }
        if self_woken && kind == "done" && inner.told.contains(pane) {
            return false;
        }
        inner.told.insert(pane.to_string());
        true
    }
}

pub static FOLLOW: LazyLock<PhoneFollow> = LazyLock::new(PhoneFollow::default);

/// Where the phone's push token is kept, beside `remote.json`.
fn token_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Arkadia")
        .join("phone-push.json")
}

#[derive(Serialize, Deserialize, Default)]
struct PushConfig {
    /// The iPhone app's Expo push token (`ExponentPushToken[…]`).
    expo_token: Option<String>,
}

/// Remembers the token the app sent, so pushes reach it after a restart.
pub fn save_push_token(token: &str) {
    if !token.starts_with("ExponentPushToken[") {
        log_line("[phone] ignored a push token of an unknown kind");
        return;
    }
    let config = PushConfig {
        expo_token: Some(token.to_string()),
    };
    let path = token_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match serde_json::to_string_pretty(&config) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                log_line(&format!("[phone] cannot save the push token: {e}"));
            }
        }
        Err(e) => log_line(&format!("[phone] cannot encode the push token: {e}")),
    }
}

fn push_token() -> Option<String> {
    let raw = std::fs::read_to_string(token_path()).ok()?;
    serde_json::from_str::<PushConfig>(&raw).ok()?.expo_token
}

/// The notification's text: which tab, and what Claude did.
pub fn message(kind: &str, project: &str, tab: &str) -> (String, String) {
    let title = match (project.is_empty(), tab.is_empty()) {
        (false, false) => format!("{project} · {tab}"),
        (false, true) => project.to_string(),
        (true, false) => tab.to_string(),
        (true, true) => "Arkadia".to_string(),
    };
    let body = if kind == "question" {
        "Claude te pose une question"
    } else {
        "Claude a fini"
    };
    (title, body.to_string())
}

/// Rings the phone for Claude's `kind` ("done" | "question") in `pane`, if
/// Alexis drives that pane from it. Off the caller's thread: it waits on the
/// network.
pub fn notify(pane: &str, kind: &str, self_woken: bool, project: &str, tab: &str) {
    if !FOLLOW.claim_notification(pane, kind, self_woken) {
        return;
    }
    let Some(token) = push_token() else {
        log_line("[phone] followed pane finished, but no push token yet");
        return;
    };
    let (title, body) = message(kind, project, tab);
    let payload = serde_json::json!({
        "to": token,
        "title": title,
        "body": body,
        "sound": "default",
        "data": { "paneId": pane },
    });
    std::thread::spawn(move || send_expo_push(&payload.to_string()));
}

/// Posts to Expo's push service through Windows' own curl: Arkadia has no
/// HTTP client of its own, and one push a reply needs none.
fn send_expo_push(json: &str) {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("curl.exe");
    cmd.args([
        "-s",
        "--max-time",
        "15",
        "-H",
        "Content-Type: application/json",
        "--data-binary",
        "@-",
        EXPO_PUSH_URL,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console over the app.
        cmd.creation_flags(0x0800_0000);
    }
    let Ok(mut child) = cmd.spawn() else {
        log_line("[phone] curl.exe missing: no push sent");
        return;
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(json.as_bytes());
    }
    match child.wait_with_output() {
        Ok(out) => log_line(&format!(
            "[phone] push sent: {}",
            String::from_utf8_lossy(&out.stdout)
                .chars()
                .take(200)
                .collect::<String>()
        )),
        Err(e) => log_line(&format!("[phone] push failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pane_driven_from_the_phone_rings_it() {
        let f = PhoneFollow::default();
        assert!(!f.should_notify("p"));
        f.phone_input("p");
        assert!(f.should_notify("p"));
    }

    #[test]
    fn typing_on_the_pc_hands_the_pane_back() {
        let f = PhoneFollow::default();
        let now = Instant::now();
        f.phone_input("p");
        f.desktop_input("p", now);
        assert!(!f.should_notify("p"));
    }

    #[test]
    fn a_button_pressed_on_the_phone_is_not_typing_on_the_pc() {
        let f = PhoneFollow::default();
        let now = Instant::now();
        f.phone_action("p", now);
        // The desktop runs the button and writes to the pane.
        f.desktop_input("p", now + Duration::from_secs(1));
        assert!(f.should_notify("p"));
        // Later writes from the desktop are Alexis at the PC.
        f.desktop_input("p", now + PHONE_ACTION_GRACE + Duration::from_secs(1));
        assert!(!f.should_notify("p"));
    }

    #[test]
    fn no_ring_for_the_pane_on_the_phone_screen() {
        let f = PhoneFollow::default();
        f.phone_input("p");
        f.set_watching(1, Some("p".into()));
        assert!(!f.should_notify("p"));
        f.set_watching(1, None);
        assert!(f.should_notify("p"));
    }

    #[test]
    fn other_panes_keep_their_own_state() {
        let f = PhoneFollow::default();
        f.phone_input("a");
        f.desktop_input("b", Instant::now());
        assert!(f.should_notify("a"));
        assert!(!f.is_followed("b"));
    }

    #[test]
    fn a_turn_claude_restarts_alone_rings_once_until_alexis_comes_back() {
        let f = PhoneFollow::default();
        f.phone_input("p");
        assert!(f.claim_notification("p", "done", false));
        // Background tasks wake Claude twice: silent.
        assert!(!f.claim_notification("p", "done", true));
        assert!(!f.claim_notification("p", "done", true));
        // A question still rings.
        assert!(f.claim_notification("p", "question", true));
        // Back on the tab from the phone: the next restart rings again.
        f.set_watching(1, Some("p".into()));
        f.set_watching(1, None);
        assert!(f.claim_notification("p", "done", true));
    }

    #[test]
    fn a_relaunched_pane_stays_followed() {
        let f = PhoneFollow::default();
        f.phone_input("old");
        f.replace("old", "new");
        assert!(f.should_notify("new"));
        assert!(!f.should_notify("old"));
    }

    #[test]
    fn the_message_names_the_tab_and_what_claude_did() {
        assert_eq!(
            message("question", "Arkadia", "Indicateur violet"),
            (
                "Arkadia · Indicateur violet".to_string(),
                "Claude te pose une question".to_string()
            )
        );
        assert_eq!(message("done", "", "").1, "Claude a fini");
        assert_eq!(message("done", "", "").0, "Arkadia");
    }
}
