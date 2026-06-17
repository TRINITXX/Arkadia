//! Debug capture of the message-tint (`visible_line_kinds`) on a long Claude
//! message whose `●` head has scrolled off the top of the alt screen — the case
//! where only the bottom of one assistant message gets the violet frame.
//!
//! Spawns a fresh `claude`, asks for a long structured markdown answer, then
//! scrolls up a few notches and dumps each visible row's text alongside the kind
//! the renderer computes (0=none, 1=user, 2=Claude).
//!
//! Usage: cargo run --example capture_tint -- [cwd]

use arkadia_lib::terminal_state::TerminalState;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

const ROWS: u16 = 40;
const COLS: u16 = 120;

fn row_text(t: &TerminalState, row: u16) -> String {
    let mut s = String::new();
    for col in 0..COLS {
        if let Some(c) = t.cell_at(0, row, col) {
            if c.width > 0 {
                s.push_str(&c.text);
            }
        }
    }
    s.trim_end().to_string()
}

fn main() {
    let cwd = std::env::args()
        .nth(1)
        .unwrap_or_else(|| std::env::current_dir().unwrap().to_string_lossy().into());

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

    let mut writer = pair.master.take_writer().expect("writer");
    std::thread::sleep(Duration::from_secs(5));

    // Mirror the reported screenshot but MUCH taller than the 40-row window, so
    // at rest (scrolled to the bottom) the `●` head is off the top of the screen
    // — the exact condition under which the tint must survive via the cache.
    let prompt = "Write ONE very long answer in French, no tool calls. Structure: \
        a 3-line intro paragraph; then a fenced ```js code block of about 15 lines; \
        then a bold header line; then a numbered list of 6 items (each 2 lines); \
        then a 4-line paragraph; then a line with just --- ; \
        then a final 3-line paragraph ending with a question. \
        It MUST be at least 70 lines tall so it overflows the screen.";
    writer.write_all(prompt.as_bytes()).unwrap();
    writer.flush().unwrap();
    std::thread::sleep(Duration::from_millis(400));
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    eprintln!("prompt sent; waiting for the long answer…");

    // Wait until streaming finishes: a final paragraph ending with `?` is on
    // screen AND the spinner line is gone for a couple of consecutive polls.
    let start = Instant::now();
    let mut quiet = 0;
    while start.elapsed() < Duration::from_secs(150) {
        std::thread::sleep(Duration::from_millis(500));
        let t = term.lock();
        let mut spinner = false;
        let mut saw_q = false;
        for r in 0..ROWS {
            let s = row_text(&t, r);
            if s.contains("esc to interrupt")
                || s.contains(" tokens")
                || s.starts_with('✻')
                || s.starts_with('✶')
                || s.starts_with('·')
            {
                spinner = true;
            }
            if s.trim_end().ends_with('?') {
                saw_q = true;
            }
        }
        if saw_q && !spinner {
            quiet += 1;
            if quiet >= 2 {
                break;
            }
        } else {
            quiet = 0;
        }
    }
    std::thread::sleep(Duration::from_millis(800));

    let dump = |term: &Mutex<TerminalState>, label: &str| {
        let mut t = term.lock();
        let kinds = t.visible_line_kinds(0);
        println!("\n===== {label} | on_alt={} =====", t.is_on_alt_screen());
        for r in 0..ROWS {
            let txt = row_text(&t, r);
            if txt.is_empty() && kinds.get(r as usize).copied().unwrap_or(0) == 0 {
                continue;
            }
            let k = kinds.get(r as usize).copied().unwrap_or(0);
            // First non-space column + first glyph, to see head vs continuation.
            let col0 = t
                .cell_at(0, r, 0)
                .map(|c| c.text.clone())
                .unwrap_or_default();
            let mark = match k {
                2 => "C",
                1 => "U",
                _ => ".",
            };
            println!("  [{mark}] r{r:>2} col0={col0:?} {txt:?}");
        }
    };

    dump(&term, "AT BOTTOM (head may be on-screen)");

    // Scroll up a few notches so the `●` head leaves the visible area.
    let wheel_up = b"\x1b[<64;5;20M";
    for n in 1..=6 {
        writer.write_all(wheel_up).unwrap();
        writer.flush().unwrap();
        std::thread::sleep(Duration::from_millis(160));
        if n % 2 == 0 {
            dump(&term, &format!("AFTER {n} WHEEL-UPS"));
        }
    }

    let _ = child.kill();
}
