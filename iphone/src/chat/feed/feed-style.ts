import { C } from "~/chat/chat-theme";
import type { MarkdownTone } from "~/messages/markdown-text";

/**
 * The column's frames and marks (`chat-css.ts`), beyond `chat-theme`'s
 * tokens: the user's green bubble, Claude's violet frame, a peer's blue one,
 * the thinking's indigo, the diff's colours. Solid where the desktop has a
 * gradient (no gradient without a native module).
 */
export const F = {
  userBg: "#1f3a2b",
  claudeBorder: "#8648c5",
  claudeBg: "#1e1d2c",
  peerBorder: "#2f74b5",
  peerBg: "#141d28",
  peerInk: "#60a5fa",
  errorBorder: "#d9534f",
  errorInk: "#f08a87",
  thought: "#8b93c9",
  stepDot: "#6b4a99",
  queued: "#8f8f9a",
  bad: "#fca5a5",
  warn: "#e7c27a",
  warnLine: "rgba(231,194,122,0.32)",
  badLine: "rgba(248,113,113,0.3)",
  head: "#d4d4d8",
  sep: "#26292e",
  noticeBg: "#1b1d21",
  /** A diff's added and removed lines, and the card head's counts. */
  add: "#86efac",
  addBg: "rgba(34,197,94,0.07)",
  del: "#fca5a5",
  delBg: "rgba(239,68,68,0.07)",
  addCount: "#4ade80",
  delCount: "#f87171",
  gapBg: "#17191c",
  lineNo: "#5d6168",
  stepInk: "#6f727a",
  pillLine: "#3a3e45",
} as const;

/** Claude's markdown in the column's colours. */
export const CHAT_TONE: MarkdownTone = {
  ink: C.ink,
  dim: C.dim,
  link: "#8ab4f8",
  codeBg: "#0f1114",
  codeInk: F.head,
  line: C.lineStrong,
};

/** The same, quieter: a step reply, a command's answer, a plan. */
export const DIM_TONE: MarkdownTone = { ...CHAT_TONE, ink: C.dim };

/** A queued message's words: grey until Claude takes it. */
export const QUEUED_TONE: MarkdownTone = { ...CHAT_TONE, ink: F.queued };
