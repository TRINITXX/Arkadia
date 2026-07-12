import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { measureCellSize } from "@/lib/cellSize";
import { keyEventToBytes } from "@/lib/keymap";
import { getFrame, usePaneFrame } from "@/lib/frameStore";
import { useElementVisible } from "@/lib/useElementVisible";
import { resolveColor } from "@/lib/palettes";
import type {
  CellRun,
  PaneState,
  TerminalFont,
  TerminalPalette,
} from "@/types";

function runStyle(run: CellRun, palette: TerminalPalette): React.CSSProperties {
  let fg = resolveColor(run.fg, palette, "fg");
  let bg = resolveColor(run.bg, palette, "bg");
  if (run.inverse) {
    [fg, bg] = [bg, fg];
  }
  const decorations: string[] = [];
  if (run.underline_style) {
    const styleMap: Record<number, string> = {
      1: "underline",
      2: "underline double",
      3: "underline wavy",
      4: "underline dotted",
      5: "underline dashed",
    };
    decorations.push(styleMap[run.underline_style] ?? "underline");
  }
  if (run.strikethrough) {
    decorations.push("line-through");
  }
  return {
    color: fg,
    backgroundColor: bg !== palette.bg ? bg : undefined,
    fontWeight: run.bold ? 600 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    opacity: run.dim ? 0.55 : undefined,
    textDecoration: decorations.length > 0 ? decorations.join(" ") : undefined,
    cursor: run.hyperlink ? "pointer" : undefined,
  };
}

interface RowProps {
  runs: CellRun[];
  cursorCol: number | null;
  focused: boolean;
  palette: TerminalPalette;
}

function Row({ runs, cursorCol, focused, palette }: RowProps) {
  if (cursorCol === null) {
    return (
      <div className="min-h-[1.25em]">
        {runs.map((r, i) => (
          <span key={i} style={runStyle(r, palette)}>
            {r.text}
          </span>
        ))}
      </div>
    );
  }

  const out: React.ReactNode[] = [];
  let col = 0;
  let placedCursor = false;
  runs.forEach((r, i) => {
    const len = [...r.text].length;
    if (!placedCursor && cursorCol >= col && cursorCol < col + len) {
      const localIdx = cursorCol - col;
      const chars = [...r.text];
      const before = chars.slice(0, localIdx).join("");
      const at = chars[localIdx] ?? " ";
      const after = chars.slice(localIdx + 1).join("");
      if (before) {
        out.push(
          <span key={`${i}-b`} style={runStyle(r, palette)}>
            {before}
          </span>,
        );
      }
      const cursorRun: CellRun = { ...r, inverse: !r.inverse };
      out.push(
        <span
          key={`${i}-c`}
          style={focused ? runStyle(cursorRun, palette) : runStyle(r, palette)}
          className={focused ? "" : "outline outline-1 outline-zinc-500"}
        >
          {at}
        </span>,
      );
      if (after) {
        out.push(
          <span key={`${i}-a`} style={runStyle(r, palette)}>
            {after}
          </span>,
        );
      }
      placedCursor = true;
    } else {
      out.push(
        <span key={i} style={runStyle(r, palette)}>
          {r.text}
        </span>,
      );
    }
    col += len;
  });

  if (!placedCursor) {
    out.push(
      <span
        key="end-cursor"
        style={
          focused
            ? { backgroundColor: palette.fg, color: palette.bg }
            : undefined
        }
        className={focused ? "" : "outline outline-1 outline-zinc-500"}
      >
        {" "}
      </span>,
    );
  }

  return <div className="min-h-[1.25em]">{out}</div>;
}

interface TerminalProps {
  pane: PaneState;
  isActive: boolean;
  font: TerminalFont;
  palette: TerminalPalette;
  onActivate: () => void;
  /** Fired when the user produces real input (keystroke) in this pane. */
  onUserInput?: () => void;
  onContextMenu: (x: number, y: number) => void;
}

export function Terminal({
  pane,
  isActive,
  font,
  palette,
  onActivate,
  onUserInput,
  onContextMenu,
}: TerminalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // Frames come from the external store: only THIS component re-renders per
  // frame, and only while the pane is actually visible (hidden tab = no sub).
  const visible = useElementVisible(ref);
  const screen = usePaneFrame(pane.id, visible);

  useEffect(() => {
    if (isActive) {
      ref.current?.focus();
    }
  }, [isActive]);

  // Belt-and-suspenders: ask the backend to (re)emit the current screen so a
  // fresh-mounted pane that missed the very first `terminal-render` event
  // still ends up rendering its initial prompt.
  useEffect(() => {
    if (getFrame(pane.id)) return;
    void invoke("request_render", { sessionId: pane.id }).catch(() => {
      /* session may not exist yet (race during spawn) — backend kick covers it */
    });
  }, [pane.id]);

  // Auto-resize PTY to match the visual size of the pane.
  // ResizeObserver.contentRect excludes padding/border (content-box).
  // Re-runs when font changes: cell size differs → recompute cols/rows.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cell = measureCellSize(font.family, font.size);
    const PADDING_TOTAL = 24; // Tailwind p-3 = 12px each side
    let lastCols = -1;
    let lastRows = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = (contentWidth: number, contentHeight: number) => {
      if (contentWidth <= 0 || contentHeight <= 0) return;
      const cols = Math.max(20, Math.floor(contentWidth / cell.width));
      const rows = Math.max(5, Math.floor(contentHeight / cell.height));
      if (cols === lastCols && rows === lastRows) return;
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
      const entry = entries[0];
      if (!entry) return;
      apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);

    // ResizeObserver doesn't fire when only the font changed (geometry unchanged) →
    // do a one-shot synchronous resize. getBoundingClientRect returns border-box, so subtract padding.
    const rect = el.getBoundingClientRect();
    apply(rect.width - PADDING_TOTAL, rect.height - PADDING_TOTAL);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [pane.id, font.family, font.size]);

  // Wheel scroll into history.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
      pendingDelta += -Math.sign(e.deltaY) * 3;
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flush);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [pane.id]);

  const onKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
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

  return (
    <div
      ref={ref}
      tabIndex={0}
      data-pane-id={pane.id}
      onFocus={() => {
        setFocused(true);
        if (!isActive) onActivate();
      }}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (!isActive) onActivate();
        ref.current?.focus();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isActive) onActivate();
        onContextMenu(e.clientX, e.clientY);
      }}
      style={{
        fontFamily: font.family,
        fontSize: `${font.size}px`,
        backgroundColor: palette.bg,
        color: palette.fg,
      }}
      className={`flex h-full w-full flex-col overflow-auto p-5 leading-tight outline-none ${
        isActive && focused
          ? "ring-1 ring-zinc-700 ring-inset"
          : isActive
            ? "ring-1 ring-zinc-800 ring-inset"
            : ""
      }`}
    >
      <div className="whitespace-pre">
        {screen ? (
          screen.lines.map((runs, idx) => (
            <Row
              key={idx}
              runs={runs}
              cursorCol={
                idx === screen.cursor_row && screen.cursor_visible
                  ? screen.cursor_col
                  : null
              }
              focused={focused && isActive}
              palette={palette}
            />
          ))
        ) : (
          <span style={{ opacity: 0.5 }}>starting pwsh...</span>
        )}
      </div>
    </div>
  );
}
