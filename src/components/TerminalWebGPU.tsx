import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  readText as readClipboard,
  writeText as writeClipboard,
} from "@tauri-apps/plugin-clipboard-manager";
import { Renderer } from "@renderer/terminal_renderer.js";
import { ensureWasmReady, paletteToWasm } from "@/lib/wasmRenderer";
import { measureCellSize } from "@/lib/cellSize";
import { CLAUDE_TINT, hexToRgba, USER_TINT } from "@/lib/messageTint";
import { isChromeRow, isInputRow, isJumpPill } from "@/lib/terminalChrome";
import {
  findClickableAt,
  buildRowMapping,
  colToCharIndex,
  charRangeToCols,
  type ClickableMatch,
  type PathMatch,
} from "@/lib/urlDetect";
import type {
  CellColor,
  CellRun,
  EditorProtocol,
  PaneState,
  RenderPayload,
  SearchHit,
  TerminalFont,
  TerminalPalette,
} from "@/types";

/** Backend result of the `resolve_path_at` command. */
interface ResolvedPath {
  start: number;
  end: number;
  abs_path: string;
  line: number | null;
  col: number | null;
}

const fontBytesCache = new Map<string, Promise<Uint8Array | null>>();

function loadFontBytes(family: string): Promise<Uint8Array | null> {
  const primary =
    family
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? "";
  if (!primary) return Promise.resolve(null);
  let promise = fontBytesCache.get(primary);
  if (!promise) {
    promise = invoke<number[] | Uint8Array>("get_font_data", {
      family: primary,
    })
      .then((raw) => (raw instanceof Uint8Array ? raw : new Uint8Array(raw)))
      .catch((e) => {
        console.warn(`[arkadia] '${primary}' not found on system:`, e);
        return null;
      });
    fontBytesCache.set(primary, promise);
  }
  return promise;
}

interface HoverRange {
  match: ClickableMatch;
  row: number;
  startCol: number;
  endCol: number;
}

interface VisibleHit {
  row: number;
  startCol: number;
  endCol: number;
  /** True for the currently-selected hit (orange instead of yellow). */
  current: boolean;
}

/**
 * Project backend hits (`total_row`) onto the visible viewport given the
 * current scroll position. `scroll_max` is the scrollback length, so visible
 * row 0 = `scroll_max - scroll_offset` in total coords.
 */
function visibleHitsForScreen(
  screen: RenderPayload,
  hits: SearchHit[],
  currentIdx: number,
): VisibleHit[] {
  const visibleStart = screen.scroll_max - screen.scroll_offset;
  const out: VisibleHit[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const visRow = h.total_row - visibleStart;
    if (visRow < 0 || visRow >= screen.rows) continue;
    out.push({
      row: visRow,
      startCol: h.start_col,
      endCol: h.end_col,
      current: i === currentIdx,
    });
  }
  return out;
}

/** Adds a yellow background over the cells covered by `hits` (orange for current). Splits affected runs. */
function applySearchHighlight(
  screen: RenderPayload,
  hits: VisibleHit[],
  highlightColor: string,
  currentColor: string,
): RenderPayload {
  if (hits.length === 0) return screen;
  const byRow = new Map<number, VisibleHit[]>();
  for (const hit of hits) {
    const arr = byRow.get(hit.row);
    if (arr) arr.push(hit);
    else byRow.set(hit.row, [hit]);
  }
  const newLines = screen.lines.slice();
  for (const [row, rowHits] of byRow) {
    const original = newLines[row];
    if (!original) continue;
    const newRuns: CellRun[] = [];
    let col = 0; // tracked in cell columns
    for (const run of original) {
      const cellWidth = run.cell_width ?? 1;
      const chars = [...run.text];
      const runEnd = col + chars.length * cellWidth;
      let charCursor = 0;
      while (charCursor < chars.length) {
        const absCol = col + charCursor * cellWidth;
        const inHit = rowHits.find(
          (h) => absCol >= h.startCol && absCol < h.endCol,
        );
        if (inHit) {
          let endChars = charCursor + 1;
          while (
            endChars < chars.length &&
            col + endChars * cellWidth < inHit.endCol
          ) {
            endChars++;
          }
          newRuns.push({
            ...run,
            text: chars.slice(charCursor, endChars).join(""),
            bg: {
              kind: "rgb",
              value: inHit.current ? currentColor : highlightColor,
            },
            fg: { kind: "rgb", value: "#000000" },
          });
          charCursor = endChars;
        } else {
          let endChars = chars.length;
          for (const h of rowHits) {
            if (h.startCol <= absCol) continue;
            const hitStartChar = Math.ceil((h.startCol - col) / cellWidth);
            if (hitStartChar > charCursor && hitStartChar < endChars) {
              endChars = hitStartChar;
            }
          }
          newRuns.push({
            ...run,
            text: chars.slice(charCursor, endChars).join(""),
          });
          charCursor = endChars;
        }
      }
      col = runEnd;
    }
    newLines[row] = newRuns;
  }
  return { ...screen, lines: newLines };
}

/**
 * Returns a shallow-cloned screen with the cells covering `hover` highlighted:
 * a background fill + contrasting foreground + underline. A 1px underline alone
 * is imperceptible over busy TUI output (e.g. Claude Code), so we fill the cell
 * background — the same mechanism the search highlight uses. Splits the affected
 * runs at the link boundaries.
 */
const HOVER_BG = "#2563eb"; // blue-600
const HOVER_FG = "#ffffff";

function applyHoverHighlight(
  screen: RenderPayload,
  hover: HoverRange | null,
): RenderPayload {
  if (!hover) return screen;
  const { row, startCol, endCol } = hover;
  if (row < 0 || row >= screen.lines.length) return screen;
  const original = screen.lines[row];
  const newRuns: CellRun[] = [];
  let col = 0; // tracked in cell columns
  for (const run of original) {
    const cellWidth = run.cell_width ?? 1;
    const chars = [...run.text];
    const cellLen = chars.length * cellWidth;
    const runEnd = col + cellLen;
    if (runEnd <= startCol || col >= endCol) {
      newRuns.push(run);
    } else {
      const localStartCells = Math.max(0, startCol - col);
      const localEndCells = Math.min(cellLen, endCol - col);
      // Snap to wide-char boundaries to avoid splitting a wide grapheme.
      const localStartChars = Math.floor(localStartCells / cellWidth);
      const localEndChars = Math.ceil(localEndCells / cellWidth);
      if (localStartChars > 0) {
        newRuns.push({
          ...run,
          text: chars.slice(0, localStartChars).join(""),
        });
      }
      newRuns.push({
        ...run,
        text: chars.slice(localStartChars, localEndChars).join(""),
        underline_style: 1,
        bg: { kind: "rgb", value: HOVER_BG },
        fg: { kind: "rgb", value: HOVER_FG },
      });
      if (localEndChars < chars.length) {
        newRuns.push({ ...run, text: chars.slice(localEndChars).join("") });
      }
    }
    col = runEnd;
  }
  const newLines = screen.lines.slice();
  newLines[row] = newRuns;
  return { ...screen, lines: newLines };
}

