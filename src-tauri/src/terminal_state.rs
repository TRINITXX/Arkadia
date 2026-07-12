//! Terminal cell grid + scrollback wrapper around `termwiz` escape parser.
//!
//! `termwiz` provides only the parser + primitive types (Action, Cell attrs).
//! We implement a small TerminalState on top: visible screen as `Vec<Vec<TerminalCell>>`,
//! scrollback as `VecDeque<Vec<TerminalCell>>` capped at 20k lines by default
//! (user-configurable, see `set_scrollback_cap`), cursor + SGR state
//! tracking, and minimal alt-screen support (so claude code's TUI works).
//!
//! Goals : strikethrough attribute (vt100 0.15 lacks it) + scroll into history.
//! Reference: WezTerm/wezterm-term (parser→state architecture).

use std::collections::VecDeque;

use serde::Serialize;
use termwiz::cell::{Intensity, Underline};
use termwiz::color::{ColorAttribute, ColorSpec};
use termwiz::escape::csi::{
    Cursor, DecPrivateMode, DecPrivateModeCode, Edit, EraseInDisplay, EraseInLine, Sgr, CSI,
};
use termwiz::escape::parser::Parser;
use termwiz::escape::{Action, ControlCode, Esc, EscCode, OperatingSystemCommand};
use unicode_width::UnicodeWidthChar;

/// Scrollback line cap: default and user-configurable bounds (Settings →
/// "Scrollback"). Each line holds one `TerminalCell` (own `String` + attrs) per
/// column, so the cap directly bounds per-pane memory.
pub const DEFAULT_SCROLLBACK_CAP: usize = 20_000;
pub const SCROLLBACK_CAP_MIN: usize = 1_000;
pub const SCROLLBACK_CAP_MAX: usize = 100_000;

/// Underline rendering style. Wire format: 0 = none, 1 = single, 2 = double,
/// 3 = curly, 4 = dotted, 5 = dashed. Maps to termwiz's `Underline` enum.
pub type UnderlineStyle = u8;
pub const UNDERLINE_NONE: u8 = 0;
pub const UNDERLINE_SINGLE: u8 = 1;
pub const UNDERLINE_DOUBLE: u8 = 2;
pub const UNDERLINE_CURLY: u8 = 3;
pub const UNDERLINE_DOTTED: u8 = 4;
pub const UNDERLINE_DASHED: u8 = 5;

#[derive(Clone, Debug)]
pub struct TerminalCellAttrs {
    pub fg: ColorAttribute,
    pub bg: ColorAttribute,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: UnderlineStyle,
    pub strikethrough: bool,
    pub reverse: bool,
    /// OSC 8 hyperlink URL associated with this cell, if any.
    pub hyperlink: Option<String>,
}

impl Default for TerminalCellAttrs {
    fn default() -> Self {
        Self {
            fg: ColorAttribute::Default,
            bg: ColorAttribute::Default,
            bold: false,
            dim: false,
            italic: false,
            underline: UNDERLINE_NONE,
            strikethrough: false,
            reverse: false,
            hyperlink: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TerminalCell {
    pub text: String,
    pub attrs: TerminalCellAttrs,
    /// Cell display width:
    /// - `1` : normal cell (one column).
    /// - `2` : main cell of a wide grapheme (CJK, emoji). The next cell to the
    ///   right is its continuation.
    /// - `0` : continuation cell — the right half of a width-2 grapheme. Its
    ///   `text` is empty; the renderer skips it.
    pub width: u8,
}

impl Default for TerminalCell {
    fn default() -> Self {
        Self {
            text: " ".to_string(),
            attrs: TerminalCellAttrs::default(),
            width: 1,
        }
    }
}

impl TerminalCell {
    fn continuation() -> Self {
        Self {
            text: String::new(),
            attrs: TerminalCellAttrs::default(),
            width: 0,
        }
    }
}

/// Mouse tracking protocol requested by the running app via DEC private modes.
/// Apps typically enable one of these alongside `MouseEncoding::Sgr`.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseProtocol {
    #[default]
    None,
    /// 1000 — press only.
    X10,
    /// 1002 — press + release + motion-while-button-held.
    ButtonEvent,
    /// 1003 — press + release + all motion (even without button).
    AnyEvent,
}

/// Wire format for mouse event reporting back to the PTY.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseEncoding {
    /// Legacy X10 — `ESC[M` + 3 bytes (Cb+32, Cx+33, Cy+33). Cap col/row at 223.
    #[default]
    Default,
    /// 1006 — `ESC[<Cb;Cx;Cy(M|m)`, no cell limit. Modern apps default to this.
    Sgr,
}

pub struct TerminalState {
    rows: u16,
    cols: u16,
    cursor_row: u16,
    cursor_col: u16,
    cursor_visible: bool,
    title: String,
    saved_cursor: Option<(u16, u16, TerminalCellAttrs)>,
    current_attrs: TerminalCellAttrs,
    main_screen: Vec<Vec<TerminalCell>>,
    alt_screen: Option<Vec<Vec<TerminalCell>>>,
    on_alt: bool,
    scrollback: VecDeque<Vec<TerminalCell>>,
    /// Max scrollback lines kept for this pane (user setting, clamped to
    /// `SCROLLBACK_CAP_MIN..=SCROLLBACK_CAP_MAX`).
    scrollback_cap: usize,
    parser: Parser,
    mouse_protocol: MouseProtocol,
    mouse_encoding: MouseEncoding,
    bracketed_paste: bool,
    /// Alt-screen tint memory: line content hash → message kind, recorded as
    /// lines are classified while their block head (`●`) is on screen, so a
    /// continuation keeps its purple tint after the head scrolls off the top.
    /// Bounded FIFO; user blocks need no cache (their grey band is intrinsic).
    line_kind_cache: std::collections::HashMap<u64, MessageKind>,
    line_kind_order: VecDeque<u64>,
    /// De-bulleted text hashes of lines seen as tool calls (`● Update(…)`).
    /// While a tool runs, Claude Code *blinks* its bullet — the cell toggles to
    /// a space, so the line momentarily looks like an assistant continuation and
    /// the block above bleeds onto it (and gets cached, persisting even after
    /// the tool finishes). Remembering the de-bulleted text lets a blinked-off
    /// frame still be recognised as a tool call. Bounded like `line_kind_cache`.
    tool_line_cache: std::collections::HashSet<u64>,
    tool_line_order: VecDeque<u64>,
    /// Hashes of lines seen as tool / thinking output while their non-message
    /// head (`● Bash(…)`, `∴`, or a `⎿` result marker) was on screen. Lets that
    /// output stay untinted once the head scrolls off the top — without it, white
    /// Bash command output reads exactly like a Claude message body to the
    /// orphan-default and flashes purple on scroll. Bounded like the others.
    none_line_cache: std::collections::HashSet<u64>,
    none_line_order: VecDeque<u64>,
}

/// Cap on the alt-screen tint cache — large enough for any on-screen scroll
/// session, small enough to stay negligible in memory.
const LINE_KIND_CACHE_CAP: usize = 4096;

impl TerminalState {
    pub fn new(rows: u16, cols: u16) -> Self {
        let rows = rows.max(1);
        let cols = cols.max(1);
        Self {
            rows,
            cols,
            cursor_row: 0,
            cursor_col: 0,
            cursor_visible: true,
            title: String::new(),
            saved_cursor: None,
            current_attrs: TerminalCellAttrs::default(),
            main_screen: blank_screen(rows, cols),
            alt_screen: None,
            on_alt: false,
            scrollback: VecDeque::new(),
            scrollback_cap: DEFAULT_SCROLLBACK_CAP,
            parser: Parser::new(),
            mouse_protocol: MouseProtocol::None,
            mouse_encoding: MouseEncoding::Default,
            bracketed_paste: false,
            line_kind_cache: std::collections::HashMap::new(),
            line_kind_order: VecDeque::new(),
            tool_line_cache: std::collections::HashSet::new(),
            tool_line_order: VecDeque::new(),
            none_line_cache: std::collections::HashSet::new(),
            none_line_order: VecDeque::new(),
        }
    }

    pub fn screen_size(&self) -> (u16, u16) {
        (self.rows, self.cols)
    }

    pub fn cursor_position(&self) -> (u16, u16) {
        let row = self.cursor_row.min(self.rows.saturating_sub(1));
        let mut col = self.cursor_col.min(self.cols.saturating_sub(1));
        // Programs sometimes leave the cursor on the continuation cell of a
        // wide grapheme. Snap left so the renderer paints the cursor on the
        // visible main cell.
        if let Some(line) = self.active_screen().get(row as usize) {
            if let Some(cell) = line.get(col as usize) {
                if cell.width == 0 && col > 0 {
                    col -= 1;
                }
            }
        }
        (row, col)
    }

