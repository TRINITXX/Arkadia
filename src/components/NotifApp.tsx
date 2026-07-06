import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadState } from "@/store";
import { resolveActivePalette } from "@/lib/palettes";
import { CLAUDE_TINT, USER_TINT } from "@/lib/messageTint";
import { formatNotifLines } from "@/lib/notifLabel";
import { subscribePopupState } from "@/lib/popupState";
import type { TerminalPalette } from "@/types";

interface WaitingItem {
  pane_id: string;
  kind: string;
  cwd: string;
  ts: number;
  project_name: string;
  tab_title: string;
}

// Tab line font bounds (px). The tab name must fit ENTIRELY on one line, so its
// size shrinks from MAX toward MIN until the measured width fits the column.
const TAB_FONT_MAX = 15;
const TAB_FONT_MIN = 8;
// Project line is a fixed muted label above the tab.
const PROJECT_FONT = 12;

/**
 * The compact notification window (`index.html?window=notif`). Two lines for the
 * pane bound to its URL — project name on top, tab name below — with the same
 * colored dot as the mirror popup (violet = Claude is asking, green = finished).
 * The tab line auto-shrinks so the full name always fits (no ellipsis). Clicking
 * the body opens Arkadia on that conversation; ✕ dismisses it.
 *
 * Read-only w.r.t. the store, like `PopupApp`: `loadState({ heal: false })`.
 */
export function NotifApp() {
  const paneId = new URLSearchParams(window.location.search).get("pane") ?? "";
  const [items, setItems] = useState<WaitingItem[]>([]);
  const [palette, setPalette] = useState<TerminalPalette | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadState({ heal: false }).then((s) => {
      if (cancelled) return;
      setPalette(resolveActivePalette(s.paletteId, s.customPalette));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      subscribePopupState<WaitingItem>({
        listen: (handler) =>
          listen<{ items: WaitingItem[] }>("popup-state", (e) =>
            handler(e.payload.items),
          ),
        requestState: () => invoke("popup_request_state"),
        onItems: setItems,
      }),
    [],
  );

  const current = items.find((i) => i.pane_id === paneId) ?? null;

  // Bound to the URL's pane id so ✕ can always close the frameless window, even
  // once this pane has left the queue.
  const dismiss = () =>
    void invoke("popup_dismiss", { paneId }).catch(() => {});
  const openInMain = () =>
    void invoke("popup_open_in_main", { paneId }).catch(() => {});

  const bg = palette?.bg ?? "#0a0a0a";
  const fg = palette?.fg ?? "#e5e5e5";
  const isQuestion = current?.kind === "question";
  const { project, tab } = current
    ? formatNotifLines(current.project_name, current.tab_title, current.cwd)
    : { project: "Conversation introuvable", tab: null };

  // Auto-fit the tab line: measure its natural width (at TAB_FONT_MAX, via a
  // hidden probe) against the live column width and shrink the font to fit.
  const colRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [colWidth, setColWidth] = useState(0);
  const [tabFontPx, setTabFontPx] = useState(TAB_FONT_MAX);

  // Track the text column width (it changes when the user resizes the popup).
  useLayoutEffect(() => {
    const col = colRef.current;
    if (!col) return;
    setColWidth(col.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setColWidth(e.contentRect.width);
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!tab || !probe || colWidth <= 0) {
      setTabFontPx(TAB_FONT_MAX);
      return;
    }
    const natural = probe.scrollWidth; // measured at TAB_FONT_MAX
    const size =
      natural > colWidth
        ? Math.max(
            TAB_FONT_MIN,
            Math.floor((TAB_FONT_MAX * colWidth) / natural),
          )
        : TAB_FONT_MAX;
    setTabFontPx(size);
  }, [tab, colWidth]);

  // Content is horizontally centered; the ✕ is absolutely positioned top-right so
  // it never shifts the centering. It's ALWAYS rendered so the frameless window
  // can never get stuck with no way to close it.
  return (
    <div
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden px-5"
      style={{
        backgroundColor: bg,
        color: fg,
        cursor: "pointer",
      }}
      // Bound to the URL's pane id, so this works even when the pane has left
      // the queue (the "Conversation introuvable" fallback): the click still
      // brings Arkadia to the front and closes this window.
      onClick={openInMain}
      title={current ? "Ouvrir dans Arkadia" : "Ouvrir Arkadia"}
    >
      <div
        ref={colRef}
        className="flex w-full min-w-0 flex-col items-center text-center leading-tight"
      >
        <div className="flex max-w-full items-center gap-1.5">
          <span
            className="shrink-0 leading-none"
            style={{
              color: isQuestion ? CLAUDE_TINT : USER_TINT,
              fontSize: 12,
            }}
          >
            ●
          </span>
          <span
            className="min-w-0 truncate"
            style={{
              fontSize: tab ? PROJECT_FONT : TAB_FONT_MAX,
              fontWeight: tab ? 500 : 600,
              opacity: tab ? 0.7 : 1,
            }}
          >
            {project}
          </span>
        </div>
        {tab && (
          <span
            className="mt-0.5 whitespace-nowrap"
            style={{ fontSize: tabFontPx, fontWeight: 600 }}
          >
            {tab}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        title="Fermer"
        aria-label="Fermer"
        className="absolute right-1 top-1 rounded px-1.5 py-0.5 hover:bg-white/10"
        style={{ opacity: 0.7 }}
      >
        ✕
      </button>
      {/* Hidden probe: the tab name at TAB_FONT_MAX, used only to measure its
          natural single-line width. Kept out of flow so it never renders. */}
      <span
        ref={probeRef}
        aria-hidden
        style={{
          position: "absolute",
          left: -9999,
          top: 0,
          visibility: "hidden",
          whiteSpace: "nowrap",
          fontSize: TAB_FONT_MAX,
          fontWeight: 600,
          pointerEvents: "none",
        }}
      >
        {tab}
      </span>
    </div>
  );
}
