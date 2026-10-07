//! Several Claude subscriptions side by side, one per pane.
//!
//! The main account is plain `~/.claude` (+ `~/.claude.json`) and is launched
//! WITHOUT `CLAUDE_CONFIG_DIR`: pointing the variable at `~/.claude` would make
//! Claude Code read `~/.claude/.claude.json` instead of `~/.claude.json`.
//! Every other account lives in `~/.claude-accounts/<id>/`, a config dir whose
//! entries are links back into `~/.claude` (skills, mods, settings, memory,
//! transcripts…) except the per-account ones listed in [`NOT_SHARED`]. Its
//! `.claude.json` cannot be linked (it holds the signed-in identity), so the
//! shareable parts — MCP servers, project trust, onboarding flags — are merged
//! both ways before each launch, as are the MCP OAuth logins of
//! `.credentials.json`.
//!
//! Usage (5-hour / weekly %) lands in `%LOCALAPPDATA%\Arkadia\usage\<id>.json`:
//! written live by the status-line script of a running session, otherwise
//! polled from the subscription usage endpoint every 30 min.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const MAIN_ID: &str = "main";
const MAX_ACCOUNTS: usize = 5;
/// Account colours. Green and amber already mean "idle" / "working" on the
/// agent badges, red is the close button: none of them here.
const PALETTE: [&str; 5] = ["#a78bfa", "#f472b6", "#22d3ee", "#818cf8", "#d4d4d8"];
/// Top-level entries of `~/.claude` that belong to one account or one process.
const NOT_SHARED: &[&str] = &[
    ".credentials.json",
    ".claude.json",
    "backups",
    "sessions",
    "session-env",
    "statsig",
    "stats-cache.json",
    "daemon",
    "daemon.lock",
    "daemon.log",
    "daemon.status.json",
    ".last-cleanup",
    ".last-update-result.json",
    // Per-account state of the status-line reset notifier.
    "claude-reset-last.txt",
    "claude-reset-notified.txt",
];
/// `.claude.json` preferences seeded into a new account so its first launch
/// skips the onboarding the user already went through.
const SEEDED_PREFS: &[&str] = &[
    "hasCompletedOnboarding",
    "lastOnboardingVersion",
    "installMethod",
    "autoUpdates",
    "autoUpdatesProtectedForNative",
    "verbose",
    "showSpinnerTree",
    "shiftEnterKeyBindingInstalled",
    "hasIdeOnboardingBeenShown",
    "claudeInChromeDefaultEnabled",
    "hasCompletedClaudeInChromeOnboarding",
    "remoteControlAtStartup",
    "prStatusFooterEnabled",
    "agentPushNotifEnabled",
    "effortCalloutDismissed",
    "effortCalloutV2Dismissed",
    "diffSidebarOpen",
    "workflowSizeGuideline",
];
const POLL_EVERY: Duration = Duration::from_secs(30 * 60);
/// Live data older than this no longer counts as live (the UI greys it).
const STALE_AFTER_MS: i64 = 40 * 60 * 1000;

/// Serialises every read-modify-write of the registry and of the shared files.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    /// Empty = derived from the signed-in plan (see `auto_label`).
    #[serde(default)]
    label: String,
    color: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    current: String,
    accounts: Vec<Account>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub pct: f64,
    /// Unix seconds (a float: the status line may send fractions).
    pub resets_at: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
    /// Unix milliseconds.
    pub updated_at: i64,
    /// "live" (status line of a running session) or "poll".
    #[serde(default)]
    pub source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    id: String,
    label: String,
    custom_label: bool,
    color: String,
    email: Option<String>,
    plan: Option<String>,
    logged_in: bool,
    usage: Option<Usage>,
    stale: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsState {
    current: String,
    max: usize,
    accounts: Vec<AccountView>,
}

// ─── Paths ──────────────────────────────────────────────────────────

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn main_root() -> PathBuf {
    home().join(".claude")
}

fn accounts_root() -> PathBuf {
    home().join(".claude-accounts")
}

fn arkadia_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
}

fn registry_path() -> PathBuf {
    arkadia_dir().join("accounts.json")
}

