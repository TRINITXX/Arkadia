//! End-to-end check of `wheel_navigate` against a real `claude --resume`
//! running in a ConPTY: navigate to previous user / Claude messages and dump
//! the centered row after each jump.
//!
//! Usage: cargo run --example navigate_live -- <session-id> <cwd>

use arkadia_lib::terminal_state::{wheel_navigate, TerminalState};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

const ROWS: u16 = 45;
const COLS: u16 = 140;

fn main() {
    let mut args = std::env::args().skip(1);
    let session = args.next().expect("session id");
    let cwd = args.next().expect("cwd");

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: ROWS,
            cols: COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");
    let mut cmd = CommandBuilder::new("claude");
    cmd.arg("--resume");
    cmd.arg(&session);
    cmd.cwd(&cwd);
    let mut child = pair.slave.spawn_command(cmd).expect("spawn claude");

    let term = Arc::new(Mutex::new(TerminalState::new(ROWS, COLS)));
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let term_reader = term.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => term_reader.lock().advance_bytes(&buf[..n]),
            }
        }
    });

    // Let the transcript render.
    std::thread::sleep(Duration::from_secs(12));
    {
        let t = term.lock();
        println!(
            "on_alt={} mouse={:?} markers(user)={:?} markers(claude)={:?}",
            t.is_on_alt_screen(),
            t.mouse_protocol(),
            t.visible_markers_with_hash(1)
                .iter()
                .map(|m| m.0)
                .collect::<Vec<_>>(),
            t.visible_markers_with_hash(2)
                .iter()
                .map(|m| m.0)
                .collect::<Vec<_>>(),
        );
    }

    let writer = Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));
    let send_wheel = |up: bool| {
        let seq = if up {
            b"\x1b[<64;5;22M"
        } else {
            b"\x1b[<65;5;22M"
        };
        let mut w = writer.lock();
        let _ = w.write_all(seq);
        let _ = w.flush();
    };

    let center = ROWS / 2;
    let dump_center = |label: &str| {
        let t = term.lock();
        println!(
            "{label} markers user={:?} claude={:?}",
            t.visible_markers_with_hash(1)
                .iter()
                .map(|m| m.0)
                .collect::<Vec<_>>(),
            t.visible_markers_with_hash(2)
                .iter()
                .map(|m| m.0)
                .collect::<Vec<_>>(),
        );
        for row in (center - 4)..=(center + 4) {
            let mut line = String::new();
            for col in 0..60u16 {
                if let Some(c) = t.cell_at(0, row, col) {
                    if c.width > 0 {
                        line.push_str(&c.text);
                    }
                }
            }
            println!("{label} row {row}: {line:?}");
        }
    };

    for (kind, label) in [(1u8, "user"), (2u8, "claude")] {
        let mut anchor: Option<u64> = None;
        for i in 0..3 {
            let (ok, t) = wheel_navigate(&term, send_wheel, kind, -1, ROWS, anchor, &|| false);
            anchor = t;
            println!("--- prev {label} #{i} -> {ok}");
            dump_center(label);
        }
        if kind == 2 {
            // And one hop forward (newer).
            let (ok, _) = wheel_navigate(&term, send_wheel, 2, 1, ROWS, anchor, &|| false);
            println!("--- next claude -> {ok}");
            dump_center("claude+1");
        }
    }

    // Sanity probe: is wheel-down processed at all right now?
    {
        let t = term.lock();
        println!(
            "post: on_alt={} mouse={:?} hash={:x}",
            t.is_on_alt_screen(),
            t.mouse_protocol(),
            t.screen_content_hash()
        );
    }
    for _ in 0..10 {
        send_wheel(false);
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::sleep(Duration::from_millis(500));
    {
        let t = term.lock();
        println!("after 10 wheel-downs: hash={:x}", t.screen_content_hash());
    }
    dump_center("post-down");
    match child.try_wait() {
        Ok(Some(status)) => println!("claude EXITED during the test: {status:?}"),
        Ok(None) => println!("claude still alive"),
        Err(e) => println!("try_wait error: {e}"),
    }

    let _ = child.kill();
}