    pub fn cursor_visible(&self) -> bool {
        self.cursor_visible
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn scrollback_len(&self) -> usize {
        if self.on_alt {
            0
        } else {
            self.scrollback.len()
        }
    }

    pub fn scrollback_cap(&self) -> usize {
        self.scrollback_cap
    }

    /// Sets the scrollback line cap (clamped to the supported bounds) and
    /// immediately evicts the oldest lines if the history already exceeds it.
    pub fn set_scrollback_cap(&mut self, cap: usize) {
        self.scrollback_cap = cap.clamp(SCROLLBACK_CAP_MIN, SCROLLBACK_CAP_MAX);
        while self.scrollback.len() > self.scrollback_cap {
            self.scrollback.pop_front();
        }
    }

    pub fn is_on_alt_screen(&self) -> bool {
        self.on_alt
    }

    pub fn mouse_protocol(&self) -> MouseProtocol {
        self.mouse_protocol
    }

    pub fn mouse_encoding(&self) -> MouseEncoding {
        self.mouse_encoding
    }

    pub fn bracketed_paste(&self) -> bool {
        self.bracketed_paste
    }

    /// Case-insensitive substring search across scrollback (oldest first)
    /// then the active screen. `total_row` 0 = oldest scrollback line;
    /// `total_row = scrollback.len()` is row 0 of the visible screen.
    pub fn search(&self, query: &str) -> Vec<SearchHit> {
        if query.is_empty() {
            return Vec::new();
        }
        let needle: Vec<char> = query.chars().flat_map(|c| c.to_lowercase()).collect();
        if needle.is_empty() {
            return Vec::new();
        }
        let mut hits = Vec::new();
        let mut total_row: u32 = 0;
        if !self.on_alt {
            for line in &self.scrollback {
                push_search_hits(line, &needle, total_row, &mut hits);
                total_row += 1;
            }
        }
        let screen = self.active_screen();
        for line in screen {
            push_search_hits(line, &needle, total_row, &mut hits);
            total_row += 1;
        }
        hits
    }

    /// Extracts the text covered by an inclusive selection in *total* row
    /// coordinates (0 = oldest scrollback line, `scrollback_len()` = visible
    /// row 0 — same convention as `search`). Endpoints may be passed in any
    /// order. Continuation cells of wide graphemes are skipped; trailing
    /// blanks are trimmed per line, lines are joined with '\n'.
    pub fn text_range(&self, start_col: u32, start_row: u32, end_col: u32, end_row: u32) -> String {
        let ((sc, sr), (ec, er)) = if (start_row, start_col) > (end_row, end_col) {
            ((end_col, end_row), (start_col, start_row))
        } else {
            ((start_col, start_row), (end_col, end_row))
        };
        let sb_len = self.scrollback_len() as u32;
        let total_rows = sb_len + self.rows as u32;
        if sr >= total_rows {
            return String::new();
        }
        let er = er.min(total_rows - 1);
        let mut lines: Vec<String> = Vec::new();
        for row in sr..=er {
            let line: &[TerminalCell] = if row < sb_len {
                &self.scrollback[row as usize]
            } else {
                match self.active_screen().get((row - sb_len) as usize) {
                    Some(l) => l,
                    None => continue,
                }
            };
            let mut row_text = String::new();
            for (idx, cell) in line.iter().enumerate() {
                let col = idx as u32;
                // Continuation cell (right half of a wide grapheme): the main
                // cell on its left already contributed the full text.
                if cell.width == 0 {
                    continue;
                }
                let selected = if sr == er {
                    col >= sc && col <= ec
                } else if row == sr {
                    col >= sc
                } else if row == er {
                    col <= ec
                } else {
                    true
                };
                if selected {
                    row_text.push_str(&cell.text);
                }
            }
            lines.push(row_text.trim_end().to_string());
        }
        // Trim trailing empty lines then join with newline.
        while lines.last().map(|s: &String| s.is_empty()).unwrap_or(false) {
            lines.pop();
        }
        lines.join("\n")
    }

    /// Line at `total_row` (same convention as `search`): scrollback first,
    /// then the active screen.
    fn line_at_total(&self, total_row: u32) -> Option<&[TerminalCell]> {
        let sb_len = self.scrollback_len();
        let r = total_row as usize;
        if r < sb_len {
            return self.scrollback.get(r).map(|l| l.as_slice());
        }
        self.active_screen().get(r - sb_len).map(|l| l.as_slice())
    }

    /// Heads of user/Claude message blocks across scrollback + screen,
    /// oldest first. On the alt screen (where Claude Code's TUI lives and
    /// `scrollback_len()` is 0) this covers the visible screen only.
    pub fn message_markers(&self) -> Vec<MessageMarker> {
        let total = self.scrollback_len() + self.active_screen().len();
        let mut out = Vec::new();
        for r in 0..total {
            let Some(line) = self.line_at_total(r as u32) else {
                continue;
            };
            if let Some(kind @ (MessageKind::User | MessageKind::Claude)) = block_head_kind(line) {
                out.push(MessageMarker {
                    total_row: r as u32,
                    kind: kind.as_u8(),
                });
            }
        }
        out
    }

    /// One `MessageKind` (as u8) per visible row at `scroll_offset` — the
    /// tint the frontend paints behind each line.
    ///
    /// A line with a non-space character in column 0 starts a block; indented
    /// and blank lines belong to the block above. Blank lines are tinted only
    /// when more block content follows (interior paragraph gap), so trailing
    /// gaps between blocks stay unpainted. On the alt screen (Claude Code's
    /// TUI) there is no scrollback: the visible screen is classified as-is.
    pub fn visible_line_kinds(&mut self, scroll_offset: u32) -> Vec<u8> {
        let rows = self.rows as usize;
        let on_alt = self.on_alt;
        let offset = if on_alt {
            0
        } else {
            self.clamp_scroll(scroll_offset) as usize
        };
        let sb_len = self.scrollback_len();
        let total = sb_len + self.active_screen().len();
        let first = sb_len - offset; // total row of visible row 0
                                     // Block state at the first visible row: replay from the nearest head
                                     // at or above it. Heads are O(1) to test, so the walk up is cheap.
        let mut cur = MessageKind::None;
        // Whether we're inside a non-tinted block established by a *visible* head
        // (tool call, banner, thinking line). Distinguishes "intentional None"
        // from "orphan None" so the orphan-default below never overrides real
        // tool output whose head is on screen.
        let mut in_none_block = false;
        let mut head_row = None;
        for r in (0..=first).rev() {
            if let Some(line) = self.line_at_total(r as u32) {
                if block_head_kind(line).is_some() {
                    head_row = Some(r);
                    break;
                }
            }
        }
        if let Some(hr) = head_row {
            for r in hr..first {
                if let Some(line) = self.line_at_total(r as u32) {
                    cur = advance_block(cur, line);
                    if let Some(k) = block_head_kind(line) {
                        in_none_block = k == MessageKind::None;
                    }
                }
            }
        }
        let mut kinds = Vec::with_capacity(rows);
        let mut to_cache: Vec<(u64, MessageKind)> = Vec::new();
        let mut tool_to_cache: Vec<u64> = Vec::new();
        let mut none_to_cache: Vec<u64> = Vec::new();
        // Whether the current Claude run was *guessed* by the orphan-default
        // rather than anchored by a real `●` head / band / cache hit. Guesses are
        // shown but never cached — caching a guess makes it permanent, which is
        // how a thinking block's body stayed purple after its `∴` head scrolled
        // back on screen (the reported false positive).
        let mut cur_is_orphan = false;
        for vis in 0..rows {
            let r = first + vis;
            let Some(line) = self.line_at_total(r as u32) else {
                kinds.push(0);
                continue;
            };
            cur = advance_block(cur, line);
            // A real anchor (any head line, or a user grey-band row) is hard
            // evidence — it clears the "guessed" flag so the run below it caches.
            if block_head_kind(line).is_some() || cur == MessageKind::User {
                cur_is_orphan = false;
            }
            // A visible head that isn't tinted (tool call, banner, thinking line)
            // opens a non-tinted block — remember it so the orphan-default below
            // doesn't repaint that block's body as Claude.
            if let Some(k) = block_head_kind(line) {
                in_none_block = k == MessageKind::None;
            }
            // A `⎿`/`↳` result marker is the head of a tool call's *output*. Its
            // `● Tool(…)` line is often a row or two above the top, so treat the
            // marker itself as opening a non-message block — this protects white
            // command output (e.g. Bash) sitting below it from the orphan-default.
            if is_tool_result_marker(line) {
                in_none_block = true;
            }
            // Tool calls (`● Update(…)`, `● Search(…)`) share the bullet with
            // assistant text but must never be framed. A running tool *blinks*
            // its bullet: the cell toggles to a space, so the line momentarily
            // looks like a continuation and the block above bleeds onto it. We
            // remember each bulleted tool line by its de-bulleted text; on a
            // blinked-off frame of the same line, end the block here instead of
            // inheriting the assistant kind.
            let is_known_tool_line =
                on_alt && self.tool_line_cache.contains(&hash_debulleted(line));
            if on_alt && line_starts_with_bullet(line) && is_tool_call_line(line) {
                tool_to_cache.push(hash_debulleted(line));
            } else if cur != MessageKind::None
                && is_known_tool_line
                && block_head_kind(line).is_none()
            {
                cur = MessageKind::None;
            }
            // Alt screen only: when `advance_block` has no context for a line
            // (its `●` head is off the top, e.g. below Claude Code's pinned
            // sticky user-prompt header), recover the Claude tint from the
            // scroll cache and let it propagate down. User blocks need no cache
            // — their grey band is intrinsic in `advance_block`. A known tool
            // line is never recovered as Claude (it would undo the reset above).
            if on_alt
                && cur == MessageKind::None
                && !in_none_block
                && !line_is_blank(line)
                && !is_right_aligned(line)
                && !is_known_tool_line
            {
                if self.line_kind_cache.get(&hash_line(line)) == Some(&MessageKind::Claude) {
                    // Anchored by a frame where the `●` head was on screen.
                    cur = MessageKind::Claude;
                    cur_is_orphan = false;
                } else if self.none_line_cache.contains(&hash_line(line)) {
                    // Seen as tool/thinking output under a visible head or `⎿` on
                    // an earlier frame — keep it untinted now that the head is off
                    // the top, instead of guessing it is a Claude message. This is
                    // what stops white Bash output flashing purple while scrolling.
                } else if orphan_claude_default(line) {
                    // No head, no cache hit, and not inside a tool/banner block:
                    // an indented prose/code/table line this deep in an orphan
                    // window is assistant text — tint it so long Claude answers
                    // stay framed. A guess: shown now, but not cached below.
                    cur = MessageKind::Claude;
                    cur_is_orphan = true;
                }
            }
            let pushed = if cur == MessageKind::Claude && line_is_blank(line) {
                // Tint only interior gaps: scan to the next non-blank line of
                // the same block (bounded by the gap length).
                let mut k = MessageKind::None;
                for nr in (r + 1)..total {
                    let Some(next) = self.line_at_total(nr as u32) else {
                        break;
                    };
                    if block_head_kind(next).is_some() {
                        break;
                    }
                    if !line_is_blank(next) {
                        k = cur;
                        break;
                    }
                }
                k
            } else {
                cur
            };
            kinds.push(pushed.as_u8());
            // Remember the classification of real content so the tint survives
            // the head scrolling off the alt screen on a later frame — but only
            // when it was *anchored* (head/band/cache), never an orphan-default
            // guess. Caching a guess makes it stick after the real head returns.
            if on_alt
                && pushed != MessageKind::None
                && !line_is_blank(line)
                && !(pushed == MessageKind::Claude && cur_is_orphan)
            {
                to_cache.push((hash_line(line), pushed));
            }
            // Symmetric to the Claude cache: remember tool/thinking output seen
            // while its non-message head (or `⎿`) is on screen, so it stays
            // untinted once that head scrolls off the top. Right-aligned footers
            // are excluded — they are chrome, not a block's output.
            if on_alt
                && in_none_block
                && pushed == MessageKind::None
                && !line_is_blank(line)
                && !is_right_aligned(line)
            {
                none_to_cache.push(hash_line(line));
            }
        }
        for (h, k) in to_cache {
            self.record_line_kind(h, k);
        }
        for h in tool_to_cache {
            self.record_tool_line(h);
        }
        for h in none_to_cache {
            self.record_none_line(h);
        }
        kinds
    }

    /// Records a line's classification in the bounded alt-screen tint cache.
    fn record_line_kind(&mut self, hash: u64, kind: MessageKind) {
        if kind == MessageKind::None {
            return;
        }
        if self.line_kind_cache.insert(hash, kind).is_none() {
            self.line_kind_order.push_back(hash);
            if self.line_kind_order.len() > LINE_KIND_CACHE_CAP {
                if let Some(old) = self.line_kind_order.pop_front() {
                    self.line_kind_cache.remove(&old);
                }
            }
        }
    }

    /// Records a tool-call line's de-bulleted hash in the bounded cache, so a
    /// later frame with the bullet blinked off is still recognised as a tool call.
    fn record_tool_line(&mut self, hash: u64) {
        if self.tool_line_cache.insert(hash) {
            self.tool_line_order.push_back(hash);
            if self.tool_line_order.len() > LINE_KIND_CACHE_CAP {
                if let Some(old) = self.tool_line_order.pop_front() {
                    self.tool_line_cache.remove(&old);
                }
            }
        }
    }

    /// Records a tool/thinking output line's hash in the bounded none cache, so a
    /// later frame with the head scrolled off keeps it untinted instead of
    /// orphan-defaulting it to Claude.
    fn record_none_line(&mut self, hash: u64) {
        if self.none_line_cache.insert(hash) {
            self.none_line_order.push_back(hash);
            if self.none_line_order.len() > LINE_KIND_CACHE_CAP {
                if let Some(old) = self.none_line_order.pop_front() {
                    self.none_line_cache.remove(&old);
                }
            }
        }
    }

    /// Marker rows of `kind` on the visible screen (live view, offset 0),
    /// each paired with a content hash of its head line so the alt-screen
    /// navigation loop can track a target line across app-driven redraws.
    pub fn visible_markers_with_hash(&self, kind: u8) -> Vec<(u16, u64)> {
        let mut out = Vec::new();
        for (row, line) in self.active_screen().iter().enumerate() {
            if let Some(k) = block_head_kind(line) {
                if k.as_u8() == kind {
                    out.push((row as u16, hash_line(line)));
                }
            }
        }
        out
    }

    /// Hash of the whole visible screen — a cheap "did the app redraw" probe
    /// for the alt-screen navigation loop.
    pub fn screen_content_hash(&self) -> u64 {
        use std::hash::Hasher;
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for line in self.active_screen() {
            h.write_u64(hash_line(line));
        }
        h.finish()
    }

    /// Returns the cell at (row, col) of the visible screen, considering scroll offset.
    /// `scroll_offset` = 0 means live (bottom). N means N lines into history.
    pub fn cell_at(&self, scroll_offset: u32, row: u16, col: u16) -> Option<&TerminalCell> {
        let rows = self.rows as usize;
        let r = row as usize;
        let c = col as usize;
        if r >= rows || c >= self.cols as usize {
            return None;
        }
        let n = if self.on_alt {
            0
        } else {
            scroll_offset as usize
        };
        let n = n.min(self.scrollback.len());

        if r < n {
            // From scrollback. scrollback[len - n + r] is the row r when scrolled by n.
            let sb_len = self.scrollback.len();
            let idx = sb_len.checked_sub(n - r)?;
            self.scrollback.get(idx).and_then(|line| line.get(c))
        } else {
            let screen = self.active_screen();
            screen.get(r - n).and_then(|line| line.get(c))
        }
    }

    pub fn clamp_scroll(&self, offset: u32) -> u32 {
        offset.min(self.scrollback.len() as u32)
    }

    pub fn set_size(&mut self, rows: u16, cols: u16) {
        let rows = rows.max(1);
        let cols = cols.max(1);
        if rows == self.rows && cols == self.cols {
            return;
        }
        resize_screen(&mut self.main_screen, rows, cols);
        if let Some(alt) = self.alt_screen.as_mut() {
            resize_screen(alt, rows, cols);
        }
        self.rows = rows;
        self.cols = cols;
        self.cursor_row = self.cursor_row.min(rows - 1);
        self.cursor_col = self.cursor_col.min(cols - 1);
    }

    pub fn advance_bytes(&mut self, bytes: &[u8]) {
        let actions = self.parser.parse_as_vec(bytes);
        for action in actions {
            self.handle_action(action);
        }
    }

    fn active_screen(&self) -> &Vec<Vec<TerminalCell>> {
        if self.on_alt {
            self.alt_screen.as_ref().unwrap_or(&self.main_screen)
        } else {
            &self.main_screen
        }
    }

    fn active_screen_mut(&mut self) -> &mut Vec<Vec<TerminalCell>> {
        if self.on_alt {
            self.alt_screen
                .as_mut()
                .expect("alt screen not initialized")
        } else {
            &mut self.main_screen
        }
    }

    fn handle_action(&mut self, action: Action) {
        match action {
            Action::Print(c) => self.print_char(c),
            Action::PrintString(s) => {
                for c in s.chars() {
                    self.print_char(c);
                }
            }
            Action::Control(code) => self.handle_control(code),
            Action::CSI(csi) => self.handle_csi(csi),
            Action::OperatingSystemCommand(osc) => self.handle_osc(*osc),
            Action::Esc(esc) => self.handle_esc(esc),
            // DCS, sixel, etc. — ignored.
            _ => {}
        }
    }

    fn print_char(&mut self, c: char) {
        if c == '\0' {
            return;
        }
        let width = char_cell_width(c);
        if width == 0 {
            if c == '\u{FE0F}' {
                // VS16 (emoji presentation selector): upgrade the previous
                // cell to width 2 so the grid matches what callers that count
                // "emoji = 2 cells" (Markdown table formatters, Claude Code)
                // expect. No-op when the prev cell is already wide / empty /
                // a continuation, or when there's no room for the partner.
                self.upgrade_prev_to_emoji_width();
            }
            // Other combining marks / nonprint: skip. V1.8 doesn't attach
            // them to the previous cell's text (full grapheme clustering
            // would).
            return;
        }

        // Wrap if there's no room for the (potentially wide) glyph.
        if self.cursor_col + width as u16 > self.cols {
            self.cursor_col = 0;
            self.line_feed();
        }

        let row = self.cursor_row as usize;
        let col = self.cursor_col as usize;
        let cols = self.cols as usize;
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();

        let Some(line) = screen.get_mut(row) else {
            self.cursor_col += width as u16;
            return;
        };

        // If we're stomping on a wide pair, blank its orphan half so we don't
        // leave a dangling continuation or main behind.
        cleanup_overwrite(line, col, &blank);
        if width == 2 && col + 1 < cols {
            cleanup_overwrite(line, col + 1, &blank);
        }

        if let Some(cell) = line.get_mut(col) {
            cell.text = c.to_string();
            cell.attrs = attrs.clone();
            cell.width = width;
        }
        if width == 2 {
            if let Some(cell) = line.get_mut(col + 1) {
                *cell = TerminalCell::continuation();
                cell.attrs = attrs;
            }
        }
        self.cursor_col += width as u16;
    }

    /// VS16 fixup: turn the cell at `cursor_col - 1` into the main of a
    /// width-2 grapheme by writing a continuation in the next column and
    /// advancing the cursor by one. Used when text-presentation-default
    /// emoji (✓ ✻ ☐ …) are followed by U+FE0F to force emoji rendering.
    fn upgrade_prev_to_emoji_width(&mut self) {
        if self.cursor_col == 0 {
            return;
        }
        let prev_col = (self.cursor_col - 1) as usize;
        let cols = self.cols as usize;
        if prev_col + 1 >= cols {
            return;
        }
        let row = self.cursor_row as usize;
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();
        let Some(line) = screen.get_mut(row) else {
            return;
        };
        let prev_width = match line.get(prev_col) {
            Some(c) => c.width,
            None => return,
        };
        // Only upgrade a "normal" width-1 cell. Already-wide or continuation
        // cells are left alone (we'd corrupt the grid).
        if prev_width != 1 {
            return;
        }
        cleanup_overwrite(line, prev_col + 1, &blank);
        if let Some(cell) = line.get_mut(prev_col) {
            cell.width = 2;
        }
        if let Some(cell) = line.get_mut(prev_col + 1) {
            *cell = TerminalCell::continuation();
            cell.attrs = attrs;
        }
        self.cursor_col += 1;
    }

    fn handle_control(&mut self, code: ControlCode) {
        match code {
            ControlCode::LineFeed | ControlCode::VerticalTab | ControlCode::FormFeed => {
                self.line_feed();
            }
            ControlCode::CarriageReturn => {
                self.cursor_col = 0;
            }
            ControlCode::Backspace => {
                if self.cursor_col > 0 {
                    self.cursor_col -= 1;
                }
            }
            ControlCode::HorizontalTab => {
                let next = ((self.cursor_col / 8) + 1) * 8;
                self.cursor_col = next.min(self.cols.saturating_sub(1));
            }
            // Bell is captured by the OSC pre-parser upstream.
            _ => {}
        }
    }

    fn line_feed(&mut self) {
        if self.cursor_row + 1 >= self.rows {
            self.scroll_up_one();
        } else {
            self.cursor_row += 1;
        }
    }

    fn scroll_up_one(&mut self) {
        let cols = self.cols;
        if self.on_alt {
            // Alt screen does not feed scrollback.
            let alt = self.alt_screen.as_mut().expect("alt screen");
            alt.remove(0);
            alt.push(blank_line(cols));
        } else {
            let top = self.main_screen.remove(0);
            self.scrollback.push_back(top);
            while self.scrollback.len() > self.scrollback_cap {
                self.scrollback.pop_front();
            }
            self.main_screen.push(blank_line(cols));
        }
    }

    fn handle_csi(&mut self, csi: CSI) {
        match csi {
            CSI::Sgr(sgr) => self.handle_sgr(sgr),
            CSI::Cursor(c) => self.handle_cursor(c),
            CSI::Edit(edit) => self.handle_edit(edit),
            CSI::Mode(mode) => self.handle_mode(mode),
            _ => {}
        }
    }

    fn handle_sgr(&mut self, sgr: Sgr) {
        match sgr {
            Sgr::Reset => {
                self.current_attrs = TerminalCellAttrs::default();
            }
            Sgr::Intensity(intensity) => match intensity {
                Intensity::Normal => {
                    self.current_attrs.bold = false;
                    self.current_attrs.dim = false;
                }
                Intensity::Bold => {
                    self.current_attrs.bold = true;
                    self.current_attrs.dim = false;
                }
                Intensity::Half => {
                    self.current_attrs.dim = true;
                    self.current_attrs.bold = false;
                }
            },
            Sgr::Italic(b) => self.current_attrs.italic = b,
            Sgr::Underline(u) => {
                self.current_attrs.underline = match u {
                    Underline::None => UNDERLINE_NONE,
                    Underline::Single => UNDERLINE_SINGLE,
                    Underline::Double => UNDERLINE_DOUBLE,
                    Underline::Curly => UNDERLINE_CURLY,
                    Underline::Dotted => UNDERLINE_DOTTED,
                    Underline::Dashed => UNDERLINE_DASHED,
                };
            }
            Sgr::StrikeThrough(b) => self.current_attrs.strikethrough = b,
            Sgr::Inverse(b) => self.current_attrs.reverse = b,
            Sgr::Foreground(spec) => {
                self.current_attrs.fg = colorspec_to_attribute(spec);
            }
            Sgr::Background(spec) => {
                self.current_attrs.bg = colorspec_to_attribute(spec);
            }
            // Underline color, Overline, Font, Blink, Invisible — ignored V1.
            _ => {}
        }
    }

    fn handle_cursor(&mut self, c: Cursor) {
        match c {
            Cursor::Position { line, col } => {
                let r = line.as_zero_based() as i64;
                let cc = col.as_zero_based() as i64;
                self.cursor_row = r.clamp(0, self.rows as i64 - 1) as u16;
                self.cursor_col = cc.clamp(0, self.cols as i64 - 1) as u16;
            }
            Cursor::Up(n) => {
                let n = n as u16;
                self.cursor_row = self.cursor_row.saturating_sub(n);
            }
            Cursor::Down(n) => {
                let n = n as u16;
                self.cursor_row = (self.cursor_row + n).min(self.rows.saturating_sub(1));
            }
            Cursor::Right(n) | Cursor::CharacterPositionForward(n) => {
                let n = n as u16;
                self.cursor_col = (self.cursor_col + n).min(self.cols.saturating_sub(1));
            }
            Cursor::Left(n) | Cursor::CharacterPositionBackward(n) => {
                let n = n as u16;
                self.cursor_col = self.cursor_col.saturating_sub(n);
            }
            Cursor::CharacterAbsolute(col) | Cursor::CharacterPositionAbsolute(col) => {
                let cc = col.as_zero_based() as i64;
                self.cursor_col = cc.clamp(0, self.cols as i64 - 1) as u16;
            }
            Cursor::LinePositionAbsolute(line) => {
                let line = line as i64 - 1;
                self.cursor_row = line.clamp(0, self.rows as i64 - 1) as u16;
            }
            Cursor::NextLine(n) => {
                let n = n as u16;
                self.cursor_row = (self.cursor_row + n).min(self.rows.saturating_sub(1));
                self.cursor_col = 0;
            }
            Cursor::PrecedingLine(n) => {
                let n = n as u16;
                self.cursor_row = self.cursor_row.saturating_sub(n);
                self.cursor_col = 0;
            }
            Cursor::SaveCursor => {
                self.saved_cursor =
                    Some((self.cursor_row, self.cursor_col, self.current_attrs.clone()));
            }
            Cursor::RestoreCursor => {
                if let Some((r, c, a)) = self.saved_cursor.clone() {
                    self.cursor_row = r.min(self.rows.saturating_sub(1));
                    self.cursor_col = c.min(self.cols.saturating_sub(1));
                    self.current_attrs = a;
                }
            }
            _ => {}
        }
    }

    fn handle_edit(&mut self, edit: Edit) {
        match edit {
            Edit::EraseInDisplay(mode) => self.erase_in_display(mode),
            Edit::EraseInLine(mode) => self.erase_in_line(mode),
            Edit::EraseCharacter(n) => self.erase_characters(n),
            Edit::DeleteCharacter(n) => self.delete_characters(n),
            Edit::InsertCharacter(n) => self.insert_characters(n),
            Edit::InsertLine(n) => self.insert_lines(n),
            Edit::DeleteLine(n) => self.delete_lines(n),
            _ => {}
        }
    }

    fn erase_in_display(&mut self, mode: EraseInDisplay) {
        let cols = self.cols as usize;
        let rows = self.rows as usize;
        let cur_row = self.cursor_row as usize;
        let cur_col = self.cursor_col as usize;
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();
        match mode {
            EraseInDisplay::EraseToEndOfDisplay => {
                if let Some(line) = screen.get_mut(cur_row) {
                    for c in cur_col..cols {
                        if let Some(cell) = line.get_mut(c) {
                            *cell = blank.clone();
                        }
                    }
                    fixup_wide_invariant(line, &blank);
                }
                for r in (cur_row + 1)..rows {
                    if let Some(line) = screen.get_mut(r) {
                        for cell in line.iter_mut() {
                            *cell = blank.clone();
                        }
                    }
                }
            }
            EraseInDisplay::EraseToStartOfDisplay => {
                for r in 0..cur_row {
                    if let Some(line) = screen.get_mut(r) {
                        for cell in line.iter_mut() {
                            *cell = blank.clone();
                        }
                    }
                }
                if let Some(line) = screen.get_mut(cur_row) {
                    for c in 0..=cur_col.min(cols.saturating_sub(1)) {
                        if let Some(cell) = line.get_mut(c) {
                            *cell = blank.clone();
                        }
                    }
                    fixup_wide_invariant(line, &blank);
                }
            }
            EraseInDisplay::EraseDisplay | EraseInDisplay::EraseScrollback => {
                for line in screen.iter_mut() {
                    for cell in line.iter_mut() {
                        *cell = blank.clone();
                    }
                }
                if matches!(mode, EraseInDisplay::EraseScrollback) && !self.on_alt {
                    self.scrollback.clear();
                }
            }
        }
    }

    fn erase_in_line(&mut self, mode: EraseInLine) {
        let cols = self.cols as usize;
        let cur_row = self.cursor_row as usize;
        let cur_col = self.cursor_col as usize;
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();
        if let Some(line) = screen.get_mut(cur_row) {
            match mode {
                EraseInLine::EraseToEndOfLine => {
                    for c in cur_col..cols {
                        if let Some(cell) = line.get_mut(c) {
                            *cell = blank.clone();
                        }
                    }
                }
                EraseInLine::EraseToStartOfLine => {
                    for c in 0..=cur_col.min(cols.saturating_sub(1)) {
                        if let Some(cell) = line.get_mut(c) {
                            *cell = blank.clone();
                        }
                    }
                }
                EraseInLine::EraseLine => {
                    for cell in line.iter_mut() {
                        *cell = blank.clone();
                    }
                }
            }
            fixup_wide_invariant(line, &blank);
        }
    }

    fn erase_characters(&mut self, n: u32) {
        let cur_row = self.cursor_row as usize;
        let cur_col = self.cursor_col as usize;
        let cols = self.cols as usize;
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();
        if let Some(line) = screen.get_mut(cur_row) {
            let end = (cur_col + n as usize).min(cols);
            for c in cur_col..end {
                if let Some(cell) = line.get_mut(c) {
                    *cell = blank.clone();
                }
            }
            fixup_wide_invariant(line, &blank);
        }
    }

    fn delete_characters(&mut self, n: u32) {
        let cur_row = self.cursor_row as usize;
        let cur_col = self.cursor_col as usize;
        let cols = self.cols as usize;
        let n = (n as usize).min(cols.saturating_sub(cur_col));
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();
        if let Some(line) = screen.get_mut(cur_row) {
            for _ in 0..n {
                if cur_col < line.len() {
                    line.remove(cur_col);
                    line.push(blank.clone());
                }
            }
            fixup_wide_invariant(line, &blank);
        }
    }

    fn insert_characters(&mut self, n: u32) {
        let cur_row = self.cursor_row as usize;
        let cur_col = self.cursor_col as usize;
        let cols = self.cols as usize;
        let n = (n as usize).min(cols.saturating_sub(cur_col));
        let attrs = self.current_attrs.clone();
        let blank = blank_cell_with_bg(&attrs);
        let screen = self.active_screen_mut();
        if let Some(line) = screen.get_mut(cur_row) {
            for _ in 0..n {
                line.insert(cur_col, blank.clone());
                if line.len() > cols {
                    line.pop();
                }
            }
            fixup_wide_invariant(line, &blank);
        }
    }

    fn insert_lines(&mut self, n: u32) {
        let cur_row = self.cursor_row as usize;
        let rows = self.rows as usize;
        let cols = self.cols;
        let n = (n as usize).min(rows.saturating_sub(cur_row));
        let screen = self.active_screen_mut();
        for _ in 0..n {
            screen.insert(cur_row, blank_line(cols));
            if screen.len() > rows {
                screen.pop();
            }
        }
    }

    fn delete_lines(&mut self, n: u32) {
        let cur_row = self.cursor_row as usize;
        let rows = self.rows as usize;
        let cols = self.cols;
        let n = (n as usize).min(rows.saturating_sub(cur_row));
        let screen = self.active_screen_mut();
        for _ in 0..n {
            if cur_row < screen.len() {
                screen.remove(cur_row);
                screen.push(blank_line(cols));
            }
        }
    }

    fn handle_mode(&mut self, mode: termwiz::escape::csi::Mode) {
        use termwiz::escape::csi::Mode;
        match mode {
            Mode::SetDecPrivateMode(p) => self.set_dec_mode(p, true),
            Mode::ResetDecPrivateMode(p) => self.set_dec_mode(p, false),
            Mode::SaveDecPrivateMode(_) | Mode::RestoreDecPrivateMode(_) => {}
            _ => {}
        }
    }

    fn set_dec_mode(&mut self, mode: DecPrivateMode, on: bool) {
        let code = match mode {
            DecPrivateMode::Code(c) => c,
            DecPrivateMode::Unspecified(_) => return,
        };
        match code {
            DecPrivateModeCode::ShowCursor => self.cursor_visible = on,
            DecPrivateModeCode::ClearAndEnableAlternateScreen
            | DecPrivateModeCode::EnableAlternateScreen
            | DecPrivateModeCode::OptEnableAlternateScreen => {
                if on {
                    self.enter_alt_screen();
                } else {
                    self.exit_alt_screen();
                }
            }
            DecPrivateModeCode::MouseTracking => {
                self.set_mouse_protocol(MouseProtocol::X10, on);
            }
            DecPrivateModeCode::ButtonEventMouse => {
                self.set_mouse_protocol(MouseProtocol::ButtonEvent, on);
            }
            DecPrivateModeCode::AnyEventMouse => {
                self.set_mouse_protocol(MouseProtocol::AnyEvent, on);
            }
            DecPrivateModeCode::SGRMouse => {
                self.mouse_encoding = if on {
                    MouseEncoding::Sgr
                } else {
                    MouseEncoding::Default
                };
            }
            DecPrivateModeCode::BracketedPaste => self.bracketed_paste = on,
            _ => {}
        }
    }

    /// Apps frequently activate 1000+1002+1003 in cascade and only disable a
    /// subset on teardown. So `?Nl` only clears the protocol if it currently
    /// matches that exact mode — otherwise it's a no-op.
    fn set_mouse_protocol(&mut self, target: MouseProtocol, on: bool) {
        if on {
            self.mouse_protocol = target;
        } else if self.mouse_protocol == target {
            self.mouse_protocol = MouseProtocol::None;
        }
    }

    fn enter_alt_screen(&mut self) {
        if !self.on_alt {
            self.saved_cursor =
                Some((self.cursor_row, self.cursor_col, self.current_attrs.clone()));
            self.alt_screen = Some(blank_screen(self.rows, self.cols));
            self.on_alt = true;
            self.cursor_row = 0;
            self.cursor_col = 0;
        }
    }

    fn exit_alt_screen(&mut self) {
        if self.on_alt {
            self.alt_screen = None;
            self.on_alt = false;
            if let Some((r, c, a)) = self.saved_cursor.clone() {
                self.cursor_row = r.min(self.rows.saturating_sub(1));
                self.cursor_col = c.min(self.cols.saturating_sub(1));
                self.current_attrs = a;
            }
        }
    }

    fn handle_osc(&mut self, osc: OperatingSystemCommand) {
        match osc {
            OperatingSystemCommand::SetIconNameAndWindowTitle(s)
            | OperatingSystemCommand::SetWindowTitle(s)
            | OperatingSystemCommand::SetWindowTitleSun(s) => {
                self.title = s;
            }
            OperatingSystemCommand::SetHyperlink(link) => {
                // OSC 8: track the active hyperlink. Cells printed while it's
                // set carry the URL through their attrs and become clickable
                // on the frontend.
                self.current_attrs.hyperlink = link.map(|h| h.uri().to_string());
            }
            _ => {}
        }
    }

    fn handle_esc(&mut self, esc: Esc) {
        match esc {
            Esc::Code(EscCode::Index) => self.line_feed(),
            Esc::Code(EscCode::NextLine) => {
                self.line_feed();
                self.cursor_col = 0;
            }
            Esc::Code(EscCode::ReverseIndex) => {
                if self.cursor_row == 0 {
                    let cols = self.cols;
                    let screen = self.active_screen_mut();
                    if !screen.is_empty() {
                        screen.pop();
                        screen.insert(0, blank_line(cols));
                    }
                } else {
                    self.cursor_row -= 1;
                }
            }
            Esc::Code(EscCode::DecSaveCursorPosition) => {
                self.saved_cursor =
                    Some((self.cursor_row, self.cursor_col, self.current_attrs.clone()));
            }
            Esc::Code(EscCode::DecRestoreCursorPosition) => {
                if let Some((r, c, a)) = self.saved_cursor.clone() {
                    self.cursor_row = r.min(self.rows.saturating_sub(1));
                    self.cursor_col = c.min(self.cols.saturating_sub(1));
                    self.current_attrs = a;
                }
            }
            _ => {}
        }
    }
}

/// Kind of conversation message block a line belongs to when the pane runs
/// Claude Code. Wire format: 0 = none, 1 = user, 2 = Claude.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MessageKind {
    None,
    User,
    Claude,
}

impl MessageKind {
    pub fn as_u8(self) -> u8 {
        match self {
            MessageKind::None => 0,
            MessageKind::User => 1,
            MessageKind::Claude => 2,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct MessageMarker {
    /// Same convention as `SearchHit`: 0 = oldest scrollback line.
    pub total_row: u32,
    /// 1 = user message (`❯`), 2 = Claude message (white `●`).
    pub kind: u8,
}

/// True when `fg` renders as the default/white-ish foreground — the color
/// Claude Code uses for the bullet of assistant text. Tool/todo bullets are
/// colored (green/orange/red…) and must not match. A true-colour bullet counts
/// as white only when it is both bright (≥ 0.7 per channel ≈ #b3b3b3, so themed
/// near-whites pass) AND near-neutral (channels within 0.18, so a *light* green
/// success dot — bright but chromatic — is rejected even though all its channels
/// clear 0.7).
fn is_default_or_white_fg(fg: &ColorAttribute) -> bool {
    match fg {
        ColorAttribute::Default => true,
        ColorAttribute::PaletteIndex(7) | ColorAttribute::PaletteIndex(15) => true,
        ColorAttribute::TrueColorWithDefaultFallback(c)
        | ColorAttribute::TrueColorWithPaletteFallback(c, _) => {
            let max = c.0.max(c.1).max(c.2);
            let min = c.0.min(c.1).min(c.2);
            min >= 0.7 && (max - min) <= 0.18
        }
        _ => false,
    }
}

fn line_is_blank(line: &[TerminalCell]) -> bool {
    line.iter().all(|c| c.text.trim().is_empty())
}

/// True when the line's content sits in its right third (a long run of leading
/// blanks then text). Claude Code's footer — the right-aligned token counter,
/// for one — looks like this; real message continuations are left-indented
/// (column ~2). Used to stop the tint bleeding onto the footer.
fn is_right_aligned(line: &[TerminalCell]) -> bool {
    match line.iter().position(|c| !c.text.trim().is_empty()) {
        Some(idx) => idx * 3 > line.len() * 2,
        None => false,
    }
}

fn hash_line(line: &[TerminalCell]) -> u64 {
    use std::hash::Hasher;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for cell in line {
        h.write(cell.text.as_bytes());
    }
    h.finish()
}

/// First glyph is Claude Code's message/tool bullet.
fn line_starts_with_bullet(line: &[TerminalCell]) -> bool {
    line.first()
        .map(|c| matches!(c.text.trim(), "●" | "⏺"))
        .unwrap_or(false)
}

/// First non-blank glyph is a tool-result marker (`⎿`/`↳`) — the head of a tool
/// call's output. Its `● Tool(…)` line sits just above it, so the marker opens a
/// non-message block in its own right.
fn is_tool_result_marker(line: &[TerminalCell]) -> bool {
    line.iter()
        .find(|c| !c.text.trim().is_empty())
        .and_then(|c| c.text.trim().chars().next())
        .map(|ch| matches!(ch, '⎿' | '↳'))
        .unwrap_or(false)
}

/// Hash of a line's text with leading whitespace and a `●`/`⏺` bullet stripped,
/// so a tool call hashes identically whether its bullet is currently drawn or
/// has blinked to a space (`is_tool_call_line` uses the same normalisation).
fn hash_debulleted(line: &[TerminalCell]) -> u64 {
    use std::hash::Hasher;
    let mut text = String::new();
    for cell in line {
        text.push_str(&cell.text);
    }
    let rest = text
        .trim_start()
        .trim_start_matches(['●', '⏺'])
        .trim_start();
    let mut h = std::collections::hash_map::DefaultHasher::new();
    h.write(rest.as_bytes());
    h.finish()
}

/// True when the row carries Claude Code's "user prompt" background — the
/// grey band it paints across the full width of transcript user messages.
/// The live input box `❯` has a default background, so it never matches.
fn col0_has_bg(line: &[TerminalCell]) -> bool {
    line.first()
        .map(|c| c.attrs.bg != ColorAttribute::Default)
        .unwrap_or(false)
}

/// True when the row carries Claude Code's specific user-prompt band — a dark
/// neutral grey (≈ #373737). Stricter than `col0_has_bg`: it must be a grey
/// (channels close together) in the dark band, so colored backgrounds inside a
/// Claude response (diffs, highlighted code) are never mistaken for a user
/// block when the `❯` head is off-screen and the band is the only clue.
fn is_user_band(line: &[TerminalCell]) -> bool {
    let Some(cell) = line.first() else {
        return false;
    };
    match cell.attrs.bg {
        ColorAttribute::TrueColorWithDefaultFallback(c)
        | ColorAttribute::TrueColorWithPaletteFallback(c, _) => {
            let (r, g, b) = (c.0, c.1, c.2);
            let max = r.max(g).max(b);
            let min = r.min(g).min(b);
            // #373737 ≈ 0.216. Accept a dark, near-neutral grey only.
            max <= 0.45 && min >= 0.08 && (max - min) <= 0.06
        }
        _ => false,
    }
}

/// Advances the block state over one line. A head line switches blocks; a
/// user block is Claude Code's grey background band plus its attachment
/// continuation lines (`⎿ [Image #N]`), so the frame wraps the whole message.
/// Any other row without the band ends the block (indented Claude content, the
/// sticky last-prompt header's surroundings — must not inherit the user kind).
/// Claude blocks keep the indent rule.
fn advance_block(cur: MessageKind, line: &[TerminalCell]) -> MessageKind {
    if let Some(kind) = block_head_kind(line) {
        return kind;
    }
    // A grey-band continuation belongs to a user block even when its `❯` head
    // has scrolled off the top — the band is the block's full extent. This is
    // what keeps user messages tinted while scrolling on the alt screen.
    if cur == MessageKind::None && is_user_band(line) {
        return MessageKind::User;
    }
    if cur == MessageKind::User && !col0_has_bg(line) {
        // A user prompt's attachment line (`⎿ [Image #N]`, `[Pasted text]`)
        // renders without the grey band but belongs to the message — keep it in
        // the block so the frame wraps it too.
        let text: String = line.iter().map(|c| c.text.as_str()).collect();
        if text.contains("[Image") || text.contains("[Pasted") {
            return MessageKind::User;
        }
        return MessageKind::None;
    }
    // Claude Code's right-aligned footer (token counter, etc.) has a blank
    // column 0, so it would otherwise extend the block above it. It is not
    // message content — end the block so the tint never bleeds onto it.
    if !line_is_blank(line) && is_right_aligned(line) {
        return MessageKind::None;
    }
    cur
}

/// Heuristic default for an "orphan" alt-screen line — one the renderer has no
/// block context for: its `●` head scrolled off the top (no scrollback on the
/// alt screen) AND the tint cache has never seen it. This is the long-message
/// case where the head and the body are never co-visible, so neither the walk-up
/// nor the per-line cache can classify the body.
///
/// Claude message bodies are always *indented* (continuation under the `●`), so
/// an indented line that isn't a tool-result / todo / thinking marker is almost
/// certainly assistant text. Flush-left lines (the `●`/`❯` heads, banners,
/// thinking `∴`, separators) and marker rows are left untinted. The caller only
/// applies this when not already inside a head-established non-tinted block
/// (`in_none_block`), so visible tool output is never caught.
///
/// The decisive signal is the foreground STYLE. A live capture showed Claude
/// streams its prose and tables in the *default* foreground with no faint/italic
/// (`fg=Default, dim=false, italic=false`), whereas tool output / thinking /
/// todos are rendered in an explicit grey (e.g. `⎿ …` result lines at ≈#999) and
/// often faint or italic. So an orphan line whose first glyph is off-default,
/// faint, or italic is NOT an assistant message — this is what stops thinking
/// and tool results flashing purple while the transcript is scrolled and their
/// `∴`/`●`/`⎿` head is momentarily above the viewport.
///
/// Square box-drawing glyphs (`│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`) are NOT rejected by shape:
/// an indented run of them in the default fg is a markdown table or ASCII diagram
/// inside the answer — assistant content that must stay framed. Claude Code's own
/// chrome boxes use the *rounded* corners (`╭ ╮ ╰ ╯`) and are flush-left, so those
/// stay rejected.
fn orphan_claude_default(line: &[TerminalCell]) -> bool {
    let Some(idx) = line.iter().position(|c| !c.text.trim().is_empty()) else {
        return false; // blank
    };
    if idx < 1 {
        return false; // flush-left → a head / banner, not an indented message body
    }
    // Claude message bodies wrap to the bullet's indent (col 2). A line indented
    // markedly deeper is nested under a marker — tool / command output below a
    // `⎿` (multi-line git/bash output, file dumps) sits at col ≥ 4. Don't
    // *bootstrap* the tint from such a line; if it really is deep Claude content
    // (a code block, a nested list) the tint still reaches it by propagation from
    // the col-2 line above, since this guard only fires when there is no block
    // context yet. A live capture showed `/commit` git output at col 5–8 tinted
    // purple exactly here, until its `⎿`/`●` head scrolled into view.
    if idx > 3 {
        return false;
    }
    let cell = &line[idx];
    // Off-default / faint / italic ⇒ tool output, thinking, or a todo — never an
    // assistant message body. This is the guard that keeps scroll-through clean.
    if !is_default_or_white_fg(&cell.attrs.fg) || cell.attrs.dim || cell.attrs.italic {
        return false;
    }
    let first = cell.text.trim().chars().next().unwrap_or(' ');
    !matches!(
        first,
        '⎿' | '↳'
            | '∴'
            | '·'
            | '◻'
            | '◼'
            | '☐'
            | '☑'
            | '✓'
            | '✔'
            | '⏺'
            | '✶'
            | '✻'
            | '╭'
            | '╮'
            | '╰'
            | '╯'
    )
}

/// True when a white-bulleted line is a Claude Code *tool call* rather than an
/// assistant text message. Tool calls share the white `●`/`⏺` bullet with
/// assistant text, so they're told apart by shape. Three forms are recognized:
/// - native:        `Bash(…)`, `Read(…)`, `mcp__server__tool(…)` — `Ident(`
/// - MCP server:    `posthog - exec (MCP)(…)`                     — `(MCP)(`
/// - MCP bracket:   `Claude in Chrome[navigate](…)`              — `Name[tool](`
///
/// Real prose (words separated by spaces, then maybe a paren) never matches the
/// native form, and the bracket form is protected by the `[tool](` structure.
fn is_tool_call_line(line: &[TerminalCell]) -> bool {
    let mut text = String::new();
    for c in line {
        text.push_str(&c.text);
    }
    let rest = text
        .trim_start()
        .trim_start_matches(['●', '⏺'])
        .trim_start();
    // MCP "server - tool" form: the `(MCP)(` signature is unique to a tool
    // invocation — assistant prose never contains it.
    if rest.contains("(MCP)(") {
        return true;
    }
    let chars: Vec<char> = rest.chars().collect();
    // Must start with an identifier character.
    match chars.first() {
        Some(c) if c.is_ascii_alphabetic() || *c == '_' => {}
        _ => return false,
    }
    // Native form: a bare `Identifier(` with no spaces, so prose (words then a
    // paren) never matches.
    for &c in &chars {
        if c == '(' {
            return true;
        }
        if c.is_alphanumeric() || c == '_' || c == '-' {
            continue;
        }
        break;
    }
    // MCP "bracket" form: `Server Name[tool](args…)` — a display name (letters,
    // digits, spaces, hyphens) then a bracketed tool then `(`. The `[tool](`
    // structure is what lets us allow spaces here without matching ordinary prose.
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '[' {
            let mut j = i + 1;
            let start = j;
            while j < chars.len()
                && (chars[j].is_alphanumeric()
                    || chars[j] == '_'
                    || chars[j] == '.'
                    || chars[j] == '-')
            {
                j += 1;
            }
            return j > start && j + 1 < chars.len() && chars[j] == ']' && chars[j + 1] == '(';
        }
        if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' {
            i += 1;
            continue;
        }
        return false;
    }
    false
}

/// `Some(kind)` when the line starts a block (non-space character in column
/// 0); `Some(MessageKind::None)` for blocks we don't tint (tool output,
/// banners, …); `None` for continuation/blank lines.
fn block_head_kind(line: &[TerminalCell]) -> Option<MessageKind> {
    let head = line.first()?;
    let ch = head.text.trim();
    if ch.is_empty() {
        return None;
    }
    let kind = match ch {
        // Claude Code transcript user messages: `❯ text` over the grey
        // full-width background band. The live input box `❯` (and text being
        // typed there) has a default background, so it never matches.
        "❯" if col0_has_bg(line) && !line_is_blank(&line[1..]) => MessageKind::User,
        // Assistant text bullet: white/default `●` (or `⏺` on some versions).
        // Colored bullets (tool calls, todos) don't match the white check; tool
        // calls that *do* render a white bullet (`● Bash(…)`) are told apart by
        // their `Name(` shape so they aren't tinted as a message.
        "●" | "⏺" if is_default_or_white_fg(&head.attrs.fg) && !is_tool_call_line(line) => {
            MessageKind::Claude
        }
        _ => MessageKind::None,
    };
    Some(kind)
}

/// Alt-screen message navigation: the running TUI (Claude Code) owns
/// scrolling, so we emit wheel events via `send_wheel(up)` and watch the
/// redrawn grid until a marker line of `kind` reaches the vertical center.
/// `dir` < 0 targets an older message (above), else a newer one (below).
///
/// `prev_target` is the line hash of the message a previous call navigated
/// to: when it is still on screen, the next target is picked relative to IT
/// — this is what makes successive clicks progress message by message even
/// though the app's wheel granularity leaves "centered" messages a few rows
/// off-center. Returns (found, target hash to remember for the next call).
///
/// The grid is re-read on every iteration — a PTY reader thread keeps
/// feeding `term` concurrently while this loop sleeps between probes.
/// Minimum delay between wheel notches. Claude Code applies *momentum* to its
/// transcript scroll: notches arriving close together accelerate it to ~20+
/// lines each, which overshoots messages and makes centering impossible
/// (verified via a trace — a single 55ms notch jumped a `●` 22 rows). At ~150ms
/// the scroll stays at a few lines per notch. 110ms is the fastest cadence
/// that still centers reliably — empirically 100ms already triggers momentum
/// ("jumps ~10 blocks at once"), 110ms does not. This is the physical floor of
/// the speed/precision tradeoff; do not lower it without re-introducing skips.
const WHEEL_NOTCH_GAP_MS: u64 = 110;

pub fn wheel_navigate(
    term: &parking_lot::Mutex<TerminalState>,
    send_wheel: impl Fn(bool),
    kind: u8,
    dir: i32,
    rows: u16,
    prev_target: Option<u64>,
    cancel: &dyn Fn() -> bool,
) -> (bool, Option<u64>) {
    let center = (rows / 2) as i32;
    // Fallback anchor when the remembered target is gone (first click, user
    // scrolled away, content changed): a marker within NEAR of the center is
    // considered "the current message".
    const NEAR: i32 = 5;
    let pick = |markers: &[(u16, u64)]| -> Option<(i32, u64)> {
        let rows_i: Vec<(i32, u64)> = markers.iter().map(|&(r, h)| (r as i32, h)).collect();
        let anchor = prev_target
            .and_then(|h| rows_i.iter().find(|&&(_, hh)| hh == h).map(|&(r, _)| r))
            .or_else(|| {
                rows_i
                    .iter()
                    .map(|&(r, _)| r)
                    .min_by_key(|r| (r - center).abs())
                    .filter(|r| (r - center).abs() <= NEAR)
            })
            .unwrap_or(center);
        if dir < 0 {
            rows_i.iter().rev().copied().find(|&(r, _)| r < anchor)
        } else {
            rows_i.iter().copied().find(|&(r, _)| r > anchor)
        }
    };

    let mut target: Option<u64> = None;
    let mut last_dist = i32::MAX;
    let mut stale = 0u32;
    let mut blind = 0u32;
    for _ in 0..150 {
        // Superseded by a newer navigation or a manual scroll → stop.
        if cancel() {
            return (false, target.or(prev_target));
        }
        let (markers, screen_hash) = {
            let t = term.lock();
            (t.visible_markers_with_hash(kind), t.screen_content_hash())
        };
        let found = target
            .and_then(|th| {
                markers
                    .iter()
                    .find(|&&(_, h)| h == th)
                    .map(|&(r, h)| (r as i32, h))
            })
            .or_else(|| pick(&markers));

        let scroll_up = if let Some((row, h)) = found {
            if target != Some(h) {
                target = Some(h);
                last_dist = (row - center).abs();
            }
            let dist = row - center;
            // Centered — or one wheel notch past center, which is as close
            // as the app's scroll granularity allows.
            if dist.abs() <= 1 || dist.abs() > last_dist {
                return (true, target);
            }
            last_dist = dist.abs();
            blind = 0;
            dist < 0 // target above center → wheel-up moves content down
        } else {
            // No candidate on screen: scroll blindly toward `dir`, but give
            // up after a while — regions dense in tool output can go hundreds
            // of lines without a message of the requested kind.
            blind += 1;
            if blind > 60 {
                return (false, prev_target);
            }
            dir < 0
        };
        let sent_at = std::time::Instant::now();
        send_wheel(scroll_up);

        // Wait for the app to repaint (Claude Code repaints within ~50ms). The
        // next iteration re-reads the grid and centers on whatever marker
        // appeared — one notch at a time, so a target scrolling into view is
        // never overshot and the message is never skipped.
        let mut changed = false;
        for _ in 0..25 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            if term.lock().screen_content_hash() != screen_hash {
                changed = true;
                break;
            }
        }
        if changed {
            stale = 0;
        } else {
            stale += 1;
            if stale >= 2 {
                // Edge of the transcript: nothing further in that direction.
                return (target.is_some(), target.or(prev_target));
            }
        }
        // Throttle below Claude Code's wedge threshold (≈30ms jams its scroll).
        let elapsed = sent_at.elapsed();
        if elapsed < std::time::Duration::from_millis(WHEEL_NOTCH_GAP_MS) {
            std::thread::sleep(std::time::Duration::from_millis(WHEEL_NOTCH_GAP_MS) - elapsed);
        }
    }
    (target.is_some(), target.or(prev_target))
}

/// Where the start of a reply lands when scrolled to "the top": a couple of rows
/// below the viewport edge so the `●` head has breathing room and doesn't sit
/// flush against the frame.
const REPLY_TOP_MARGIN: i32 = 2;
/// Acceptable settle window for the head: anywhere from the top edge down to
/// `REPLY_TOP_BAND`. The app's wheel granularity is coarse (several lines per
/// notch), so insisting on the exact margin row makes the loop oscillate or
/// overshoot; landing anywhere in this band reads as "at the top".
const REPLY_TOP_BAND: i32 = 6;

/// Alt-screen: bring the most recent message of `kind` (2 = Claude) to near the
/// top of the viewport, so the user reads the reply from its start when Claude
/// finishes. Unlike `wheel_navigate` (which *centres* a target relative to an
/// anchor), this locks onto the bottom-most — i.e. most recent — visible marker
/// and drives it to a small top margin.
///
/// Behaviour by reply length (we are at the live bottom when Claude finishes):
/// - Long reply (head scrolled off the top): no marker is visible, so we wheel
///   up until the head appears, then settle it at `REPLY_TOP_MARGIN`.
/// - Short reply (head already on screen): it can't be pulled above its natural
///   live position (the app pins its input at the bottom), so the wheel-down
///   notches are no-ops, the screen stops changing, and we return having left
///   the already-visible reply in place.
///
/// Returns true if it locked onto a target marker.
pub fn wheel_message_to_top(
    term: &parking_lot::Mutex<TerminalState>,
    send_wheel: impl Fn(bool),
    kind: u8,
    cancel: &dyn Fn() -> bool,
) -> bool {
    let mut locked: Option<u64> = None;
    let mut last_dist = i32::MAX;
    let mut stale = 0u32;
    let mut blind = 0u32;
    for _ in 0..150 {
        // Superseded by a manual scroll or a newer navigation → stop.
        if cancel() {
            return locked.is_some();
        }
        let (markers, screen_hash) = {
            let t = term.lock();
            (t.visible_markers_with_hash(kind), t.screen_content_hash())
        };
        // The target head: once locked, track it by hash across redraws; before
        // that, the most recent message of `kind` is the bottom-most marker.
        let head: Option<(i32, u64)> = match locked {
            Some(h) => markers
                .iter()
                .find(|&&(_, hh)| hh == h)
                .map(|&(r, hh)| (r as i32, hh)),
            None => markers
                .iter()
                .max_by_key(|&&(r, _)| r)
                .map(|&(r, hh)| (r as i32, hh)),
        };

        let scroll_up = match head {
            Some((row, h)) => {
                if locked != Some(h) {
                    locked = Some(h);
                    last_dist = (row - REPLY_TOP_MARGIN).abs();
                }
                let dist = row - REPLY_TOP_MARGIN;
                // Settled when the head sits inside the top band (we don't need the
                // exact row — the app's wheel granularity is coarse), or once it
                // starts oscillating past the target.
                if (0..=REPLY_TOP_BAND).contains(&dist) || dist.abs() > last_dist {
                    return true;
                }
                last_dist = dist.abs();
                blind = 0;
                // Head above the target (row < margin) → wheel up pushes it down;
                // head below → wheel down brings it up toward the top.
                dist < 0
            }
            None => {
                if locked.is_some() {
                    // The locked head overshot OFF the top (one coarse wheel-down
                    // notch jumped it above row 0). Wheel UP — older content — to
                    // bring it back down into view; wheeling DOWN here would chase
                    // the live bottom and dump the user at the end of the reply.
                    true
                } else {
                    // No marker on screen yet (long reply, head off the top) →
                    // reveal it by scrolling up. Bail out if it never shows.
                    blind += 1;
                    if blind > 80 {
                        return false;
                    }
                    true
                }
            }
        };

        let sent_at = std::time::Instant::now();
        send_wheel(scroll_up);

        // Wait for the app to repaint, then re-read the grid next iteration.
        let mut changed = false;
        for _ in 0..25 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            if term.lock().screen_content_hash() != screen_hash {
                changed = true;
                break;
            }
        }
        if changed {
            stale = 0;
        } else {
            stale += 1;
            if stale >= 2 {
                // Can't scroll further that way (already at live, or transcript
                // edge): leave the reply wherever it ended up.
                return locked.is_some();
            }
        }
        let elapsed = sent_at.elapsed();
        if elapsed < std::time::Duration::from_millis(WHEEL_NOTCH_GAP_MS) {
            std::thread::sleep(std::time::Duration::from_millis(WHEEL_NOTCH_GAP_MS) - elapsed);
        }
    }
    locked.is_some()
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchHit {
    /// 0 = oldest scrollback line, `scrollback_len` = visible row 0.
    pub total_row: u32,
    pub start_col: u32,
    pub end_col: u32,
}

/// Scans `line` for `needle` and pushes each match (in cell-column terms).
/// Continuation cells (right half of a wide grapheme) are skipped, and the
/// match's `end_col` extends to the right edge of the last matched cell so
/// the highlight covers wide chars fully.
fn push_search_hits(
    line: &[TerminalCell],
    needle: &[char],
    total_row: u32,
    hits: &mut Vec<SearchHit>,
) {
    let mut chars: Vec<char> = Vec::with_capacity(line.len());
    let mut char_to_col: Vec<u32> = Vec::with_capacity(line.len());
    let mut char_width: Vec<u32> = Vec::with_capacity(line.len());
    for (idx, cell) in line.iter().enumerate() {
        if cell.width == 0 {
            continue;
        }
        let cw = cell.width.max(1) as u32;
        for c in cell.text.chars().flat_map(|c| c.to_lowercase()) {
            chars.push(c);
            char_to_col.push(idx as u32);
            char_width.push(cw);
        }
    }
    if chars.len() < needle.len() {
        return;
    }
    let max_start = chars.len() - needle.len();
    let mut i = 0;
    while i <= max_start {
        let mut matched = true;
        for j in 0..needle.len() {
            if chars[i + j] != needle[j] {
                matched = false;
                break;
            }
        }
        if matched {
            let start_col = char_to_col[i];
            let last = i + needle.len() - 1;
            let end_col = char_to_col[last] + char_width[last];
            hits.push(SearchHit {
                total_row,
                start_col,
                end_col,
            });
            i += needle.len();
        } else {
            i += 1;
        }
    }
}

fn blank_line(cols: u16) -> Vec<TerminalCell> {
    vec![TerminalCell::default(); cols as usize]
}

fn blank_screen(rows: u16, cols: u16) -> Vec<Vec<TerminalCell>> {
    (0..rows).map(|_| blank_line(cols)).collect()
}

fn blank_cell_with_bg(attrs: &TerminalCellAttrs) -> TerminalCell {
    TerminalCell {
        text: " ".to_string(),
        attrs: TerminalCellAttrs {
            bg: attrs.bg,
            ..TerminalCellAttrs::default()
        },
        width: 1,
    }
}

fn resize_screen(screen: &mut Vec<Vec<TerminalCell>>, rows: u16, cols: u16) {
    while screen.len() > rows as usize {
        screen.pop();
    }
    while screen.len() < rows as usize {
        screen.push(blank_line(cols));
    }
    let blank = TerminalCell::default();
    for line in screen.iter_mut() {
        if line.len() > cols as usize {
            line.truncate(cols as usize);
        }
        while line.len() < cols as usize {
            line.push(TerminalCell::default());
        }
        // A wide main may have lost its continuation to truncation; clean it.
        fixup_wide_invariant(line, &blank);
    }
}

/// Returns 0/1/2 for the visible column count of `c`. Combining marks and
/// nonprintable code points return 0; East Asian wide and emoji return 2;
/// everything else returns 1.
///
/// `unicode-width` follows UAX#11 strictly: a few emoji that are
/// "Neutral"/"Narrow" by East Asian Width (e.g. 🗑 U+1F5D1 WASTEBASKET) get
/// width 1 even though every modern terminal and every Markdown renderer
/// allocates 2 cells for them. We override the value for ranges that are
/// emoji-presentation-default in Unicode (`Emoji_Presentation=Yes`), so the
/// grid stays in sync with what apps like Claude Code, fish, gitui, etc.
/// expect when they pre-compute column counts for tables.
fn char_cell_width(c: char) -> u8 {
    let w = c.width().unwrap_or(0);
    if w == 0 {
        return 0;
    }
    if is_emoji_presentation_default(c) {
        return 2;
    }
    if w >= 2 {
        2
    } else {
        1
    }
}

/// Subset of Unicode `Emoji_Presentation=Yes` (i.e. renders as emoji by
/// default, width 2). Covers the SMP ranges that hold every emoji a Claude
/// Code todo-table or commit-message output is realistically going to use.
/// Not exhaustive — code points outside these ranges keep their `unicode-
/// width` value (text-presentation default; force emoji form via VS16).
fn is_emoji_presentation_default(c: char) -> bool {
    let cp = c as u32;
    matches!(
        cp,
        0x1F000..=0x1F02F |   // Mahjong tiles
        0x1F0A0..=0x1F0FF |   // Playing cards
        0x1F300..=0x1F6FF |   // Misc Symbols/Pictographs, Emoticons, Transport, Map
        0x1F900..=0x1F9FF |   // Supplemental Symbols/Pictographs
        0x1FA00..=0x1FAFF |   // Symbols and Pictographs Extended-A
        0x1F1E6..=0x1F1FF     // Regional Indicators (flag halves)
    )
}

/// When we're about to overwrite a cell that participates in a wide pair,
/// blank its partner so we don't leave a dangling continuation (right half
/// of a wide whose main was overwritten) or orphan main (wide whose
/// continuation was overwritten).
fn cleanup_overwrite(line: &mut [TerminalCell], col: usize, blank: &TerminalCell) {
    if col >= line.len() {
        return;
    }
    match line[col].width {
        2 => {
            if let Some(cont) = line.get_mut(col + 1) {
                *cont = blank.clone();
            }
        }
        0 => {
            if col > 0 {
                if let Some(main) = line.get_mut(col - 1) {
                    *main = blank.clone();
                }
            }
        }
        _ => {}
    }
}

/// Walks the line and blanks any orphan main (width=2 with no continuation
/// after) or orphan continuation (width=0 with no main before). Called after
/// erase / insert / delete operations that may have split a wide pair.
fn fixup_wide_invariant(line: &mut [TerminalCell], blank: &TerminalCell) {
    let len = line.len();
    let mut i = 0;
    while i < len {
        match line[i].width {
            2 => {
                let next_ok = i + 1 < len && line[i + 1].width == 0;
                if next_ok {
                    i += 2;
                } else {
                    line[i] = blank.clone();
                    i += 1;
                }
            }
            0 => {
                line[i] = blank.clone();
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }
}

fn colorspec_to_attribute(spec: ColorSpec) -> ColorAttribute {
    match spec {
        ColorSpec::Default => ColorAttribute::Default,
        ColorSpec::PaletteIndex(i) => ColorAttribute::PaletteIndex(i),
        ColorSpec::TrueColor(srgba) => ColorAttribute::TrueColorWithDefaultFallback(srgba),
    }
}

/// Encodes a mouse event for transmission back to the running TUI.
///
/// `button`: 0=left, 1=middle, 2=right, 64=wheel-up, 65=wheel-down. For
/// `MouseEncoding::Default`, release-events ignore `button` and always send 3
/// (the "any-button release" code from the X10 protocol). SGR distinguishes
/// press vs release through the trailing `M` / `m` instead.
///
/// `modifiers` packs the keyboard state: bit 0 = shift, bit 1 = alt, bit 2 = ctrl.
///
/// Cells are 0-indexed throughout the codebase; the wire format is 1-indexed for
/// SGR and offset-by-33 for legacy X10. Default encoding clamps col/row at 222
/// to stay within the byte range — apps that need wider terminals should enable
/// SGR (1006).
pub fn encode_mouse(
    button: u8,
    col: u16,
    row: u16,
    modifiers: u8,
    motion: bool,
    pressed: bool,
    encoding: MouseEncoding,
) -> Vec<u8> {
    let cb_mods = (modifiers & 0b111) << 2;
    let cb_motion = if motion { 32 } else { 0 };
    match encoding {
        MouseEncoding::Sgr => {
            let cb = button | cb_mods | cb_motion;
            let trail = if pressed { 'M' } else { 'm' };
            format!("\x1b[<{};{};{}{}", cb, col + 1, row + 1, trail).into_bytes()
        }
        MouseEncoding::Default => {
            let raw = if pressed { button } else { 3 };
            let cb = (raw | cb_mods | cb_motion).saturating_add(32);
            let cx = col.saturating_add(33).min(255) as u8;
            let cy = row.saturating_add(33).min(255) as u8;
            vec![0x1b, b'[', b'M', cb, cx, cy]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_mouse_sgr_press_left() {
        assert_eq!(
            encode_mouse(0, 10, 5, 0, false, true, MouseEncoding::Sgr),
            b"\x1b[<0;11;6M".to_vec()
        );
    }

    #[test]
    fn encode_mouse_sgr_release_left() {
        assert_eq!(
            encode_mouse(0, 10, 5, 0, false, false, MouseEncoding::Sgr),
            b"\x1b[<0;11;6m".to_vec()
        );
    }

    #[test]
    fn encode_mouse_sgr_motion_left_drag() {
        assert_eq!(
            encode_mouse(0, 10, 5, 0, true, true, MouseEncoding::Sgr),
            b"\x1b[<32;11;6M".to_vec()
        );
    }

    #[test]
    fn encode_mouse_sgr_shift_ctrl_right() {
        // mods = shift|ctrl = 0b101 → (5 << 2) = 20 → button 2 + 20 = 22
        assert_eq!(
            encode_mouse(2, 10, 5, 0b101, false, true, MouseEncoding::Sgr),
            b"\x1b[<22;11;6M".to_vec()
        );
    }

    #[test]
    fn encode_mouse_sgr_wheel_up() {
        assert_eq!(
            encode_mouse(64, 10, 5, 0, false, true, MouseEncoding::Sgr),
            b"\x1b[<64;11;6M".to_vec()
        );
    }

    #[test]
    fn encode_mouse_default_press_left() {
        let want: Vec<u8> = vec![0x1b, b'[', b'M', 32, 10 + 33, 5 + 33];
        assert_eq!(
            encode_mouse(0, 10, 5, 0, false, true, MouseEncoding::Default),
            want
        );
    }

    #[test]
    fn encode_mouse_default_release_uses_button_3() {
        let want: Vec<u8> = vec![0x1b, b'[', b'M', 3 + 32, 10 + 33, 5 + 33];
        assert_eq!(
            encode_mouse(0, 10, 5, 0, false, false, MouseEncoding::Default),
            want
        );
    }

    #[test]
    fn set_dec_mode_x10_and_sgr_encoding() {
        let mut t = TerminalState::new(24, 80);
        assert_eq!(t.mouse_protocol(), MouseProtocol::None);
        assert_eq!(t.mouse_encoding(), MouseEncoding::Default);
        t.advance_bytes(b"\x1b[?1000h\x1b[?1006h");
        assert_eq!(t.mouse_protocol(), MouseProtocol::X10);
        assert_eq!(t.mouse_encoding(), MouseEncoding::Sgr);
    }

    #[test]
    fn set_dec_mode_any_event_toggle() {
        let mut t = TerminalState::new(24, 80);
        t.advance_bytes(b"\x1b[?1003h");
        assert_eq!(t.mouse_protocol(), MouseProtocol::AnyEvent);
        t.advance_bytes(b"\x1b[?1003l");
        assert_eq!(t.mouse_protocol(), MouseProtocol::None);
    }

    #[test]
    fn set_dec_mode_cascade_disable_only_matching() {
        let mut t = TerminalState::new(24, 80);
        // Apps activate 1000+1002+1003 in sequence — last write wins.
        t.advance_bytes(b"\x1b[?1000h\x1b[?1002h\x1b[?1003h");
        assert_eq!(t.mouse_protocol(), MouseProtocol::AnyEvent);
        // Disabling a non-active mode is a no-op.
        t.advance_bytes(b"\x1b[?1000l");
        assert_eq!(t.mouse_protocol(), MouseProtocol::AnyEvent);
        // Disabling the active mode clears it.
        t.advance_bytes(b"\x1b[?1003l");
        assert_eq!(t.mouse_protocol(), MouseProtocol::None);
    }

    fn widths(t: &TerminalState, row: usize) -> Vec<u8> {
        t.active_screen()[row].iter().map(|c| c.width).collect()
    }
    fn texts(t: &TerminalState, row: usize) -> Vec<String> {
        t.active_screen()[row]
            .iter()
            .map(|c| c.text.clone())
            .collect()
    }

    #[test]
    fn print_wide_chinese() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("你好".as_bytes());
        assert_eq!(&widths(&t, 0)[..4], &[2, 0, 2, 0]);
        assert_eq!(texts(&t, 0)[0], "你");
        assert_eq!(texts(&t, 0)[1], "");
        assert_eq!(texts(&t, 0)[2], "好");
        assert_eq!(texts(&t, 0)[3], "");
        let (_, col) = t.cursor_position();
        assert_eq!(col, 4);
    }

    #[test]
    fn print_emoji() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("🚀".as_bytes());
        assert_eq!(&widths(&t, 0)[..2], &[2, 0]);
        assert_eq!(texts(&t, 0)[0], "🚀");
        let (_, col) = t.cursor_position();
        assert_eq!(col, 2);
    }

    #[test]
    fn print_mixed_width() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("a你b".as_bytes());
        assert_eq!(&widths(&t, 0)[..4], &[1, 2, 0, 1]);
        assert_eq!(texts(&t, 0)[0], "a");
        assert_eq!(texts(&t, 0)[1], "你");
        assert_eq!(texts(&t, 0)[2], "");
        assert_eq!(texts(&t, 0)[3], "b");
    }

    #[test]
    fn wide_wraps_at_right_edge() {
        let mut t = TerminalState::new(3, 5);
        t.advance_bytes("abcd你".as_bytes());
        assert_eq!(&widths(&t, 0)[..], &[1, 1, 1, 1, 1]);
        assert_eq!(&widths(&t, 1)[..3], &[2, 0, 1]);
        assert_eq!(texts(&t, 1)[0], "你");
        assert_eq!(t.cursor_position(), (1, 2));
    }

    #[test]
    fn combining_marks_skipped_v18() {
        let mut t = TerminalState::new(2, 10);
        // 'e' followed by combining acute (U+0301).
        t.advance_bytes("e\u{0301}".as_bytes());
        assert_eq!(texts(&t, 0)[0], "e");
        let (_, col) = t.cursor_position();
        assert_eq!(col, 1);
    }

    #[test]
    fn search_finds_wide_char_with_full_end() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("你好世界".as_bytes());
        let hits = t.search("好");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start_col, 2);
        assert_eq!(hits[0].end_col, 4); // covers both cells of 好
    }

