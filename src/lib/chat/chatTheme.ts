/**
 * The chat's colours (« Colonne calme »): its CSS (`chat-css.ts`) and the
 * theme its visuals get (`chatVisual.ts`) read them here, so a visual looks
 * like the column it sits in.
 */
export const CHAT_TOKENS = {
  /** The terminal's grey: the column, and a visual's page. */
  bg: "#181a1d",
  ink: "#e4e4e7",
  dim: "#a1a1aa",
  mute: "#858790",
  line: "#2b2e33",
  /** Cards sunk in the column (diffs, tool output). */
  card: "#141619",
  /** Raised boxes (the input card). */
  raised: "#202327",
  raisedHover: "#25282c",
  lineStrong: "#31353b",
  accent: "#e2865f",
  accentInk: "#1a0f0a",
} as const;

export const CHAT_FONTS = {
  sans: '"Segoe UI", system-ui, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
  mono: '"Cascadia Code", "JetBrains Mono", ui-monospace, monospace',
} as const;