/**
 * Strips Claude Code's grey user-prompt band: user rows (`line_kinds === 1`)
 * get their cell backgrounds reset to default, so only the green frame
 * (MessageBorderOverlay) marks a user message — no grey fill behind the text.
 */
function stripUserBand(screen: RenderPayload): RenderPayload {
  const kinds = screen.line_kinds;
  if (!kinds || !kinds.some((k) => k === 1)) return screen;
  const transparent: CellColor = { kind: "default" };
  const newLines = screen.lines.slice();
  for (let row = 0; row < newLines.length; row++) {
    if (kinds[row] === 1) {
      newLines[row] = newLines[row].map((run) =>
        run.bg.kind === "default" ? run : { ...run, bg: transparent },
      );
    }
  }
  return { ...screen, lines: newLines };
}

/**
 * Blanks Claude Code's floating "Jump to bottom (ctrl+End)" pill — a centred
 * overlay that clutters the transcript. The message-nav rail + ctrl+End cover
 * its function.
 */
function hideJumpPill(screen: RenderPayload): RenderPayload {
  let changed = false;
  const transparent: CellColor = { kind: "default" };
  const newLines = screen.lines.map((line) => {
    if (!isJumpPill(line)) return line;
    changed = true;
    return line.map((run) => ({
      ...run,
      text: " ".repeat([...run.text].length),
      bg: transparent,
    }));
  });
  return changed ? { ...screen, lines: newLines } : screen;
}

interface MessageBlock {
  /** 1 = user → green, 2 = Claude → purple. */
  kind: number;
  /** First and last visible row index (inclusive) of the contiguous block. */
  start: number;
  end: number;
}

