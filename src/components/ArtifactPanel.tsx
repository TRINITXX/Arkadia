import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Store } from "@tauri-apps/plugin-store";
import { ExternalLink, RotateCw, X } from "lucide-react";
import type { ArtifactItem } from "@/lib/artifactTabs";
import { useAnyOverlayOpen } from "@/lib/overlays";

/** Own store file: the main saveState() never rewrites it (see notepadStore). */
const STORE_FILE = "artifact-panel.json";
const KEY_WIDTH = "width";
const WIDTH_DEFAULT = 560;
const WIDTH_MIN = 360;
/** Share of the window the panel may take, so the terminals stay usable. */
const WIDTH_MAX_SHARE = 0.7;

function clampWidth(w: unknown): number {
  const max = Math.round(window.innerWidth * WIDTH_MAX_SHARE);
  const wanted =
    typeof w === "number" && Number.isFinite(w) ? w : WIDTH_DEFAULT;
  return Math.max(WIDTH_MIN, Math.min(max, Math.round(wanted)));
}

/** The panel body in physical pixels: where the native webview is laid. */
function bodyBounds(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    width: Math.round(r.width * dpr),
    height: Math.round(r.height * dpr),
  };
}

function placeWebview(el: HTMLElement): void {
  void invoke("artifact_view_place", { bounds: bodyBounds(el) }).catch(
    () => {},
  );
}

/** The nonce each artifact was last shown with: a newer one reloads its page.
 *  Module-wide, so it outlives the panel leaving with its tab (keys are unique
 *  for the app's lifetime). */
const shownNonce = new Map<string, number>();

interface ArtifactPanelProps {
  /** The artifacts of the active Arkadia tab, one tab of the panel each. */
  items: ArtifactItem[];
  activeKey: string;
  /** Shown in the header when several accounts exist. */
  accountLabel: (accountId: string) => string | null;
  onSelect: (key: string) => void;
  onCloseItem: (key: string) => void;
  /** Closes the panel: every artifact of this tab. */
  onCloseAll: () => void;
  /** The panel's width once settled (not on every step of a drag). */
  onWidthChange: (width: number) => void;
}

/**
 * The claude.ai artifacts of the active tab, docked beside the terminals.
 * Each page is a separate borderless window (`artifact_view.rs`) laid over
 * the empty body below the tabs; React only reserves that room and reports
 * where it is.
 */
