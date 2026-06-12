//! Feed a raw PTY capture (see capture_claude.rs) through TerminalState and
//! dump the message classification per row — ground-truth debugging for the
//! conversation tint/navigation feature.
//!
//! Usage: cargo run --example classify_capture -- <capture-file>

use arkadia_lib::terminal_state::TerminalState;

fn main() {
    let path = std::env::args().nth(1).expect("capture file");
    let bytes = std::fs::read(&path).expect("read capture");
    let mut t = TerminalState::new(45, 140);
    t.advance_bytes(&bytes);

    println!("scrollback_len = {}", t.scrollback_len());
    println!("markers = {:?}", t.message_markers());
    println!("visible kinds(0) = {:?}", t.visible_line_kinds(0));
    println!("--- per visible row: col0 cell ---");
    for row in 0..45u16 {
        let cell = t.cell_at(0, row, 0);
        let (text, fg, bg) = match cell {
            Some(c) => (
                c.text.clone(),
                format!("{:?}", c.attrs.fg),
                format!("{:?}", c.attrs.bg),
            ),
            None => ("<none>".into(), "-".into(), "-".into()),
        };
        // bg at a few columns to see how far a block background extends.
        let bg_at = |col: u16| {
            t.cell_at(0, row, col)
                .map(|c| match &c.attrs.bg {
                    termwiz::color::ColorAttribute::Default => "D".to_string(),
                    other => format!("{other:?}").chars().take(28).collect(),
                })
                .unwrap_or_default()
        };
        let mut line = String::new();
        for col in 0..40u16 {
            if let Some(c) = t.cell_at(0, row, col) {
                if c.width > 0 {
                    line.push_str(&c.text);
                }
            }
        }
        println!(
            "row {row:2}: col0={text:?} fg={fg} bg0={bg} bg5={} bg60={} bg120={} | {line:?}",
            bg_at(5),
            bg_at(60),
            bg_at(120)
        );
    }
}
