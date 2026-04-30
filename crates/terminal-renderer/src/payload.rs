//! Mirrors the `RenderPayload` shape emitted by `src-tauri/src/terminal.rs`.
//! Decoded via `serde-wasm-bindgen` from the JS `terminal-render` event payload.

use serde::Deserialize;

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CellColor {
    Default,
    Ansi { idx: u8 },
    Rgb { value: String },
}

fn default_cell_width() -> u8 {
    1
}

#[derive(Deserialize, Debug)]
pub struct CellRun {
    pub text: String,
    pub fg: CellColor,
    pub bg: CellColor,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// 0 = none, 1 = single, 2 = double, 3 = curly, 4 = dotted, 5 = dashed.
    #[serde(default)]
    pub underline_style: u8,
    #[serde(default)]
    pub inverse: bool,
    #[serde(default)]
    pub strikethrough: bool,
    /// OSC 8 hyperlink target. Optional.
    #[serde(default)]
    pub hyperlink: Option<String>,
    /// Visual cell width per char in this run: 1 for normal, 2 for CJK / emoji.
    /// Defaults to 1 so older payloads (pre-V1.8) still parse.
    #[serde(default = "default_cell_width")]
    pub cell_width: u8,
}

#[derive(Deserialize, Debug)]
pub struct RenderPayload {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub cursor_visible: bool,
    #[serde(default)]
    pub title: String,
    pub lines: Vec<Vec<CellRun>>,
    #[serde(default)]
    pub scroll_offset: u32,
    #[serde(default)]
    pub scroll_max: u32,
}

/// JS-side palette: arrays of `[r, g, b, a]` floats in [0, 1].
#[derive(Deserialize, Debug)]
pub struct TerminalPalette {
    pub bg: [f32; 4],
    pub fg: [f32; 4],
    pub ansi: [[f32; 4]; 16],
}
