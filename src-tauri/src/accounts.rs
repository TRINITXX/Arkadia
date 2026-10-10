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
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
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
    adopt_sessions_dir(dir);
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

/// `sessions` (the registry of running sessions, one `<pid>` file each) used to
/// be per-account, which hid each account's sessions from the others' peer
/// messaging. A real folder left by that era is merged into the main one and
/// removed, so that [`ensure_links`] can replace it with a junction.
fn adopt_sessions_dir(dir: &Path) {
    let own = dir.join("sessions");
    let Ok(meta) = fs::symlink_metadata(&own) else {
        return;
    };
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return;
    }
    let shared = main_root().join("sessions");
    let _ = fs::create_dir_all(&shared);
    if let Ok(entries) = fs::read_dir(&own) {
        for entry in entries.flatten() {
            let to = shared.join(entry.file_name());
            if !to.exists() && fs::rename(entry.path(), &to).is_err() {
                let _ = fs::copy(entry.path(), &to);
            }
        }
    }
    if let Err(e) = fs::remove_dir_all(&own) {
        eprintln!("[accounts] adopt {} failed: {e}", own.display());
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

// ─── Memory folder ──────────────────────────────────────────────────

/// Longest project folder name Claude Code uses as is; past it, it appends a
/// hash this code does not reproduce.
const MAX_SLUG: usize = 200;

/// Claude Code's folder name for a project under `projects/`: every UTF-16
/// unit that is not an ASCII letter or digit becomes `-`.
fn project_slug(root: &str) -> Option<String> {
    let slug: String = root
        .encode_utf16()
        .map(|u| match u {
            0x30..=0x39 | 0x41..=0x5a | 0x61..=0x7a => char::from(u as u8),
            _ => '-',
        })
        .collect();
    (slug.len() <= MAX_SLUG).then_some(slug)
}

/// `fs::canonicalize` without Windows' `\\?\` prefix: the spelling Node's
/// `realpath` hands Claude Code.
fn real_path(p: &Path) -> Option<PathBuf> {
    let canon = fs::canonicalize(p).ok()?;
    let s = canon.to_string_lossy();
    Some(match s.strip_prefix(r"\\?\UNC\") {
        Some(rest) => PathBuf::from(format!(r"\\{rest}")),
        None => PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s)),
    })
}

/// Main working tree of the linked worktree whose `.git` file sits in `root`
/// (the shared git folder itself for a bare repo), checked the way Claude
/// Code checks it. `None` for a plain repo or a submodule.
fn linked_worktree_main(root: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(root.join(".git")).ok()?;
    let gitdir = text.trim().strip_prefix("gitdir:")?.trim();
    let gitdir = std::path::absolute(root.join(gitdir)).ok()?;
    let common = fs::read_to_string(gitdir.join("commondir")).ok()?;
    let common = std::path::absolute(gitdir.join(common.trim())).ok()?;
    if gitdir.parent()? != common.join("worktrees") {
        return None;
    }
    let back = fs::read_to_string(gitdir.join("gitdir")).ok()?;
    if real_path(&gitdir.join(back.trim()))? != real_path(root)?.join(".git") {
        return None;
    }
    if common.file_name()? != ".git" {
        return (!common.join(".git").exists()).then_some(common);
    }
    common.parent().map(Path::to_path_buf)
}

/// Folder Claude Code keys a project's memory by, and whether it is a git
/// repo: the nearest folder up from `start` holding a `.git`, a linked
/// worktree standing for its main one; else `start`. Claude Code reads these
/// files rather than asking git, so this does too. `None` when a `.git` is a
/// link, which Claude Code leaves undecided.
fn memory_root(start: &Path) -> Option<(PathBuf, bool)> {
    let mut dir = start;
    loop {
        if let Ok(meta) = fs::symlink_metadata(dir.join(".git")) {
            if meta.file_type().is_symlink() {
                return None;
            }
            let root = linked_worktree_main(dir).unwrap_or_else(|| dir.to_path_buf());
            return Some((root, true));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return Some((start.to_path_buf(), false)),
        }
    }
}

