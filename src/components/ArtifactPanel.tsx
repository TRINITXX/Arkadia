import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Store } from "@tauri-apps/plugin-store";
import { ExternalLink, RotateCw, X } from "lucide-react";
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

interface ArtifactPanelProps {
  url: string;
  /** Claude account the artifact opens with: its own claude.ai sign-in. */
  accountId: string;
  /** Shown in the header when several accounts exist. */
  accountLabel: string | null;
  /** Bumped per click: the same link clicked again is shown again. */
  nonce: number;
  /** The panel's width once settled (not on every step of a drag). */
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

/**
 * A claude.ai artifact docked beside the terminals. The page itself is a
 * separate borderless window (`artifact_view.rs`) laid over the empty body
 * below the header; React only reserves that room and reports where it is.
 */
export function ArtifactPanel({
  url,
  accountId,
  accountLabel,
  nonce,
  onWidthChange,
  onClose,
}: ArtifactPanelProps) {
  const [width, setWidth] = useState(() => clampWidth(undefined));
  const [settledWidth, setSettledWidth] = useState(width);
  const [error, setError] = useState<string | null>(null);
  const widthRef = useRef(width);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hidden = useAnyOverlayOpen();

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

  // Show the artifact, or switch to a new one, once the body is laid out.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setError(null);
    invoke("artifact_view_show", {
      url,
      account: accountId,
      bounds: bodyBounds(el),
    })
      // The panel may have moved while the window was being built.
      .then(() => placeWebview(el))
      .catch((e) => setError(String(e)));
  }, [url, accountId, nonce]);

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

  useEffect(() => {
    void invoke("artifact_view_set_hidden", { hidden }).catch(() => {});
  }, [hidden]);

  // The webview goes away with the panel.
  useEffect(
    () => () => {
      void invoke("artifact_view_close").catch(() => {});
    },
    [],
  );

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
          <span className="text-xs font-medium text-zinc-200">Artefact</span>
          <span className="flex-1 truncate text-xs text-zinc-500">
            {accountLabel ?? ""}
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
            onClick={() => void openExternal(url).catch(() => {})}
            className={iconButton}
            title="Ouvrir dans le navigateur"
            aria-label="Ouvrir l'artefact dans le navigateur"
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className={iconButton}
            title="Fermer"
            aria-label="Fermer le panneau d'artefact"
          >
            <X size={14} />
          </button>
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
