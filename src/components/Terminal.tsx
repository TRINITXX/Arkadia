import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { measureCellSize } from "@/lib/cellSize";
import { resolveColor } from "@/lib/palettes";
import type {
  CellRun,
  PaneState,
  TerminalFont,
  TerminalPalette,
} from "@/types";

function keyEventToBytes(e: React.KeyboardEvent): Uint8Array | null {
  switch (e.key) {
    case "Enter":
      return new TextEncoder().encode("\r");
    case "Backspace":
      return new Uint8Array([0x7f]);
    case "Tab":
      return new TextEncoder().encode("\t");
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
  onContextMenu: (x: number, y: number) => void;
}

export function Terminal({
  pane,
  isActive,
  font,
  palette,
  onActivate,
  onContextMenu,
}: TerminalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (isActive) {
      ref.current?.focus();
    }
  }, [isActive]);

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
        {pane.screen ? (
          pane.screen.lines.map((runs, idx) => (
            <Row
              key={idx}
              runs={runs}
              cursorCol={
                idx === pane.screen!.cursor_row && pane.screen!.cursor_visible
                  ? pane.screen!.cursor_col
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