/// A value [`pin_memory_dir`] wrote: `~/.claude/projects/<folder>/memory`.
fn is_pinned(value: &str) -> bool {
    value
        .strip_prefix("~/.claude/projects/")
        .and_then(|rest| rest.strip_suffix("/memory"))
        .is_some_and(|name| {
            !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// Points a project's local settings at `dir`. A value pinned here before
/// follows the folder when it is copied or moved; one the user chose stays.
fn with_memory_dir(settings: &mut Value, dir: &str) -> bool {
    let Some(obj) = settings.as_object_mut() else {
        return false;
    };
    match obj.get("autoMemoryDirectory") {
        None => {}
        Some(Value::String(cur)) if cur != dir && is_pinned(cur) => {}
        Some(_) => return false,
    }
    obj.insert("autoMemoryDirectory".into(), Value::String(dir.into()));
    true
}

/// `git -C <cwd> <args>` without a console window. `None` = git missing.
fn git_in(cwd: &Path, args: &[&str]) -> Option<std::process::Output> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);
    // Inherited, these would make git answer for another repo.
    for var in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CEILING_DIRECTORIES"] {
        cmd.env_remove(var);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output().ok()
}

/// A secondary account reaches the memory folder through its `projects`
/// junction. Claude Code resolves it, lands in `~/.claude` (a folder it always
/// protects, ahead of any allow rule) and asks before every memory write.
/// Pointing `autoMemoryDirectory` at the real folder, in the project's local
/// settings, removes the detour. Never touches a file git would show. The
/// home folder is no exception: Claude Code's user settings are
/// `settings.json` only, so `~/.claude/settings.local.json` is just the home
/// project's local file.
pub fn pin_memory_dir(cwd: &Path) {
    let Some(start) = real_path(cwd) else {
        return;
    };
    let Some((root, in_repo)) = memory_root(&start) else {
        return;
    };
    let Some(slug) = project_slug(&root.to_string_lossy()) else {
        return;
    };
    let path = start.join(".claude").join("settings.local.json");
    let Ok(existing) = read_existing(&path) else {
        return;
    };
    let mut settings = existing.unwrap_or_else(|| Value::Object(Map::new()));
    if !with_memory_dir(&mut settings, &format!("~/.claude/projects/{slug}/memory")) {
        return;
    }
    if in_repo
        && !git_in(&start, &["check-ignore", "-q", ".claude/settings.local.json"])
            .is_some_and(|o| o.status.success())
    {
        return;
    }
    let _ = write_json(&path, &settings);
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

    #[test]
    fn project_slug_matches_claude_code_folder_names() {
        assert_eq!(
            project_slug(r"C:\Users\TRINITX\Desktop\Claude Desktop\Assets IA").as_deref(),
            Some("C--Users-TRINITX-Desktop-Claude-Desktop-Assets-IA")
        );
        // One dash per UTF-16 unit: two for an emoji.
        assert_eq!(project_slug("C:/Données/😀").as_deref(), Some("C--Donn-es---"));
        assert_eq!(project_slug(&"a".repeat(201)), None);
    }

    /// A linked worktree: `<meta>` is its folder under the shared git folder.
    fn fake_worktree(tree: &Path, meta: &Path) {
        fs::create_dir_all(meta).unwrap();
        fs::create_dir_all(tree.join("sub")).unwrap();
        fs::write(meta.join("commondir"), "../..\n").unwrap();
        let back = format!("{}\n", tree.join(".git").display());
        fs::write(meta.join("gitdir"), back).unwrap();
        fs::write(tree.join(".git"), format!("gitdir: {}\n", meta.display())).unwrap();
    }

    #[test]
    fn linked_worktrees_share_the_main_repo_memory() {
        let tmp = std::env::temp_dir().join(format!("arkadia-memroot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let app_git = tmp.join("app").join(".git");
        fake_worktree(&tmp.join("app-feat"), &app_git.join("worktrees").join("feat"));
        let bare = tmp.join("proj").join(".bare");
        fake_worktree(&tmp.join("proj").join("main"), &bare.join("worktrees").join("main"));

        let from_sub = memory_root(&tmp.join("app-feat").join("sub"));
        assert_eq!(from_sub, Some((tmp.join("app"), true)));
        // Bare repo: the shared git folder itself, as Claude Code keys it.
        assert_eq!(memory_root(&tmp.join("proj").join("main")), Some((bare, true)));
        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn a_pinned_memory_dir_follows_the_folder_but_a_user_choice_stays() {
        let (a, b) = ("~/.claude/projects/C--a/memory", "~/.claude/projects/C--b/memory");
        let mut s = json!({"enabledMcpjsonServers": ["blender"]});
        assert!(with_memory_dir(&mut s, a));
        assert!(!with_memory_dir(&mut s, a));
        assert!(with_memory_dir(&mut s, b));
        assert_eq!(s["autoMemoryDirectory"], b);
        assert_eq!(s["enabledMcpjsonServers"][0], "blender");
        let mut own = json!({"autoMemoryDirectory": "D:/notes"});
        assert!(!with_memory_dir(&mut own, b));
        assert_eq!(own["autoMemoryDirectory"], "D:/notes");
    }
}
