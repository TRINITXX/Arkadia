//! HTTP side: serves the phone page from the app's embedded frontend and runs
//! one WebSocket session per connected phone.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State as AxState};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use super::access::{decide, Access, RequestInfo};
use super::peer::is_tailscale_daemon;
use super::{RemoteHub, PORT};
use crate::popup::log_line;
use crate::sessions::{self, SessionIndex};
use crate::terminal::{self, SessionMap};

/// Floor between two frames sent to a phone: a busy pane renders at ~60 Hz,
/// the phone only needs the latest picture.
const FRAME_GAP: Duration = Duration::from_millis(33);
/// Keeps the socket alive through proxies and the phone's network.
const PING_EVERY: Duration = Duration::from_secs(25);
const BIND_RETRY: Duration = Duration::from_secs(3);

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    hub: Arc<RemoteHub>,
    access: Arc<Access>,
}

impl Ctx {
    /// Lets the request through, with the device's Tailscale IP when it came
    /// through Tailscale, or logs why not.
    fn check(
        &self,
        peer: SocketAddr,
        headers: &HeaderMap,
        websocket: bool,
    ) -> Result<Option<IpAddr>, &'static str> {
        let get = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
        let forwarded_for = get("x-forwarded-for");
        let req = RequestInfo {
            host: get("host"),
            origin: get("origin"),
            forwarded_for,
            // Only worth asking Windows when a device is claimed.
            via_tailscale: forwarded_for.is_some() && is_tailscale_daemon(peer, PORT),
            check_origin: websocket,
        };
        decide(&req, &self.access.tailnet(), cfg!(debug_assertions), PORT).inspect_err(|why| {
            log_line(&format!(
                "[remote] refused {} from {:?}: {why}",
                if websocket { "socket" } else { "request" },
                req.forwarded_for
            ))
        })
    }
}

pub async fn serve(app: AppHandle, hub: Arc<RemoteHub>, access: Arc<Access>) {
    // The port may still be held for a moment (a previous Arkadia closing):
    // keep trying rather than leave the phone without a server.
    let mut warned = false;
    let listener = loop {
        match tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await {
            Ok(l) => break l,
            Err(e) => {
                if !warned {
                    log_line(&format!(
                        "[remote] cannot listen on 127.0.0.1:{PORT} yet: {e}"
                    ));
                    warned = true;
                }
                tokio::time::sleep(BIND_RETRY).await;
            }
        }
    };
    super::keep_to_self(&listener);
    log_line(&format!("[remote] listening on 127.0.0.1:{PORT}"));
    let router = Router::new()
        .route("/ws", get(ws_route))
        .fallback(get(static_route))
        .with_state(Ctx { app, hub, access });
    let service = router.into_make_service_with_connect_info::<SocketAddr>();
    if let Err(e) = axum::serve(listener, service).await {
        log_line(&format!("[remote] server stopped: {e}"));
    }
}

/// The phone page and its files, from the frontend bundled in the exe.
async fn static_route(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    uri: Uri,
    headers: HeaderMap,
    AxState(ctx): AxState<Ctx>,
) -> Response {
    if ctx.check(peer, &headers, false).is_err() {
        return StatusCode::FORBIDDEN.into_response();
    }
    let path = match uri.path() {
        "/" => "mobile.html",
        p => p.trim_start_matches('/'),
    };
    // Never the desktop page: it only works inside Tauri.
    // sw.js: the phone's offline cache of this page (see public/sw.js).
    let servable = path == "mobile.html"
        || path == "sw.js"
        || path.starts_with("assets/")
        || path.starts_with("mobile/");
    let asset = servable
        .then(|| ctx.app.asset_resolver().get(path.to_string()))
        .flatten();
    // A missing file comes back as the desktop index.html (Tauri's fallback).
    let asset = asset.filter(|a| path == "mobile.html" || !a.mime_type.starts_with("text/html"));
    let Some(asset) = asset else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Hashed bundle files never change; the page itself must always be fresh.
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    (
        [
            (header::CONTENT_TYPE, asset.mime_type),
            (header::CACHE_CONTROL, cache.to_string()),
        ],
        asset.bytes,
    )
        .into_response()
}

