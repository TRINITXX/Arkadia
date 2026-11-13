//! The chat view's link to Claude Code. A Node process per Claude account
//! runs the repo's `chat-server/server.ts` (the Agent SDK, no terminal), and
//! this module relays: commands in through `chat_command`, each line the
//! server prints out as a `chat-event`. The conversations live in that
//! process, so a page that reloads starts its chats again and gets their
//! events back while Claude goes on working.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Once};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::remote::RemoteHub;

use crate::popup::log_line;

/// Arkadia runs from its repo's build folder: the server sits beside it.
const SERVER_SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../chat-server/server.ts");

/// After the first chat server: the chats restored at launch start first.
const UPDATE_DELAY: Duration = Duration::from_secs(120);
/// Then once a day while Arkadia runs.
const UPDATE_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// A `claude update` still running past this is stopped: a version weighs
/// some 335 MB, so a slow line needs time.
const UPDATE_TIMEOUT: Duration = Duration::from_secs(20 * 60);
static UPDATER: Once = Once::new();

/// Claude Code updates itself while a terminal runs it; its docs don't say it
/// does when only the Agent SDK runs it. So the chats run `claude update`
/// themselves: two minutes after the first server, then once a day (Alexis,
/// 31/10/2026). A new version takes effect at the next chat. Hidden, its
/// outcome in the log.
fn keep_claude_current() {
    UPDATER.call_once(|| {
        std::thread::spawn(|| {
            std::thread::sleep(UPDATE_DELAY);
            loop {
                run_claude_update();
                std::thread::sleep(UPDATE_EVERY);
            }
        });
    });
}

fn run_claude_update() {
    let Some(bin) = crate::ai_search::claude_binary() else {
        log_line("claude update: claude binary not found");
        return;
    };
    let mut cmd = Command::new(bin);
    cmd.arg("update")
        // The main account's config: the binary is the same for all.
        .env_remove("CLAUDE_CONFIG_DIR")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console over the app.
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            log_line(&format!("claude update: {e}"));
            return;
        }
    };
    // Read on their own threads: a full pipe would stall the update.
    let drain = |pipe: Option<Box<dyn std::io::Read + Send>>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut bytes);
            }
            String::from_utf8_lossy(&bytes).into_owned()
        })
    };
    let out = drain(child.stdout.take().map(|p| Box::new(p) as _));
    let err = drain(child.stderr.take().map(|p| Box::new(p) as _));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.to_string(),
            Ok(None) if started.elapsed() > UPDATE_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                // A child of claude may still hold the pipes: no wait on them.
                log_line("claude update: stopped after 20 min");
                return;
            }
            Ok(None) => std::thread::sleep(Duration::from_secs(1)),
            Err(e) => break e.to_string(),
        }
    };
    let text = format!(
        "{} {}",
        out.join().unwrap_or_default(),
        err.join().unwrap_or_default()
    );
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    log_line(&format!(
        "claude update ({status}): {}",
        crate::sessions::truncate_for_ui(&text, 300)
    ));
}

struct Server {
    stdin: ChildStdin,
    child: Child,
}

/// One chat server per Claude account (`main` for the main one).
#[derive(Default, Clone)]
pub struct ChatServers(Arc<Mutex<HashMap<String, Server>>>);

fn account_key(account_id: Option<&str>) -> String {
    account_id.unwrap_or("main").to_string()
}

/// Set for a chat's Claude Code: `arkadia-notify.ps1` then writes nothing (no
/// signal, no pane map). The page notifies from the chat's own state
/// (`useChatNotify`) and rings its badge from it.
pub const CHAT_MARKER: &str = "ARKADIA_CHAT";

/// What a chat's Claude Code and its hooks get from Arkadia, as a pane's
/// shell does (`terminal::spawn_terminal`): the pane id the hooks report,
/// the chat marker, and the Lab's marker, or the artifact inbox's `BROWSER`
/// in the daily app.
fn chat_env(chat_id: &str) -> Value {
    let mut env = serde_json::Map::new();
    env.insert("ARKADIA_PANE_ID".into(), json!(chat_id));
    env.insert(CHAT_MARKER.into(), json!("1"));
    if crate::lab::LAB {
        env.insert(crate::lab::PANE_MARKER.into(), json!("1"));
    } else if let Some(browser) = crate::artifact_inbox::browser_command() {
        env.insert("BROWSER".into(), json!(browser));
    }
    Value::Object(env)
}

