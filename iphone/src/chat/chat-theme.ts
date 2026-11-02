import { CHAT_TOKENS } from "@/lib/chat/chatTheme";

/**
 * The chat's colours on the iPhone: the desktop column's (« Colonne calme »,
 * `chatTheme.ts`), so a chat reads the same on both, with iOS's own status
 * colours. Fonts are the system's (San Francisco, Menlo).
 */
export const C = {
  bg: CHAT_TOKENS.bg,
  ink: CHAT_TOKENS.ink,
  dim: CHAT_TOKENS.dim,
  mute: CHAT_TOKENS.mute,
  line: CHAT_TOKENS.line,
  lineStrong: CHAT_TOKENS.lineStrong,
  /** Sunk in the column: diffs, tool output, code. */
  card: CHAT_TOKENS.card,
  /** Raised: the input, a sheet, the user's frame. */
  raised: CHAT_TOKENS.raised,
  accent: CHAT_TOKENS.accent,
  accentInk: CHAT_TOKENS.accentInk,
  ok: "#30d158",
  warn: "#ff9f0a",
  bad: "#ff453a",
  info: "#0a84ff",
} as const;

export const MONO = "Menlo";

/** Text sizes: the column's body, its small print, its tiny labels. */
export const T = {
  body: 15,
  small: 13,
  tiny: 11,
} as const;
