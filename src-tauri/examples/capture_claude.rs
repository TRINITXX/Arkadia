//! Debug capture: spawn `claude --resume <session>` under a ConPTY, record
//! the raw bytes it emits while rendering the transcript, and dump them to a
//! file for offline analysis of the exact glyphs/colors Claude Code prints.
//!
//! Usage: cargo run --example capture_claude -- <session-id> <cwd> <out-file>

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn main() {
    let mut args = std::env::args().skip(1);
    let session = args.next().expect("session id");
    let cwd = args.next().expect("cwd");
    let out = args.next().expect("out file");

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 45,
            cols: 140,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut cmd = CommandBuilder::new("claude");
    cmd.arg("--resume");
    cmd.arg(&session);
    cmd.cwd(&cwd);
    let mut child = pair.slave.spawn_command(cmd).expect("spawn claude");

    let mut reader = pair.master.try_clone_reader().expect("reader");
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Capture the initial render, then send SGR wheel-up events (Claude Code
    // enables mouse tracking) so it scrolls its internal transcript and we
    // capture older content too. Wheel events are not "input" — the resumed
    // session is never written to.
    let mut writer = pair.master.take_writer().expect("writer");
    let mut all: Vec<u8> = Vec::new();
    let start = Instant::now();
    let mut wheel_sent = 0u32;
    let mut next_wheel = Duration::from_secs(6);
    while start.elapsed() < Duration::from_secs(20) {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => all.extend_from_slice(&chunk),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if start.elapsed() >= next_wheel && wheel_sent < 40 {
            use std::io::Write as _;
            let _ = writer.write_all(b"\x1b[<64;40;20M"); // SGR wheel-up
            let _ = writer.flush();
            wheel_sent += 1;
            next_wheel = start.elapsed() + Duration::from_millis(120);
        }
    }
    let _ = child.kill();
    std::fs::write(&out, &all).expect("write capture");
    eprintln!(
        "captured {} bytes ({wheel_sent} wheel-ups) -> {}",
        all.len(),
        out
    );
}
