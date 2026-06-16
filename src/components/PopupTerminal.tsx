import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText as readClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { resolveColor } from "@/lib/palettes";
import { keyEventToBytes } from "@/lib/keymap";
import { isChromeRow, isJumpPill } from "@/lib/terminalChrome";
import type {
  CellRun,
  RenderPayload,
  TerminalFont,
  TerminalPalette,
} from "@/types";

interface Props {
  /** Arkadia pane UUID = PTY session id = `send_input` target. */
  paneId: string;
  /** Per-signal nonce (hook ts). Changes when the popup re-appears for the same
   * pane → re-runs the open-time scroll to the start of Claude's reply. */
  resetSignal?: number;
  font: TerminalFont;
  palette: TerminalPalette;
  /** Called when the user submits the prompt (plain Enter). */
  onSubmit?: () => void;
}

// Box-drawing (U+2500–U+257F) + block elements (U+2580–U+259F). Excludes the
// geometric `●` bullet (U+25CF) so Claude's prose bullets stay wrappable.
const BOX_RE = /[─-▟]/;
// ASCII tables: a row with 3+ pipes, or a `+---+` rule.
const ASCII_TABLE_RE = /\|[^|]*\|[^|]*\||\+[-=]{2,}/;

function runStyle(run: CellRun, palette: TerminalPalette): React.CSSProperties {
  let fg = resolveColor(run.fg, palette, "fg");
  let bg = resolveColor(run.bg, palette, "bg");
  if (run.inverse) [fg, bg] = [bg, fg];
  const deco: string[] = [];
  if (run.underline_style) deco.push("underline");
  if (run.strikethrough) deco.push("line-through");
  return {
    color: fg,
    backgroundColor: bg !== palette.bg ? bg : undefined,
    fontWeight: run.bold ? 600 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    opacity: run.dim ? 0.55 : undefined,
    textDecoration: deco.length ? deco.join(" ") : undefined,
  };
}

/**
 * A row is "structural" — must keep fixed width (no wrap), or its alignment
 * breaks — when it has any coloured background (code block / diff / band) or
 * any box-drawing / ASCII-table character. Plain prose rows wrap.
 */
function isStructuralRow(runs: CellRun[]): boolean {
  let text = "";
  for (const r of runs) {
    if (r.bg.kind !== "default") return true;
    text += r.text;
  }
  return BOX_RE.test(text) || ASCII_TABLE_RE.test(text);
}

/** Drops trailing default-bg spaces so full-width padding doesn't force wraps. */
function trimTrailing(runs: CellRun[]): CellRun[] {
  const out = runs.slice();
  while (out.length > 0) {
    const r = out[out.length - 1];
    if (r.bg.kind !== "default") break;
    const trimmed = r.text.replace(/\s+$/u, "");
    if (trimmed.length === 0) {
      out.pop();
      continue;
    }
    out[out.length - 1] = { ...r, text: trimmed };
    break;
  }
  return out;
}

function rowIsBlank(runs: CellRun[]): boolean {
  return runs.every(
    (r) => r.text.trim().length === 0 && r.bg.kind === "default",
  );
}

/**
 * One row. Prose rows (`wrap`) reflow to the container width; structural rows
 * keep fixed width (caller wraps a group of them in one horizontal scroller so
 * they scroll — and stay aligned — together). Paints the cursor when present.
 */
