/**
 * Conversation message tints — shared by the terminal line backgrounds and
 * the toolbar navigation buttons so both render the exact same color at the
 * exact same opacity.
 */
export const MESSAGE_TINT_ALPHA = 0.12;
/** User messages (`❯`) — green-500. */
export const USER_TINT = "#22c55e";
/** Claude messages (white `●`) — purple-500. */
export const CLAUDE_TINT = "#a855f7";

/**
 * `#rrggbb` result of compositing `tint` at `alpha` over an opaque `base`.
 * The WebGPU renderer has no alpha blending on cell backgrounds, so the
 * blend is precomputed here.
 */
export function mixHex(base: string, tint: string, alpha: number): string {
  const b = parseHex(base);
  const t = parseHex(tint);
  const mix = (i: number) => Math.round(b[i] + (t[i] - b[i]) * alpha);
  return `#${toHex(mix(0))}${toHex(mix(1))}${toHex(mix(2))}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function toHex(v: number): string {
  return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
}
