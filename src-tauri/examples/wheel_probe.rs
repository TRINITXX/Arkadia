//! Minimal probe: does Claude Code react to SGR wheel-up AND wheel-down?
//! Usage: cargo run --example wheel_probe -- <session-id> <cwd>

use arkadia_lib::terminal_state::TerminalState;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

fn main() {
    let mut args = std::env::args().skip(1);
    let session = args.next().expect("session id");
    let cwd = args.next().expect("cwd");
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
    let mut child = pair.slave.spawn_command(cmd).expect("spawn");

    let term = Arc::new(Mutex::new(TerminalState::new(45, 140)));
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let t2 = term.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => t2.lock().advance_bytes(&buf[..n]),
            }
        }
    });
    let mut writer = pair.master.take_writer().expect("writer");
    std::thread::sleep(Duration::from_secs(10));

    let hash = |label: &str| {
        let t = term.lock();
        println!("{label}: hash={:x}", t.screen_content_hash());
    };
    hash("start");
    for i in 0..40 {
        let _ = writer.write_all(b"\x1b[<64;5;22M");
        let _ = writer.flush();
        std::thread::sleep(Duration::from_millis(250));
        hash(&format!("up {i}"));
    }
    // Recovery attempts from the wedged top state: slow wheel-downs, with a
    // wheel-up thrown in at #7, then PageDown-style keys at the end.
    for i in 0..15 {
        let seq: &[u8] = if i == 7 {
            b"\x1b[<64;5;22M"
        } else {
            b"\x1b[<65;5;22M"
        };
        let _ = writer.write_all(seq);
        let _ = writer.flush();
        std::thread::sleep(Duration::from_millis(400));
        hash(&format!("down {i}"));
    }
    let _ = child.kill();
}
