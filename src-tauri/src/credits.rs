//! The Anthropic API credits: when every subscription account is at its
//! limit, a chat can go on with them (pseudo-account [`ACCOUNT`], its own
//! chat server), and the « Comptes » menu shows what is left of them.
//!
//! Two secrets live here, and neither ever reaches the page, a log or a
//! command line:
//! - the API key (`~/.config/claude-credits/api-key.txt`), read when the
//!   credits' chat server starts and put in that server's env alone
//!   (`chat::server_command`); every other Claude Arkadia starts drops any
//!   inherited one ([`scrub`]);
//! - the Console session, kept in a WebView2 profile of its own: Alexis signs
//!   in once in Arkadia's window ([`credits_console_login`]), then the
//!   profile's cookies for the Console go to `curl.exe` on its stdin, for the
//!   two endpoints the Console's own page calls (no public balance API for
//!   this organization). The Console page gets no IPC: its label is refused
//!   by `artifact_view::guard`, and no capability lists it.
//!
//! The page only gets [`CreditsView`]: key present or not, the Console's
//! state, the tranches and when they were read.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::popup::log_line;

/// The pseudo-account of a chat on the credits: never in the registry.
pub const ACCOUNT: &str = "api";
/// Always this model on the credits, whatever the pane asked (never Fable).
pub const MODEL: &str = "claude-opus-5-5";
/// What Claude Code reads the key from.
pub const KEY_VAR: &str = "ANTHROPIC_API_KEY";
/// The `opus` alias the subagents use, pinned to [`MODEL`] too.
pub const OPUS_ALIAS_VAR: &str = "ANTHROPIC_DEFAULT_OPUS_MODEL";
/// The `fable` alias (a subagent, a workflow agent or an agent file asking
/// for it), pinned to [`MODEL`]: never Fable on the key. Read by Claude Code
/// 2.1.325, which then counts [`MODEL`] as « Fable » in its own checks.
pub const FABLE_ALIAS_VAR: &str = "ANTHROPIC_DEFAULT_FABLE_MODEL";
const KEY_PREFIX: &str = "sk-ant-";

const CONSOLE_HOST: &str = "platform.claude.com";
const CONSOLE_ORIGIN: &str = "https://platform.claude.com";
const LOGIN_URL: &str = "https://platform.claude.com/login";
const LOGIN_LABEL: &str = "credits-console";
const READER_PREFIX: &str = "credits-reader-";
const LOGIN_TITLE: &str = "Console Anthropic : choisissez « Continuer avec l'e-mail » (Google refuse souvent ce navigateur)";
/// The Console's window and `curl.exe` say the same browser: a Cloudflare
/// clearance cookie only holds for the user agent it was given to.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

const POLL_EVERY: Duration = Duration::from_secs(30 * 60);
/// After launch: the chats restored at start come first.
const FIRST_POLL: Duration = Duration::from_secs(90);
/// The menu opened twice in a row reads once.
const MIN_GAP_MS: i64 = 60_000;
/// Below one dollar left, the credits count as used up.
const EXHAUSTED_BELOW: i64 = 100;

// ─── Key ────────────────────────────────────────────────────────────

fn key_file() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("claude-credits")
        .join("api-key.txt")
}

/// The key the file holds, if it looks like one: `sk-ant-…`, one token of
/// printable ASCII.
fn valid_key(raw: &str) -> Option<String> {
    let key = raw.trim_start_matches('\u{feff}').trim();
    let ok = key.starts_with(KEY_PREFIX)
        && key.len() > KEY_PREFIX.len()
        && key.len() <= 512
        && key.chars().all(|c| c.is_ascii_graphic());
    ok.then(|| key.to_string())
}

/// Read at each start of the credits' chat server, never kept.
pub fn api_key() -> Option<String> {
    valid_key(&fs::read_to_string(key_file()).ok()?)
}

/// Drops an API key Arkadia itself may have inherited: a Claude started for
/// a subscription (a chat server, a hello, the AI search) must never pay
/// with the credits.
pub fn scrub(cmd: &mut Command) {
    cmd.env_remove(KEY_VAR);
}

