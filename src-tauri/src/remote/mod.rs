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
pub(crate) mod peer;
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

/// Latest-value channels between the app and the connected phones (the
/// desktop snapshot, the frames of each watched pane), and each phone's
/// outbox for the window's replies.
pub struct RemoteHub {
    state: Latest,
    frames: Mutex<HashMap<String, Latest>>,
    clients: Mutex<HashMap<u64, mpsc::Sender<Message>>>,
    next_client: AtomicU64,
}

impl Default for RemoteHub {
    fn default() -> Self {
        Self {
            state: watch::channel(None).0,
            frames: Mutex::default(),
            clients: Mutex::default(),
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
    use super::keep_to_self;

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
