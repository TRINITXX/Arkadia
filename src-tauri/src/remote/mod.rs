//! Phone companion: a small HTTP + WebSocket server that lets an allowed
//! device (see `access`) drive this running Arkadia.
//!
//! The desktop window stays the brain. It publishes a display-ready snapshot
//! of its projects, tabs and badges (`remote_publish_state`); the phone reads
//! that, watches one pane's frames and types into it through the same PTY
//! commands the desktop uses. Actions that change the desktop's own state
//! (new tab, toolbar button, account…) are relayed to the window as a
//! `remote-action` event; it answers with `remote_reply`.

pub(crate) mod access;
mod activity;
pub(crate) mod peer;
pub(crate) mod phone;
pub(crate) mod presence;
mod server;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::Message;
use parking_lot::Mutex;
use tauri::{AppHandle, State};
use tokio::sync::{mpsc, watch};

use crate::terminal::RenderPayload;

/// Loopback port the server binds; `tailscale serve` proxies HTTPS to it. A
/// debug build uses its own so `tauri dev` can run beside the daily instance.
pub const PORT: u16 = if cfg!(debug_assertions) { 47601 } else { 47600 };

type Latest = watch::Sender<Option<Arc<str>>>;

/// A connected phone's chat: the one it shows, and the queue of its events.
/// Unbounded: a chat's events build its state, none may be dropped, and the
/// chat servers' reader must never wait on a slow phone.
struct PhoneChat {
    chat: Option<String>,
    out: mpsc::UnboundedSender<Message>,
}

/// What `chat_line` reads of a chat server's line: the rest is the phone's.
#[derive(serde::Deserialize)]
struct ChatHead {
    #[serde(rename = "chatId")]
    chat_id: Option<String>,
    to: Option<String>,
}

/// Prefix of `to` on a line for one phone (`chat-server/server.ts` `emit`).
const PHONE_PREFIX: &str = "phone:";