// ─── State ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Console {
    /// Never signed in from Arkadia.
    #[default]
    Unknown,
    Connected,
    /// The Console refused the session (401/403): sign in again.
    Disconnected,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TrancheKind {
    /// The Team plan's monthly API credit (`subscription_api_credit`).
    Team,
    Promo,
    Purchased,
}

/// One credit, in cents.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tranche {
    pub kind: TrancheKind,
    pub remaining: i64,
    pub granted: i64,
    /// Unix ms.
    pub expires_at: Option<i64>,
}

/// The last read, kept on disk for the next launch (no id, no cookie).
#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct Stored {
    console: Console,
    tranches: Vec<Tranche>,
    /// Cents, as the Console totals them.
    total: Option<i64>,
    /// Unix ms of the last successful read.
    fetched_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreditsView {
    key_present: bool,
    console: Console,
    tranches: Vec<Tranche>,
    total: Option<i64>,
    fetched_at: Option<i64>,
    /// Less than a dollar left at the last read.
    exhausted: bool,
}

impl CreditsView {
    fn of(stored: Stored, key_present: bool) -> Self {
        let exhausted = stored.console == Console::Connected
            && stored.total.is_some_and(|t| t < EXHAUSTED_BELOW);
        Self {
            key_present,
            console: stored.console,
            tranches: stored.tranches,
            total: stored.total,
            fetched_at: stored.fetched_at,
            exhausted,
        }
    }
}

static STATE: Mutex<Option<Stored>> = Mutex::new(None);
static READING: AtomicBool = AtomicBool::new(false);
static LAST_READ: AtomicI64 = AtomicI64::new(0);
/// Reader labels are never reused: a window closes asynchronously.
static NEXT_READER: AtomicU64 = AtomicU64::new(1);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn arkadia_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
}

/// The Lab keeps its own: two instances never share a WebView2 profile.
fn suffix() -> &'static str {
    if crate::lab::LAB {
        "-lab"
    } else {
        ""
    }
}

fn state_file() -> PathBuf {
    arkadia_dir().join(format!("credits{}.json", suffix()))
}

/// The Console's WebView2 profile: its sign-in survives a restart.
fn session_dir() -> PathBuf {
    arkadia_dir().join(format!("console-session{}", suffix()))
}

fn load() -> Stored {
    fs::read_to_string(state_file())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn stored() -> Stored {
    let mut slot = STATE.lock().unwrap_or_else(|e| e.into_inner());
    slot.get_or_insert_with(load).clone()
}

fn store(next: &Stored) {
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = Some(next.clone());
    let path = state_file();
    if let Ok(text) = serde_json::to_string_pretty(next) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let tmp = path.with_extension("arkadia-tmp");
        if fs::write(&tmp, text).is_ok() && fs::rename(&tmp, &path).is_err() {
            let _ = fs::remove_file(&tmp);
        }
    }
}

// ─── Console's answers ──────────────────────────────────────────────

fn valid_uuid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// `GET /api/organizations`: the organization that can use the API.
pub fn parse_org(body: &Value) -> Option<String> {
    body.as_array()?
        .iter()
        .find(|org| {
            org.get("capabilities")
                .and_then(Value::as_array)
                .is_some_and(|caps| caps.iter().any(|c| c == "api"))
        })
        .and_then(|org| org.get("uuid")?.as_str())
        .filter(|id| valid_uuid(id))
        .map(str::to_string)
}

fn cents(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64))
}

fn tranche(t: &Value, kind: TrancheKind, now: i64) -> Option<Tranche> {
    let remaining = cents(t.get("remaining_amount_minor_units"))?;
    let granted = cents(t.get("granted_amount_minor_units")).unwrap_or(remaining);
    let expires_at = t
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis());
    // An expired credit pays nothing any more.
    if expires_at.is_some_and(|at| at <= now) {
        return None;
    }
    Some(Tranche {
        kind,
        remaining,
        granted,
        expires_at,
    })
}