function Row({
  runs,
  cursorCol,
  wrap,
  palette,
  setCursor,
  rowRef,
}: {
  runs: CellRun[];
  cursorCol: number | null;
  wrap: boolean;
  palette: TerminalPalette;
  /** Callback ref capturing the cursor cell so the parent can scroll it into view. */
  setCursor: (el: HTMLSpanElement | null) => void;
  /** Callback ref on the row's root, set only on the anchor row (start of the
   * last Claude response) so the popup can scroll it to the top on open. */
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const trimmed = trimTrailing(runs);
  const base: React.CSSProperties = wrap
    ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
    : { whiteSpace: "pre" };

  if (cursorCol === null) {
    if (trimmed.length === 0)
      return <div ref={rowRef} style={{ minHeight: "1.2em" }} />;
    return (
      <div ref={rowRef} style={base}>
        {trimmed.map((r, i) => (
          <span key={i} style={runStyle(r, palette)}>
            {r.text}
          </span>
        ))}
      </div>
    );
  }

  // Cursor row: split the run holding the cursor and invert that cell.
  const out: React.ReactNode[] = [];
  let col = 0;
  let placed = false;
  trimmed.forEach((r, i) => {
    const chars = [...r.text];
    const len = chars.length;
    if (!placed && cursorCol >= col && cursorCol < col + len) {
      const idx = cursorCol - col;
      const before = chars.slice(0, idx).join("");
      const at = chars[idx] ?? " ";
      const after = chars.slice(idx + 1).join("");
      if (before)
        out.push(
          <span key={`${i}-b`} style={runStyle(r, palette)}>
            {before}
          </span>,
        );
      out.push(
        <span
          key={`${i}-c`}
          ref={setCursor}
          style={runStyle({ ...r, inverse: !r.inverse }, palette)}
        >
          {at}
        </span>,
      );
      if (after)
        out.push(
          <span key={`${i}-a`} style={runStyle(r, palette)}>
            {after}
          </span>,
        );
      placed = true;
    } else {
      out.push(
        <span key={i} style={runStyle(r, palette)}>
          {r.text}
        </span>,
      );
    }
    col += len;
  });
  if (!placed) {
    // Cursor sits past the trimmed text (e.g. after a trailing space that
    // trimTrailing dropped): pad the gap so it renders at its real column —
    // otherwise typing a space looks like the cursor never moved.
    const gap = cursorCol - col;
    if (gap > 0) {
      out.push(<span key="cursor-gap">{" ".repeat(gap)}</span>);
    }
    out.push(
      <span
        key="cursor-end"
        ref={setCursor}
        style={{ backgroundColor: palette.fg, color: palette.bg }}
      >
        {" "}
      </span>,
    );
  }
  return (
    <div ref={rowRef} style={base}>
      {out}
    </div>
  );
}

interface RowData {
  runs: CellRun[];
  realRow: number;
  structural: boolean;
}

interface Block {
  structural: boolean;
  rows: RowData[];
}

/**
 * Read-only live view of a pane, used in the notification popup. Subscribes to
 * broadcast `terminal-render` events for `paneId` and renders at full (readable)
 * font, preserving every colour/style. Hybrid layout: prose paragraphs wrap to
 * the popup width; structural content (tables, box-drawing, coloured code/diff
 * blocks) keeps fixed width and shares one horizontal scroller per run of rows,
 * so alignment never breaks. Keystrokes are forwarded to the pane's PTY so the
 * reply field behaves exactly like Arkadia's terminal; it never resizes the PTY.
 * Mounted keyed by `paneId`, so it re-inits when the queue advances.
 */
export function PopupTerminal({
  paneId,
  resetSignal,
  font,
  palette,
  onSubmit,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement | null>(null);
  const setCursor = (el: HTMLSpanElement | null) => {
    cursorRef.current = el;
  };
  // Root of the anchor row (start of the last Claude response). On open we scroll
  // it to the top so the user reads Claude's reply from its beginning.
  const claudeStartRef = useRef<HTMLDivElement | null>(null);
  const setClaudeStart = (el: HTMLDivElement | null) => {
    claudeStartRef.current = el;
  };
  // True until the user first interacts (wheel / type): keeps the open view
  // pinned to the top of Claude's reply across cursor-blink re-renders.
  const initialScrollRef = useRef(true);
  // One diagnostic log line per popup appearance (reset on resetSignal).
  const loggedOpenRef = useRef(false);
  // True once the user has taken control of the scroll with the wheel: from then
  // on the DOM scroll position is theirs to keep — auto-scroll stops re-pinning.
  const userScrolledRef = useRef(false);
  const [screen, setScreen] = useState<RenderPayload | null>(null);
  const screenRef = useRef<RenderPayload | null>(null);
  const lastWheelRef = useRef(0);
  // Accumulated wheel deltaY, to coalesce one physical notch (emitted as a burst
  // of small events by precision wheels) into a single, consistent scroll step.
  const wheelAccRef = useRef(0);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;
    void listen<RenderPayload>("terminal-render", (event) => {
      if (!active) return;
      if (event.payload.session_id !== paneId) return;
      screenRef.current = event.payload;
      setScreen(event.payload);
    }).then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
      // Request the first frame only once the listener is live, else an idle
      // pane (no further renders) leaves the popup blank.
      void invoke("request_render", { sessionId: paneId }).catch(() => {});
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [paneId]);

  useEffect(() => {
    scrollRef.current?.focus();
  }, [paneId]);

  // Both live and history views pin to the BOTTOM of the mirror. Live → the
  // input field stays in view (never clipped, incl. when resizing shorter).
  // History (the "Jump to bottom" pill is on Claude Code's screen) → bottom-pin
  // too, so entering/leaving history is continuous: each wheel notch shifts the
  // content by only the few lines Claude Code scrolled, instead of snapping the
  // whole viewport between top and bottom (which felt like a full-screen jump).
  // The mirror window itself travels through the scrollback as you wheel, so the
  // whole conversation is still reachable.
  const applyAutoScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // On open, scroll to the start of Claude's last reply so it's read from the
    // top. Held until the first user interaction. If the anchor isn't found,
    // show the TOP of the mirror (never the bottom) — closer to "the beginning".
    if (initialScrollRef.current) {
      const anchor = claudeStartRef.current;
      if (anchor) {
        // Explicit offset rather than scrollIntoView (which can no-op or scroll
        // the wrong ancestor in nested scrollers): align the anchor's top with
        // the container's top, minus a small margin.
        const top =
          anchor.getBoundingClientRect().top -
          el.getBoundingClientRect().top +
          el.scrollTop;
        el.scrollTop = Math.max(0, top - 4);
      } else {
        el.scrollTop = 0;
      }
      if (!loggedOpenRef.current) {
        loggedOpenRef.current = true;
        const s = screenRef.current;
        const k = s?.line_kinds ?? [];
        void invoke("popup_log_ui", {
          msg: `open-scroll pane=${s?.session_id ?? "?"} kindsLen=${k.length} count2=${k.filter((x) => x === 2).length} anchor=${!!anchor} scrollTop=${el.scrollTop} scrollH=${el.scrollHeight} clientH=${el.clientHeight}`,
        }).catch(() => {});
      }
      return;
    }
    // Once the user has scrolled with the wheel, the position is theirs — don't
    // yank it back to the bottom on the next frame (cursor blink, etc.).
    if (userScrolledRef.current) return;
    const s = screenRef.current;
    const scrolledUp = (s?.lines ?? []).some((l) => isJumpPill(l));
    if (scrolledUp) {
      el.scrollTop = el.scrollHeight;
    } else if (cursorRef.current) {
      cursorRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => applyAutoScroll());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useLayoutEffect(() => {
    applyAutoScroll();
  }, [screen]);

  // A fresh signal for the same pane (popup re-appearing) re-arms the open-time
  // scroll, so the new reply is shown from its top — not where the user last was.
  useEffect(() => {
    initialScrollRef.current = true;
    loggedOpenRef.current = false;
    userScrolledRef.current = false;
    applyAutoScroll();
    // applyAutoScroll is a fresh closure each render; depend only on the nonce.
  }, [resetSignal]);

  // Wheel = scroll Claude Code's own transcript (infinite history). On the alt
  // screen Claude Code tracks the mouse, so forward a wheel button (64 up / 65
  // down) like the main terminal; otherwise page the backend scrollback.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      initialScrollRef.current = false;
      userScrolledRef.current = true;
      // Interacting with the popup → focus it so the user can type a reply right
      // away. Focus the OS window (only if not already focused, to avoid stealing
      // it on every notch) and the keydown-handling container.
      if (!document.hasFocus()) void getCurrentWindow().setFocus();
      el.focus();
      // Scroll the mirror natively from the current position first. Only when the
      // DOM is already at the edge in the wheel's direction do we forward to
      // Claude Code to load more transcript (earlier/newer) — so reading within
      // the current view never snaps the position elsewhere.
      const goingUp = e.deltaY < 0;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((goingUp && !atTop) || (!goingUp && !atBottom)) {
        return; // let the browser scroll the container
      }
      e.preventDefault();
      // Coalesce one physical notch into a single, consistent scroll step. A
      // precision wheel emits a *burst* of small events per notch, so a plain
      // time-gate let a variable number through (one notch sometimes scrolled 3
      // lines, sometimes 7). Accumulate deltaY and act once per notch's worth of
      // travel, capping at one step per event so a burst can't over-scroll.
      const perNotch = e.deltaMode === 0 ? 100 : 1; // pixel vs line/page mode
      wheelAccRef.current += e.deltaY;
      if (Math.abs(wheelAccRef.current) < perNotch) return;
      const dir = wheelAccRef.current > 0 ? 1 : -1;
      wheelAccRef.current = 0;
      // Floor between steps: Claude Code applies momentum when wheel events
      // arrive too fast, so keep them ~30ms apart for a controlled scroll.
      const now = performance.now();
      if (now - lastWheelRef.current < 30) return;
      lastWheelRef.current = now;
      const s = screenRef.current;
      if (s && (s.mouse_protocol ?? 0) > 0) {
        void invoke("send_mouse_event", {
          sessionId: paneId,
          col: Math.max(0, Math.floor((s.cols ?? 80) / 2)),
          row: Math.max(0, Math.floor((s.rows ?? 24) / 2)),
          button: dir > 0 ? 65 : 64,
          modifiers: 0,
          motion: false,
          pressed: true,
        });
      } else {
        void invoke("scroll_terminal", {
          sessionId: paneId,
          delta: -dir * 3,
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [paneId]);

  const onKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+C with a text selection → let the browser copy it. Without this it
    // would fall through to keyEventToBytes and send 0x03 (SIGINT) to the PTY,
    // which clears Claude Code's input line — wiping what the user just typed.
    // With no selection, ^C still forwards (interrupt), as in the main terminal.
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "c") {
      const sel = window.getSelection()?.toString() ?? "";
      if (sel.length > 0) return;
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "v") {
      e.preventDefault();
      initialScrollRef.current = false;
      userScrolledRef.current = false; // typing → bring the input back into view
      try {
        const text = await readClipboard();
        if (text && text.length > 0) {
          const useBracketed = screen?.bracketed_paste ?? false;
          const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
          const payload = useBracketed
            ? `\x1b[200~${normalized}\x1b[201~`
            : normalized;
          const bytes = Array.from(new TextEncoder().encode(payload));
          await invoke("send_input", { sessionId: paneId, bytes });
        }
      } catch (err) {
        console.error("[arkadia popup] paste failed:", err);
      }
      return;
    }
    const isPlainEnter =
      e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    const bytes = keyEventToBytes(e);
    if (bytes) {
      e.preventDefault();
      initialScrollRef.current = false;
      userScrolledRef.current = false; // typing → bring the input back into view
      await invoke("send_input", {
        sessionId: paneId,
        bytes: Array.from(bytes),
      });
      // Plain Enter submits the prompt → dismiss the popup. Shift+Enter inserts
      // a newline (handled above as ESC+CR) and must keep the popup open.
      if (isPlainEnter) onSubmit?.();
    }
  };

  // Drop Claude Code's chrome (status line, token counter, hints, pill, spinner)
  // so the popup shows just the response + the input box; trim/collapse blank
  // rows; then group consecutive kept rows by kind (structural rows share a
  // scroller to stay aligned).
  const lines = screen?.lines ?? [];
  const cols = screen?.cols ?? 80;
  const kept: number[] = [];
  for (let r = 0; r < lines.length; r++) {
    if (isChromeRow(lines[r], cols)) continue;
    const blank = rowIsBlank(lines[r]);
    // Collapse consecutive blanks (incl. gaps left where chrome was removed).
    if (blank && kept.length > 0 && rowIsBlank(lines[kept[kept.length - 1]]))
      continue;
    kept.push(r);
  }
  while (kept.length > 0 && rowIsBlank(lines[kept[0]])) kept.shift();
  while (kept.length > 0 && rowIsBlank(lines[kept[kept.length - 1]]))
    kept.pop();

  const blocks: Block[] = [];
  for (const r of kept) {
    const runs = lines[r];
    const structural = isStructuralRow(runs);
    const data: RowData = { runs, realRow: r, structural };
    const tail = blocks[blocks.length - 1];
    if (tail && tail.structural === structural) tail.rows.push(data);
    else blocks.push({ structural, rows: [data] });
  }

  // First visible row of the last contiguous Claude block (line_kinds: 2 = Claude)
  // — the anchor the popup scrolls to the top on open. -1 when none is on screen.
  const kinds = screen?.line_kinds ?? [];
  let claudeRunStart = -1;
  for (let r = kinds.length - 1; r >= 0; r--) {
    if (kinds[r] === 2) claudeRunStart = r;
    else if (claudeRunStart !== -1) break;
  }
  // Fallback when line_kinds yields nothing (e.g. detection edge case): the last
  // row whose first glyph is Claude's bullet (●/⏺) — the start of its reply.
  if (claudeRunStart === -1) {
    for (let i = kept.length - 1; i >= 0; i--) {
      const r = kept[i];
      const t = lines[r]
        .map((c) => c.text)
        .join("")
        .trimStart();
      if (t.startsWith("●") || t.startsWith("⏺")) {
        claudeRunStart = r;
        break;
      }
    }
  }
  const claudeAnchorRow =
    claudeRunStart === -1 ? -1 : (kept.find((r) => r >= claudeRunStart) ?? -1);

  const renderRow = (rd: RowData, wrap: boolean) => {
    const onCursorRow =
      !!screen && screen.cursor_visible && rd.realRow === screen.cursor_row;
    return (
      <Row
        key={rd.realRow}
        runs={rd.runs}
        cursorCol={onCursorRow ? screen!.cursor_col : null}
        wrap={wrap}
        palette={palette}
        setCursor={setCursor}
        rowRef={rd.realRow === claudeAnchorRow ? setClaudeStart : undefined}
      />
    );
  };

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="h-full w-full overflow-x-hidden overflow-y-auto px-3 py-2 leading-tight outline-none"
      style={{
        backgroundColor: palette.bg,
        color: palette.fg,
        fontFamily: font.family,
        fontSize: `${font.size}px`,
      }}
    >
      {blocks.map((b, i) =>
        b.structural ? (
          <div key={i} className="overflow-x-auto">
            <div style={{ width: "max-content" }}>
              {b.rows.map((rd) => renderRow(rd, false))}
            </div>
          </div>
        ) : (
          <div key={i}>{b.rows.map((rd) => renderRow(rd, true))}</div>
        ),
      )}
    </div>
  );
}
