import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useOverlay } from "@/lib/overlays";
import {
  isRegion,
  pointIn,
  spanned,
  toGrabPixels,
  type Point,
  type Region,
} from "@/lib/artifactSnip";

interface Snip {
  /** The artifact the capture belongs to: another one on screen ends it. */
  key: string;
  /** Object URL of the frozen artifact. */
  src: string;
  /** The first corner, once placed. */
  start: Point | null;
  /** The pointer, the other corner of the region being traced. */
  end: Point | null;
}

/**
 * Region capture of the artifact on screen (`artifact_snip.rs`): the page is
 * grabbed and shown frozen in its place, a region is traced from one corner
 * to the other (dragged, or two clicks), and the region goes to the
 * clipboard. Escape, a right click or the button again cancel.
 */
export function useArtifactSnip(
  activeKey: string | undefined,
  onSnipped: () => void,
  onFailed: (message: string) => void,
) {
  const [snip, setSnipState] = useState<Snip | null>(null);
  // Pointer handlers read the latest corners before React re-renders.
  const snipRef = useRef<Snip | null>(null);
  const grabbingRef = useRef(false);
  const activeKeyRef = useRef(activeKey);
  const mountedRef = useRef(true);
  const imageRef = useRef<HTMLImageElement>(null);

  const setSnip = useCallback((next: Snip | null) => {
    snipRef.current = next;
    setSnipState(next);
  }, []);

  const cancel = useCallback(() => {
    if (!snipRef.current) return;
    setSnip(null);
    void invoke("artifact_snip_cancel").catch(() => {});
  }, [setSnip]);

  // The artifact window steps aside while its frozen picture is traced over.
  const snipping = snip !== null;
  const src = snip?.src ?? null;
  useOverlay(snipping);

  useEffect(() => {
    if (!src) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  // Another artifact on screen, or the panel gone, ends the capture.
  useEffect(() => {
    activeKeyRef.current = activeKey;
    if (snipRef.current && snipRef.current.key !== activeKey) cancel();
  }, [activeKey, cancel]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  // Escape is the capture's, never the terminal's (it would stop Claude).
  useEffect(() => {
    if (!snipping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [snipping, cancel]);

  const toggle = useCallback(async () => {
    if (snipRef.current) {
      cancel();
      return;
    }
    const key = activeKeyRef.current;
    if (!key || grabbingRef.current) return;
    grabbingRef.current = true;
    try {
      const png = await invoke<ArrayBuffer>("artifact_snip_grab");
      // The panel closed or moved to another artifact while grabbing.
      if (!mountedRef.current || activeKeyRef.current !== key) {
        void invoke("artifact_snip_cancel").catch(() => {});
        return;
      }
      setSnip({
        key,
        src: URL.createObjectURL(new Blob([png], { type: "image/png" })),
        start: null,
        end: null,
      });
    } catch (e) {
      onFailed(String(e));
    } finally {
      grabbingRef.current = false;
    }
  }, [cancel, onFailed, setSnip]);

  const finish = useCallback(
    async (region: Region) => {
      const image = imageRef.current;
      if (!image) return;
      const grab = { width: image.naturalWidth, height: image.naturalHeight };
      setSnip(null);
      try {
        await invoke("artifact_snip_copy", {
          ...toGrabPixels(region, grab),
        });
        onSnipped();
      } catch (e) {
        onFailed(String(e));
      }
    },
    [onFailed, onSnipped, setSnip],
  );

  const pointAt = (e: React.PointerEvent): Point =>
    pointIn(
      { x: e.clientX, y: e.clientY },
      e.currentTarget.getBoundingClientRect(),
    );

  const layerHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const current = snipRef.current;
      if (e.button !== 0 || !current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = pointAt(e);
      setSnip({ ...current, start: current.start ?? p, end: p });
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const current = snipRef.current;
      if (!current?.start) return;
      setSnip({ ...current, end: pointAt(e) });
    },
    // Released far enough from the first corner: that is the other one. A
    // click only places the first corner, the next click places the other.
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const current = snipRef.current;
      if (e.button !== 0 || !current?.start) return;
      const region = spanned(current.start, pointAt(e));
      const shown = e.currentTarget.getBoundingClientRect();
      if (isRegion(region, shown)) void finish(region);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
    },
  };

  const region = snip?.start && snip.end ? spanned(snip.start, snip.end) : null;

  return { snipping, src, region, toggle, imageRef, layerHandlers };
}
