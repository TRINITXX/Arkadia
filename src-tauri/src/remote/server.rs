//! HTTP side: serves the phone page from the app's embedded frontend and runs
//! one WebSocket session per connected phone.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State as AxState};
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use super::access::{decide, wake_relay, Access, RequestInfo};
use super::peer::is_tailscale_daemon;
use super::phone::{save_push_token, FOLLOW};
use super::{RemoteHub, PORT};
use crate::conversation::{
    evict_phone_cache, image_bytes, read_conversation_delta_for_phone, ConvCacheMap,
};
use crate::media::{read_video, MediaError};
use crate::popup::log_line;
use crate::sessions::{self, SessionIndex};
use crate::terminal::{self, SessionMap};

/// Floor between two frames sent to a phone: a busy pane renders at ~60 Hz,
/// the phone only needs the latest picture.
const FRAME_GAP: Duration = Duration::from_millis(33);
/// Keeps the socket alive through proxies and the phone's network.
const PING_EVERY: Duration = Duration::from_secs(25);
const BIND_RETRY: Duration = Duration::from_secs(3);
/// Bounds of one `Inputs` sequence: enough to clear a long prompt
/// (`promptClear`, 21 writes 20 ms apart), never a stall of the socket.
const MAX_INPUT_PARTS: usize = 64;
const MAX_INPUT_GAP_MS: u64 = 200;

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
    super::activity::spawn(hub.clone());
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
        .route("/image", get(image_route))
        .route("/thumb", get(thumb_route))
        .route("/video", get(video_route))
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