    #[test]
    fn overwrite_wide_with_normal_clears_continuation() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("你".as_bytes());
        t.advance_bytes(b"\x1b[H"); // cursor home (0,0)
        t.advance_bytes(b"x");
        assert_eq!(&widths(&t, 0)[..2], &[1, 1]);
        assert_eq!(texts(&t, 0)[0], "x");
        assert_eq!(texts(&t, 0)[1], " "); // cont was blanked
    }

    #[test]
    fn cursor_snaps_off_continuation() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("你".as_bytes());
        // Force cursor onto the continuation cell (col 1).
        t.cursor_col = 1;
        let (_, col) = t.cursor_position();
        assert_eq!(col, 0); // snapped to the wide main
    }

    #[test]
    fn erase_to_end_of_line_cleans_orphan_main() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("a你b".as_bytes());
        // Cursor home + erase from (0,2) to EOL — that's the cont of 你.
        t.advance_bytes(b"\x1b[1;3H"); // CUP (1,3) = row 0, col 2 (1-based)
        t.advance_bytes(b"\x1b[K"); // EraseToEndOfLine
                                    // The orphan main 你 at col 1 should now be a blank.
        assert_eq!(&widths(&t, 0)[..4], &[1, 1, 1, 1]);
        assert_eq!(texts(&t, 0)[0], "a");
        assert_eq!(texts(&t, 0)[1], " ");
    }

    #[test]
    fn text_range_single_line() {
        let mut t = TerminalState::new(4, 20);
        t.advance_bytes(b"hello world");
        // No scrollback yet: total row 0 = screen row 0.
        assert_eq!(t.text_range(2, 0, 4, 0), "llo");
    }

    #[test]
    fn text_range_reversed_endpoints() {
        let mut t = TerminalState::new(4, 20);
        t.advance_bytes(b"hello world");
        assert_eq!(t.text_range(4, 0, 2, 0), "llo");
    }

    #[test]
    fn text_range_multiline_trims_trailing_blanks() {
        let mut t = TerminalState::new(4, 20);
        t.advance_bytes(b"alpha\r\nbeta");
        // From inside "alpha" to the right edge of "beta"'s row: trailing
        // blank cells must be trimmed on every line.
        assert_eq!(
            t.text_range(2, 0, 19, 1),
            "pha
beta"
        );
    }

    #[test]
    fn text_range_spans_scrollback_and_screen() {
        let mut t = TerminalState::new(2, 10);
        // Three lines on a 2-row screen: "one" scrolls out into scrollback.
        t.advance_bytes(b"one\r\ntwo\r\nthree");
        assert_eq!(t.scrollback_len(), 1);
        // total row 0 = "one" (scrollback), 1 = "two", 2 = "three" (screen).
        assert_eq!(
            t.text_range(0, 0, 9, 2),
            "one
two
three"
        );
    }

    #[test]
    fn scrollback_cap_clamps_to_supported_bounds() {
        let mut t = TerminalState::new(2, 10);
        assert_eq!(t.scrollback_cap(), DEFAULT_SCROLLBACK_CAP);
        t.set_scrollback_cap(10);
        assert_eq!(t.scrollback_cap(), SCROLLBACK_CAP_MIN);
        t.set_scrollback_cap(1_000_000);
        assert_eq!(t.scrollback_cap(), SCROLLBACK_CAP_MAX);
    }

    #[test]
    fn set_scrollback_cap_evicts_oldest_excess_immediately() {
        let mut t = TerminalState::new(2, 10);
        // 1502 lines on a 2-row screen: 1500 land in scrollback.
        for i in 0..1502 {
            t.advance_bytes(format!("l{i}\r\n").as_bytes());
        }
        assert!(t.scrollback_len() >= 1500);
        t.set_scrollback_cap(SCROLLBACK_CAP_MIN);
        assert_eq!(t.scrollback_len(), SCROLLBACK_CAP_MIN);
        // The kept lines are the newest ones: the oldest survivors follow the
        // evicted head, and later output keeps evicting at the new cap.
        t.advance_bytes(b"tail\r\n");
        assert_eq!(t.scrollback_len(), SCROLLBACK_CAP_MIN);
    }

    #[test]
    fn text_range_wide_grapheme_skips_continuation() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("日本".as_bytes());
        // 日 occupies cols 0-1 (continuation cell at col 1), 本 cols 2-3.
        assert_eq!(t.text_range(0, 0, 3, 0), "日本");
    }

    #[test]
    fn text_range_out_of_bounds_clamps() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes(b"ab");
        // End row far beyond the grid: clamps to the last total row.
        assert_eq!(t.text_range(0, 0, 9, 99), "ab");
        // Start row beyond the grid: empty result.
        assert_eq!(t.text_range(0, 50, 9, 99), "");
    }

    /// Claude Code paints user messages over a grey background band.
    const USER_BG: &str = "\x1b[48;2;55;55;55m";

    #[test]
    fn message_markers_user_and_white_bullet_only() {
        let mut t = TerminalState::new(10, 40);
        t.advance_bytes(
            format!("{USER_BG}❯ hello\x1b[0m\r\n{USER_BG}  continued\x1b[0m\r\n\r\n\x1b[32m●\x1b[0m tool call\r\n● answer\r\n")
                .as_bytes(),
        );
        let markers = t.message_markers();
        assert_eq!(markers.len(), 2);
        assert_eq!((markers[0].total_row, markers[0].kind), (0, 1));
        assert_eq!((markers[1].total_row, markers[1].kind), (4, 2));
    }

    #[test]
    fn message_markers_claude_code_transcript_glyphs() {
        let mut t = TerminalState::new(10, 60);
        // Real Claude Code transcript shapes (from a ConPTY capture): grey
        // `❯` user line, pure-white `●` assistant line, green `●` tool call,
        // `⎿` result.
        t.advance_bytes(
            "\x1b[48;2;55;55;55m\x1b[38;2;80;80;80m❯\x1b[39m fix the bug please\x1b[0m\r\n\r\n\x1b[38;2;255;255;255m●\x1b[0m Looking at it.\r\n\r\n\x1b[38;2;78;186;101m●\x1b[0m Bash(cargo test)\r\n  ⎿ ok\r\n"
                .as_bytes(),
        );
        let markers = t.message_markers();
        assert_eq!(markers.len(), 2);
        assert_eq!((markers[0].total_row, markers[0].kind), (0, 1));
        assert_eq!((markers[1].total_row, markers[1].kind), (2, 2));
    }

    #[test]
    fn message_markers_work_on_alt_screen() {
        let mut t = TerminalState::new(10, 60);
        // Claude Code runs its TUI on the alt screen (DEC 1049).
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "\x1b[48;2;55;55;55m\x1b[38;2;80;80;80m❯\x1b[39m hello\x1b[0m\r\n\r\n\x1b[38;2;255;255;255m●\x1b[0m Answer text.\r\n  wrapped line\r\n"
                .as_bytes(),
        );
        assert!(t.is_on_alt_screen());
        let markers = t.message_markers();
        assert_eq!(markers.len(), 2);
        assert_eq!((markers[0].total_row, markers[0].kind), (0, 1));
        assert_eq!((markers[1].total_row, markers[1].kind), (2, 2));
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..4], &[1, 0, 2, 2]);
        // Marker/hash snapshot used by the wheel-navigation loop.
        let claude = t.visible_markers_with_hash(2);
        assert_eq!(claude.len(), 1);
        assert_eq!(claude[0].0, 2);
    }

    #[test]
    fn orphan_claude_body_is_tinted_on_alt_screen() {
        // A Claude answer taller than the screen: its `●` head has scrolled off
        // the top, there is no scrollback on the alt screen, and the tint cache
        // is empty. The indented body must still be framed (the reported bug).
        let mut t = TerminalState::new(6, 60);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "  Voici une explication structuree de la navigation.\r\n  function f(x) {\r\n    return x + 1;\r\n  }\r\n  Conclusion finale de la reponse ici.\r\n"
                .as_bytes(),
        );
        assert!(t.is_on_alt_screen());
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..5], &[2, 2, 2, 2, 2]);
    }

    #[test]
    fn orphan_default_does_not_repaint_visible_tool_output() {
        // When a tool call's white `●` head IS on screen, its `⎿` result and the
        // indented output below must stay untinted — the orphan-default must not
        // override a head-established non-tinted block.
        let mut t = TerminalState::new(6, 60);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "\x1b[38;2;230;230;230m●\x1b[0m Bash(cargo test)\r\n  ⎿ running tests\r\n     all checks passed\r\n"
                .as_bytes(),
        );
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..3], &[0, 0, 0]);
    }

    #[test]
    fn nbsp_only_prompt_is_excluded() {
        let mut t = TerminalState::new(4, 20);
        // The live input prompt renders as `❯` + NBSP (U+00A0).
        t.advance_bytes("❯\u{a0}".as_bytes());
        assert!(t.message_markers().is_empty());
    }

    #[test]
    fn near_white_truecolor_bullet_is_claude() {
        let mut t = TerminalState::new(4, 40);
        // 38;2;230;230;230 ≈ #e6e6e6 — themed near-white must pass.
        t.advance_bytes("\x1b[38;2;230;230;230m⏺\x1b[0m answer\r\n".as_bytes());
        let markers = t.message_markers();
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].kind, 2);
        // A mid-grey (#808080) must not.
        let mut t2 = TerminalState::new(4, 40);
        t2.advance_bytes("\x1b[38;2;128;128;128m⏺\x1b[0m note\r\n".as_bytes());
        assert!(t2.message_markers().is_empty());
    }

    #[test]
    fn white_bullet_tool_call_is_not_a_message() {
        // Tool calls share the white bullet with assistant text but must not be
        // tinted/bordered as a message.
        let mut t = TerminalState::new(4, 40);
        t.advance_bytes("\x1b[38;2;230;230;230m⏺\x1b[0m Bash(cd foo)\r\n".as_bytes());
        assert!(t.message_markers().is_empty());
        // Plain prose after the same white bullet stays a Claude message.
        let mut t2 = TerminalState::new(4, 40);
        t2.advance_bytes("\x1b[38;2;230;230;230m⏺\x1b[0m Voici la reponse\r\n".as_bytes());
        assert_eq!(t2.message_markers().len(), 1);
    }

    #[test]
    fn bash_tool_call_with_quoted_args_is_not_a_message() {
        // `● Bash(cd "…" && git commit -m "…")` — white bullet, native tool call.
        // The `Name(` shape must exclude it from the Claude frame even with
        // spaces/quotes/`&&` in the arguments.
        let mut t = TerminalState::new(4, 80);
        t.advance_bytes(
            "\x1b[38;2;230;230;230m●\x1b[0m Bash(cd \"C:/x\" && git commit -m \"msg\")\r\n"
                .as_bytes(),
        );
        assert!(t.message_markers().is_empty());
    }

    #[test]
    fn bracket_mcp_tool_call_is_not_a_message() {
        // MCP servers with a display name render as `Name[tool](args…)`
        // (e.g. `Claude in Chrome[navigate](url)`). The spaces break the strict
        // native scan, so the `[tool](` structure is what excludes it.
        let mut t = TerminalState::new(4, 80);
        t.advance_bytes(
            "\x1b[38;2;230;230;230m●\x1b[0m Claude in Chrome[navigate](www.x.tech)\r\n".as_bytes(),
        );
        assert!(t.message_markers().is_empty());
        // But a real Claude line that merely opens a paren after words stays a
        // message (native scan must not match prose).
        let mut t2 = TerminalState::new(4, 80);
        t2.advance_bytes("\x1b[38;2;230;230;230m●\x1b[0m Voici la reponse (oui)\r\n".as_bytes());
        assert_eq!(t2.message_markers().len(), 1);
    }

    #[test]
    fn mcp_tool_call_is_not_a_message() {
        // MCP tool calls render as `server - tool (MCP)(args…)` after the white
        // bullet. The spaces/hyphen break the strict identifier scan, so the
        // `(MCP)(` signature is what keeps them out of the Claude frame.
        let mut t = TerminalState::new(4, 60);
        t.advance_bytes(
            "\x1b[38;2;230;230;230m⏺\x1b[0m posthog - exec (MCP)(command: \"x\")\r\n".as_bytes(),
        );
        assert!(t.message_markers().is_empty());
    }

    #[test]
    fn light_green_bullet_is_not_claude() {
        // A light success-green dot (#b3ffb3) is bright in every channel but
        // chromatic — it must not count as the white assistant bullet, even
        // when followed by prose (i.e. independent of the tool-call shape).
        let mut t = TerminalState::new(4, 40);
        t.advance_bytes("\x1b[38;2;179;255;179m⏺\x1b[0m done\r\n".as_bytes());
        assert!(t.message_markers().is_empty());
    }

    #[test]
    fn user_block_includes_image_attachment_line() {
        // A user prompt (grey band) followed by its `⎿ [Image #N]` attachment
        // line (no band) — both rows must be the user block so the frame wraps
        // the whole message.
        let mut t = TerminalState::new(4, 40);
        t.advance_bytes("\x1b[48;2;55;55;55m❯ question [Image #3]\x1b[0m\r\n".as_bytes());
        t.advance_bytes("  \u{23bf} [Image #3]\r\n".as_bytes());
        let kinds = t.visible_line_kinds(0);
        assert_eq!(kinds[0], 1);
        assert_eq!(kinds[1], 1);
    }

    #[test]
    fn input_box_prompt_is_never_a_user_marker() {
        let mut t = TerminalState::new(4, 20);
        // The live input box renders with a default background — empty or
        // while typing, it must not classify as a user message.
        t.advance_bytes("❯ ".as_bytes());
        assert!(t.message_markers().is_empty());
        t.advance_bytes(b"hi");
        assert!(t.message_markers().is_empty());
        assert_eq!(t.visible_line_kinds(0), vec![0, 0, 0, 0]);
    }

    #[test]
    fn sticky_prompt_header_tints_only_its_own_row() {
        let mut t = TerminalState::new(6, 40);
        // When scrolled, Claude Code pins the last user prompt at row 0; the
        // unrelated (default-bg) content below must not inherit the kind.
        t.advance_bytes(
            format!(
                "{USER_BG}❯ mon dernier prompt\x1b[0m\r\n     placeholder content\r\n     more content\r\n"
            )
            .as_bytes(),
        );
        let kinds = t.visible_line_kinds(0);
        assert_eq!(kinds, vec![1, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn visible_line_kinds_blocks_and_trailing_gaps() {
        let mut t = TerminalState::new(10, 40);
        t.advance_bytes(
            format!("{USER_BG}❯ hello\x1b[0m\r\n{USER_BG}  continued\x1b[0m\r\n\r\n\x1b[32m●\x1b[0m tool call\r\n● answer\r\n")
                .as_bytes(),
        );
        let kinds = t.visible_line_kinds(0);
        // Row 2 is a default-bg gap before the next block → untinted. The
        // blank rows after "● answer" trail to EOF → untinted too.
        assert_eq!(kinds, vec![1, 1, 0, 0, 2, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn visible_line_kinds_tints_interior_paragraph_gap() {
        let mut t = TerminalState::new(5, 40);
        t.advance_bytes("● first paragraph\r\n\r\n  second paragraph\r\n".as_bytes());
        let kinds = t.visible_line_kinds(0);
        assert_eq!(kinds, vec![2, 2, 2, 0, 0]);
    }

    #[test]
    fn visible_line_kinds_head_in_scrollback() {
        let mut t = TerminalState::new(5, 40);
        // Six lines on a 5-row screen: the "● answer" head scrolls out.
        t.advance_bytes("● answer\r\n  l1\r\n  l2\r\n  l3\r\n  l4\r\n  l5".as_bytes());
        assert_eq!(t.scrollback_len(), 1);
        // Live view shows only continuation lines — still classified Claude.
        assert_eq!(t.visible_line_kinds(0), vec![2, 2, 2, 2, 2]);
        // Scrolled up by one, the head itself is visible.
        assert_eq!(t.visible_line_kinds(1), vec![2, 2, 2, 2, 2]);
    }

    #[test]
    fn alt_screen_user_band_tinted_without_head() {
        let mut t = TerminalState::new(4, 40);
        t.advance_bytes(b"\x1b[?1049h");
        // Only continuation lines of a user message are visible — the `❯` head
        // scrolled above the top of the alt screen. Each still carries the
        // grey band, which is enough to keep them tinted green.
        t.advance_bytes(
            format!("{USER_BG}  continued one\x1b[0m\r\n{USER_BG}  continued two\x1b[0m\r\n")
                .as_bytes(),
        );
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..2], &[1, 1]);
    }

    #[test]
    fn alt_screen_claude_continuation_tinted_from_scroll_cache() {
        let mut t = TerminalState::new(6, 40);
        t.advance_bytes(b"\x1b[?1049h");
        // Frame 1: the white `●` head is on screen, so the body lines are
        // classified Claude and recorded in the scroll cache.
        t.advance_bytes(
            "\x1b[38;2;255;255;255m●\x1b[0m answer\r\n  body line A\r\n  body line B\r\n  body line C\r\n"
                .as_bytes(),
        );
        assert_eq!(t.visible_line_kinds(0)[0], 2);
        // Frame 2: Claude Code redraws with the head scrolled off — only the
        // continuation lines remain. They must stay purple via the cache.
        t.advance_bytes(b"\x1b[2J\x1b[H");
        t.advance_bytes("  body line A\r\n  body line B\r\n  body line C\r\n".as_bytes());
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..3], &[2, 2, 2]);
    }

    #[test]
    fn alt_screen_claude_tinted_under_sticky_user_header() {
        let mut t = TerminalState::new(6, 50);
        t.advance_bytes(b"\x1b[?1049h");
        // Frame 1: the Claude answer's white `●` head is on screen — fills the
        // scroll cache with its body lines.
        t.advance_bytes(
            "\x1b[38;2;255;255;255m●\x1b[0m answer body\r\n  more body text\r\n  even more body\r\n"
                .as_bytes(),
        );
        assert_eq!(t.visible_line_kinds(0)[0], 2);
        // Frame 2: scrolled — Claude Code pins the last user prompt at row 0
        // (grey band) above the answer's continuations, and the `●` head is
        // gone. Only the scroll cache can keep the body purple *under* the
        // green sticky header. This is the real-world case the user hit.
        t.advance_bytes(b"\x1b[2J\x1b[H");
        t.advance_bytes(
            format!("{USER_BG}❯ my prompt\x1b[0m\r\n\r\n  more body text\r\n  even more body\r\n")
                .as_bytes(),
        );
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..4], &[1, 0, 2, 2]);
    }

    #[test]
    fn alt_screen_right_aligned_footer_not_tinted() {
        let mut t = TerminalState::new(5, 50);
        t.advance_bytes(b"\x1b[?1049h");
        // A Claude answer followed by Claude Code's right-aligned token-counter
        // footer (blank column 0, text in the right third). The counter must
        // NOT inherit the purple tint and must not poison the cache.
        let mut s = String::from("\x1b[38;2;255;255;255m●\x1b[0m answer\r\n  body\r\n");
        s.push_str(&" ".repeat(38));
        s.push_str("12345 tokens\r\n");
        t.advance_bytes(s.as_bytes());
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..3], &[2, 2, 0]);
    }

    #[test]
    fn alt_screen_blinking_tool_bullet_does_not_extend_claude_frame() {
        let mut t = TerminalState::new(6, 50);
        t.advance_bytes(b"\x1b[?1049h");
        // Frame 1: a Claude answer, then a tool call whose `●` bullet is drawn.
        // The tool line is kind 0 (not framed) and is remembered by its text.
        t.advance_bytes(
            "\x1b[38;2;255;255;255m●\x1b[0m answer\r\n  body line\r\n\x1b[38;2;255;255;255m●\x1b[0m Update(src/store.ts)\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..3], &[2, 2, 0]);
        // Frame 2: the running tool blinks its bullet OFF — the cell is now a
        // space, so the line looks like a continuation. It must still NOT inherit
        // the Claude tint above (the bug: a purple frame closing under the tool).
        t.advance_bytes(b"\x1b[2J\x1b[H");
        t.advance_bytes(
            "\x1b[38;2;255;255;255m●\x1b[0m answer\r\n  body line\r\n  Update(src/store.ts)\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..3], &[2, 2, 0]);
    }

    #[test]
    fn alt_screen_claude_code_line_with_call_shape_still_framed() {
        // A genuine assistant continuation line that *looks* like a tool call
        // (`foo(bar)` in a code block) was never seen with a bullet, so it must
        // not be mistaken for a blinked-off tool call and drop out of the frame.
        let mut t = TerminalState::new(6, 50);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "\x1b[38;2;255;255;255m●\x1b[0m here is code\r\n  print(value)\r\n  done()\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..3], &[2, 2, 2]);
    }

    #[test]
    fn orphan_claude_table_prefix_is_tinted_on_alt_screen() {
        // A markdown TABLE at the very top of an orphan window: the assistant
        // `●` head and the prose above scrolled off the alt screen, the cache is
        // cold. The box-drawing table rows are assistant content and must be
        // framed — not left as an untinted gap with the violet box starting only
        // below the table (the reported bug). They share the prose's attributes
        // (fg=Default, no dim/italic), confirmed by a live capture.
        let mut t = TerminalState::new(7, 60);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "  \u{250c}\u{2500}\u{2500}\u{252c}\u{2500}\u{2500}\u{2510}\r\n  \u{2502} popup.js  \u{2502} DEFAULT \u{2502}\r\n  \u{251c}\u{2500}\u{2500}\u{253c}\u{2500}\u{2500}\u{2524}\r\n  \u{2502} popup.html\u{2502} toggle  \u{2502}\r\n  \u{2514}\u{2500}\u{2500}\u{2534}\u{2500}\u{2500}\u{2518}\r\n  La table ci-dessus resume les modules.\r\n"
                .as_bytes(),
        );
        assert!(t.is_on_alt_screen());
        let kinds = t.visible_line_kinds(0);
        // Five table rows + the prose line below — all framed as one block.
        assert_eq!(&kinds[..6], &[2, 2, 2, 2, 2, 2]);
    }

    #[test]
    fn alt_screen_orphan_default_does_not_poison_cache_for_thinking() {
        // The reported false positive: a thinking block whose `∴` head scrolls
        // off the top during streaming. While the head is off-screen the orphan
        // default may transiently tint the indented continuations — but it must
        // NOT remember that guess, or the tint sticks even after the `∴` head
        // scrolls back into view (where the block is unambiguously non-message).
        let mut t = TerminalState::new(6, 60);
        t.advance_bytes(b"\x1b[?1049h");
        // Frame 1 (live bottom, `∴` head above the top): only the continuations
        // show. The orphan default has no head/band/cache anchor here.
        t.advance_bytes(
            "  The key insight is the cache.\r\n  More reasoning prose here.\r\n  Even more thinking text.\r\n"
                .as_bytes(),
        );
        let _ = t.visible_line_kinds(0);
        // Frame 2 (scrolled up): the `∴` head is visible again above the same
        // body. The head establishes a non-message block; the body must be 0.
        t.advance_bytes(b"\x1b[2J\x1b[H");
        t.advance_bytes(
            "\u{2234} I am thinking about it.\r\n  The key insight is the cache.\r\n  More reasoning prose here.\r\n  Even more thinking text.\r\n"
                .as_bytes(),
        );
        let kinds = t.visible_line_kinds(0);
        assert_eq!(&kinds[..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn alt_screen_orphan_default_skips_grey_tool_output() {
        // The reported scroll flash: a wrapped tool-output line in an orphan
        // window (its `●`/`⎿` head momentarily above the top). It is indented and
        // prose-like, but rendered in Claude Code's grey (#999) — so it must NOT
        // be tinted as an assistant message. A live capture showed tool results
        // at fg≈(0.6,0.6,0.6); assistant prose is fg=Default.
        let mut t = TerminalState::new(4, 60);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "\x1b[38;2;153;153;153m  reading file contents here and a lot more text\x1b[0m\r\n"
                .as_bytes(),
        );
        assert_eq!(t.visible_line_kinds(0)[0], 0);
        // Sanity: the same words in the DEFAULT fg (an assistant continuation)
        // are still tinted, so the guard keys on style, not on the words.
        let mut t2 = TerminalState::new(4, 60);
        t2.advance_bytes(b"\x1b[?1049h");
        t2.advance_bytes("  reading file contents here and a lot more text\r\n".as_bytes());
        assert_eq!(t2.visible_line_kinds(0)[0], 2);
    }

    #[test]
    fn alt_screen_orphan_default_skips_faint_or_italic_thinking() {
        // Thinking continuations in an orphan window: even in the default fg they
        // are rendered faint and/or italic, which marks them as non-message.
        let mut t = TerminalState::new(4, 60);
        t.advance_bytes(b"\x1b[?1049h");
        // SGR 2 (faint) + 3 (italic).
        t.advance_bytes(
            "\x1b[2m\x1b[3m  the key insight is the scroll cache here\x1b[0m\r\n".as_bytes(),
        );
        assert_eq!(t.visible_line_kinds(0)[0], 0);
    }

    #[test]
    fn alt_screen_white_bash_output_stays_untinted_after_head_scrolls_off() {
        // The reported case: `Bash` writes its output in the *default* (white)
        // fg, identical to a Claude message body, so the style guard can't tell
        // them apart. The structure can: the output sits under a green `● Bash(…)`
        // head and a `⎿` marker. Seen once with that head/marker on screen, the
        // output is remembered as non-message and must stay untinted on scroll.
        let mut t = TerminalState::new(6, 60);
        t.advance_bytes(b"\x1b[?1049h");
        // Frame 1: the green tool head + `⎿` + white output are all on screen.
        t.advance_bytes(
            "\x1b[38;2;78;186;101m\u{25cf}\x1b[0m Bash(seq 1 50)\r\n  \u{23bf} output line one detail\r\n    output line two detail\r\n    output line three detail\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..4], &[0, 0, 0, 0]);
        // Frame 2: scrolled up — the `● Bash` head and `⎿` are above the top, only
        // the white output shows. It must NOT be guessed as a Claude message.
        t.advance_bytes(b"\x1b[2J\x1b[H");
        t.advance_bytes(
            "    output line two detail\r\n    output line three detail\r\n".as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..2], &[0, 0]);
    }

    #[test]
    fn alt_screen_visible_bash_result_marker_blocks_orphan_tint() {
        // Even with the `● Bash` head one row above the top, the `⎿` marker is the
        // first visible row; it opens the tool block so the white output below it
        // is not orphan-defaulted to Claude on that frame (no cache needed).
        let mut t = TerminalState::new(4, 60);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "  \u{23bf} first output row of the command\r\n    second output row of the command\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..2], &[0, 0]);
    }

    #[test]
    fn alt_screen_deep_bash_output_not_tinted_at_top_of_orphan_window() {
        // Real `/commit` case (from a live capture): multi-line git/bash output
        // under a `⎿` whose head is above the top of the alt screen. The output is
        // white (fg=Default) like a Claude message, but indented far deeper
        // (col 5–8) than a Claude body (col 2). At the top of an orphan window it
        // must NOT bootstrap the purple tint — the bug the user saw on every
        // commit/push until the green bullet scrolled into view.
        let mut t = TerminalState::new(5, 70);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "     To https://github.com/x/arkadia.git\r\n        dc1c7e3..d2ad91f  master -> master\r\n     Deleted branch fix/foo\r\n     === final ===\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn alt_screen_deep_claude_code_tinted_by_propagation_from_col2() {
        // The indent guard only blocks *bootstrapping* the tint. A deeply-indented
        // Claude line (a code block at col 4) preceded by a col-2 body line still
        // gets tinted, because the kind propagates down from the anchored line.
        let mut t = TerminalState::new(5, 60);
        t.advance_bytes(b"\x1b[?1049h");
        t.advance_bytes(
            "  Voici le code de la fonction principale.\r\n  function f(x) {\r\n    return x + 1;\r\n  }\r\n"
                .as_bytes(),
        );
        assert_eq!(&t.visible_line_kinds(0)[..4], &[2, 2, 2, 2]);
    }
}