/// The Team plan's credit, by its program or its name; any other promo.
fn promo_kind(t: &Value) -> TrancheKind {
    let program = t.get("program_id").and_then(Value::as_str).unwrap_or("");
    let name = t.get("name").and_then(Value::as_str).unwrap_or("");
    if program == "subscription_api_credit" || name.contains("Team") {
        TrancheKind::Team
    } else {
        TrancheKind::Promo
    }
}

/// `GET /api/organizations/<uuid>/prepaid/credits`: the credits still
/// running, Team first, and the total (cents).
pub fn parse_credits(body: &Value, now: i64) -> Option<(Vec<Tranche>, Option<i64>)> {
    let promo = body.get("promo_tranches").and_then(Value::as_array);
    let bought = body.get("tranches").and_then(Value::as_array);
    if promo.is_none() && bought.is_none() {
        return None;
    }
    let mut out: Vec<Tranche> = promo
        .into_iter()
        .flatten()
        .filter_map(|t| tranche(t, promo_kind(t), now))
        .chain(
            bought
                .into_iter()
                .flatten()
                .filter_map(|t| tranche(t, TrancheKind::Purchased, now)),
        )
        .collect();
    out.sort_by_key(|t| match t.kind {
        TrancheKind::Team => 0,
        TrancheKind::Promo => 1,
        TrancheKind::Purchased => 2,
    });
    let sum: i64 = out.iter().map(|t| t.remaining).sum();
    let total = cents(body.get("amount")).or(Some(sum));
    Some((out, total))
}

// ─── Reading ────────────────────────────────────────────────────────

enum Read {
    Balance(Vec<Tranche>, Option<i64>),
    SignedOut,
    /// Network, Console down, an answer not understood: nothing changes.
    Failed(String),
}

