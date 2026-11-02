/**
 * The desktop's request panels and question sheet shades (`chat-css.ts`)
 * that the column's palette (`C`) does not name: a request reads the same on
 * the phone as in the PC's input card.
 */
export const A = {
  /** `.chat-box.ask`: the brown edge of what waits for an answer. */
  askLine: "#5a3a2c",
  /** A picked option or tab, a cautious « Refuser » (`.chat-opt.sel`). */
  picked: "#2b2623",
  /** The sheet's picked option (`.chat-sheet-q .opt.on`). */
  optOn: "#3a2519",
  /** The question sheet's card. */
  sheet: "#1d2024",
  /** A plain button, the mic, an option's number. */
  button: "#2a2d32",
  optionKey: "#2b2e33",
  /** Bright text: titles, picked labels. */
  strong: "#f4f4f5",
  /** An option's label at rest. */
  option: "#d4d4d8",
  /** Step bars: to answer, answered. */
  seg: "#33363c",
  segDone: "#2f6b47",
  radio: "#4a4e55",
  /** Claude's reason beside his reco. */
  reason: "#d6b9a8",
  /** « Le sous-agent … demande ». */
  asker: "#c4b5fd",
  error: "#fca5a5",
  recording: "#ef4444",
  /** A diff's added and removed lines (`.chat-diff .p / .m`). */
  addInk: "#86efac",
  addBg: "rgba(34,197,94,0.07)",
  delInk: "#fca5a5",
  delBg: "rgba(239,68,68,0.07)",
  gapBg: "#17191c",
} as const;