/// An image the modern view shows (pasted, screenshot, path in a message),
/// with the desktop's own checks (image types only, size cap).
async fn image_route(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<ImageQuery>,
    headers: HeaderMap,
    AxState(ctx): AxState<Ctx>,
) -> Response {
    if ctx.check(peer, &headers, false).is_err() {
        return StatusCode::FORBIDDEN.into_response();
    }
    // Only the phone page's own fetches: another site open on the phone
    // could otherwise probe which images exist on the PC.
    let same_origin =
        headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("same-origin");
    if !same_origin {
        return StatusCode::FORBIDDEN.into_response();
    }
    // `image_bytes` refuses network paths, which would make the PC sign in
    // to another machine.
    let path = query.path;
    match tauri::async_runtime::spawn_blocking(move || {
        let bytes = image_bytes(&path)?;
        let ext = path
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        Ok::<_, String>((bytes, ext))
    })
    .await
    {
        Ok(Ok((bytes, ext))) => {
            let mime = match ext.as_str() {
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                "svg" => "image/svg+xml",
                _ => "image/png",
            };
            (
                [
                    (header::CONTENT_TYPE, mime),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                    (
                        header::HeaderName::from_static("cross-origin-resource-policy"),
                        "same-origin",
                    ),
                    // An SVG opened on its own must not run scripts here.
                    (
                        header::CONTENT_SECURITY_POLICY,
                        "sandbox; default-src 'none'",
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
struct ImageQuery {
    path: String,
}

/// A photo or download's thumbnail for the iPhone's picker, with the desktop
/// picker's checks (still images, local disk, size cap) and /image's guard.
async fn thumb_route(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<ImageQuery>,
    headers: HeaderMap,
    AxState(ctx): AxState<Ctx>,
) -> Response {
    if ctx.check(peer, &headers, false).is_err() {
        return StatusCode::FORBIDDEN.into_response();
    }
    let same_origin =
        headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("same-origin");
    if !same_origin {
        return StatusCode::FORBIDDEN.into_response();
    }
    let app = ctx.app.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        crate::photos::thumbnail_bytes(&app, &query.path)
    })
    .await
    {
        Ok(Ok(bytes)) => (
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (
                    header::HeaderName::from_static("cross-origin-resource-policy"),
                    "same-origin",
                ),
            ],
            bytes,
        )
            .into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// A video the conversation mentions, in the byte ranges the phone's player
/// asks for: it seeks without the whole file crossing the network.
async fn video_route(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    method: Method,
    Query(query): Query<ImageQuery>,
    headers: HeaderMap,
    AxState(ctx): AxState<Ctx>,
) -> Response {
    if ctx.check(peer, &headers, false).is_err() {
        return StatusCode::FORBIDDEN.into_response();
    }
    // As for /image, another site open on the phone must not probe the PC's
    // files. A request without the header is refused too: the header is all
    // that tells the phone page from a page elsewhere playing the same URL.
    let same_origin =
        headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("same-origin");
    if !same_origin {
        return StatusCode::FORBIDDEN.into_response();
    }
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let head = method == Method::HEAD;
    let read = tauri::async_runtime::spawn_blocking(move || {
        read_video(&query.path, range.as_deref(), head)
    })
    .await;
    let common = [
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (
            header::HeaderName::from_static("cross-origin-resource-policy"),
            "same-origin",
        ),
    ];
    match read {
        Ok(Ok(chunk)) => {
            let status = StatusCode::from_u16(chunk.status).unwrap_or(StatusCode::OK);
            let mut res = (
                status,
                common,
                [
                    (header::CONTENT_TYPE, chunk.mime),
                    (header::ACCEPT_RANGES, "bytes"),
                ],
            )
                .into_response();
            if let Some(range) = chunk.content_range().and_then(|r| r.parse().ok()) {
                res.headers_mut().insert(header::CONTENT_RANGE, range);
            }
            *res.body_mut() = chunk.body.into();
            res
        }
        Ok(Err(MediaError::Unsatisfiable { total })) => (
            StatusCode::RANGE_NOT_SATISFIABLE,
            common,
            [(header::CONTENT_RANGE, format!("bytes */{total}"))],
        )
            .into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
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
    /// Writes spaced on the PC itself: Claude Code reads a write of over
    /// ~40 bytes as a paste and drops its control keys (REVIEW.md « Rafale de
    /// touches »), and the network may bunch writes the phone spaced.
    Inputs {
        pane: String,
        parts: Vec<String>,
        gap_ms: u64,
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
    /// Back to the live bottom: the phone opened a pane left scrolled up.
    Bottom {
        pane: String,
    },
    /// A wheel notch for an app that tracks the mouse (button 64 up, 65 down).
    Wheel {
        pane: String,
        col: u16,
        row: u16,
        button: u8,
    },
    /// A left click (press then release) for an app that tracks the mouse.
    Click {
        pane: String,
        col: u16,
        row: u16,
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
    /// The modern view's incremental read of a pane's conversation (same
    /// generation/have contract as `read_conversation_delta`).
    Conv {
        id: u64,
        pane: String,
        generation: u64,
        have: usize,
    },
    /// The picker's recent photos or downloads (`list_recent_files`).
    Files {
        id: u64,
        source: String,
        limit: usize,
    },
    /// The last code block Claude wrote in the pane (`read_last_code_block`).
    Code {
        id: u64,
        pane: String,
    },
    /// The iPhone app's push token, for the panes it drives (`phone`).
    Push {
        token: String,
    },
    /// The Live Activity's push token once the app started it; `None` when
    /// it ended it (`activity`).
    Activity {
        token: Option<String>,
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

    // Kept by the phone for when the PC is off and this server with it.
    if let Some(relay) = wake_relay() {
        let msg = serde_json::json!({ "t": "wake", "url": relay.url, "token": relay.token });
        let _ = out.send(text(msg.to_string())).await;
    }
    let client = ctx.hub.add_client(out.clone());
    let mut state_rx = ctx.hub.watch_state();
    state_rx.mark_changed();
    // The tabs it drives: the app shows their dots in its Live Activity.
    let mut follow_rx = FOLLOW.subscribe();
    follow_rx.mark_changed();
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
                        FOLLOW.set_watching(client, pane.clone());
                        if let Some(task) = frames.take() {
                            task.abort();
                        }
                        if let Some(pane) = pane {
                            frames = Some(stream_frames(&ctx, &pane, frames_out.clone()));
                        }
                    }
                    ClientMsg::Action { id, action } => {
                        // A button the phone pressed for a pane: the phone drives it.
                        if let Some(pane) = action.get("paneId").and_then(|v| v.as_str()) {
                            FOLLOW.phone_action(pane, std::time::Instant::now());
                        }
                        let relayed = RelayedAction { client, id, action };
                        if let Err(e) = ctx.app.emit_to("main", "remote-action", relayed) {
                            let _ = out.send(error(&format!("desktop window unreachable: {e}"))).await;
                        }
                    }
                    ClientMsg::Conv { id, pane, generation, have } => {
                        let app = ctx.app.clone();
                        let out = out.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let cache = app.state::<ConvCacheMap>();
                            let read = read_conversation_delta_for_phone(&cache, client, &pane, generation, have);
                            let reply = match read {
                                Ok(delta) => serde_json::json!({ "t": "reply", "id": id, "result": delta }),
                                Err(e) => serde_json::json!({ "t": "reply", "id": id, "error": e }),
                            };
                            let _ = out.blocking_send(text(reply.to_string()));
                        });
                    }
                    ClientMsg::Files { id, source, limit } => {
                        let app = ctx.app.clone();
                        let out = out.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let listed = crate::photos::list_recent_files(app, source, limit);
                            let _ = out.blocking_send(text(reply(id, listed).to_string()));
                        });
                    }
                    ClientMsg::Code { id, pane } => {
                        let out = out.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let block = crate::conversation::read_last_code_block(pane);
                            let _ = out.blocking_send(text(reply(id, block).to_string()));
                        });
                    }
                    ClientMsg::Push { token } => save_push_token(&token),
                    ClientMsg::Activity { token } => super::activity::set_token(token),
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
            changed = follow_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let panes = follow_rx.borrow_and_update().clone();
                let msg = serde_json::json!({ "t": "follow", "panes": panes });
                if out.send(text(msg.to_string())).await.is_err() {
                    break;
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
    FOLLOW.set_watching(client, None);
    ctx.hub.remove_client(client);
    evict_phone_cache(&ctx.app.state::<ConvCacheMap>(), client, None);
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
        | ClientMsg::Search { .. }
        | ClientMsg::Conv { .. }
        | ClientMsg::Files { .. }
        | ClientMsg::Code { .. }
        | ClientMsg::Push { .. }
        | ClientMsg::Activity { .. } => Ok(()),
        ClientMsg::Input { pane, data } => {
            FOLLOW.phone_input(&pane);
            terminal::write_input(pane, data.into_bytes(), sessions)
        }
        ClientMsg::Inputs {
            pane,
            parts,
            gap_ms,
        } => {
            FOLLOW.phone_input(&pane);
            let gap = Duration::from_millis(gap_ms.min(MAX_INPUT_GAP_MS));
            for (i, part) in parts.into_iter().take(MAX_INPUT_PARTS).enumerate() {
                if i > 0 {
                    // Off the socket loop (spawn_blocking): the next message waits.
                    std::thread::sleep(gap);
                }
                terminal::write_input(pane.clone(), part.into_bytes(), sessions.clone())?;
            }
            Ok(())
        }
        ClientMsg::Resize { pane, cols, rows } => {
            terminal::resize_terminal(pane, cols, rows, sessions, app.clone())
        }
        ClientMsg::Scroll { pane, delta } => {
            terminal::scroll_terminal(pane, delta, sessions, app.clone())
        }
        ClientMsg::Bottom { pane } => terminal::scroll_to_bottom(pane, sessions, app.clone()),
        ClientMsg::Wheel {
            pane,
            col,
            row,
            button,
        } if matches!(button, 64 | 65) => {
            terminal::send_mouse_event(pane, col, row, button, 0, false, true, sessions)
        }
        ClientMsg::Wheel { button, .. } => Err(format!("not a wheel button: {button}")),
        ClientMsg::Click { pane, col, row } => {
            FOLLOW.phone_input(&pane);
            terminal::send_mouse_event(
                pane.clone(),
                col,
                row,
                0,
                0,
                false,
                true,
                sessions.clone(),
            )?;
            terminal::send_mouse_event(pane, col, row, 0, 0, false, false, sessions)
        }
    }
}

/// A request's answer: its result, or the error the phone shows.
fn reply<T: Serialize>(id: u64, result: Result<T, String>) -> serde_json::Value {
    match result {
        Ok(value) => serde_json::json!({ "t": "reply", "id": id, "result": value }),
        Err(e) => serde_json::json!({ "t": "reply", "id": id, "error": e }),
    }
}

fn error(message: &str) -> Message {
    text(serde_json::json!({ "t": "error", "message": message }).to_string())
}