/// A value inside a curl config file's double quotes.
fn quoted(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// `name=value; …` for the request: cookies with a character that would
/// break the header (or the config line) are left out.
fn cookie_header(cookies: &[(String, String)]) -> String {
    let fits = |s: &str| !s.chars().any(|c| c.is_control() || c == ';');
    cookies
        .iter()
        .filter(|(n, v)| !n.is_empty() && fits(n) && fits(v) && !n.contains('='))
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

/// curl's options, given on its stdin (`-K -`): the cookies never show on a
/// command line another process could read.
fn curl_config(url: &str, cookie: &str) -> String {
    format!(
        "url = \"{}\"\nheader = \"Cookie: {}\"\nheader = \"Accept: application/json\"\nuser-agent = \"{}\"\nsilent\nmax-time = 20\nwrite-out = \"\\n%{{http_code}}\"\n",
        quoted(url),
        quoted(cookie),
        quoted(USER_AGENT),
    )
}

/// The status code curl writes after the body (`write-out`).
fn split_status(out: &[u8]) -> Option<(u16, &[u8])> {
    let at = out.iter().rposition(|b| *b == b'\n')?;
    let code = std::str::from_utf8(&out[at + 1..])
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some((code, &out[..at]))
}

fn console_get(path: &str, cookie: &str) -> Result<(u16, Vec<u8>), String> {
    let mut cmd = Command::new("curl.exe");
    cmd.args(["-K", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    scrub(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console over the app.
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let config = curl_config(&format!("{CONSOLE_ORIGIN}{path}"), cookie);
        stdin
            .write_all(config.as_bytes())
            .map_err(|e| format!("curl stdin: {e}"))?;
    }
    let out = child.wait_with_output().map_err(|e| format!("curl: {e}"))?;
    let (code, body) = split_status(&out.stdout).ok_or("no answer")?;
    Ok((code, body.to_vec()))
}

fn json_of(code: u16, body: &[u8]) -> Result<Value, Read> {
    match code {
        200 => serde_json::from_slice(body).map_err(|_| Read::Failed("answer not JSON".into())),
        401 | 403 => Err(Read::SignedOut),
        // Never the body: it may hold ids.
        _ => Err(Read::Failed(format!("HTTP {code}"))),
    }
}

fn read_balance(cookie: &str) -> Read {
    if cookie.is_empty() {
        return Read::SignedOut;
    }
    let orgs = match console_get("/api/organizations", cookie) {
        Ok((code, body)) => match json_of(code, &body) {
            Ok(v) => v,
            Err(read) => return read,
        },
        Err(e) => return Read::Failed(e),
    };
    let Some(org) = parse_org(&orgs) else {
        return Read::Failed("no organization with the API".into());
    };
    let credits = match console_get(&format!("/api/organizations/{org}/prepaid/credits"), cookie) {
        Ok((code, body)) => match json_of(code, &body) {
            Ok(v) => v,
            Err(read) => return read,
        },
        Err(e) => return Read::Failed(e),
    };
    match parse_credits(&credits, now_ms()) {
        Some((tranches, total)) => Read::Balance(tranches, total),
        None => Read::Failed("credits not understood".into()),
    }
}

/// A window on the Console's profile, for its cookies. Hidden, and gone at
/// once: no WebView2 kept running between two reads.
fn reader(app: &AppHandle) -> Result<WebviewWindow, String> {
    let label = format!(
        "{READER_PREFIX}{}",
        NEXT_READER.fetch_add(1, Ordering::Relaxed)
    );
    let blank: Url = "about:blank".parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .data_directory(session_dir())
        .user_agent(USER_AGENT)
        .title("Crédits API")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .decorations(false)
        .inner_size(1.0, 1.0)
        .build()
        .map_err(|e| e.to_string())
}

/// The Console's cookies, from the sign-in window when it is open, else
/// from a reader. Off the main thread only (WebView2 deadlocks otherwise).
fn console_cookie(app: &AppHandle) -> Result<String, String> {
    let url: Url = format!("{CONSOLE_ORIGIN}/")
        .parse()
        .map_err(|e| format!("{e}"))?;
    let cookies = match app.get_webview_window(LOGIN_LABEL) {
        Some(window) => window.cookies_for_url(url),
        None => {
            let window = reader(app)?;
            let cookies = window.cookies_for_url(url);
            let _ = window.destroy();
            cookies
        }
    }
    .map_err(|e| e.to_string())?;
    let pairs: Vec<(String, String)> = cookies
        .iter()
        .map(|c| (c.name().to_string(), c.value().to_string()))
        .collect();
    Ok(cookie_header(&pairs))
}

/// Reads the balance now, unless one was read under a minute ago (`force`
/// after a sign-in), or Arkadia was never signed in. Blocking: a thread or
/// an async command only.
fn refresh(app: &AppHandle, force: bool) -> Stored {
    let current = stored();
    let now = now_ms();
    if !force
        && (current.console == Console::Unknown
            || now - LAST_READ.load(Ordering::Relaxed) < MIN_GAP_MS)
    {
        return current;
    }
    if READING.swap(true, Ordering::AcqRel) {
        return current;
    }
    LAST_READ.store(now, Ordering::Relaxed);
    let read = console_cookie(app)
        .map(|cookie| read_balance(&cookie))
        .unwrap_or_else(Read::Failed);
    READING.store(false, Ordering::Release);
    // Re-read: a sign-in may have stored meanwhile.
    let mut next = stored();
    match read {
        Read::Balance(tranches, total) => {
            log_line(&format!("credits: read, {} credit(s)", tranches.len()));
            next = Stored {
                console: Console::Connected,
                tranches,
                total,
                fetched_at: Some(now_ms()),
            };
        }
        Read::SignedOut => {
            log_line("credits: Console signed out");
            next.console = Console::Disconnected;
        }
        Read::Failed(why) => {
            log_line(&format!("credits: read failed ({why})"));
            return next;
        }
    }
    store(&next);
    next
}

/// Every 30 min while the Console is signed in.
pub fn spawn_poller(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_POLL);
        loop {
            if stored().console == Console::Connected {
                refresh(&app, false);
            }
            std::thread::sleep(POLL_EVERY);
        }
    });
}

// ─── Sign-in window ─────────────────────────────────────────────────

/// Pages the sign-in window keeps: the Console, Claude, and the sign-in
/// pages they send to. Anything else opens in the browser.
fn stays_in_console(url: &Url) -> bool {
    if matches!(url.scheme(), "about" | "blob" | "data") {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    const DOMAINS: [&str; 3] = ["claude.com", "claude.ai", "anthropic.com"];
    const SIGN_IN_HOSTS: [&str; 3] = [
        "accounts.google.com",
        "accounts.youtube.com",
        "appleid.apple.com",
    ];
    DOMAINS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
        || SIGN_IN_HOSTS.contains(&host)
}

/// A Console page past the sign-in: the session may be there.
fn signed_in_page(url: &Url) -> bool {
    url.host_str() == Some(CONSOLE_HOST)
        && !url.path().starts_with("/login")
        && !url.path().starts_with("/magic-link")
}

fn open_outside(url: &Url) {
    let _ = open::that_detached(url.as_str());
}

// ─── Commands ───────────────────────────────────────────────────────

/// What the page knows of the credits: never the key, the cookies or ids.
#[tauri::command(async)]
pub fn credits_state() -> CreditsView {
    CreditsView::of(stored(), api_key().is_some())
}

/// The « Comptes » menu opens: the balance read again (a minute apart at
/// most), then given back.
#[tauri::command(async)]
pub fn credits_refresh(app: AppHandle) -> CreditsView {
    CreditsView::of(refresh(&app, false), api_key().is_some())
}

/// Arkadia's own window on the Console's sign-in page, its profile kept for
/// the next reads. Once a Console page past the sign-in loads, the balance
/// is read, and the window closes when it worked.
#[tauri::command]
pub async fn credits_console_login(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let main = app
        .get_webview_window("main")
        .ok_or("fenêtre principale absente")?;
    let url: Url = LOGIN_URL.parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url))
        // Owned by main: it never outlives it, nor keeps the process up.
        .parent(&main)
        .map_err(|e| e.to_string())?
        .data_directory(session_dir())
        .user_agent(USER_AGENT)
        .title(LOGIN_TITLE)
        .inner_size(560.0, 780.0)
        .center()
        .on_navigation(|url| {
            let keep = stays_in_console(url);
            if !keep {
                open_outside(url);
            }
            keep
        })
        .on_new_window(|url, _features| {
            // Sign-in popups stay in WebView2; any other link opens outside.
            if stays_in_console(&url) {
                NewWindowResponse::Allow
            } else {
                open_outside(&url);
                NewWindowResponse::Deny
            }
        })
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished || !signed_in_page(payload.url()) {
                return;
            }
            let app = window.app_handle().clone();
            // Cookies are read off this thread (WebView2 deadlocks otherwise).
            std::thread::spawn(move || {
                if refresh(&app, true).console == Console::Connected {
                    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
                        let _ = window.close();
                    }
                }
            });
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_key_is_one_sk_ant_token() {
        assert_eq!(
            valid_key("sk-ant-abc123\r\n").as_deref(),
            Some("sk-ant-abc123")
        );
        assert_eq!(valid_key("\u{feff}sk-ant-x").as_deref(), Some("sk-ant-x"));
        assert_eq!(valid_key("sk-ant-"), None);
        assert_eq!(valid_key("sk-proj-abc"), None);
        assert_eq!(valid_key("sk-ant-a b"), None);
        assert_eq!(valid_key(""), None);
    }

    #[test]
    fn scrub_drops_an_inherited_key() {
        let mut cmd = Command::new("claude");
        scrub(&mut cmd);
        assert!(cmd.get_envs().any(|(k, v)| k == KEY_VAR && v.is_none()));
    }

    /// Shaped like the Console's answers of 13/11/2026, ids made up.
    #[test]
    fn the_console_answers_give_the_api_org_and_its_credits() {
        let orgs = json!([
            { "uuid": "11111111-2222-3333-4444-555555555555", "name": "Team",
              "capabilities": ["chat", "claude_pro"] },
            { "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
              "name": "ROTOLO’s Individual Org", "billing_type": "prepaid",
              "capabilities": ["api", "api_individual"] }
        ]);
        assert_eq!(
            parse_org(&orgs).as_deref(),
            Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        );
        assert_eq!(
            parse_org(&json!([{ "uuid": "../x", "capabilities": ["api"] }])),
            None
        );
        assert_eq!(parse_org(&json!({ "error": "x" })), None);

        let credits = json!({
            "amount": 145111,
            "tranches": [],
            "promo_tranches": [
                { "name": null, "remaining_amount_minor_units": 99413,
                  "granted_amount_minor_units": 100000,
                  "expires_at": "2027-04-08T00:00:00Z", "granted_at": "2026-10-10T00:00:00Z",
                  "program_id": "promo_x", "scope": { "kind": "unscoped", "applies_to": [] } },
                { "name": "API credit (Team)", "remaining_amount_minor_units": 45698,
                  "granted_amount_minor_units": 50000,
                  "expires_at": "2026-12-10T00:00:00Z", "granted_at": "2026-11-07T00:00:00Z",
                  "program_id": "subscription_api_credit",
                  "scope": { "kind": "scoped", "applies_to": ["api"] } },
                { "name": "Old", "remaining_amount_minor_units": 500,
                  "granted_amount_minor_units": 500, "expires_at": "2026-01-01T00:00:00Z" }
            ]
        });
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-13T12:00:00Z")
            .unwrap()
            .timestamp_millis();
        let (tranches, total) = parse_credits(&credits, now).unwrap();
        assert_eq!(total, Some(145111));
        assert_eq!(
            tranches,
            vec![
                Tranche {
                    kind: TrancheKind::Team,
                    remaining: 45698,
                    granted: 50000,
                    expires_at: Some(1_796_860_800_000),
                },
                Tranche {
                    kind: TrancheKind::Promo,
                    remaining: 99413,
                    granted: 100000,
                    expires_at: Some(1_807_142_400_000),
                },
            ]
        );
        // No total given: the credits' sum.
        let bare = json!({ "promo_tranches": [
            { "remaining_amount_minor_units": 120, "granted_amount_minor_units": 500 }
        ]});
        assert_eq!(parse_credits(&bare, now).unwrap().1, Some(120));
        assert!(parse_credits(&json!({ "detail": "x" }), now).is_none());
    }

    #[test]
    fn used_up_credits_say_so_only_when_read() {
        let read = |console, total| {
            CreditsView::of(
                Stored {
                    console,
                    total,
                    ..Default::default()
                },
                true,
            )
        };
        assert!(read(Console::Connected, Some(40)).exhausted);
        assert!(!read(Console::Connected, Some(45_698)).exhausted);
        assert!(!read(Console::Disconnected, Some(0)).exhausted);
        assert!(!read(Console::Connected, None).exhausted);
    }

    #[test]
    fn cookies_go_on_stdin_quoted_and_whole() {
        let header = cookie_header(&[
            ("sessionKeyLC".into(), "abc\"d".into()),
            ("bad".into(), "x;y".into()),
            ("lastActiveOrg".into(), "o-1".into()),
        ]);
        assert_eq!(header, "sessionKeyLC=abc\"d; lastActiveOrg=o-1");
        let config = curl_config("https://platform.claude.com/api/organizations", &header);
        assert!(config.contains("header = \"Cookie: sessionKeyLC=abc\\\"d; lastActiveOrg=o-1\"\n"));
        assert!(config.contains("write-out = \"\\n%{http_code}\"\n"));
        assert_eq!(
            split_status(b"{\"a\":1}\n200"),
            Some((200, &b"{\"a\":1}"[..]))
        );
        assert_eq!(split_status(b"\n401"), Some((401, &b""[..])));
        assert_eq!(split_status(b""), None);
    }

    #[test]
    fn the_sign_in_window_keeps_the_console_and_its_sign_in_pages() {
        let url = |s: &str| Url::parse(s).unwrap();
        assert!(stays_in_console(&url("https://platform.claude.com/login")));
        assert!(stays_in_console(&url(
            "https://accounts.google.com/o/oauth2"
        )));
        assert!(stays_in_console(&url("https://claude.ai/magic-link")));
        assert!(!stays_in_console(&url("https://example.com/")));
        assert!(!stays_in_console(&url("http://platform.claude.com/")));
        assert!(signed_in_page(&url(
            "https://platform.claude.com/dashboard"
        )));
        assert!(!signed_in_page(&url(
            "https://platform.claude.com/login?x=1"
        )));
        assert!(!signed_in_page(&url("https://claude.ai/new")));
    }
}
