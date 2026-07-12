//! Replay a raw PTY capture (from `capture_claude.rs`) FRAME BY FRAME and dump,
//! for every frame that contains a tool/thinking region, each row's computed
//! kind (0/1/2) next to the first-content cell's fg / dim / italic. Ground truth
//! for how Bash output and thinking are rendered and whether the tint classifier
//! leaves them untinted while their head is off the top.
//!
//! Usage: cargo run --example classify_frames -- <capture-file>

use arkadia_lib::terminal_state::{TerminalCell, TerminalState};

const ROWS: u16 = 45;
const COLS: u16 = 140;

fn row_cells(t: &TerminalState, row: u16) -> Vec<TerminalCell> {
    (0..COLS)
        .filter_map(|c| t.cell_at(0, row, c).cloned())
        .collect()
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
    cells
        .iter()
        .enumerate()
        .find(|(_, c)| !c.text.trim().is_empty())
}
fn fg_short(fg: &termwiz::color::ColorAttribute) -> String {
    use termwiz::color::ColorAttribute::*;
    match fg {
        Default => "Def".into(),
        PaletteIndex(i) => format!("P{i}"),
        TrueColorWithDefaultFallback(c) | TrueColorWithPaletteFallback(c, _) => {
            format!(
                "#{:02x}{:02x}{:02x}",
                (c.0 * 255.0) as u8,
                (c.1 * 255.0) as u8,
                (c.2 * 255.0) as u8
            )
        }
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("capture file");
    let bytes = std::fs::read(&path).expect("read capture");

    let mut t = TerminalState::new(ROWS, COLS);
    let mut last_hash = 0u64;
    let mut frame = 0;
    // Feed in small chunks so intermediate (scrolled) frames are observed, not
    // just the final screen.
    for chunk in bytes.chunks(512) {
        t.advance_bytes(chunk);
        let h = t.screen_content_hash();
        if h == last_hash {
            continue;
        }
        last_hash = h;

        let cells_per_row: Vec<Vec<TerminalCell>> = (0..ROWS).map(|r| row_cells(&t, r)).collect();
        // Only dump frames that actually contain a tool/thinking region.
        let interesting = cells_per_row.iter().any(|cells| {
            first_content(cells)
                .and_then(|(_, c)| c.text.trim().chars().next())
                .map(|ch| matches!(ch, '⎿' | '↳' | '∴' | '·' | '✻' | '✶'))
                .unwrap_or(false)
        });
        if !interesting {
            continue;
        }
        frame += 1;
        let kinds = t.visible_line_kinds(0);
        println!(
            "\n===== frame {frame} (on_alt={}) =====",
            t.is_on_alt_screen()
        );
        for (r, cells) in cells_per_row.iter().enumerate() {
            let txt = row_text(cells);
            let k = kinds.get(r).copied().unwrap_or(0);
            if txt.is_empty() && k == 0 {
                continue;
            }
            let mark = match k {
                2 => "C",
                1 => "U",
                _ => ".",
            };
            let (idx, attrs) = match first_content(cells) {
                Some((i, c)) => (
                    i as i32,
                    format!(
                        "fg={:<8} dim={} ital={}",
                        fg_short(&c.attrs.fg),
                        c.attrs.dim as u8,
                        c.attrs.italic as u8
                    ),
                ),
                None => (-1, "—".into()),
            };
            let shown: String = txt.chars().take(58).collect();
            println!("  [{mark}] r{r:>2} idx={idx:>2} {attrs:<30} {shown:?}");
        }
    }
    eprintln!("dumped {frame} interesting frames");
}
