/**
 * Word-level search highlighting over already-rendered conversation blocks.
 *
 * The prose goes through a markdown renderer and a syntax highlighter before it
 * reaches the screen, so wrapping matches in `<mark>` would mean rewriting that
 * HTML and undoing the colouring. The CSS Custom Highlight API paints ranges
 * without touching the DOM at all: we hand it `Range`s, it tints the glyphs, and
 * the markup stays exactly as hljs left it.
 *
 * Available since Chromium 105; the app's WebView2 is far past that. Where it
 * is missing the functions below degrade to no-ops and the tinted block that
 * `BlockRow` draws remains as the coarse fallback.
 */

/** Registry names — also the `::highlight()` selectors in the view's CSS. */
const ALL = "arkadia-match";
const CURRENT = "arkadia-match-current";

/** One match, and where it sits, so navigation can scroll to it. */
export interface Occurrence {
  range: Range;
  /** Index of the visible row holding it — what the scroll code already keys on. */
  rowIndex: number;
}

/** A rendered row, as `ModernConversationView` tracks them. */
export interface Row {
  index: number;
  el: HTMLElement;
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

/** The `CSS.highlights` registry, or null where the API is missing. */
function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

function HighlightCtor(): (new (...ranges: Range[]) => unknown) | null {
  return (
    (globalThis as { Highlight?: new (...ranges: Range[]) => unknown })
      .Highlight ?? null
  );
}

/** True when the browser can paint ranges — checked before any work is done. */
export function highlightSupported(): boolean {
  return registry() !== null && HighlightCtor() !== null;
}

/**
 * Every occurrence of every term across `rows`, in reading order.
 *
 * Text is walked node by node, so a match split across inline markup (half of
 * it inside an `<em>`) is simply not found — an acceptable blind spot, and the
 * reason the count is computed from the same walk rather than from the raw
 * text: what the counter says is exactly what the user can step through.
 */
export function collectOccurrences(rows: Row[], terms: string[]): Occurrence[] {
  if (terms.length === 0 || !highlightSupported()) return [];
  const ordered = [...terms]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const out: Occurrence[] = [];
  for (const { index, el } of rows) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue ?? "";
      if (text.trim()) {
        const hay = text.toLowerCase();
        let i = 0;
        while (i < text.length) {
          const hit = ordered.find((t) => hay.startsWith(t, i));
          if (hit === undefined) {
            i += 1;
            continue;
          }
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + hit.length);
          out.push({ range, rowIndex: index });
          i += hit.length;
        }
      }
      node = walker.nextNode();
    }
  }
  return out;
}

/**
 * Paints `occurrences`, with `current` in the stronger tint. Both registries
 * are rewritten on every call, so this doubles as the way to move the cursor
 * from one match to the next.
 */
export function paintOccurrences(
  occurrences: Occurrence[],
  current: Occurrence | null,
): void {
  const reg = registry();
  const Ctor = HighlightCtor();
  if (!reg || !Ctor) return;
  if (occurrences.length === 0) {
    clearOccurrences();
    return;
  }
  // The current match is painted by the second registry only; leaving it out of
  // the first avoids two overlapping backgrounds fighting over the same glyphs.
  const rest = current
    ? occurrences.filter((o) => o !== current).map((o) => o.range)
    : occurrences.map((o) => o.range);
  reg.set(ALL, new Ctor(...rest));
  if (current) reg.set(CURRENT, new Ctor(current.range));
  else reg.delete(CURRENT);
}

/** Drops both registries — on close, on an emptied query, on unmount. */
export function clearOccurrences(): void {
  const reg = registry();
  if (!reg) return;
  reg.delete(ALL);
  reg.delete(CURRENT);
}