/** Contiguous runs of same-kind rows in `line_kinds` (skipping kind 0). */
function messageBlocks(kinds: number[] | null | undefined): MessageBlock[] {
  if (!kinds) return [];
  const blocks: MessageBlock[] = [];
  let i = 0;
  while (i < kinds.length) {
    const k = kinds[i];
    if (k === 1 || k === 2) {
      let j = i;
      while (j + 1 < kinds.length && kinds[j + 1] === k) j++;
      blocks.push({ kind: k, start: i, end: j });
      i = j + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

/**
 * Draws the conversation block outline (`line_kinds` from the backend: 1 = user
 * → green, 2 = Claude → purple) as a framed box per contiguous block, as a DOM
 * overlay above the canvas. A border (not a background fill) keeps the terminal
 * colors untouched; rgba alpha gives the outline its own, higher opacity. Rows
 * map to pixels via the same CSS-pixel cell height the grid is laid out with
 * (`measureCellSize`), so the box stays aligned at any font size / DPR.
 */
function MessageBorderOverlay({
  screen,
  font,
}: {
  screen: RenderPayload | null;
  font: TerminalFont;
}) {
  const blocks = messageBlocks(screen?.line_kinds);
  if (blocks.length === 0) return null;
  const lines = screen?.lines ?? [];
  const cols = screen?.cols ?? 80;
  const rows = screen?.rows ?? lines.length;
  const { height: cellH } = measureCellSize(font.family, font.size);
  // Horizontal overshoot of the frame into the pane padding.
  const GAP = 8;
  // Vertical breathing room (px) into adjacent whitespace — capped at half the
  // available gap so two stacked frames never overlap and keep a clear margin.
  const MARGIN_V = 4;

  // Column of the first non-space cell of a row, or null when blank.
  const firstContentCol = (row: number): number | null => {
    const line = lines[row];
    if (!line) return null;
    let col = 0;
    for (const r of line) {
      const w = r.cell_width ?? 1;
      for (const ch of [...r.text]) {
        if (ch.trim().length > 0) return col;
        col += w;
      }
    }
    return null;
  };
  // "Left content" = a genuine message line (starts in the left quarter). Blank
  // rows, centred pills ("Jump to bottom"), and right-aligned footers are
  // excluded, so the backend's tint bleed across empty space never gets framed.
  const isLeftContent = (row: number): boolean => {
    const idx = firstContentCol(row);
    return idx !== null && idx * 4 <= cols;
  };
  // A right-aligned row = the footer token counter. A cut-off frame stops just
  // above it.
  const isRightAligned = (row: number): boolean => {
    const idx = firstContentCol(row);
    return idx !== null && idx * 4 >= cols * 3;
  };
  // Count of consecutive non-content (blank/footer) rows from `row` in `dir`.
  const blankRun = (row: number, dir: 1 | -1): number => {
    let n = 0;
    for (let r = row; r >= 0 && r < rows && !isLeftContent(r); r += dir) n++;
    return n;
  };

  // The "Jump to bottom" pill is only present when the transcript is scrolled
  // up — i.e. the bottom-most visible message continues below the fold and must
  // keep its bottom open. Detected by its text (stable), not by position: the
  // pill is a fixed overlay that can sit on top of any content row.
  const scrolledUp = lines.some((line) => isJumpPill(line));

  // First pass: trim each block to its real content rows.
  const trimmed = blocks
    .map((b) => {
      let start = b.start;
      let end = b.end;
      while (start <= end && !isLeftContent(start)) start++;
      while (end >= start && !isLeftContent(end)) end--;
      return start <= end ? { kind: b.kind, start, end } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const maxEnd = trimmed.reduce((m, b) => Math.max(m, b.end), -1);

  // True when the message at `end` runs off the bottom of the viewport: scrolled
  // up, it's the bottom-most block, and nothing but chrome/footer follows it. If
  // a conversation row (e.g. a `∴` thinking line) sits below it before the
  // footer, the message actually ended on screen → not cut off.
  const runsOffBottom = (end: number): boolean => {
    if (!scrolledUp || end !== maxEnd) return false;
    for (let r = end + 1; r < rows; r++) {
      if (firstContentCol(r) === null) continue; // blank
      if (isChromeRow(lines[r], cols) || isInputRow(lines[r])) break; // footer
      return false; // real conversation content below → ended on screen
    }
    return true;
  };

  // True when `row` is the actual head of its message (Claude `●`/`⏺`, user `❯`).
  // When the head has scrolled off the top, the block's first visible row is a
  // continuation — so the frame is cut at the top and its top border is dropped.
  const startsWithHead = (row: number, kind: number): boolean => {
    const line = lines[row];
    if (!line) return false;
    let text = "";
    for (const r of line) text += r.text;
    const t = text.replace(/^\s+/u, "");
    if (kind === 2) return t.startsWith("●") || t.startsWith("⏺");
    if (kind === 1) return t.startsWith("❯");
    return true;
  };

  const boxes = trimmed.map(({ kind, start, end }) => {
    // Cut off at the bottom: the bottom-most block while scrolled up.
    const cutOff = runsOffBottom(end);
    // Cut off at the top: the message head scrolled above the viewport, so the
    // first visible row isn't the `●`/`❯` head → drop the top border.
    const cutTop = !startsWithHead(start, kind);
    // Where a cut-off frame stops: just above the token counter (right-aligned)
    // or the input separator / `❯` box (left content) — whichever comes first.
    // Never the viewport bottom, so the sides don't wrap the input/status area.
    let footerBottom = end + 1;
    while (
      footerBottom < rows &&
      !isLeftContent(footerBottom) &&
      !isRightAligned(footerBottom)
    )
      footerBottom++;
    // Reach up to MARGIN_V into adjacent whitespace for text breathing, but
    // never more than half of it — so two stacked frames (e.g. a pinned prompt
    // above a Claude reply) keep a clear gap and never overlap.
    const topExt = Math.min(MARGIN_V, (blankRun(start - 1, -1) * cellH) / 2);
    const botExt = Math.min(MARGIN_V, (blankRun(end + 1, 1) * cellH) / 2);
    return { kind, start, end, topExt, botExt, cutOff, cutTop, footerBottom };
  });

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {boxes.map((b) => {
        const tint = b.kind === 1 ? USER_TINT : CLAUDE_TINT;
        // Soft "glow" delimiter (vs. the old hard 1px box): a barely-there tint
        // fill + a low-alpha ring (no glow). The ring is per-side so a cut edge
        // stays open.
        const ring = `1px solid ${hexToRgba(tint, 0.2)}`;
        // No breathing room above a top-cut frame: it opens at the viewport edge.
        const tExt = b.cutTop ? 0 : b.topExt;
        const R = 10;
        const tl = b.cutTop ? 0 : R;
        const br = b.cutOff ? 0 : R;
        return (
          <div
            key={`${b.kind}:${b.start}`}
            style={{
              position: "absolute",
              top: b.start * cellH - tExt,
              // When cut off, the open frame stops just under the token count
              // (footerBottom), not at the viewport bottom — so its sides don't
              // run through the input/status area.
              height: b.cutOff
                ? (b.footerBottom - b.start) * cellH + tExt
                : (b.end - b.start + 1) * cellH + tExt + b.botExt,
              left: -GAP,
              // Clear the scrollbar overlay (6px + a small margin) on the right.
              right: 10,
              background: hexToRgba(tint, 0.05),
              borderTop: b.cutTop ? "none" : ring,
              borderLeft: ring,
              borderRight: ring,
              borderBottom: b.cutOff ? "none" : ring,
              // Square off whichever edge is open (cut at top and/or bottom).
              borderRadius: `${tl}px ${tl}px ${br}px ${br}px`,
              boxSizing: "border-box",
            }}
          />
        );
      })}
    </div>
  );
}

/** True iff the running app has activated some form of mouse tracking. */
function mouseModeActive(screen: RenderPayload | null): boolean {
  return (screen?.mouse_protocol ?? 0) > 0;
}

/**
 * If `col` lands on the right half of a wide grapheme, returns the column of
 * its main (left half) so URL/path/hyperlink lookups land on the right cell.
 * Otherwise returns `col` unchanged.
 */
function snapToWideMain(
  screen: RenderPayload | null,
  col: number,
  row: number,
): number {
  if (!screen) return col;
  const line = screen.lines[row];
  if (!line) return col;
  let c = 0;
  for (const run of line) {
    const cellWidth = run.cell_width ?? 1;
    const len = [...run.text].length * cellWidth;
    if (col >= c && col < c + len) {
      if (cellWidth === 2 && (col - c) % 2 === 1) return col - 1;
      return col;
    }
    c += len;
  }
  return col;
}

/** Packs keyboard modifiers into the bit layout the backend expects. */
function mouseModifiers(e: {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}): number {
  return (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4 : 0);
}

function keyEventToBytes(e: React.KeyboardEvent): Uint8Array | null {
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    switch (e.key) {
      case "ArrowLeft":
        return new TextEncoder().encode("\x1b[1;5D");
      case "ArrowRight":
        return new TextEncoder().encode("\x1b[1;5C");
      case "ArrowUp":
        return new TextEncoder().encode("\x1b[1;5A");
      case "ArrowDown":
        return new TextEncoder().encode("\x1b[1;5B");
      // Ctrl+Backspace → Ctrl+W (backward-kill-word). PSReadLine, bash readline,
      // zsh, Claude Code all interpret 0x17 as "delete previous word".
      case "Backspace":
        return new Uint8Array([0x17]);
      // Ctrl+Delete → Alt+D (kill-word forward) in readline conventions.
      case "Delete":
        return new TextEncoder().encode("\x1bd");
    }
  }
  switch (e.key) {
    case "Enter":
      // Shift+Enter sends ESC+CR (a.k.a. Alt-Enter) — Claude Code and most
      // readline-style apps interpret this as "newline without submit".
      return new TextEncoder().encode(e.shiftKey ? "\x1b\r" : "\r");
    case "Backspace":
      return new Uint8Array([0x7f]);
    case "Tab":
      return new TextEncoder().encode(e.shiftKey ? "\x1b[Z" : "\t");
    case "Escape":
      return new TextEncoder().encode("\x1b");
    case "ArrowUp":
      return new TextEncoder().encode("\x1b[A");
    case "ArrowDown":
      return new TextEncoder().encode("\x1b[B");
    case "ArrowRight":
      return new TextEncoder().encode("\x1b[C");
    case "ArrowLeft":
      return new TextEncoder().encode("\x1b[D");
    case "Home":
      return new TextEncoder().encode("\x1b[H");
    case "End":
      return new TextEncoder().encode("\x1b[F");
    case "PageUp":
      return new TextEncoder().encode("\x1b[5~");
    case "PageDown":
      return new TextEncoder().encode("\x1b[6~");
    case "Insert":
      return new TextEncoder().encode("\x1b[2~");
    case "Delete":
      return new TextEncoder().encode("\x1b[3~");
  }
  if (e.key.startsWith("F") && e.key.length <= 3) {
    const n = parseInt(e.key.slice(1), 10);
    if (n >= 1 && n <= 4) {
      return new TextEncoder().encode(`\x1bO${"PQRS"[n - 1]}`);
    }
    if (n >= 5 && n <= 12) {
      const map: Record<number, string> = {
        5: "15",
        6: "17",
        7: "18",
        8: "19",
        9: "20",
        10: "21",
        11: "23",
        12: "24",
      };
      return new TextEncoder().encode(`\x1b[${map[n]}~`);
    }
  }
  if (e.key.length === 1) {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const code = e.key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) return new Uint8Array([code - 96]);
      if (e.key === "@") return new Uint8Array([0x00]);
      if (e.key === "[") return new Uint8Array([0x1b]);
      if (e.key === "\\") return new Uint8Array([0x1c]);
      if (e.key === "]") return new Uint8Array([0x1d]);
      if (e.key === "^") return new Uint8Array([0x1e]);
      if (e.key === "_") return new Uint8Array([0x1f]);
      return null;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const enc = new TextEncoder().encode(e.key);
      const out = new Uint8Array(enc.length + 1);
      out[0] = 0x1b;
      out.set(enc, 1);
      return out;
    }
    return new TextEncoder().encode(e.key);
  }
  return null;
}

interface Props {
  pane: PaneState;
  isActive: boolean;
  font: TerminalFont;
  palette: TerminalPalette;
  editorProtocol: EditorProtocol;
  /** Draw the green/purple conversation frames. */
  showMessageFrames: boolean;
  onActivate: () => void;
  /** Fired when the user produces real input (keystroke/paste) in this pane. */
  onUserInput?: () => void;
  onContextMenu: (x: number, y: number) => void;
}

export function TerminalWebGPU({
  pane,
  isActive,
  font,
  palette,
  showMessageFrames,
  onActivate,
  onUserInput,
  onContextMenu,
}: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const readyRef = useRef(false);
  const [rendererVersion, setRendererVersion] = useState(0);
  const focusedRef = useRef(false);
  const [scrollbarVisible, setScrollbarVisible] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHitCount, setSearchHitCount] = useState(0);
  const [searchCurrent1, setSearchCurrent1] = useState(0); // 1-based, 0 = none
  const allHitsRef = useRef<SearchHit[]>([]);
  const currentHitIdxRef = useRef<number>(-1);
  const visibleHitsRef = useRef<VisibleHit[]>([]);
  // Latest payload, kept in a ref so the resize observer can repaint
  // without re-creating itself on every render.
  const screenRef = useRef(pane.screen);
  useEffect(() => {
    screenRef.current = pane.screen;
  }, [pane.screen]);

  // Live cwd kept in a ref so the (deps: []) hover effect reads the current
  // value when resolving relative paths, not the null captured at mount.
  const cwdRef = useRef(pane.cwd);
  useEffect(() => {
    cwdRef.current = pane.cwd;
  }, [pane.cwd]);

  // Live palette in a ref so redraws triggered from stale closures (resize
  // observer, window listeners) still tint with the current background.
  const paletteRef = useRef(palette);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  // Mouse-selection state. cellRef is the CSS-pixel cell size so we can
  // convert mouse coords → grid cells without a fresh measurement.
  const cellRef = useRef<{ w: number; h: number }>({ w: 1, h: 1 });
  // Drag anchor in *total* row coordinates (0 = oldest scrollback line) so
  // the selection stays glued to content while the viewport scrolls.
  const dragStartRef = useRef<{ col: number; row: number } | null>(null);
  const dragMovedRef = useRef(false);
  // Current selection endpoints (total rows), mirroring the renderer's
  // Selection — needed to fetch the selected text from the backend on copy.
  const selectionRef = useRef<{
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  } | null>(null);
  // Last mouse position of an in-progress drag, to re-anchor the selection
  // end when the viewport scrolls under a stationary cursor.
  const lastDragPosRef = useRef<{ x: number; y: number } | null>(null);
  // Edge auto-scroll while drag-selecting past the top/bottom border.
  const autoScrollTimerRef = useRef<number | null>(null);
  const autoScrollDeltaRef = useRef(0);
  const hoveredUrlRef = useRef<HoverRange | null>(null);
  const pendingClickRef = useRef<ClickableMatch | null>(null);
  // When the running TUI has mouse tracking on and the user presses a button
  // without Shift, we forward the press to the PTY and keep the originating
  // button here so that the matching mouseup/mousemove can route too.
  const mouseEventActiveRef = useRef<{ button: number } | null>(null);
  // Dedup motion events to one per cell. Browsers fire mousemove on every
  // pixel of motion; TUIs only care when we cross a cell boundary.
  const lastMouseCellRef = useRef<{ col: number; row: number } | null>(null);

  const recomputeVisibleHits = () => {
    const screen = screenRef.current;
    if (!screen || allHitsRef.current.length === 0) {
      visibleHitsRef.current = [];
      return;
    }
    visibleHitsRef.current = visibleHitsForScreen(
      screen,
      allHitsRef.current,
      currentHitIdxRef.current,
    );
  };

  const redraw = () => {
    const r = rendererRef.current;
    const screen = screenRef.current;
    if (!readyRef.current || !r || !screen) return;
    recomputeVisibleHits();
    // Conversation block outlines are a DOM overlay (MessageBorderOverlay); the
    // only cell repaint is stripping Claude Code's grey user-prompt band so the
    // green frame stands alone. Search + hover layer on top.
    let modified = stripUserBand(screen);
    modified = hideJumpPill(modified);
    modified = applySearchHighlight(
      modified,
      visibleHitsRef.current,
      "#fde047", // yellow for non-current hits
      "#fb923c", // orange for the current hit
    );
    modified = applyHoverHighlight(modified, hoveredUrlRef.current);
    r.draw(modified);
  };

  const scrollToHit = (idx: number) => {
    const screen = screenRef.current;
    if (!screen || allHitsRef.current.length === 0) return;
    const hit = allHitsRef.current[idx];
    if (!hit) return;
    // Center the hit row in the viewport.
    const desiredOffset =
      screen.scroll_max - hit.total_row + Math.floor(screen.rows / 2);
    const target = Math.max(0, Math.min(screen.scroll_max, desiredOffset));
    const delta = target - screen.scroll_offset;
    if (delta !== 0) {
      void invoke("scroll_terminal", { sessionId: pane.id, delta });
    } else {
      // Already on screen — just refresh the highlight.
      redraw();
    }
  };

  const gotoHit = (idx: number) => {
    const hits = allHitsRef.current;
    if (hits.length === 0) {
      currentHitIdxRef.current = -1;
      setSearchCurrent1(0);
      return;
    }
    const realIdx = ((idx % hits.length) + hits.length) % hits.length;
    currentHitIdxRef.current = realIdx;
    setSearchCurrent1(realIdx + 1);
    scrollToHit(realIdx);
  };

  const cellAt = (clientX: number, clientY: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return { col: 0, row: 0 };
    const rect = wrapper.getBoundingClientRect();
    const col = Math.max(
      0,
      Math.floor((clientX - rect.left) / cellRef.current.w),
    );
    const row = Math.max(
      0,
      Math.floor((clientY - rect.top) / cellRef.current.h),
    );
    return { col, row };
  };

  // First visible row in total coordinates (same convention as SearchHit).
  const visibleStartRow = () => {
    const s = screenRef.current;
    return s ? s.scroll_max - s.scroll_offset : 0;
  };

  // cellAt clamped to the grid — selection coordinates must not run past the
  // last row/col when the pointer leaves the wrapper during a drag.
  const selectionCellAt = (clientX: number, clientY: number) => {
    const { col, row } = cellAt(clientX, clientY);
    const s = screenRef.current;
    return {
      col: Math.min(col, (s?.cols ?? 1) - 1),
      row: Math.min(row, (s?.rows ?? 1) - 1),
    };
  };

  const stopAutoScroll = () => {
    if (autoScrollTimerRef.current !== null) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    autoScrollDeltaRef.current = 0;
  };

  // ─── 1. Init / teardown — once per pane ─────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Belt-and-suspenders: ask the backend to (re)emit the current screen.
    // Handles the case where the very first `terminal-render` event was emitted
    // before React had inserted this pane in its state, leaving the screen null.
    if (!pane.screen) {
      void invoke("request_render", { sessionId: pane.id }).catch(() => {
        /* session may not exist yet (race during spawn) — backend kick covers it */
      });
    }

    void (async () => {
      await ensureWasmReady();
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const renderer = await Renderer.new(canvas);
        if (cancelled) {
          renderer.free();
          return;
        }
        rendererRef.current = renderer;
        readyRef.current = true;
        renderer.set_palette(paletteToWasm(palette));
        const dpr = window.devicePixelRatio || 1;
        // Rasterize at the device-pixel size so the atlas glyphs match the
        // shader's cell_size (which is also in device pixels).
        renderer.set_font_size(Math.max(1, Math.round(font.size * dpr)));
        renderer.set_focused(focusedRef.current);
        const cell = measureCellSize(font.family, font.size);
        // Seed the swap chain with the wrapper's real pixel size. The resize
        // observer below only fires when dimensions *change* — without this,
        // the surface stays at the CSS-sized configuration set in `Renderer::new`
        // while `cell_size` is in device pixels, blowing cells up by a factor
        // of `dpr`.
        const wrapper = wrapperRef.current;
        if (wrapper) {
          const rect = wrapper.getBoundingClientRect();
          const pw = Math.max(1, Math.floor(rect.width * dpr));
          const ph = Math.max(1, Math.floor(rect.height * dpr));
          canvas.width = pw;
          canvas.height = ph;
          renderer.resize(pw, ph);
        }
        renderer.set_cell_size(cell.width * dpr, cell.height * dpr);
        const fontBytes = await loadFontBytes(font.family);
        if (cancelled) {
          renderer.free();
          return;
        }
        if (fontBytes) {
          const ok = renderer.set_primary_font(fontBytes);
          if (ok) {
            const cell2 = measureCellSize(font.family, font.size);
            renderer.set_cell_size(cell2.width * dpr, cell2.height * dpr);
          }
        }
        redraw();
        setRendererVersion((v) => v + 1);
      } catch (e) {
        console.error("[arkadia] Renderer.new failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      rendererRef.current?.free();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  // ─── 2. Palette change ──────────────────────────────────────────
  useEffect(() => {
    const r = rendererRef.current;
    if (!readyRef.current || !r) return;
    r.set_palette(paletteToWasm(palette));
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  // ─── 3. Font size change ───────────────────────────────────────
  useEffect(() => {
    const r = rendererRef.current;
    if (!readyRef.current || !r) return;
    const dpr = window.devicePixelRatio || 1;
    r.set_font_size(Math.max(1, Math.round(font.size * dpr)));
    const cell = measureCellSize(font.family, font.size);
    r.set_cell_size(cell.width * dpr, cell.height * dpr);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font.family, font.size]);

  // ─── 3b. Font family swap (load system font into the GPU atlas) ──
  // The Rust renderer bundles Cascadia by default and has no access to
  // system fonts (WASM sandbox). We resolve the font on the Tauri host
  // via `get_font_data`, then hand the raw bytes to the renderer.
  useEffect(() => {
    let cancelled = false;
    const r = rendererRef.current;
    if (!readyRef.current || !r) return;
    const primary =
      font.family
        .split(",")[0]
        ?.trim()
        .replace(/^["']|["']$/g, "") ?? "";
    if (!primary) return;
    void (async () => {
      try {
        const raw = await invoke<number[] | Uint8Array>("get_font_data", {
          family: primary,
        });
        if (cancelled) return;
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        const live = rendererRef.current;
        if (!live || !readyRef.current) return;
        const ok = live.set_primary_font(bytes);
        if (!ok) {
          console.warn(
            `[arkadia] '${primary}' rejected by renderer, keeping previous font`,
          );
          return;
        }
        const dpr = window.devicePixelRatio || 1;
        const cell = measureCellSize(font.family, font.size);
        live.set_cell_size(cell.width * dpr, cell.height * dpr);
        redraw();
      } catch (e) {
        console.warn(`[arkadia] '${primary}' not found on system:`, e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font.family, rendererVersion]);

  // ─── 4. New payload from backend ───────────────────────────────
  useEffect(() => {
    if (!pane.screen) return;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.screen]);

  // ─── 5. Resize: update canvas pixels + PTY cols/rows ───────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const cell = measureCellSize(font.family, font.size);
    let lastCols = -1;
    let lastRows = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;

    cellRef.current = { w: cell.width, h: cell.height };

    const apply = (cssWidth: number, cssHeight: number) => {
      if (cssWidth <= 0 || cssHeight <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));
      // Sync canvas backing store with the wrapper's CSS size × DPR.
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const r = rendererRef.current;
      if (r && readyRef.current) {
        r.resize(pixelWidth, pixelHeight);
        r.set_cell_size(cell.width * dpr, cell.height * dpr);
        redraw();
      }
      // Reserve room for ScrollbarOverlay (6 px overlay + 2 px right margin +
      // a little safety) so the last column never falls under the scrollbar.
      const SCROLLBAR_RESERVE_PX = 10;
      const cols = Math.max(
        20,
        Math.floor((cssWidth - SCROLLBAR_RESERVE_PX) / cell.width),
      );
      const rows = Math.max(5, Math.floor(cssHeight / cell.height));
      if (cols === lastCols && rows === lastRows) return;
      // The grid is changing: viewport columns no longer line up with the
      // selected content — drop the selection rather than show a stale shape.
      rendererRef.current?.clear_selection();
      selectionRef.current = null;
      lastCols = cols;
      lastRows = rows;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void invoke("resize_terminal", {
          sessionId: pane.id,
          cols,
          rows,
        });
      }, 50);
    };

    const observer = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      apply(e.contentRect.width, e.contentRect.height);
    });
    observer.observe(wrapper);
    const rect = wrapper.getBoundingClientRect();
    apply(rect.width, rect.height);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, font.family, font.size]);

  // ─── 6. Focus ─────────────────────────────────────────────────
  useEffect(() => {
    if (isActive) outerRef.current?.focus();
  }, [isActive]);

  const onKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    const r = rendererRef.current;

    // Ctrl+F: open search overlay.
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }

    // Ctrl+V: read clipboard and inject into the PTY as input bytes.
    // Wraps the payload with bracketed-paste markers (DEC mode 2004) when the
    // running app has activated them — without this, multi-line pastes get
    // executed line by line because each \n is treated as Enter.
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "v") {
      e.preventDefault();
      try {
        const text = await readClipboard();
        if (text && text.length > 0) {
          const useBracketed = screenRef.current?.bracketed_paste ?? false;
          const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
          const payload = useBracketed
            ? `\x1b[200~${normalized}\x1b[201~`
            : normalized;
          const bytes = Array.from(new TextEncoder().encode(payload));
          onUserInput?.();
          await invoke("send_input", { sessionId: pane.id, bytes });
        }
      } catch (err) {
        console.error("[arkadia] paste failed:", err);
      }
      return;
    }

    // Ctrl+C: copy if a selection is active, otherwise fall through to SIGINT.
    // The selected text lives in the backend (scrollback + screen) — the
    // renderer only knows the visible payload.
    if (
      r &&
      e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "c" &&
      r.has_selection() &&
      selectionRef.current
    ) {
      e.preventDefault();
      const sel = selectionRef.current;
      try {
        const text = await invoke<string>("get_text_range", {
          sessionId: pane.id,
          startCol: sel.startCol,
          startRow: sel.startRow,
          endCol: sel.endCol,
          endRow: sel.endRow,
        });
        if (text.length > 0) {
          await writeClipboard(text);
        }
      } catch (err) {
        console.error("[arkadia] clipboard write failed:", err);
      }
      r.clear_selection();
      selectionRef.current = null;
      redraw();
      return;
    }
    const bytes = keyEventToBytes(e);
    if (bytes) {
      e.preventDefault();
      onUserInput?.();
      await invoke("send_input", {
        sessionId: pane.id,
        bytes: Array.from(bytes),
      });
    }
  };

  // Window-level mousemove/up listeners so a drag continues even when the
  // cursor leaves the canvas.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Mouse-mode passthrough: forward motion when the running app subscribes
      // to it (1003 always, 1002 only while a button is held). A local
      // drag-select in progress wins over passthrough — its motion never
      // reaches the app.
      const screen = screenRef.current;
      if (mouseModeActive(screen) && !dragStartRef.current) {
        const proto = screen!.mouse_protocol;
        const active = mouseEventActiveRef.current;
        const shouldMove = proto === 3 || (proto === 2 && !!active);
        if (shouldMove) {
          const { col, row } = cellAt(e.clientX, e.clientY);
          const last = lastMouseCellRef.current;
          if (last && last.col === col && last.row === row) return;
          lastMouseCellRef.current = { col, row };
          const btn = active?.button ?? 3; // 3 = no button (X11 convention)
          void invoke("send_mouse_event", {
            sessionId: pane.id,
            col,
            row,
            button: btn,
            modifiers: 0,
            motion: true,
            pressed: true,
          });
        }
        return;
      }

      const start = dragStartRef.current;
      const r = rendererRef.current;
      if (!start || !r) return;
      lastDragPosRef.current = { x: e.clientX, y: e.clientY };
      const { col, row } = selectionCellAt(e.clientX, e.clientY);
      const totalRow = visibleStartRow() + row;
      if (col === start.col && totalRow === start.row) return;
      // First real move: commit the start of the selection.
      if (!dragMovedRef.current) {
        dragMovedRef.current = true;
        // Drag cancels any pending click.
        pendingClickRef.current = null;
        // Clear any prior selection from a previous drag now that we know
        // this gesture is actually a drag.
        r.clear_selection();
        selectionRef.current = null;
      }
      selectionRef.current = {
        startCol: start.col,
        startRow: start.row,
        endCol: col,
        endRow: totalRow,
      };
      r.set_selection(start.col, start.row, col, totalRow);
      // Edge auto-scroll: dragging past the top/bottom edge scrolls into
      // history/live (speed ∝ overshoot, one tick per 50ms). The selection
      // end is re-anchored by the scroll_offset effect on each repaint.
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const cellH = cellRef.current.h;
        let delta = 0;
        if (e.clientY < rect.top) {
          // Backend convention: positive delta = scroll INTO history (up).
          delta = Math.ceil((rect.top - e.clientY) / cellH);
        } else if (e.clientY > rect.bottom) {
          delta = -Math.ceil((e.clientY - rect.bottom) / cellH);
        }
        autoScrollDeltaRef.current = delta;
        if (delta !== 0 && autoScrollTimerRef.current === null) {
          autoScrollTimerRef.current = window.setInterval(() => {
            const d = autoScrollDeltaRef.current;
            if (d === 0 || !dragStartRef.current) {
              stopAutoScroll();
              return;
            }
            void invoke("scroll_terminal", { sessionId: pane.id, delta: d });
          }, 50);
        } else if (delta === 0) {
          stopAutoScroll();
        }
      }
    };
    const onUp = async (e: MouseEvent) => {
      // Mouse-mode passthrough: emit release for the press-button we recorded.
      const active = mouseEventActiveRef.current;
      if (active && mouseModeActive(screenRef.current)) {
        mouseEventActiveRef.current = null;
        lastMouseCellRef.current = null;
        const { col, row } = cellAt(e.clientX, e.clientY);
        void invoke("send_mouse_event", {
          sessionId: pane.id,
          col,
          row,
          button: active.button,
          modifiers: 0,
          motion: false,
          pressed: false,
        });
        return;
      }

      const start = dragStartRef.current;
      dragStartRef.current = null;
      lastDragPosRef.current = null;
      stopAutoScroll();
      const r = rendererRef.current;

      // Click-without-drag on a clickable target (URL, OSC 8, path) → open.
      if (start && !dragMovedRef.current && pendingClickRef.current) {
        const match = pendingClickRef.current;
        pendingClickRef.current = null;
        if (r) {
          r.clear_selection();
          selectionRef.current = null;
          redraw();
        }
        try {
          if (match.kind === "path") {
            // Open with the OS default app; absPath was already resolved +
            // filesystem-validated by the backend `resolve_path_at`.
            await invoke("open_path", { path: match.absPath });
          } else {
            // url | hyperlink → OS browser via the shell scope (http/https).
            await openExternal(match.url);
          }
        } catch (err) {
          console.error("[arkadia] open clickable failed:", err);
        }
        dragMovedRef.current = false;
        return;
      }

      pendingClickRef.current = null;
      if (!r || !start) return;
      // Plain click (no movement) → drop any existing selection.
      if (!dragMovedRef.current) {
        r.clear_selection();
        selectionRef.current = null;
        redraw();
        // The app never saw the left press (it was held back in case a
        // drag-select followed): replay it as a press+release pair so
        // click-driven TUIs keep working under mouse mode.
        if (mouseModeActive(screenRef.current)) {
          const { col, row } = cellAt(e.clientX, e.clientY);
          const base = {
            sessionId: pane.id,
            col,
            row,
            button: 0,
            modifiers: mouseModifiers(e),
            motion: false,
          };
          void invoke("send_mouse_event", { ...base, pressed: true }).then(() =>
            invoke("send_mouse_event", { ...base, pressed: false }),
          );
        }
      }
      dragMovedRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      stopAutoScroll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  // While a drag is in progress, a wheel or edge auto-scroll moves the
  // content under a (possibly stationary) cursor: re-anchor the selection
  // end to the cell currently under the last known mouse position so the
  // selection keeps extending past one screen.
  useEffect(() => {
    const start = dragStartRef.current;
    const pos = lastDragPosRef.current;
    const r = rendererRef.current;
    if (!start || !dragMovedRef.current || !pos || !r) return;
    const { col, row } = selectionCellAt(pos.x, pos.y);
    const totalRow = visibleStartRow() + row;
    selectionRef.current = {
      startCol: start.col,
      startRow: start.row,
      endCol: col,
      endRow: totalRow,
    };
    r.set_selection(start.col, start.row, col, totalRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.screen?.scroll_offset, pane.screen?.scroll_max]);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const { col, row } = cellAt(e.clientX, e.clientY);
    // A plain left-click landing directly on a detected link opens it — even
    // while an app captures the mouse — so paths/URLs are clickable with no
    // modifier. Shift and non-left buttons never open (selection / app behaviour).
    const screen = pane.screen;
    const snapped = screen ? snapToWideMain(screen, col, row) : col;
    const openable = e.button === 0 && !e.shiftKey && !!screen;
    // Hyperlinks/URLs are detected synchronously; file paths come from the hover
    // state (resolved asynchronously by the backend) when the click is in range.
    const hov = hoveredUrlRef.current;
    const hoveredPath: PathMatch | null =
      openable &&
      hov &&
      hov.match.kind === "path" &&
      hov.row === row &&
      snapped >= hov.startCol &&
      snapped < hov.endCol
        ? hov.match
        : null;
    const linkHit: ClickableMatch | null = openable
      ? (findClickableAt(screen!, snapped, row) ?? hoveredPath)
      : null;

    // Mouse-mode passthrough: forward the press to the PTY and skip the local
    // drag-select / click-to-open. Selection has priority over the app: a
    // plain left press stays local (drag-select; a click without drag is
    // replayed to the app on mouseup). Shift+left hands the gesture to the
    // app; middle/right pass through as before (Shift+right keeps the panel
    // context menu).
    if (
      mouseModeActive(screen) &&
      !linkHit &&
      ((e.button === 0 && e.shiftKey) ||
        (e.button !== 0 && e.button <= 2 && !e.shiftKey))
    ) {
      e.preventDefault();
      if (!isActive) onActivate();
      outerRef.current?.focus();
      mouseEventActiveRef.current = { button: e.button };
      lastMouseCellRef.current = { col, row };
      void invoke("send_mouse_event", {
        sessionId: pane.id,
        col,
        row,
        button: e.button,
        modifiers: mouseModifiers(e),
        motion: false,
        pressed: true,
      });
      return;
    }

    // Local drag-select path: only the primary (left) button.
    if (e.button !== 0) return;

    if (!isActive) onActivate();
    outerRef.current?.focus();
    // Remember the link under the press; mouseup opens it iff there was no drag.
    pendingClickRef.current = linkHit;
    // Don't draw a selection yet — we wait for the first real move so a
    // pure click stays click-shaped. mousemove will commit the selection.
    dragStartRef.current = { col, row: visibleStartRow() + row };
    dragMovedRef.current = false;
  };

  // ─── Search invocation: query the backend whenever the query changes
  // (debounced 100ms). Backend search spans full scrollback + visible.
  useEffect(() => {
    if (!searchOpen || searchQuery.length === 0) {
      allHitsRef.current = [];
      currentHitIdxRef.current = -1;
      setSearchHitCount(0);
      setSearchCurrent1(0);
      redraw();
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void invoke<SearchHit[]>("search_terminal", {
        sessionId: pane.id,
        query: searchQuery,
      })
        .then((hits) => {
          if (cancelled) return;
          allHitsRef.current = hits;
          setSearchHitCount(hits.length);
          if (hits.length > 0) {
            currentHitIdxRef.current = 0;
            setSearchCurrent1(1);
            scrollToHit(0);
          } else {
            currentHitIdxRef.current = -1;
            setSearchCurrent1(0);
            redraw();
          }
        })
        .catch((e) => {
          console.error("[arkadia] search failed:", e);
        });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, searchQuery, pane.id]);

  // Re-derive visible hits + redraw on every screen update, so the highlight
  // tracks new output without re-running the backend search.
  useEffect(() => {
    if (!searchOpen) return;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.screen]);

  // ─── Scrollbar fade-in/out: visible when scrolled into history,
  // fades out after 1.5s of inactivity at the bottom (live).
  const lastOffsetRef = useRef(0);
  useEffect(() => {
    const offset = pane.screen?.scroll_offset ?? 0;
    const max = pane.screen?.scroll_max ?? 0;
    if (max === 0) {
      setScrollbarVisible(false);
      return;
    }
    if (offset !== lastOffsetRef.current) {
      lastOffsetRef.current = offset;
      setScrollbarVisible(true);
    }
    if (offset === 0) {
      const t = window.setTimeout(() => setScrollbarVisible(false), 1500);
      return () => window.clearTimeout(t);
    } else {
      setScrollbarVisible(true);
    }
  }, [pane.screen?.scroll_offset, pane.screen?.scroll_max]);

  // ─── 7. Wheel scroll into history ──────────────────────────────
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    let pendingDelta = 0;
    let rafScheduled = false;
    const flush = () => {
      rafScheduled = false;
      if (pendingDelta === 0) return;
      const delta = pendingDelta;
      pendingDelta = 0;
      void invoke("scroll_terminal", { sessionId: pane.id, delta });
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      // Mouse-mode passthrough: encode wheel up/down as buttons 64/65 at the
      // cursor's current cell. One PTY event per wheel notch (no batching).
      if (mouseModeActive(screenRef.current)) {
        // The app is about to scroll its own content (its alt screen has no
        // terminal scrollback, so `scroll_offset` never moves). A selection
        // anchored to terminal rows would freeze in place over the now-wrong
        // text — drop it, unless a drag is still committing it.
        const r = rendererRef.current;
        if (r && !dragStartRef.current && r.has_selection()) {
          r.clear_selection();
          selectionRef.current = null;
          redraw();
        }
        const button = e.deltaY > 0 ? 65 : 64;
        const { col, row } = cellAt(e.clientX, e.clientY);
        void invoke("send_mouse_event", {
          sessionId: pane.id,
          col,
          row,
          button,
          modifiers: mouseModifiers(e),
          motion: false,
          pressed: true,
        });
        return;
      }
      // Backend convention: positive delta = scroll INTO history.
      // Browser: deltaY > 0 = scroll DOWN (toward live) = decrement offset.
      pendingDelta += -Math.sign(e.deltaY) * 3;
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flush);
      }
    };
    outer.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      outer.removeEventListener("wheel", onWheel);
    };
    // `redraw` is a plain function recreated every render: listing it would
    // tear down / re-add the wheel listener per frame (the same instability
    // class as the zombie-listener leak). Subscription effects stay keyed on
    // stable ids only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  // URL hover : pointer cursor + on-screen underline. Recomputed on every
  // mousemove (window-level so we still clear when the cursor leaves the
  // wrapper).
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    let cursorIsPointer = false;

    const setHover = (next: HoverRange | null) => {
      const cur = hoveredUrlRef.current;
      const key = (m: ClickableMatch) =>
        m.kind === "path" ? m.absPath : m.url;
      const same =
        cur === next ||
        (!!cur &&
          !!next &&
          cur.row === next.row &&
          cur.startCol === next.startCol &&
          cur.endCol === next.endCol &&
          cur.match.kind === next.match.kind &&
          key(cur.match) === key(next.match));
      if (same) return;
      hoveredUrlRef.current = next;
      redraw();
    };

    const applyMatch = (match: ClickableMatch | null) => {
      setHover(
        match
          ? {
              match,
              row: match.row,
              startCol: match.startCol,
              endCol: match.endCol,
            }
          : null,
      );
      const wantPointer = !!match;
      if (wantPointer !== cursorIsPointer) {
        outer.style.cursor = wantPointer ? "pointer" : "";
        cursorIsPointer = wantPointer;
      }
    };
    const clearAffordance = () => applyMatch(null);

    // Last evaluated cell (avoid redundant work / IPC while the cursor sits in
    // one cell); `probeSeq` discards stale async path resolutions.
    let lastCell = "";
    let probeSeq = 0;

    // Hyperlinks/URLs are detected synchronously. File paths need filesystem
    // validation (to handle spaces) so they go through the backend
    // `resolve_path_at` command asynchronously. Affordance applies with no
    // modifier, even while an app captures the mouse.
    const computeHover = (clientX: number, clientY: number) => {
      const wrapper = wrapperRef.current;
      const screen = screenRef.current;
      if (!wrapper || !screen) {
        lastCell = "";
        clearAffordance();
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        lastCell = "";
        clearAffordance();
        return;
      }
      const cw = cellRef.current.w;
      const ch = cellRef.current.h;
      if (cw <= 0 || ch <= 0) return;
      const rawCol = Math.floor((clientX - rect.left) / cw);
      const row = Math.floor((clientY - rect.top) / ch);
      const col = snapToWideMain(screen, rawCol, row);

      // Still within the currently-highlighted path → keep it (no re-probe
      // while sweeping across a multi-cell path).
      const cur = hoveredUrlRef.current;
      if (
        cur &&
        cur.match.kind === "path" &&
        cur.row === row &&
        col >= cur.startCol &&
        col < cur.endCol
      ) {
        return;
      }

      const cellKey = `${row}:${col}`;
      if (cellKey === lastCell) return;
      lastCell = cellKey;

      // Sync: hyperlink / URL.
      const sync = findClickableAt(screen, col, row);
      if (sync) {
        applyMatch(sync);
        return;
      }

      // Async: file path via the backend (filesystem-validated, space-aware).
      const line = screen.lines[row];
      if (!line) {
        clearAffordance();
        return;
      }
      const { text, charToCol, charWidth } = buildRowMapping(line);
      const charIdx = colToCharIndex(charToCol, charWidth, col);
      // Skip the IPC when there's no path separator on the row.
      if (charIdx == null || !/[\\/]/.test(text)) {
        clearAffordance();
        return;
      }
      const seq = ++probeSeq;
      void invoke<ResolvedPath | null>("resolve_path_at", {
        line: text,
        cwd: cwdRef.current,
        click: charIdx,
      })
        .then((res) => {
          if (seq !== probeSeq) return; // superseded by a newer move
          const liveLine = screenRef.current?.lines[row];
          if (!liveLine || buildRowMapping(liveLine).text !== text) return; // row changed
          if (!res) {
            clearAffordance();
            return;
          }
          const cols = charRangeToCols(
            charToCol,
            charWidth,
            res.start,
            res.end,
          );
          if (!cols) {
            clearAffordance();
            return;
          }
          applyMatch({
            kind: "path",
            absPath: res.abs_path,
            startCol: cols.startCol,
            endCol: cols.endCol,
            row,
          });
        })
        .catch(() => {});
    };

    const onMove = (e: MouseEvent) => computeHover(e.clientX, e.clientY);

    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      outer.style.cursor = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={outerRef}
      tabIndex={0}
      data-pane-id={pane.id}
      onFocus={() => {
        focusedRef.current = true;
        rendererRef.current?.set_focused(true);
        if (!isActive) onActivate();
      }}
      onBlur={() => {
        focusedRef.current = false;
        rendererRef.current?.set_focused(false);
      }}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => {
        e.preventDefault();
        // Mouse-mode: onMouseDown already encoded the right-click — swallow the
        // panel menu unless Shift bypass is held.
        if (mouseModeActive(pane.screen) && !e.shiftKey) {
          return;
        }
        if (!isActive) onActivate();
        onContextMenu(e.clientX, e.clientY);
      }}
      style={{
        backgroundColor: palette.bg,
        outline: "none",
        padding: 20,
      }}
      className="relative h-full w-full overflow-hidden"
    >
      <div ref={wrapperRef} className="relative h-full w-full">
        <canvas ref={canvasRef} className="block h-full w-full" />
        {showMessageFrames && (
          <MessageBorderOverlay screen={pane.screen} font={font} />
        )}
        <ScrollbarOverlay
          screen={pane.screen}
          visible={scrollbarVisible}
          fg={palette.fg}
        />
        {searchOpen && (
          <SearchOverlay
            query={searchQuery}
            onChange={setSearchQuery}
            hitCount={searchHitCount}
            currentIdx={searchCurrent1}
            onNext={() => gotoHit(currentHitIdxRef.current + 1)}
            onPrev={() => gotoHit(currentHitIdxRef.current - 1)}
            onClose={() => {
              setSearchOpen(false);
              setSearchQuery("");
              allHitsRef.current = [];
              currentHitIdxRef.current = -1;
              setSearchHitCount(0);
              setSearchCurrent1(0);
              redraw();
              outerRef.current?.focus();
            }}
            palette={palette}
          />
        )}
      </div>
    </div>
  );
}