async fn ws_route(
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxState(ctx): AxState<Ctx>,
) -> Response {
    let Ok(device) = ctx.check(peer, &headers, true) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let who = device.map_or("local".to_string(), |ip| ip.to_string());
    ws.on_upgrade(move |socket| async move {
        log_line(&format!("[remote] phone connected ({who})"));
        session(socket, ctx, device).await;
        log_line(&format!("[remote] phone left ({who})"));
    })
}

/// What the phone sends. Terminal commands mirror the desktop's Tauri ones.
#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientMsg {
    /// Stream this pane's frames (replaces the previous one); `None` = none.
    Watch {
        pane: Option<String>,
    },
    Input {
        pane: String,
        data: String,
    },
    Resize {
        pane: String,
        cols: u16,
        rows: u16,
    },
    Scroll {
        pane: String,
        delta: i32,
    },
    /// A wheel notch for an app that tracks the mouse (button 64 up, 65 down).
    Wheel {
        pane: String,
        col: u16,
        row: u16,
        button: u8,
    },
    /// Something only the desktop window can do (new tab, toolbar button,
    /// account…): relayed as `remote-action`, answered by `remote_reply`.
    Action {
        id: u64,
        action: serde_json::Value,
    },
    /// Every past Claude session, newest first.
    Sessions {
        id: u64,
    },
    /// Past sessions whose conversation contains `query`.
    Search {
        id: u64,
        query: String,
    },
}

/// `remote-action` payload: which phone asked, its request id, the action.
#[derive(Serialize, Clone)]
struct RelayedAction {
    client: u64,
    id: u64,
    action: serde_json::Value,
}

fn text(json: String) -> Message {
    Message::Text(json.into())
}

