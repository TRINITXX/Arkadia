import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadState } from "@/store";
import { resolveActivePalette } from "@/lib/palettes";
import { PopupReading } from "@/components/PopupReading";
import { CLAUDE_TINT, USER_TINT } from "@/lib/messageTint";
import {
  DEFAULT_TERMINAL_FONT,
  type TerminalFont,
  type TerminalPalette,
} from "@/types";

// Tauri's ResizeDirection enum isn't exported; its values are these strings.
type ResizeDir =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

// Drag handles for the frameless popup (no OS resize borders). Each starts a
// native resize-drag in its direction on mouse-down.
const RESIZE_HANDLES: { dir: ResizeDir; style: React.CSSProperties }[] = [
  {
    dir: "North",
    style: { top: 0, left: 8, right: 8, height: 5, cursor: "ns-resize" },
  },
  {
    dir: "South",
    style: { bottom: 0, left: 8, right: 8, height: 5, cursor: "ns-resize" },
  },
  {
    dir: "West",
    style: { left: 0, top: 8, bottom: 8, width: 5, cursor: "ew-resize" },
  },
  {
    dir: "East",
    style: { right: 0, top: 8, bottom: 8, width: 5, cursor: "ew-resize" },
  },
  {
    dir: "NorthWest",
    style: { top: 0, left: 0, width: 10, height: 10, cursor: "nwse-resize" },
  },
  {
    dir: "NorthEast",
    style: { top: 0, right: 0, width: 10, height: 10, cursor: "nesw-resize" },
  },
  {
    dir: "SouthWest",
    style: { bottom: 0, left: 0, width: 10, height: 10, cursor: "nesw-resize" },
  },
  {
    dir: "SouthEast",
    style: {
      bottom: 0,
      right: 0,
      width: 10,
      height: 10,
      cursor: "nwse-resize",
    },
  },
];

function ResizeHandles() {
  return (
    <>
      {RESIZE_HANDLES.map((h) => (
        <div
          key={h.dir}
          onMouseDown={(e) => {
            e.preventDefault();
            const win = getCurrentWindow();
            void win.startResizeDragging(
              h.dir as Parameters<typeof win.startResizeDragging>[0],
            );
          }}
          style={{ position: "fixed", zIndex: 50, ...h.style }}
        />
      ))}
    </>
  );
}

interface WaitingItem {
  pane_id: string;
  kind: string;
  cwd: string;
  ts: number;
}

/**
 * The notification popup window (`index.html?window=popup`). Shows the pane at
 * the front of the backend queue: a live view of the waiting conversation plus
 * a header with a queue counter and two actions — dismiss, or open Arkadia on
 * this conversation. Replying happens directly in the mirrored terminal.
 */
export function PopupApp() {
  // Each popup window is bound to one pane via its URL (`?pane=<id>`).
  const paneId = new URLSearchParams(window.location.search).get("pane") ?? "";
  const [items, setItems] = useState<WaitingItem[]>([]);
  const [font, setFont] = useState<TerminalFont>(DEFAULT_TERMINAL_FONT);
  const [palette, setPalette] = useState<TerminalPalette | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadState().then((s) => {
      if (cancelled) return;
      setFont(s.font);
      setPalette(resolveActivePalette(s.paletteId, s.customPalette));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;
    void listen<{ items: WaitingItem[] }>("popup-state", (e) => {
      if (!active) return;
      setItems(e.payload.items);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    void invoke("popup_request_state").catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const current = items.find((i) => i.pane_id === paneId) ?? null;

  // Bound to the URL's pane id, so both actions work even when the queue no
  // longer carries this pane (the empty/fallback state below) — the ✕ must
  // always be able to close the frameless window.
  const dismiss = () =>
    void invoke("popup_dismiss", { paneId }).catch(() => {});
  const openInMain = () =>
    void invoke("popup_open_in_main", { paneId }).catch(() => {});

  const bg = palette?.bg ?? "#0a0a0a";
  const fg = palette?.fg ?? "#e5e5e5";
  const folder = current
    ? current.cwd
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() || current.cwd
    : "";
  const isQuestion = current?.kind === "question";
  const label = current
    ? isQuestion
      ? "Claude attend ta réponse"
      : "Claude a terminé"
    : "";

  // The header (with its ✕) is ALWAYS rendered — even before the palette loads
  // or when the pane has left the queue — so the frameless, undecorated window
  // can never get stuck with no way to close it.
  return (
    <div
      className="arkadia-popup flex h-screen w-screen flex-col overflow-hidden"
      style={{ backgroundColor: bg, color: fg }}
    >
      {/* The mirrored terminal's footer (status line, input box) is full
          terminal width, so its no-wrap blocks would show scrollbars. Hide all
          scrollbars in the popup — content still scrolls with the wheel. */}
      <style>{`
        .arkadia-popup ::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .arkadia-popup * { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
      <ResizeHandles />
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 border-b px-3 py-1.5 text-xs"
        style={{ borderColor: `${fg}22` }}
      >
        <span style={{ color: isQuestion ? CLAUDE_TINT : USER_TINT }}>●</span>
        <span className="flex-1 truncate" data-tauri-drag-region>
          {label}
          {folder && <span style={{ opacity: 0.55 }}> · {folder}</span>}
        </span>
        <button
          type="button"
          onClick={openInMain}
          title="Ouvrir dans Arkadia"
          aria-label="Ouvrir dans Arkadia"
          className="rounded px-1.5 py-0.5 hover:bg-white/10"
          style={{ opacity: 0.7 }}
        >
          ⮕
        </button>
        <button
          type="button"
          onClick={dismiss}
          title="Fermer"
          aria-label="Fermer"
          className="rounded px-1.5 py-0.5 hover:bg-white/10"
          style={{ opacity: 0.7 }}
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {current && palette ? (
          <PopupReading
            key={current.pane_id}
            paneId={current.pane_id}
            resetSignal={current.ts}
            kind={current.kind}
            font={font}
            palette={palette}
            onSubmit={dismiss}
          />
        ) : (
          <div
            className="flex h-full items-center justify-center px-4 text-center text-xs"
            style={{ opacity: 0.45 }}
          >
            {palette && !current
              ? "Conversation introuvable — ferme cette fenêtre."
              : ""}
          </div>
        )}
      </div>
    </div>
  );
}