function SearchOverlay({
  query,
  onChange,
  hitCount,
  currentIdx,
  onNext,
  onPrev,
  onClose,
  palette,
}: {
  query: string;
  onChange: (q: string) => void;
  hitCount: number;
  /** 1-based; 0 means "no hit". */
  currentIdx: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  palette: TerminalPalette;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const btnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: palette.fg,
    opacity: hitCount === 0 ? 0.25 : 0.6,
    cursor: hitCount === 0 ? "default" : "pointer",
    padding: "0 4px",
    fontSize: 14,
    lineHeight: 1,
  };
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 16,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 10px",
        backgroundColor: "rgba(20, 20, 22, 0.92)",
        border: `1px solid ${palette.fg}33`,
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        color: palette.fg,
        fontFamily: "inherit",
        fontSize: 13,
        zIndex: 10,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "Enter" || e.key === "F3") {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) onPrev();
            else onNext();
            return;
          }
          // Stop other keys from reaching the terminal handler.
          e.stopPropagation();
        }}
        placeholder="Search…"
        autoComplete="off"
        spellCheck={false}
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          color: palette.fg,
          width: 160,
          fontFamily: "inherit",
        }}
      />
      <span
        style={{
          opacity: 0.6,
          minWidth: 56,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {query.length === 0
          ? ""
          : hitCount === 0
            ? "no match"
            : `${currentIdx} / ${hitCount}`}
      </span>
      <button
        onClick={onPrev}
        disabled={hitCount === 0}
        style={btnStyle}
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        onClick={onNext}
        disabled={hitCount === 0}
        style={btnStyle}
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        onClick={onClose}
        style={{ ...btnStyle, opacity: 0.6, cursor: "pointer", fontSize: 16 }}
        aria-label="Close search"
      >
        ×
      </button>
    </div>
  );
}

function ScrollbarOverlay({
  screen,
  visible,
  fg,
}: {
  screen: RenderPayload | null;
  visible: boolean;
  fg: string;
}) {
  if (!screen || screen.scroll_max === 0) return null;
  const total = screen.scroll_max + screen.rows;
  const thumbHeightPct = Math.max(4, (screen.rows / total) * 100);
  const thumbTopPct =
    ((screen.scroll_max - screen.scroll_offset) / total) * 100;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 2,
        right: 2,
        bottom: 2,
        width: 6,
        opacity: visible ? 0.5 : 0,
        transition: "opacity 250ms ease-out",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${thumbTopPct}%`,
          height: `${thumbHeightPct}%`,
          backgroundColor: fg,
          borderRadius: 3,
          minHeight: 12,
        }}
      />
    </div>
  );
}
