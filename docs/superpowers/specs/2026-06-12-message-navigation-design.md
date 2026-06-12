# Message Navigation & Tinting — Design

Date: 2026-06-12
Status: approved

## Goal

When a pane runs Claude Code, let the user (a) visually distinguish conversation
messages while scrolling, and (b) jump between them with toolbar buttons.

- **User messages** — head line `❯` at column 0 **over Claude Code's grey
  background band** (truecolor ≈ #373737, painted across the full row). The
  block extends exactly as far as the grey band does. The live input box `❯`
  (empty or while typing) has a default background and never matches; the
  sticky last-prompt header shown when scrolled tints only its own row.
  Ground truth from a ConPTY capture: `❯ text`, fg grey #505050, bg #373737.
- **Claude messages** — blocks whose head line starts with `●` (U+25CF, pure
  white truecolor in the capture; `⏺` U+23FA accepted as fallback) at
  column 0, rendered in the **default/white-ish** foreground (truecolor
  ≥ 0.7 per channel). Colored bullets (tool calls, todos) are ignored.

**Critical environmental fact (found the hard way):** Claude Code runs its
TUI on the **alt screen** (DEC 1049) with full mouse tracking (1003 + SGR
1006) and scrolls its transcript internally. Arkadia's scrollback is empty
for those panes, so classification must run on the visible alt screen and
navigation cannot use `scroll_terminal`.

## Features

### 1. Permanent line tint

Every line belonging to a message block gets a subtle background tint
(~6% opacity over the palette background — just visible while scrolling):

- User blocks → green (`#22c55e` @ 6%). The green **replaces** Claude Code's
  own grey band (every run is repainted on user rows).
- Claude blocks → purple (`#a855f7` @ 6%), default-bg runs only (diffs/code
  backgrounds inside a response stay intact).

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

- `RenderPayload.line_kinds: Vec<u8>` filled in `emit_render`. On the alt
  screen the visible screen is classified as-is (no scrollback).
- Tauri command `navigate_message(session_id, kind, dir) -> bool` with two
  strategies:
  - **Main screen**: markers live in Arkadia's scrollback — set the scroll
    offset directly (same math as search hits) and re-emit.
  - **Alt screen** (Claude Code): `wheel_navigate` sends SGR wheel events to
    the PTY and watches the redrawn grid until the target marker reaches the
    vertical center. The anchor is the message navigated to by the previous
    click (line hash remembered per session in `Session.nav_target`), falling
    back to the marker nearest the center — successive clicks progress
    message by message and adjacent messages are never skipped. Stops at the
    transcript edges (screen stops changing) and bails after ~60 blind
    notches when no message of the kind exists nearby.
    **Throttled to ≥150ms between wheel events**: Claude Code coalesces
    rapid wheel input and its scroll state machine wedges at the buffer top
    when slammed (30ms gaps wedge it irrecoverably, 250ms never does —
    verified with `examples/wheel_probe.rs`).
- `list_message_markers(session_id)` kept as a debugging command.
- Debug examples (`src-tauri/examples/`): `capture_claude.rs` (ConPTY raw
  capture of a resumed session), `classify_capture.rs` (classification dump),
  `navigate_live.rs` (end-to-end wheel navigation against the real app).

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
