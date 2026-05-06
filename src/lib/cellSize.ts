interface CellSize {
  width: number;
  height: number;
}

const SAMPLE_LEN = 100;
const SAMPLE_CHAR = "M";

const cache = new Map<string, CellSize>();

function key(family: string, size: number): string {
  return `${family}|${size}`;
}

/**
 * Measures one cell of the terminal grid for a given monospace font.
 *
 * Width comes from a 100-char DOM span (averaged for sub-pixel precision).
 * Height uses Canvas `fontBoundingBoxAscent + fontBoundingBoxDescent` — the
 * font-declared line box — which matches what WezTerm computes from the
 * FreeType metrics (`ascent + abs(descent)`). The DOM `lineHeight` route
 * either over-pads (≥ 1.2) or clips ascenders/descenders (1.0), so we avoid
 * it entirely here.
 *
 * Cached per (family, size).
 */
export function measureCellSize(family: string, size: number): CellSize {
  const k = key(family, size);
  const hit = cache.get(k);
  if (hit) return hit;

  // Width via DOM span (most reliable for sub-pixel monospace advance width).
  const span = document.createElement("span");
  span.style.fontFamily = family;
  span.style.fontSize = `${size}px`;
  span.style.lineHeight = "1";
  span.style.position = "absolute";
  span.style.left = "-9999px";
  span.style.top = "-9999px";
  span.style.whiteSpace = "pre";
  span.style.visibility = "hidden";
  span.textContent = SAMPLE_CHAR.repeat(SAMPLE_LEN);
  document.body.appendChild(span);
  const rect = span.getBoundingClientRect();
  document.body.removeChild(span);
  const width = rect.width / SAMPLE_LEN;

  // Height via Canvas font metrics — matches WezTerm's `ascent + |descent|`.
  let height = Math.ceil(size * 1.2); // safe fallback if Canvas API misses fields
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = `${size}px ${family}`;
    const m = ctx.measureText(SAMPLE_CHAR);
    const ascent =
      typeof m.fontBoundingBoxAscent === "number"
        ? m.fontBoundingBoxAscent
        : m.actualBoundingBoxAscent;
    const descent =
      typeof m.fontBoundingBoxDescent === "number"
        ? m.fontBoundingBoxDescent
        : m.actualBoundingBoxDescent;
    if (
      Number.isFinite(ascent) &&
      Number.isFinite(descent) &&
      ascent + descent > 0
    ) {
      height = Math.ceil(ascent + descent);
    }
  }

  const measured: CellSize = { width, height };
  cache.set(k, measured);
  return measured;
}