fn chat_message(line: &str) -> Message {
    Message::Text(format!(r#"{{"t":"chat","event":{line}}}"#).into())
}

/// Latest-value channels between the app and the connected phones (the
/// desktop snapshot, the frames of each watched pane), each phone's outbox
/// for the window's replies, and the chat each phone shows.
pub struct RemoteHub {
    state: Latest,
    frames: Mutex<HashMap<String, Latest>>,
    clients: Mutex<HashMap<u64, mpsc::Sender<Message>>>,
    chats: Mutex<HashMap<u64, PhoneChat>>,
    next_client: AtomicU64,
}

impl Default for RemoteHub {
    fn default() -> Self {
        Self {
            state: watch::channel(None).0,
            frames: Mutex::default(),
            clients: Mutex::default(),
            chats: Mutex::default(),
            next_client: AtomicU64::new(1),
        }
    }
}

impl RemoteHub {
    /// Hands a pane's fresh frame to the phones watching it. Costs one map
    /// lookup when nobody watches; serializes only when someone does.
    pub fn publish_frame(&self, payload: &RenderPayload) {
        let frames = self.frames.lock();
        let Some(tx) = frames.get(&payload.session_id) else {
            return;
        };
        if tx.receiver_count() == 0 {
            return;
        }
        if let Ok(json) = serde_json::to_string(payload) {
            tx.send_replace(Some(json.into()));
        }
    }

    /// Whether a connected phone shows `pane` right now.
    pub fn is_watching(&self, pane: &str) -> bool {
        self.frames
            .lock()
            .get(pane)
            .is_some_and(|tx| tx.receiver_count() > 0)
    }

    fn watch_frames(&self, pane: &str) -> watch::Receiver<Option<Arc<str>>> {
        let mut frames = self.frames.lock();
        frames.retain(|_, tx| tx.receiver_count() > 0);
        frames
            .entry(pane.to_string())
            .or_insert_with(|| watch::channel(None).0)
            .subscribe()
    }

    fn watch_state(&self) -> watch::Receiver<Option<Arc<str>>> {
        self.state.subscribe()
    }

    /// Registers a connected phone's outbox; returns its id.
    fn add_client(&self, out: mpsc::Sender<Message>) -> u64 {
        let id = self.next_client.fetch_add(1, Ordering::Relaxed);
        self.clients.lock().insert(id, out);
        id
    }

    fn remove_client(&self, id: u64) {
        self.clients.lock().remove(&id);
        self.chats.lock().remove(&id);
    }

    /// A connected phone's queue for chat events (`chat_line`).
    fn add_chat_outbox(&self, client: u64, out: mpsc::UnboundedSender<Message>) {
        self.chats
            .lock()
            .insert(client, PhoneChat { chat: None, out });
    }

    /// The chat a phone shows now (`None`: none); returns the one it left.
    fn show_chat(&self, client: u64, chat: Option<String>) -> Option<String> {
        let mut chats = self.chats.lock();
        let phone = chats.get_mut(&client)?;
        std::mem::replace(&mut phone.chat, chat)
    }

    /// A line of a chat server, for the phones: an event of a chat a phone
    /// shows goes to it too, and one addressed to a phone (`to`: its replay,
    /// its own reads) to that phone alone. Returns whether the page gets the
    /// line as well. Read only when a phone shows a chat or the line names one.
    pub fn chat_line(&self, line: &str) -> bool {
        let addressed = line.contains(r#""to":"phone:"#);
        if !addressed && !self.chats.lock().values().any(|p| p.chat.is_some()) {
            return true;
        }
        let Ok(head) = serde_json::from_str::<ChatHead>(line) else {
            return true;
        };
        let chats = self.chats.lock();
        if let Some(to) = head.to {
            let phone = to
                .strip_prefix(PHONE_PREFIX)
                .and_then(|id| id.parse::<u64>().ok())
                .and_then(|id| chats.get(&id));
            if let Some(phone) = phone {
                let _ = phone.out.send(chat_message(line));
            }
            return false;
        }
        if let Some(chat) = head.chat_id {
            for phone in chats.values() {
                if phone.chat.as_deref() == Some(chat.as_str()) {
                    let _ = phone.out.send(chat_message(line));
                }
            }
        }
        true
    }

    /// A chat server stopped (`server_exit`): every phone showing a chat
    /// hears it, and opens its chat again once the page resumed it.
    pub fn chat_server_exit(&self, line: &str) {
        for phone in self.chats.lock().values() {
            if phone.chat.is_some() {
                let _ = phone.out.send(chat_message(line));
            }
        }
    }

    /// Tells every connected phone about a desktop event (the modern view
    /// re-reads its conversation on `agent-state-changed`, as on the desktop).
    pub fn broadcast_event(&self, name: &str, payload: &impl serde::Serialize) {
        let msg = serde_json::json!({ "t": "event", "name": name, "payload": payload });
        let text = msg.to_string();
        for out in self.clients.lock().values() {
            let _ = out.try_send(Message::Text(text.clone().into()));
        }
    }
}

/// The desktop relaunched a pane under a new id (another account): a tab the
/// phone drives keeps its notifications and Live Activity row.
#[tauri::command]
pub fn remote_pane_replaced(old_id: String, new_id: String) {
    phone::FOLLOW.replace(&old_id, &new_id);
}

/// Alexis wrote in a chat on the PC (a message, an answer, a stop): a chat the
/// phone drove goes back to the PC, as a terminal does on a key (`send_input`).
#[tauri::command]
pub fn remote_desktop_chat_input(pane: String) {
    phone::FOLLOW.desktop_input(&pane, std::time::Instant::now());
}

/// The desktop window's snapshot (JSON built by `buildRemoteSnapshot`).
#[tauri::command]
pub fn remote_publish_state(snapshot: String, hub: State<'_, Arc<RemoteHub>>) {
    hub.state.send_if_modified(|cur| {
        if cur.as_deref() == Some(snapshot.as_str()) {
            return false;
        }
        *cur = Some(snapshot.into());
        true
    });
}

/// The window's answer to a relayed action (`remote-action`), for the phone
/// that sent it. A phone gone meanwhile is simply not answered.
#[tauri::command]
pub fn remote_reply(
    client: u64,
    id: u64,
    result: serde_json::Value,
    hub: State<'_, Arc<RemoteHub>>,
) {
    let out = hub.clients.lock().get(&client).cloned();
    if let Some(out) = out {
        let msg = serde_json::json!({ "t": "reply", "id": id, "result": result });
        let _ = out.try_send(Message::Text(msg.to_string().into()));
    }
}

/// Keeps a listening socket out of the programs we start. Windows hands every
/// inheritable handle to a child started the usual way (and mio's sockets
/// are inheritable): a long-lived child, such as the gate, would then hold our
/// port after we exit, accepting connections nobody answers.
pub(crate) fn keep_to_self(listener: &tokio::net::TcpListener) {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawSocket;
        use windows::Win32::Foundation::{
            SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT,
        };
        let handle = HANDLE(listener.as_raw_socket() as *mut core::ffi::c_void);
        // SAFETY: the socket handle is valid for the listener's lifetime.
        let _ = unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) };
    }
    #[cfg(not(windows))]
    let _ = listener;
}