/// A start carries the chat's variables; other commands go as they are.
fn with_chat_env(mut command: Value) -> Value {
    if command["type"] == "start" {
        if let Some(chat_id) = command["chatId"].as_str().map(str::to_string) {
            command["env"] = chat_env(&chat_id);
        }
    }
    command
}

/// What a chat server's Claude Code pays with.
enum Launch {
    /// A subscription: a secondary account's `CLAUDE_CONFIG_DIR`, none for
    /// the main one (rule of `accounts`).
    Subscription(Option<PathBuf>),
    /// The API credits (`credits::ACCOUNT`): the main config dir, so its
    /// sessions are the others', and the key, which Claude Code then takes
    /// over the claude.ai sign-in.
    Credits(String),
}

/// The credits' server alone gets the key; a subscription account never
/// does, a key on disk or not. Read here, at the server's start only.
fn launch_for(
    account: &str,
    key: impl FnOnce() -> Option<String>,
    config_dir: impl FnOnce() -> Option<PathBuf>,
) -> Result<Launch, String> {
    if account == crate::credits::ACCOUNT {
        return key()
            .map(Launch::Credits)
            .ok_or_else(|| "clé API des crédits absente ou invalide".to_string());
    }
    Ok(Launch::Subscription(config_dir()))
}

/// The server's process: its account key, and the env of its [`Launch`].
fn server_command(account: &str, launch: &Launch) -> Command {
    let mut cmd = Command::new("node");
    cmd.arg(SERVER_SCRIPT)
        // Its own account key: a visual's check names it, so a reloaded page
        // sends its report back here (`chatCommandFor`).
        .env("ARKADIA_CHAT_ACCOUNT", account)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match launch {
        Launch::Subscription(dir) => {
            match dir {
                Some(dir) => cmd.env("CLAUDE_CONFIG_DIR", dir),
                None => cmd.env_remove("CLAUDE_CONFIG_DIR"),
            };
            crate::credits::scrub(&mut cmd);
        }
        Launch::Credits(key) => {
            cmd.env_remove("CLAUDE_CONFIG_DIR")
                // A token would win over the key.
                .env_remove("ANTHROPIC_AUTH_TOKEN")
                .env(crate::credits::KEY_VAR, key)
                // Subagents ask for `opus`, or `fable`: Opus 5.5 there too.
                .env(crate::credits::OPUS_ALIAS_VAR, crate::credits::MODEL)
                .env(crate::credits::FABLE_ALIAS_VAR, crate::credits::MODEL);
        }
    }
    cmd
}

/// Starts the account's server.
fn spawn_server(app: &AppHandle, account_id: Option<&str>) -> Result<Server, String> {
    keep_claude_current();
    let account = account_key(account_id);
    let launch = launch_for(&account, crate::credits::api_key, || {
        crate::accounts::prepare_launch(account_id)
    })?;
    let mut cmd = server_command(&account, &launch);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console over the app.
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Node introuvable pour le chat : {e}"))?;
    let stdin = child.stdin.take().ok_or("chat : pas d'entrée")?;
    let stdout = child.stdout.take().ok_or("chat : pas de sortie")?;
    let stderr = child.stderr.take().ok_or("chat : pas de sortie d'erreur")?;

    let out_app = app.clone();
    let out_account = account.clone();
    std::thread::spawn(move || {
        // The phones showing a chat get its events too; a line addressed to
        // one phone (its replay, its own reads) never reaches the page.
        let hub = out_app.state::<Arc<RemoteHub>>().inner().clone();
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if hub.chat_line(&line) {
                let _ = out_app.emit("chat-event", line);
            }
        }
        let exit = json!({ "type": "server_exit", "account": out_account }).to_string();
        hub.chat_server_exit(&exit);
        let _ = out_app.emit("chat-event", exit);
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            log_line(&format!("[chat {account}] {line}"));
        }
    });
    Ok(Server { stdin, child })
}

impl ChatServers {
    /// Ends the chat of a pane that closes, whatever its account: every
    /// server running gets the close (one with no such chat ignores it).
    /// On its own thread: `close_terminal` runs on the main thread, and the
    /// lock may be held a while (a server starting, a large message sent).
    pub fn close_chat(&self, chat_id: &str) {
        let line = format!("{}\n", json!({ "type": "close", "chatId": chat_id }));
        let servers = self.clone();
        std::thread::spawn(move || {
            for server in servers.0.lock().values_mut() {
                let _ = server.stdin.write_all(line.as_bytes());
                let _ = server.stdin.flush();
            }
        });
    }
}

/// The page's words for a chat whose server is gone (`SERVER_GONE`): a
/// phone's catch-up of such a chat gets them, and shows it ended.
const SERVER_GONE: &str = "Le serveur du chat s'est arrêté";