fn usage_path(id: &str) -> PathBuf {
    arkadia_dir().join("usage").join(format!("{id}.json"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 16 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Config dir of a secondary account (`None` for the main one).
fn secondary_dir(id: &str) -> Option<PathBuf> {
    (id != MAIN_ID && valid_id(id)).then(|| accounts_root().join(id))
}

fn config_root(id: &str) -> PathBuf {
    secondary_dir(id).unwrap_or_else(main_root)
}

fn global_json(id: &str) -> PathBuf {
    match secondary_dir(id) {
        Some(dir) => dir.join(".claude.json"),
        None => home().join(".claude.json"),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─── JSON files ─────────────────────────────────────────────────────

fn read_json(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()
}

/// tmp + rename, so a crash never leaves a torn file behind.
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("arkadia-tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// ─── Registry ───────────────────────────────────────────────────────

fn load_registry() -> Registry {
    let mut reg: Registry = fs::read_to_string(registry_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Registry {
            current: MAIN_ID.into(),
            accounts: Vec::new(),
        });
    reg.accounts.retain(|a| valid_id(&a.id));
    if !reg.accounts.iter().any(|a| a.id == MAIN_ID) {
        reg.accounts.insert(
            0,
            Account {
                id: MAIN_ID.into(),
                label: String::new(),
                color: PALETTE[0].into(),
            },
        );
    }
    if !reg.accounts.iter().any(|a| a.id == reg.current) {
        reg.current = MAIN_ID.into();
    }
    reg
}

fn save_registry(reg: &Registry) -> Result<(), String> {
    let value = serde_json::to_value(reg).map_err(|e| e.to_string())?;
    write_json(&registry_path(), &value)
}

// ─── Identity ───────────────────────────────────────────────────────

struct Identity {
    email: Option<String>,
    plan: Option<String>,
}

fn identity(id: &str) -> Option<Identity> {
    let json = read_json(&global_json(id))?;
    let acc = json.get("oauthAccount")?;
    let s = |k: &str| acc.get(k).and_then(Value::as_str).map(str::to_string);
    let org_type = s("organizationType").unwrap_or_default();
    let tier = s("organizationRateLimitTier").unwrap_or_default();
    let plan = if org_type.contains("team") || org_type.contains("enterprise") {
        let name = s("organizationName").unwrap_or_else(|| "Team".into());
        Some(name.trim_end_matches("'s Organization").to_string())
    } else if org_type.contains("max") {
        Some(if tier.contains("20x") { "Max 20x" } else { "Max 5x" }.into())
    } else if org_type.contains("pro") {
        Some("Pro".into())
    } else {
        None
    };
    Some(Identity {
        email: s("emailAddress"),
        plan,
    })
}

fn logged_in(id: &str) -> bool {
    read_json(&config_root(id).join(".credentials.json"))
        .and_then(|c| c.get("claudeAiOauth").cloned())
        .is_some()
}

// ─── Shared files ───────────────────────────────────────────────────

/// Creates a link in `dir` for every shareable entry of `~/.claude` it lacks.
/// Directories get junctions (no privilege needed), files get symlinks: a
/// hard link would be broken by Claude Code's write-then-rename.
fn ensure_links(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let Ok(entries) = fs::read_dir(main_root()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if NOT_SHARED.contains(&name_str.as_ref()) || name_str.ends_with(".arkadia-tmp") {
            continue;
        }
        let link = dir.join(&name);
        if fs::symlink_metadata(&link).is_ok() {
            continue;
        }
        let target = entry.path();
        let is_dir = fs::metadata(&target).map(|m| m.is_dir()).unwrap_or(false);
        let made = if is_dir {
            make_junction(&link, &target)
        } else {
            make_file_link(&link, &target)
        };
        if let Err(e) = made {
            eprintln!("[accounts] link {} failed: {e}", link.display());
        }
    }
}

#[cfg(windows)]
fn make_junction(link: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let status = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        // CREATE_NO_WINDOW: never flash a console over the app.
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| e.to_string())?;
    if status.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&status.stderr).trim().to_string())
    }
}

#[cfg(windows)]
fn make_file_link(link: &Path, target: &Path) -> Result<(), String> {
    std::os::windows::fs::symlink_file(target, link).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn make_junction(link: &Path, target: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn make_file_link(link: &Path, target: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link).map_err(|e| e.to_string())
}

fn object_at<'a>(root: &'a mut Value, key: &str) -> Option<&'a mut Map<String, Value>> {
    let obj = root.as_object_mut()?;
    obj.entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
}

fn map_at(root: &Value, key: &str) -> Map<String, Value> {
    root.get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

/// Reads a file that may legitimately be absent: `Ok(None)` when it does not
/// exist, `Err` when it exists but cannot be read or parsed — the caller must
/// then leave it alone rather than rebuild it from scratch, which would drop
/// the account's login.
fn read_existing(path: &Path) -> Result<Option<Value>, ()> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(raw.trim_start_matches('\u{feff}'))
            .map(Some)
            .map_err(|_| ()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(()),
    }
}

/// Three-way merge of one map against the state both sides had after the last
/// sync (`base`): the side that added, edited or removed a key since wins over
/// the side that did not touch it; when both changed it, main wins.
fn merge3(
    main: &Map<String, Value>,
    acc: &Map<String, Value>,
    base: &Map<String, Value>,
) -> Map<String, Value> {
    let keys: std::collections::BTreeSet<&String> =
        main.keys().chain(acc.keys()).chain(base.keys()).collect();
    let mut out = Map::new();
    for k in keys {
        let (m, a, b) = (main.get(k), acc.get(k), base.get(k));
        let pick = if m == a || a == b {
            m
        } else if m == b {
            a
        } else {
            m.or(a)
        };
        if let Some(v) = pick {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

fn set_servers(target: &mut Value, merged: &Map<String, Value>) -> bool {
    match object_at(target, "mcpServers") {
        Some(slot) if slot != merged => {
            *slot = merged.clone();
            true
        }
        _ => false,
    }
}

/// Adds the projects (trust, allowed tools, project MCP servers) the other
/// side knows and this one does not. Never removes anything.
fn add_projects_from(target: &mut Value, other: &Map<String, Value>) -> bool {
    let Some(projects) = object_at(target, "projects") else {
        return false;
    };
    let mut changed = false;
    for (path, op) in other {
        match projects.get_mut(path) {
            None => {
                projects.insert(path.clone(), op.clone());
                changed = true;
            }
            Some(tp) => {
                let Some(other_servers) = op.get("mcpServers").and_then(Value::as_object) else {
                    continue;
                };
                let Some(servers) = object_at(tp, "mcpServers") else {
                    continue;
                };
                for (k, v) in other_servers {
                    if !servers.contains_key(k) {
                        servers.insert(k.clone(), v.clone());
                        changed = true;
                    }
                }
            }
        }
    }
    changed
}

/// Onboarding preferences the user already went through, so a new account's
/// first launch skips them.
fn seed_prefs(target: &mut Value, main: &Value) -> bool {
    let (Some(m), Some(t)) = (main.as_object(), target.as_object_mut()) else {
        return false;
    };
    let mut changed = false;
    for key in SEEDED_PREFS {
        if let (Some(v), false) = (m.get(*key), t.contains_key(*key)) {
            t.insert((*key).to_string(), v.clone());
            changed = true;
        }
    }
    changed
}

/// Copies into `target` the MCP OAuth logins it lacks. Existing entries are
/// never overwritten (no reliable way to tell which copy is newer) and the
/// subscription login (`claudeAiOauth`) is never touched.
fn add_mcp_logins_from(target: &mut Value, source: &Value) -> bool {
    let logins = map_at(source, "mcpOAuth");
    let Some(slot) = object_at(target, "mcpOAuth") else {
        return false;
    };
    let mut changed = false;
    for (k, v) in logins {
        if !slot.contains_key(&k) {
            slot.insert(k, v);
            changed = true;
        }
    }
    changed
}

/// `.claude.json` of a secondary account against `~/.claude.json`. MCP servers
/// go both ways with deletions (three-way merge against the last synced
/// state), projects are only ever added, prefs only seed the secondary. Each
/// file is re-read right before it is written.
fn sync_global(dir: &Path) {
    let main_path = home().join(".claude.json");
    let acc_path = dir.join(".claude.json");
    let base_path = dir.join(".arkadia-sync.json");
    let Some(main) = read_json(&main_path) else {
        return;
    };
    let Ok(acc) = read_existing(&acc_path) else {
        return;
    };
    let acc = acc.unwrap_or_else(|| Value::Object(Map::new()));
    let base = read_json(&base_path)
        .map(|b| map_at(&b, "mcpServers"))
        .unwrap_or_default();
    let merged = merge3(
        &map_at(&main, "mcpServers"),
        &map_at(&acc, "mcpServers"),
        &base,
    );
    let (main_projects, acc_projects) = (map_at(&main, "projects"), map_at(&acc, "projects"));

    if let Some(mut fresh) = read_json(&main_path) {
        if set_servers(&mut fresh, &merged) | add_projects_from(&mut fresh, &acc_projects) {
            let _ = write_json(&main_path, &fresh);
        }
    }
    if let Ok(fresh) = read_existing(&acc_path) {
        let mut fresh = fresh.unwrap_or_else(|| Value::Object(Map::new()));
        if set_servers(&mut fresh, &merged)
            | add_projects_from(&mut fresh, &main_projects)
            | seed_prefs(&mut fresh, &main)
        {
            let _ = write_json(&acc_path, &fresh);
        }
    }
    // The base is what BOTH files hold now, so a write lost to a concurrent
    // Claude Code save is never mistaken for a deletion next time.
    let now_main = read_json(&main_path)
        .map(|v| map_at(&v, "mcpServers"))
        .unwrap_or_default();
    let now_acc = read_json(&acc_path)
        .map(|v| map_at(&v, "mcpServers"))
        .unwrap_or_default();
    let agreed: Map<String, Value> = now_main
        .into_iter()
        .filter(|(k, v)| now_acc.get(k) == Some(v))
        .collect();
    let _ = write_json(&base_path, &serde_json::json!({ "mcpServers": agreed }));
}

/// MCP logins flow one way only, main → secondary: `~/.claude/.credentials.json`
/// holds the main subscription's single-use refresh token, and a write racing
/// a running Claude Code's refresh would sign it out. It is never written here.
fn sync_mcp_logins(dir: &Path) {
    let acc_creds = dir.join(".credentials.json");
    let Some(main) = read_json(&main_root().join(".credentials.json")) else {
        return;
    };
    // Not signed in yet (nothing to add to) or unreadable (left alone).
    let Ok(Some(acc)) = read_existing(&acc_creds) else {
        return;
    };
    if add_mcp_logins_from(&mut acc.clone(), &main) {
        if let Ok(Some(mut fresh)) = read_existing(&acc_creds) {
            if add_mcp_logins_from(&mut fresh, &main) {
                let _ = write_json(&acc_creds, &fresh);
            }
        }
    }
}

/// Brings a secondary account's per-account files in line with the main ones.
fn sync_account(id: &str) {
    let Some(dir) = secondary_dir(id) else { return };
    ensure_links(&dir);
    sync_global(&dir);
    sync_mcp_logins(&dir);
}

/// Config dir to hand a new pane (`CLAUDE_CONFIG_DIR`), after refreshing its
/// shared files. `None` = main account, launched without the variable. An
/// unknown id (account removed since) falls back to the main account.
pub fn prepare_launch(account_id: Option<&str>) -> Option<PathBuf> {
    let id = account_id.unwrap_or(MAIN_ID);
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !load_registry().accounts.iter().any(|a| a.id == id) {
        return None;
    }
    let dir = secondary_dir(id)?;
    sync_account(id);
    Some(dir)
}

/// Config dir of the account currently selected for new tabs.
pub fn current_launch_dir() -> Option<PathBuf> {
    let current = {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        load_registry().current
    };
    prepare_launch(Some(&current))
}

// ─── Usage ──────────────────────────────────────────────────────────

fn read_usage(id: &str) -> Option<Usage> {
    let mut usage: Usage = serde_json::from_value(read_json(&usage_path(id))?).ok()?;
    // A window whose reset has passed is back to zero.
    let now_s = (now_ms() / 1000) as f64;
    for w in [&mut usage.five_hour, &mut usage.seven_day].into_iter().flatten() {
        if w.resets_at.is_some_and(|r| r <= now_s) {
            w.pct = 0.0;
            w.resets_at = None;
        }
    }
    Some(usage)
}

fn parse_window(v: Option<&Value>) -> Option<UsageWindow> {
    let v = v?;
    let pct = v.get("utilization").and_then(Value::as_f64)?;
    let resets_at = v
        .get("resets_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp() as f64);
    Some(UsageWindow { pct, resets_at })
}

/// One call to the subscription usage endpoint, with the account's current
/// access token. Never refreshes the token: the refresh token is single-use,
/// and spending it here would sign out the running Claude Code.
fn poll_usage(id: &str) -> Option<Usage> {
    let creds = read_json(&config_root(id).join(".credentials.json"))?;
    let oauth = creds.get("claudeAiOauth")?;
    let token = oauth.get("accessToken").and_then(Value::as_str)?;
    if oauth.get("expiresAt").and_then(Value::as_i64).unwrap_or(0) <= now_ms() {
        return None;
    }
    let mut cmd = Command::new("curl.exe");
    cmd.args(["-s", "-m", "15", "https://api.anthropic.com/api/oauth/usage"])
        .args(["-H", &format!("Authorization: Bearer {token}")])
        .args(["-H", "anthropic-beta: oauth-2025-04-20"])
        .args(["-H", "anthropic-version: 2023-06-01"])
        .args(["-H", "User-Agent: claude-code/2.1.292"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    let body: Value = serde_json::from_slice(&out.stdout).ok()?;
    let five_hour = parse_window(body.get("five_hour"));
    let seven_day = parse_window(body.get("seven_day"));
    if five_hour.is_none() && seven_day.is_none() {
        return None;
    }
    Some(Usage {
        five_hour,
        seven_day,
        updated_at: now_ms(),
        source: "poll".into(),
    })
}

/// Background loop: every account whose usage is older than 30 min (no live
/// session reporting it) gets one poll, at most once per 30 min per account.
pub fn spawn_usage_poller() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(15));
        let mut last_attempt: HashMap<String, i64> = HashMap::new();
        loop {
            let ids: Vec<String> = {
                let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
                load_registry().accounts.into_iter().map(|a| a.id).collect()
            };
            let now = now_ms();
            let every = POLL_EVERY.as_millis() as i64;
            for id in ids {
                let fresh = read_json(&usage_path(&id))
                    .and_then(|v| serde_json::from_value::<Usage>(v).ok())
                    .is_some_and(|u| now - u.updated_at < every);
                let tried = last_attempt.get(&id).is_some_and(|t| now - t < every);
                if fresh || tried {
                    continue;
                }
                last_attempt.insert(id.clone(), now);
                if let Some(usage) = poll_usage(&id) {
                    if let Ok(value) = serde_json::to_value(&usage) {
                        let _ = write_json(&usage_path(&id), &value);
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(60));
        }
    });
}

// ─── Commands ───────────────────────────────────────────────────────

fn auto_label(id: &str, ident: Option<&Identity>) -> String {
    match ident.and_then(|i| i.plan.clone()) {
        Some(plan) => plan,
        None if id == MAIN_ID => "Principal".into(),
        None => "Non connecté".into(),
    }
}

#[tauri::command]
pub fn accounts_state() -> AccountsState {
    let reg = {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        load_registry()
    };
    let now = now_ms();
    let accounts = reg
        .accounts
        .iter()
        .map(|a| {
            let ident = identity(&a.id);
            let usage = read_usage(&a.id);
            let stale = usage
                .as_ref()
                .is_none_or(|u| now - u.updated_at > STALE_AFTER_MS);
            AccountView {
                id: a.id.clone(),
                label: if a.label.is_empty() {
                    auto_label(&a.id, ident.as_ref())
                } else {
                    a.label.clone()
                },
                custom_label: !a.label.is_empty(),
                color: a.color.clone(),
                email: ident.as_ref().and_then(|i| i.email.clone()),
                plan: ident.as_ref().and_then(|i| i.plan.clone()),
                logged_in: logged_in(&a.id),
                usage,
                stale,
            }
        })
        .collect();
    AccountsState {
        current: reg.current,
        max: MAX_ACCOUNTS,
        accounts,
    }
}

/// Registers a new account and prepares its config dir. It does NOT become
/// current: the UI does that once the login tab is actually open, so an
/// aborted add never leaves new tabs on a signed-out account. Async so the
/// first sync (one `mklink` per shared folder) runs off the main thread.
#[tauri::command]
pub async fn account_add() -> Result<String, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry();
    if reg.accounts.len() >= MAX_ACCOUNTS {
        return Err(format!("{MAX_ACCOUNTS} comptes au maximum"));
    }
    let id: String = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    let color = PALETTE
        .iter()
        .find(|c| !reg.accounts.iter().any(|a| a.color == **c))
        .unwrap_or(&PALETTE[0])
        .to_string();
    reg.accounts.push(Account {
        id: id.clone(),
        label: String::new(),
        color,
    });
    sync_account(&id);
    save_registry(&reg)?;
    Ok(id)
}

/// Forgets an account. Its config dir is renamed aside, never deleted: it is
/// full of junctions into `~/.claude`, and a recursive delete that followed
/// one would wipe the shared data.
#[tauri::command]
pub async fn account_remove(id: String) -> Result<(), String> {
    if id == MAIN_ID {
        return Err("le compte principal ne se retire pas".into());
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry();
    reg.accounts.retain(|a| a.id != id);
    if reg.current == id {
        reg.current = MAIN_ID.into();
    }
    save_registry(&reg)?;
    if let Some(dir) = secondary_dir(&id) {
        if dir.exists() {
            let aside = accounts_root().join(format!("{id}.removed-{}", now_ms()));
            let _ = fs::rename(&dir, aside);
        }
    }
    let _ = fs::remove_file(usage_path(&id));
    Ok(())
}

#[tauri::command]
pub fn account_update(
    id: String,
    label: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry();
    let acc = reg
        .accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("compte inconnu")?;
    if let Some(label) = label {
        acc.label = label.trim().chars().take(24).collect();
    }
    if let Some(color) = color {
        if PALETTE.contains(&color.as_str()) {
            acc.color = color;
        }
    }
    save_registry(&reg)
}

#[tauri::command]
pub fn account_set_current(id: String) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry();
    if !reg.accounts.iter().any(|a| a.id == id) {
        return Err("compte inconnu".into());
    }
    reg.current = id;
    save_registry(&reg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn m(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn merge3_keeps_additions_from_both_sides_on_first_sync() {
        let out = merge3(&m(json!({"exa": 1})), &m(json!({"stripe": 2})), &Map::new());
        assert_eq!(Value::Object(out), json!({"exa": 1, "stripe": 2}));
    }

    #[test]
    fn merge3_propagates_a_deletion_and_an_edit() {
        let base = m(json!({"exa": 1, "stripe": 2}));
        // exa removed on main, stripe edited on the secondary.
        let out = merge3(&m(json!({"stripe": 2})), &m(json!({"exa": 1, "stripe": 3})), &base);
        assert_eq!(Value::Object(out), json!({"stripe": 3}));
    }

    #[test]
    fn merge3_lets_main_win_a_conflict() {
        let base = m(json!({"exa": 1}));
        let out = merge3(&m(json!({"exa": 2})), &m(json!({"exa": 3})), &base);
        assert_eq!(Value::Object(out), json!({"exa": 2}));
    }

    #[test]
    fn mcp_logins_only_fill_gaps_and_never_touch_the_subscription() {
        let main = json!({
            "claudeAiOauth": {"accessToken": "main"},
            "mcpOAuth": {"cf": {"accessToken": "new"}, "only-main": {}}
        });
        let mut acc = json!({
            "claudeAiOauth": {"accessToken": "acc"},
            "mcpOAuth": {"cf": {"accessToken": "old"}}
        });
        assert!(add_mcp_logins_from(&mut acc, &main));
        assert_eq!(acc["mcpOAuth"]["cf"]["accessToken"], "old");
        assert!(acc["mcpOAuth"].get("only-main").is_some());
        assert_eq!(acc["claudeAiOauth"]["accessToken"], "acc");
        assert!(!add_mcp_logins_from(&mut acc, &main));
    }

    #[test]
    fn projects_and_prefs_are_added_never_removed() {
        let main = json!({
            "projects": {"C:/p": {"hasTrustDialogAccepted": true}},
            "hasCompletedOnboarding": true,
            "oauthAccount": {"emailAddress": "a@x"}
        });
        let mut acc = json!({
            "projects": {"C:/q": {}},
            "oauthAccount": {"emailAddress": "b@x"}
        });
        assert!(add_projects_from(&mut acc, &map_at(&main, "projects")));
        assert!(seed_prefs(&mut acc, &main));
        assert!(acc["projects"].get("C:/q").is_some());
        assert_eq!(acc["projects"]["C:/p"]["hasTrustDialogAccepted"], true);
        assert_eq!(acc["hasCompletedOnboarding"], true);
        assert_eq!(acc["oauthAccount"]["emailAddress"], "b@x");
    }
}
