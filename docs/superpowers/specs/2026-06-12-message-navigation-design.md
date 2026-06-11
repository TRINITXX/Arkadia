# Message Navigation & Tinting — Design

Date: 2026-06-12
Status: approved

## Goal

When a pane runs Claude Code, let the user (a) visually distinguish conversation
messages while scrolling, and (b) jump between them with toolbar buttons.

- **User messages** — blocks whose head line starts with `❯` at column 0.
- **Claude messages** — blocks whose head line starts with `●` at column 0
  rendered in the **default/white** foreground. Colored `●` (tool calls, todos)
  are ignored.

## Features

### 1. Permanent line tint

Every line belonging to a message block gets a subtle background tint
(~12% opacity over the palette background — just visible while scrolling):

- User blocks → green (`#22c55e` @ 12%)
- Claude blocks → purple (`#a855f7` @ 12%)

Block extent rule (matches Claude Code layout): a line with a non-space
character at column 0 starts a new block; indented and blank lines belong to
the current block. Blank lines are tinted only when followed (before the next
head) by a non-blank line of the same block — i.e. interior paragraph gaps are
tinted, trailing gaps between blocks are not.

The empty input prompt (`❯` with nothing after it) is **not** a user block:
a `❯` head requires non-space content after the marker on the same line.

### 2. Four navigation buttons

In the toolbar, left of the notepad button:
`[↑ green] [↓ green] [↑ purple] [↓ purple]`

- Green pair: previous/next **user** message. Purple pair: **Claude** messages.
- ↑ = older (up), ↓ = newer (down). No wrap-around.
- Acts on the **active pane**; the target message head row is centered in the
  viewport (same math as the search `scrollToHit`).
- Button backgrounds use the **same color and opacity** as the line tints
  (rgba @ 12%, slightly stronger on hover); icons stay neutral zinc.

## Architecture (approach A — backend classifies, frontend tints)

### Rust — `terminal_state.rs`

- `MessageKind` (None/User/Claude) + head detection helpers.
  - White check for `●`: fg is `Default`, palette index 7/15, or truecolor with
    r,g,b ≥ 0.85.
- `pub fn message_markers(&self) -> Vec<MessageMarker { total_row: u32, kind: u8 }>`
  — full scan of scrollback + active screen (empty on alt screen). Same
  `total_row` convention as `search`.
- `pub fn visible_line_kinds(&self, scroll_offset: u32) -> Vec<u8>` — one kind
  (0/1/2) per visible row. Resolves the enclosing block of the first visible
  row by scanning up to the nearest head; blank lines look ahead to the next
  non-blank to distinguish interior vs trailing gaps. All zeros on alt screen.

### Rust — `terminal.rs` / `lib.rs`

- `RenderPayload.line_kinds: Vec<u8>` filled in `emit_render`.
- New Tauri command `list_message_markers(session_id) -> Vec<MessageMarker>`,
  registered in `lib.rs`. Invoked on demand (button click only).

### Frontend — `types.ts`, `TerminalWebGPU.tsx`

- `RenderPayload.line_kinds?: number[]`, `MessageMarker` interface.
- `applyMessageTint(screen, palette)` first in the `redraw()` chain (search and
  hover highlights keep priority): for tinted rows, runs whose bg is still
  `default` get `bg = mix(palette.bg, tint, 0.12)` as an rgb hex. Runs cover
  the full row width (blank cells included), so the whole line is tinted.

### Frontend — `Toolbar.tsx`, `App.tsx`

- Toolbar gains `onNavigateMessage(kind, dir)` + disabled state; renders the
  4 buttons (Tailwind arbitrary rgba backgrounds, lucide chevrons).
- `App.navigateMessage`: fetch markers, filter by kind, current position =
  viewport center row in total coords, pick previous (`< center`, last) or
  next (`> center`, first), scroll via `scroll_terminal` with a clamped delta
  centering the target.

## Edge cases

- Alt screen: no tint, no markers.
- Typing in the prompt: the line has content after `❯` → tinted green and
  navigable (consistent).
- A message whose target row cannot be centered (too close to the bottom):
  clamped scroll; a second click is a no-op once the row is on screen.
- Non-Claude-Code panes: `❯`/`●`-headed lines may still match — accepted
  heuristic, tint is subtle.

## Testing

Rust unit tests on a synthetic `TerminalState` (feed bytes through the parser):

- `❯ text` block → User; continuation + interior blank lines tinted; trailing
  blank not tinted.
- White `●` → Claude; colored `●` (e.g. SGR 32) → ignored.
- Empty prompt `❯` → no marker, no tint.
- `message_markers` returns heads in order with correct `total_row` across
  scrollback + screen.
- `visible_line_kinds` correct when the block head is scrolled off-screen.
