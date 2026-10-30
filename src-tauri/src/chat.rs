//! The chat view's link to Claude Code. A Node process per Claude account
//! runs the repo's `chat-server/server.ts` (the Agent SDK, no terminal), and
//! this module relays: commands in through `chat_command`, each line the
//! server prints out as a `chat-event`. The conversations live in that
//! process, so a page that reloads starts its chats again and gets their
//! events back while Claude goes on working.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::popup::log_line;

/// Arkadia runs from its repo's build folder: the server sits beside it.
const SERVER_SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../chat-server/server.ts");

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

/// What a chat's Claude Code and its hooks get from Arkadia, as a pane's
/// shell does (`terminal::spawn_terminal`): the pane id the hooks report,
/// and the Lab's marker, or the artifact inbox's `BROWSER` in the daily app.
fn chat_env(chat_id: &str) -> Value {
    let mut env = serde_json::Map::new();
    env.insert("ARKADIA_PANE_ID".into(), json!(chat_id));
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

/// Starts the account's server. A secondary account runs with its own
/// `CLAUDE_CONFIG_DIR`, the main one without it (rule of `accounts`).
fn spawn_server(app: &AppHandle, account_id: Option<&str>) -> Result<Server, String> {
    let mut cmd = Command::new("node");
    cmd.arg(SERVER_SCRIPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match crate::accounts::prepare_launch(account_id) {
        Some(dir) => {
            cmd.env("CLAUDE_CONFIG_DIR", dir);
        }
        None => {
            cmd.env_remove("CLAUDE_CONFIG_DIR");
        }
    }
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
    let account = account_key(account_id);

    let out_app = app.clone();
    let out_account = account.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let _ = out_app.emit("chat-event", line);
        }
        let exit = json!({ "type": "server_exit", "account": out_account });
        let _ = out_app.emit("chat-event", exit.to_string());
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
    let mut line = serde_json::to_string(&with_chat_env(command)).map_err(|e| e.to_string())?;
    line.push('\n');
    let key = account_key(account_id.as_deref());
    let mut map = servers.0.lock();
    let alive = map
        .get_mut(&key)
        .is_some_and(|s| matches!(s.child.try_wait(), Ok(None)));
    if !alive {
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
    fn a_start_gets_the_pane_id_and_nothing_else_changes() {
        let start = with_chat_env(json!({ "type": "start", "chatId": "p1", "cwd": "C:/x" }));
        assert_eq!(start["env"]["ARKADIA_PANE_ID"], "p1");
        assert_eq!(start["cwd"], "C:/x");
        let send = json!({ "type": "send", "chatId": "p1", "text": "t" });
        assert_eq!(with_chat_env(send.clone()), send);
    }

    #[test]
    fn the_server_script_sits_in_the_repo() {
        assert!(
            std::path::Path::new(SERVER_SCRIPT).is_file(),
            "{SERVER_SCRIPT}"
        );
    }
}
