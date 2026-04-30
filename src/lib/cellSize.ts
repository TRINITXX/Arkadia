interface CellSize {
  width: number;
  height: number;
}

const SAMPLE_LEN = 100;
const SAMPLE_CHAR = "M";
const LINE_HEIGHT = 1.25; // matches Tailwind `leading-tight`

const cache = new Map<string, CellSize>();

function key(family: string, size: number): string {
  return `${family}|${size}`;
}

/** Measures one cell of the terminal grid for a given monospace font. Cached per (family, size). */
export function measureCellSize(family: string, size: number): CellSize {
  const k = key(family, size);
  const hit = cache.get(k);
  if (hit) return hit;

  const span = document.createElement("span");
  span.style.fontFamily = family;
  span.style.fontSize = `${size}px`;
  span.style.lineHeight = String(LINE_HEIGHT);
  span.style.position = "absolute";
  span.style.left = "-9999px";
  span.style.top = "-9999px";
  span.style.whiteSpace = "pre";
  span.style.visibility = "hidden";
  span.textContent = SAMPLE_CHAR.repeat(SAMPLE_LEN);

  document.body.appendChild(span);
  const rect = span.getBoundingClientRect();
  document.body.removeChild(span);

  const measured: CellSize = {
    width: rect.width / SAMPLE_LEN,
    height: rect.height,
  };
  cache.set(k, measured);
  return measured;
}
