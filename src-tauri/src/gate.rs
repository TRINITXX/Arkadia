//! The gate: a tiny always-on companion of Arkadia for the phone. `tailscale
//! serve` routes `/gate/*` to it (prefix stripped): it says whether Arkadia
//! runs and starts it on request, which Arkadia cannot do while closed.
//!
//! Same executable as Arkadia, run with `--gate` (no window, no Tauri) from a
//! copy in `%LOCALAPPDATA%/Arkadia/gate`: an exe running from `target/` would
//! block every rebuild. Arkadia refreshes that copy, starts it, and registers
//! it to start with Windows (`install`, release builds only).

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};

use crate::popup::log_line;
use crate::remote::access::{decide, Access, RequestInfo};
use crate::remote::peer::is_tailscale_daemon;

/// Loopback port of the gate (`tailscale serve --set-path=/gate` points here).
pub const GATE_PORT: u16 = if cfg!(debug_assertions) { 47611 } else { 47610 };
const GATE_ARG: &str = "--gate";
const GATE_EXE: &str = "arkadia-gate.exe";
/// Windows' per-user autostart list.
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "ArkadiaGate";

fn gate_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("gate")
}

/// Where Arkadia records its own exe, for the gate to start it.
fn arkadia_path_file() -> PathBuf {
    gate_dir().join("arkadia-path.txt")
}

pub fn is_gate_mode() -> bool {
    std::env::args().any(|a| a == GATE_ARG)
}

/// True when Arkadia's phone server answers (so Arkadia runs).
fn arkadia_running() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], crate::remote::PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Gate mode entry point, from `main`.
pub fn run() {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => return log_line(&format!("[gate] no runtime: {e}")),
    };
    runtime.block_on(serve());
}

async fn serve() {
    // A second gate (Windows start + Arkadia start) finds the port taken.
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", GATE_PORT)).await {
        Ok(l) => l,
        Err(_) => return,
    };
    crate::remote::keep_to_self(&listener);
    log_line(&format!("[gate] listening on 127.0.0.1:{GATE_PORT}"));
    let access = Arc::new(Access::default());
    access.spawn_refresh();
    let router = Router::new()
        .route("/status", get(status_route))
        .route("/open", post(open_route))
        .with_state(access);
    let service = router.into_make_service_with_connect_info::<SocketAddr>();
    if let Err(e) = axum::serve(listener, service).await {
        log_line(&format!("[gate] stopped: {e}"));
    }
}

fn allowed(access: &Access, peer: SocketAddr, headers: &HeaderMap, check_origin: bool) -> bool {
    let get = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let forwarded_for = get("x-forwarded-for");
    let req = RequestInfo {
        host: get("host"),
        origin: get("origin"),
        forwarded_for,
        via_tailscale: forwarded_for.is_some() && is_tailscale_daemon(peer, GATE_PORT),
        check_origin,
    };
    decide(&req, &access.tailnet(), cfg!(debug_assertions), GATE_PORT)
        .inspect_err(|why| log_line(&format!("[gate] refused {forwarded_for:?}: {why}")))
        .is_ok()
}

async fn status_route(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(access): State<Arc<Access>>,
) -> Response {
    if !allowed(&access, peer, &headers, false) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let running = tokio::task::spawn_blocking(arkadia_running)
        .await
        .unwrap_or(false);
    Json(serde_json::json!({ "arkadia": running })).into_response()
}

async fn open_route(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(access): State<Arc<Access>>,
) -> Response {
    if !allowed(&access, peer, &headers, true) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let started = tokio::task::spawn_blocking(start_arkadia)
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    match started {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => {
            log_line(&format!("[gate] cannot start Arkadia: {e}"));
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

fn start_arkadia() -> Result<(), String> {
    if arkadia_running() {
        return Ok(());
    }
    let exe = std::fs::read_to_string(arkadia_path_file()).map_err(|e| e.to_string())?;
    let exe = PathBuf::from(exe.trim());
    spawn_clean(&exe, "", exe.parent().unwrap_or(&gate_dir()))?;
    log_line("[gate] started Arkadia for the phone");
    Ok(())
}

/// Arkadia side: refreshes the gate copy, starts it and registers it with
/// Windows. Release builds only (a `tauri dev` copy must not replace it).
pub fn install() {
    if cfg!(debug_assertions) {
        return;
    }
    if let Err(e) = try_install() {
        log_line(&format!("[gate] install failed: {e}"));
    }
}

fn try_install() -> Result<(), String> {
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = gate_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(arkadia_path_file(), me.to_string_lossy().as_bytes())
        .map_err(|e| e.to_string())?;

    let gate = dir.join(GATE_EXE);
    if digest(&gate) != digest(&me) {
        // An older gate holds its exe open: stop it before replacing it.
        hidden("taskkill", &["/IM", GATE_EXE, "/F"]);
        std::thread::sleep(Duration::from_millis(500));
        std::fs::copy(&me, &gate).map_err(|e| format!("copy: {e}"))?;
        log_line("[gate] installed a new gate");
    }

    let gate_cmd = format!("\"{}\" {GATE_ARG}", gate.display());
    hidden(
        "reg",
        &[
            "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &gate_cmd, "/f",
        ],
    );

    let up = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], GATE_PORT)),
        Duration::from_millis(300),
    )
    .is_ok();
    if !up {
        spawn_clean(&gate, GATE_ARG, &dir).map_err(|e| format!("start: {e}"))?;
    }
    Ok(())
}

/// Starts a program that outlives us (the gate, or Arkadia from the gate)
/// detached and without inheriting any handle: a child started the usual way
/// gets our inheritable handles, sockets included, and keeps them open.
#[cfg(windows)]
fn spawn_clean(exe: &Path, args: &str, cwd: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        CreateProcessW, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS, PROCESS_INFORMATION,
        STARTUPINFOW,
    };
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let app = wide(exe.as_os_str());
    let dir = wide(cwd.as_os_str());
    let mut cmdline = wide(format!("\"{}\" {args}", exe.display()).as_ref());
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut info = PROCESS_INFORMATION::default();
    // SAFETY: every buffer is NUL-terminated and outlives the call; the two
    // returned handles are closed right after.
    unsafe {
        CreateProcessW(
            PCWSTR(app.as_ptr()),
            Some(PWSTR(cmdline.as_mut_ptr())),
            None,
            None,
            false,
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            None,
            PCWSTR(dir.as_ptr()),
            &startup,
            &mut info,
        )
        .map_err(|e| e.to_string())?;
        let _ = CloseHandle(info.hProcess);
        let _ = CloseHandle(info.hThread);
    }
    Ok(())
}

#[cfg(not(windows))]
fn spawn_clean(exe: &Path, args: &str, cwd: &Path) -> Result<(), String> {
    std::process::Command::new(exe)
        .args(args.split_whitespace())
        .current_dir(cwd)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn digest(path: &std::path::Path) -> Option<Vec<u8>> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path).ok()?;
    Some(Sha256::digest(&bytes).to_vec())
}

/// Runs a system tool without flashing a console; its outcome is not needed.
fn hidden(program: &str, args: &[&str]) {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console over the app.
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd.output();
}
