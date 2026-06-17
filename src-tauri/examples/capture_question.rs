//! Debug capture of Claude Code's AskUserQuestion box (single- vs multi-question).
//!
//! Spawns a fresh `claude` interactive TUI under a ConPTY, drives it into calling
//! the AskUserQuestion tool with N questions, then dumps the rendered screen rows
//! (plain text + styled segments, so a highlighted "tab" is visible) and saves the
//! raw PTY bytes as a replayable fixture. Used to base the popup's multi-question
//! detection on the real render, not a guess.
//!
//! Usage: cargo run --example capture_question -- <count> [cwd] [out-bytes-file]

use arkadia_lib::terminal_state::TerminalState;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

const ROWS: u16 = 45;
const COLS: u16 = 120;

fn looks_like_option(s: &str) -> bool {
    // "1. ..", "❯ 1. ..", "> 2. .." — the selectable rows of the box.
    let t = s.trim_start().trim_start_matches(['❯', '>', '│', '┃', ' ']);
    let mut chars = t.chars();
    let mut saw_digit = false;
    for c in chars.by_ref() {
        if c.is_ascii_digit() {
            saw_digit = true;
        } else {
            return saw_digit && c == '.';
        }
    }
    false
}

fn main() {
    let mut args = std::env::args().skip(1);
    let count: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(3);
    let cwd = args
        .next()
        .unwrap_or_else(|| std::env::current_dir().unwrap().to_string_lossy().into());
    let out_bytes = args.next();

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
    let raw: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let term_reader = term.clone();
    let raw_reader = raw.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    term_reader.lock().advance_bytes(&buf[..n]);
                    raw_reader.lock().extend_from_slice(&buf[..n]);
                }
            }
        }
    });

    let mut writer = pair.master.take_writer().expect("writer");

    // Let the TUI come up.
    std::thread::sleep(Duration::from_secs(5));

    let prompt = format!(
        "Call the AskUserQuestion tool exactly once, right now, with {count} question(s). \
         Use short distinct headers and 3 short options each. \
         Do not write any text and do not call any other tool.",
    );
    writer.write_all(prompt.as_bytes()).unwrap();
    writer.flush().unwrap();
    std::thread::sleep(Duration::from_millis(400));
    writer.write_all(b"\r").unwrap();
    writer.flush().unwrap();
    eprintln!("prompt sent ({count} question(s)); waiting for the box…");

    // Poll until the option box renders (or timeout).
    let start = Instant::now();
    let mut rendered = false;
    while start.elapsed() < Duration::from_secs(90) {
        std::thread::sleep(Duration::from_millis(250));
        let t = term.lock();
        let mut has_option = false;
        for row in 0..ROWS {
            let mut line = String::new();
            for col in 0..COLS {
                if let Some(c) = t.cell_at(0, row, col) {
                    if c.width > 0 {
                        line.push_str(&c.text);
                    }
                }
            }
            if looks_like_option(&line) {
                has_option = true;
                break;
            }
        }
        if has_option {
            rendered = true;
            break;
        }
    }

    // Let the box settle, then dump.
    std::thread::sleep(Duration::from_millis(1200));
    eprintln!(
        "rendered={rendered} after {:?}; dumping screen ({count} question(s))\n",
        start.elapsed()
    );

    // Compact view of the tab/progress bar + nav hint, to trace progression.
    let dump_progress = |term: &Mutex<TerminalState>, label: &str| {
        let t = term.lock();
        println!("--- {label} ---");
        for row in 0..ROWS {
            let mut line = String::new();
            let mut active: Option<String> = None;
            let mut span: Option<(u16, String)> = None;
            for col in 0..COLS {
                if let Some(c) = t.cell_at(0, row, col) {
                    if c.width == 0 {
                        continue;
                    }
                    line.push_str(&c.text);
                    let lav = matches!(
                        c.attrs.bg,
                        termwiz::color::ColorAttribute::TrueColorWithDefaultFallback(_)
                    ) && !c.text.trim().is_empty();
                    if lav {
                        match span.as_mut() {
                            Some((_, txt)) => txt.push_str(&c.text),
                            None => span = Some((col, c.text.clone())),
                        }
                    } else if let Some((_, txt)) = span.take() {
                        if txt.contains('☐') || txt.contains('✔') || txt.contains("Submit") {
                            active = Some(txt);
                        }
                    }
                }
            }
            let l = line.trim_end();
            let is_tabbar = l.contains('←') || l.contains('→') || l.contains("Submit");
            let is_hint = l.contains("to select") || l.contains("to navigate");
            if is_tabbar || is_hint {
                println!("  r{row:>2}: {l:?}  active={active:?}");
            }
        }
    };

    dump_progress(&term, "initial");
    // Drive Enter presses to walk through the questions and reach Submit.
    for i in 1..=(count + 1) {
        let _ = writer.write_all(b"\r");
        let _ = writer.flush();
        std::thread::sleep(Duration::from_millis(900));
        dump_progress(&term, &format!("after Enter #{i}"));
    }
    println!();

    {
        let t = term.lock();
        let (cr, cc) = t.cursor_position();
        println!(
            "=== {count} QUESTION(S) | on_alt={} cursor=({cr},{cc}) ===",
            t.is_on_alt_screen()
        );
        for row in 0..ROWS {
            let mut line = String::new();
            // Styled spans: collect (col, text) for cells with bg!=Default or reverse/bold.
            let mut styled: Vec<String> = Vec::new();
            let mut span: Option<(u16, String, String)> = None;
            for col in 0..COLS {
                if let Some(c) = t.cell_at(0, row, col) {
                    if c.width == 0 {
                        continue;
                    }
                    line.push_str(&c.text);
                    let a = &c.attrs;
                    let is_styled = a.reverse
                        || !matches!(a.bg, termwiz::color::ColorAttribute::Default)
                        || a.bold;
                    if is_styled {
                        let tag = format!("bg={:?} rev={} bold={}", a.bg, a.reverse, a.bold);
                        match span.as_mut() {
                            Some((_, txt, t0)) if *t0 == tag => txt.push_str(&c.text),
                            _ => {
                                if let Some((sc, txt, t0)) = span.take() {
                                    styled.push(format!("[{sc}: {txt:?} {t0}]"));
                                }
                                span = Some((col, c.text.clone(), tag));
                            }
                        }
                    } else if let Some((sc, txt, t0)) = span.take() {
                        styled.push(format!("[{sc}: {txt:?} {t0}]"));
                    }
                }
            }
            if let Some((sc, txt, t0)) = span.take() {
                styled.push(format!("[{sc}: {txt:?} {t0}]"));
            }
            let trimmed = line.trim_end();
            if trimmed.is_empty() && styled.is_empty() {
                continue;
            }
            println!("r{row:>2}: {trimmed:?}");
            if !styled.is_empty() {
                println!("       styled: {}", styled.join(" "));
            }
        }
    }

    if let Some(path) = out_bytes {
        let bytes = raw.lock().clone();
        std::fs::write(&path, &bytes).expect("write raw bytes");
        eprintln!("raw bytes ({}) -> {path}", bytes.len());
    }

    // Don't submit any answer — leave Claude hanging; just kill it.
    let _ = child.kill();
}