/// Whether a command may start its account's server. A phone's catch-up
/// (`phone_replay`) never does: no server, no chat to replay, and starting
/// one that dies at once would loop with the phone's next catch-up.
fn starts_server(command: &Value) -> bool {
    command["type"] != "phone_replay"
}

/// Sends one command to the chat server of `account_id`, started on first
/// use and again if it ended.
// Off the main thread: it may start a process and sync an account's files.
#[tauri::command(async)]
pub fn chat_command(
    account_id: Option<String>,
    command: Value,
    servers: State<'_, ChatServers>,
    app: AppHandle,
) -> Result<(), String> {
    let starts = starts_server(&command);
    let mut line = serde_json::to_string(&with_chat_env(command)).map_err(|e| e.to_string())?;
    line.push('\n');
    let key = account_key(account_id.as_deref());
    let mut map = servers.0.lock();
    let alive = map
        .get_mut(&key)
        .is_some_and(|s| matches!(s.child.try_wait(), Ok(None)));
    if !alive {
        if !starts {
            return Err(SERVER_GONE.into());
        }
        map.insert(key.clone(), spawn_server(&app, account_id.as_deref())?);
    }
    let server = map.get_mut(&key).ok_or("chat : serveur absent")?;
    server
        .stdin
        .write_all(line.as_bytes())
        .and_then(|()| server.stdin.flush())
        .map_err(|e| format!("chat : envoi impossible : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_phone_catch_up_never_starts_a_server() {
        assert!(!starts_server(&json!({ "type": "phone_replay", "chatId": "c" })));
        assert!(starts_server(&json!({ "type": "start", "chatId": "c" })));
        assert!(starts_server(&json!({ "type": "send", "chatId": "c" })));
    }

    #[test]
    fn a_start_gets_the_pane_id_and_nothing_else_changes() {
        let start = with_chat_env(json!({ "type": "start", "chatId": "p1", "cwd": "C:/x" }));
        assert_eq!(start["env"]["ARKADIA_PANE_ID"], "p1");
        // The notify hook skips a chat: its page notifies.
        assert_eq!(start["env"][CHAT_MARKER], "1");
        assert_eq!(start["cwd"], "C:/x");
        let send = json!({ "type": "send", "chatId": "p1", "text": "t" });
        assert_eq!(with_chat_env(send.clone()), send);
    }

    /// The env a server gets: `Some(value)` set, `None` removed, absent untouched.
    fn env_of(cmd: &Command, name: &str) -> Option<Option<String>> {
        cmd.get_envs()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    #[test]
    fn only_the_credits_server_gets_the_api_key() {
        let key = || Some("sk-ant-test".to_string());
        let dir = || Some(PathBuf::from("C:/acc"));
        for account in ["main", "1e37cada"] {
            let launch = launch_for(account, key, dir).unwrap();
            let cmd = server_command(account, &launch);
            // Removed, even when Arkadia itself inherited one.
            assert_eq!(env_of(&cmd, crate::credits::KEY_VAR), Some(None), "{account}");
            assert_eq!(env_of(&cmd, "CLAUDE_CONFIG_DIR"), Some(Some("C:/acc".into())));
        }
        let launch = launch_for(crate::credits::ACCOUNT, key, dir).unwrap();
        let cmd = server_command(crate::credits::ACCOUNT, &launch);
        assert_eq!(env_of(&cmd, crate::credits::KEY_VAR), Some(Some("sk-ant-test".into())));
        // The main config dir: its sessions are every account's.
        assert_eq!(env_of(&cmd, "CLAUDE_CONFIG_DIR"), Some(None));
        for alias in [crate::credits::OPUS_ALIAS_VAR, crate::credits::FABLE_ALIAS_VAR] {
            assert_eq!(env_of(&cmd, alias), Some(Some(crate::credits::MODEL.into())), "{alias}");
        }
        assert_eq!(env_of(&cmd, "ARKADIA_CHAT_ACCOUNT"), Some(Some("api".into())));
        // Never on its command line.
        assert!(!cmd.get_args().any(|a| a.to_string_lossy().contains("sk-ant")));
        // No key on disk: the credits' server does not start.
        assert!(launch_for(crate::credits::ACCOUNT, || None, dir).is_err());
    }

    #[test]
    fn the_server_script_sits_in_the_repo() {
        assert!(
            std::path::Path::new(SERVER_SCRIPT).is_file(),
            "{SERVER_SCRIPT}"
        );
    }
}
