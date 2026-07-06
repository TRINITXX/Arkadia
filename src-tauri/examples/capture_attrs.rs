//! Ground-truth dump for the message-tint classifier on the two reported
//! false-classification cases:
//!   1. a markdown TABLE inside a long Claude answer (box-drawing rows lose the
//!      tint because `orphan_claude_default` rejects box-drawing glyphs), and
//!   2. a THINKING block that wrongly *gets* the tint when its `∴` head is off
//!      the top of the alt screen.
//!
//! For every visible row it prints the computed kind (0/1/2) next to the
//! ATTRIBUTES of the first non-blank cell (fg / dim / italic) — the signals a
//! better heuristic could key on. Run live, then scrolled up a few notches so
//! the heads leave the viewport (the exact orphan condition).
//!
//! Usage: cargo run --example capture_attrs -- [cwd]

use arkadia_lib::terminal_state::{TerminalCell, TerminalState};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

const ROWS: u16 = 40;
const COLS: u16 = 120;

fn row_cells(t: &TerminalState, row: u16) -> Vec<TerminalCell> {
    let mut out = Vec::new();
    for col in 0..COLS {
        if let Some(c) = t.cell_at(0, row, col) {
            out.push(c.clone());
        }
    }
    out
}

fn row_text(cells: &[TerminalCell]) -> String {
    let mut s = String::new();
    for c in cells {
        if c.width > 0 {
            s.push_str(&c.text);
        }
    }
    s.trim_end().to_string()
}

fn first_content(cells: &[TerminalCell]) -> Option<(usize, &TerminalCell)> {
    cells.iter().enumerate().find(|(_, c)| !c.text.trim().is_empty())
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

    // Force BOTH reproduction cases into one tall answer: ultrathink (so a
    // thinking block renders) + a markdown table (box-drawing rows) + lots of
    // prose so the whole thing overflows the 40-row window and the heads scroll
    // off the top.
    let prompt = "ultrathink about terminal renderers, then write ONE long answer in French (no tool calls). \
        It MUST contain: a 3-line intro; a markdown TABLE with 3 columns and 5 rows; \
        a bold header; a numbered list of 6 items (2 lines each); a 5-line paragraph; \
        and a closing paragraph ending with a question. At least 70 lines tall.";
    writer.write_all(prompt.as_bytes()).unwrap();
    writer.flush().unwrap();
    std::thread::sleep(Duration::from_millis(400));
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    eprintln!("prompt sent; waiting for the long answer…");

    let start = Instant::now();
    let mut quiet = 0;
    while start.elapsed() < Duration::from_secs(180) {
        std::thread::sleep(Duration::from_millis(500));
        let t = term.lock();
        let mut spinner = false;
        let mut saw_q = false;
        for r in 0..ROWS {
            let s = row_text(&row_cells(&t, r));
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
            let cells = row_cells(&t, r);
            let txt = row_text(&cells);
            let k = kinds.get(r as usize).copied().unwrap_or(0);
            if txt.is_empty() && k == 0 {
                continue;
            }
            let mark = match k {
                2 => "C",
                1 => "U",
                _ => ".",
            };
            let (idx, attrs) = match first_content(&cells) {
                Some((i, c)) => (
                    i as i32,
                    format!("fg={:?} dim={} ital={}", c.attrs.fg, c.attrs.dim, c.attrs.italic),
                ),
                None => (-1, "—".into()),
            };
            let shown: String = txt.chars().take(70).collect();
            println!("  [{mark}] r{r:>2} idx={idx:>2} {attrs:<46} {shown:?}");
        }
    };

    dump(&term, "AT BOTTOM");

    let wheel_up = b"\x1b[<64;5;20M";
    for n in 1..=8 {
        writer.write_all(wheel_up).unwrap();
        writer.flush().unwrap();
        std::thread::sleep(Duration::from_millis(160));
        if n % 2 == 0 {
            dump(&term, &format!("AFTER {n} WHEEL-UPS"));
        }
    }

    let _ = child.kill();
}
