import init from "@renderer/terminal_renderer.js";
import type { TerminalPalette } from "@/types";

// `wasm-pack --target web` exposes a single async initializer. Call it once and
// share the resolution across all canvases — the WASM module is global state.
let initPromise: Promise<unknown> | null = null;

export function ensureWasmReady(): Promise<unknown> {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

/** Converts "#RRGGBB" or "#RRGGBBAA" into components in [0, 1]. */
export function hexToRgba01(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1.0;
  return [r, g, b, a];
}

export interface RendererPalette {
  bg: [number, number, number, number];
  fg: [number, number, number, number];
  ansi: [number, number, number, number][];
}

/** Resolves a palette into the float-vector form expected by `Renderer.set_palette`. */
export function paletteToWasm(palette: TerminalPalette): RendererPalette {
  return {
    bg: hexToRgba01(palette.bg),
    fg: hexToRgba01(palette.fg),
    ansi: palette.ansi.map((c) => hexToRgba01(c)),
  };
}