/// Starts the allowlist refresh and the server. Call once from `setup`.
pub fn spawn(app: AppHandle, hub: Arc<RemoteHub>) {
    let access = Arc::new(access::Access::default());
    access.spawn_refresh();
    tauri::async_runtime::spawn(server::serve(app, hub, access));
}

#[cfg(test)]
mod tests {
    use super::{keep_to_self, RemoteHub};
    use axum::extract::ws::Message;
    use tokio::sync::mpsc;

    fn texts(rx: &mut mpsc::UnboundedReceiver<Message>) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(Message::Text(t)) = rx.try_recv() {
            out.push(t.to_string());
        }
        out
    }

    /// A chat's events reach the phone that shows it; a phone's own replay
    /// reaches that phone alone, never the page nor another phone.
    #[test]
    fn chat_lines_go_to_the_phone_that_shows_the_chat() {
        let hub = RemoteHub::default();
        let (a_tx, mut a) = mpsc::unbounded_channel();
        let (b_tx, mut b) = mpsc::unbounded_channel();
        hub.add_chat_outbox(1, a_tx);
        hub.add_chat_outbox(2, b_tx);
        let live = r#"{"type":"sdk","chatId":"c1","message":{"type":"assistant"}}"#;
        // No phone shows a chat: the page alone, nothing read.
        assert!(hub.chat_line(live));
        assert!(texts(&mut a).is_empty());

        hub.show_chat(1, Some("c1".into()));
        hub.show_chat(2, Some("c2".into()));
        assert!(hub.chat_line(live), "the page still gets it");
        assert_eq!(texts(&mut a), [format!(r#"{{"t":"chat","event":{live}}}"#)]);
        assert!(texts(&mut b).is_empty(), "phone 2 shows another chat");

        let replay = r#"{"type":"attached","chatId":"c1","to":"phone:2"}"#;
        assert!(!hub.chat_line(replay), "never the page");
        assert!(texts(&mut a).is_empty(), "phone 1 shows c1 but didn't ask");
        assert_eq!(texts(&mut b).len(), 1);

        // A `to` nested in a tool's input is no address.
        let nested = r#"{"type":"sdk","chatId":"c1","message":{"input":{"to":"phone:2"}}}"#;
        assert!(hub.chat_line(nested));
        assert_eq!(texts(&mut a).len(), 1);
        assert!(texts(&mut b).is_empty());

        // Left the chat: nothing more.
        assert_eq!(hub.show_chat(1, None).as_deref(), Some("c1"));
        assert!(hub.chat_line(live));
        assert!(texts(&mut a).is_empty());
    }

    /// The 11/10 bug: the gate, started by Arkadia, kept Arkadia's port after
    /// it closed, so the next Arkadia could not serve the phone.
    #[cfg(windows)]
    #[tokio::test]
    async fn a_program_we_start_does_not_keep_our_port() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        keep_to_self(&listener);
        let mut child = std::process::Command::new("ping")
            .args(["-n", "6", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        drop(listener);
        let rebound = tokio::net::TcpListener::bind(addr).await;
        let _ = child.kill();
        assert!(rebound.is_ok(), "the child still holds {addr}");
    }
}