/// One phone's session. `device` (its Tailscale IP) is re-checked against the
/// allowlist at every ping: removing a device cuts it off within `PING_EVERY`.
async fn session(socket: WebSocket, ctx: Ctx, device: Option<IpAddr>) {
    let (mut sink, mut stream) = socket.split();
    // Two outboxes: frames only ever wait for their own (small) queue, so on a
    // slow link a busy pane cannot crowd out replies, the snapshot or pings,
    // which the writer always sends first.
    let (out, mut out_rx) = mpsc::channel::<Message>(64);
    let (frames_out, mut frames_rx) = mpsc::channel::<Message>(2);
    let writer = tokio::spawn(async move {
        loop {
            let msg = tokio::select! {
                biased;
                Some(msg) = out_rx.recv() => msg,
                Some(frame) = frames_rx.recv() => frame,
                else => break,
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let client = ctx.hub.add_client(out.clone());
    let mut state_rx = ctx.hub.watch_state();
    state_rx.mark_changed();
    let mut frames: Option<tokio::task::JoinHandle<()>> = None;
    let mut ping = tokio::time::interval(PING_EVERY);

    loop {
        tokio::select! {
            incoming = stream.next() => {
                let raw = match incoming {
                    Some(Ok(Message::Text(raw))) => raw,
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                let msg = match serde_json::from_str::<ClientMsg>(raw.as_str()) {
                    Ok(msg) => msg,
                    Err(e) => {
                        let _ = out.send(error(&format!("bad message: {e}"))).await;
                        continue;
                    }
                };
                match msg {
                    ClientMsg::Watch { pane } => {
                        if let Some(task) = frames.take() {
                            task.abort();
                        }
                        if let Some(pane) = pane {
                            frames = Some(stream_frames(&ctx, &pane, frames_out.clone()));
                        }
                    }
                    ClientMsg::Action { id, action } => {
                        let relayed = RelayedAction { client, id, action };
                        if let Err(e) = ctx.app.emit_to("main", "remote-action", relayed) {
                            let _ = out.send(error(&format!("desktop window unreachable: {e}"))).await;
                        }
                    }
                    ClientMsg::Sessions { .. } | ClientMsg::Search { .. } => {
                        // A full scan can take seconds: off the socket loop.
                        let app = ctx.app.clone();
                        let out = out.clone();
                        tauri::async_runtime::spawn_blocking(move || list_sessions(&app, msg, &out));
                    }
                    _ => {
                        // In order: the next keystroke waits for this one.
                        let app = ctx.app.clone();
                        let result = tauri::async_runtime::spawn_blocking(move || run(&app, msg)).await;
                        if let Ok(Err(e)) = result {
                            let _ = out.send(error(&e)).await;
                        }
                    }
                }
            }
            changed = state_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let snapshot = state_rx.borrow_and_update().clone();
                if let Some(s) = snapshot {
                    if out.send(text(format!(r#"{{"t":"state","state":{s}}}"#))).await.is_err() {
                        break;
                    }
                }
            }
            _ = ping.tick() => {
                if device.is_some_and(|ip| !ctx.access.tailnet().allowed_ips.contains(&ip)) {
                    log_line("[remote] device no longer allowed, closing its session");
                    break;
                }
                if out.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
    }
    ctx.hub.remove_client(client);
    if let Some(task) = frames {
        task.abort();
    }
    writer.abort();
}

/// Answers a `Sessions` or `Search` request with the matching list.
fn list_sessions(app: &AppHandle, msg: ClientMsg, out: &mpsc::Sender<Message>) {
    let index = app.state::<SessionIndex>();
    let (id, result) = match msg {
        ClientMsg::Search { id, query } => (
            id,
            serde_json::to_value(sessions::search_claude_sessions(query, index)),
        ),
        ClientMsg::Sessions { id } => (
            id,
            serde_json::to_value(sessions::list_claude_sessions(index)),
        ),
        _ => return,
    };
    let reply = serde_json::json!({ "t": "reply", "id": id, "result": result.unwrap_or_default() });
    let _ = out.blocking_send(text(reply.to_string()));
}

/// Forwards a pane's frames to the phone, at most one per `FRAME_GAP`, always
/// the latest. Asks the pane for a fresh frame first so an idle one shows up.
fn stream_frames(ctx: &Ctx, pane: &str, out: mpsc::Sender<Message>) -> tokio::task::JoinHandle<()> {
    let mut rx = ctx.hub.watch_frames(pane);
    let app = ctx.app.clone();
    let id = pane.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = terminal::request_render(id, app.state::<SessionMap>(), app.clone());
    });
    tokio::spawn(async move {
        loop {
            let frame = rx.borrow_and_update().clone();
            if let Some(f) = frame {
                if out
                    .send(text(format!(r#"{{"t":"frame","frame":{f}}}"#)))
                    .await
                    .is_err()
                {
                    break;
                }
                tokio::time::sleep(FRAME_GAP).await;
            }
            if rx.changed().await.is_err() {
                break;
            }
        }
    })
}

fn run(app: &AppHandle, msg: ClientMsg) -> Result<(), String> {
    let sessions = app.state::<SessionMap>();
    match msg {
        ClientMsg::Watch { .. }
        | ClientMsg::Action { .. }
        | ClientMsg::Sessions { .. }
        | ClientMsg::Search { .. } => Ok(()),
        ClientMsg::Input { pane, data } => terminal::send_input(pane, data.into_bytes(), sessions),
        ClientMsg::Resize { pane, cols, rows } => {
            terminal::resize_terminal(pane, cols, rows, sessions, app.clone())
        }
        ClientMsg::Scroll { pane, delta } => {
            terminal::scroll_terminal(pane, delta, sessions, app.clone())
        }
        ClientMsg::Wheel {
            pane,
            col,
            row,
            button,
        } if matches!(button, 64 | 65) => {
            terminal::send_mouse_event(pane, col, row, button, 0, false, true, sessions)
        }
        ClientMsg::Wheel { button, .. } => Err(format!("not a wheel button: {button}")),
    }
}

fn error(message: &str) -> Message {
    text(serde_json::json!({ "t": "error", "message": message }).to_string())
}