export function ArtifactPanel({
  items,
  activeKey,
  accountLabel,
  onSelect,
  onCloseItem,
  onCloseAll,
  onWidthChange,
}: ArtifactPanelProps) {
  const [width, setWidth] = useState(() => clampWidth(undefined));
  const [settledWidth, setSettledWidth] = useState(width);
  const [error, setError] = useState<string | null>(null);
  const widthRef = useRef(width);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hidden = useAnyOverlayOpen();
  const active = items.find((i) => i.key === activeKey) ?? items[0];

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    onWidthChange(settledWidth);
  }, [settledWidth, onWidthChange]);

  // Width: load once.
  useEffect(() => {
    let alive = true;
    Store.load(STORE_FILE, { autoSave: false, defaults: {} })
      .then((s) => s.get<unknown>(KEY_WIDTH))
      .then((w) => {
        if (!alive || w === undefined) return;
        const loaded = clampWidth(w);
        setWidth(loaded);
        setSettledWidth(loaded);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Put the active artifact on screen once the body is laid out: built the
  // first time, reloaded when its link was opened again, else as it was left.
  const activeItemKey = active?.key;
  const activeNonce = active?.nonce;
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !active) return;
    const last = shownNonce.get(active.key);
    shownNonce.set(active.key, active.nonce);
    setError(null);
    invoke("artifact_view_show", {
      key: active.key,
      url: active.url,
      account: active.accountId,
      bounds: bodyBounds(el),
      reload: last !== undefined && last !== active.nonce,
      hidden,
    })
      // The panel may have moved while the window was being built.
      .then(() => placeWebview(el))
      .catch((e) => setError(String(e)));
    // Keyed on the artifact and its nonce only: a title change is no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItemKey, activeNonce]);

  // The panel leaves the screen with its tab: the pages hide and stay as
  // they are, for when the tab comes back.
  useEffect(
    () => () => {
      void invoke("artifact_view_hide_all").catch(() => {});
    },
    [],
  );

  // Keep the page on the body as the window or the panel resizes, or the
  // window moves to a screen of another scale (no resize fires then).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const place = () => placeWebview(el);
    const onWindowResize = () => {
      const clamped = clampWidth(widthRef.current);
      setWidth(clamped);
      setSettledWidth(clamped);
      place();
    };
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", onWindowResize);
    let scaleQuery: MediaQueryList | null = null;
    const onScale = () => {
      place();
      watchScale();
    };
    const watchScale = () => {
      scaleQuery?.removeEventListener("change", onScale);
      scaleQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      scaleQuery.addEventListener("change", onScale);
    };
    watchScale();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      scaleQuery?.removeEventListener("change", onScale);
    };
  }, []);

  // Width resize from the left strip. Pointer capture keeps the drag alive
  // when the cursor crosses the artifact window; a lost capture (Alt+Tab
  // mid-drag) ends it like a release.
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMove = (ev: PointerEvent) => {
      setWidth(clampWidth(startWidth + (startX - ev.clientX)));
    };
    // A release also loses the capture: the second call finds nothing to do.
    let done = false;
    const onUp = () => {
      if (done) return;
      done = true;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("lostpointercapture", onUp);
      setSettledWidth(widthRef.current);
      Store.load(STORE_FILE, { autoSave: false, defaults: {} })
        .then(async (s) => {
          await s.set(KEY_WIDTH, widthRef.current);
          await s.save();
        })
        .catch(() => {});
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("lostpointercapture", onUp);
  };

  const iconButton =
    "flex size-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100";

  return (
    <div style={{ width }} className="flex shrink-0 bg-zinc-950">
      <div
        onPointerDown={onResizeStart}
        className="w-1.5 shrink-0 cursor-col-resize border-l border-zinc-800 hover:bg-zinc-700"
        title="Glisser pour changer la largeur"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
          <span className="text-xs font-medium text-zinc-200">Artefacts</span>
          <span className="flex-1 truncate text-xs text-zinc-500">
            {active ? (accountLabel(active.accountId) ?? "") : ""}
          </span>
          <button
            type="button"
            onClick={() => void invoke("artifact_view_reload").catch(() => {})}
            className={iconButton}
            title="Recharger"
            aria-label="Recharger l'artefact"
          >
            <RotateCw size={14} />
          </button>
          <button
            type="button"
            onClick={() =>
              active && void openExternal(active.url).catch(() => {})
            }
            className={iconButton}
            title="Ouvrir dans le navigateur"
            aria-label="Ouvrir l'artefact dans le navigateur"
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            onClick={onCloseAll}
            className={iconButton}
            title="Fermer tous les artefacts de cet onglet"
            aria-label="Fermer le panneau d'artefacts"
          >
            <X size={14} />
          </button>
        </div>
        <div
          role="tablist"
          aria-label="Artefacts de cet onglet"
          className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-zinc-800 px-2 pt-1.5"
        >
          {items.map((item) => {
            const isActive = item.key === active?.key;
            const label = item.title?.trim() || "Artefact";
            return (
              <div
                key={item.key}
                className={`group flex min-w-0 max-w-44 shrink-0 items-center gap-1.5 rounded-t-md pl-2.5 pr-1 text-xs ${
                  isActive
                    ? "bg-[#f3f0e8] font-semibold text-zinc-900"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelect(item.key)}
                  className="min-w-0 truncate py-1.5 text-left"
                  title={label}
                >
                  {label}
                </button>
                <button
                  type="button"
                  onClick={() => onCloseItem(item.key)}
                  className={`flex size-5 shrink-0 items-center justify-center rounded ${
                    isActive
                      ? "text-zinc-500 hover:bg-zinc-300 hover:text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                  title="Fermer cet artefact"
                  aria-label={`Fermer ${label}`}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <div
          ref={bodyRef}
          className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-zinc-500"
        >
          {error
            ? `Impossible d'afficher l'artefact : ${error}`
            : "Chargement de l'artefact…"}
        </div>
      </div>
    </div>
  );
}
