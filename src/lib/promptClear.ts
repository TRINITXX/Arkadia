/**
 * Keys that empty Claude Code's prompt whatever it holds and wherever the
 * cursor sits: Ctrl+E to the end of the cursor's line, Ctrl+K over and over to
 * eat the lines below (at a line end it deletes the line break), then Ctrl+U
 * over and over to eat the lines above (at a line start it deletes the break
 * before). Pure text editing: unlike Esc or Ctrl+C it never interrupts Claude,
 * and on an empty prompt it does nothing.
 */
const CTRL_E = 0x05;
const CTRL_K = 0x0b;
const CTRL_U = 0x15;

/**
 * Ctrl+K and Ctrl+U stop at the wrap, so a kill eats one *screen* row (or one
 * line break). The box shows ~15 rows and scrolls past that, so the screen
 * can't size the burst: 160 covers a long dictation (~13,000 characters at
 * 100 columns) on each side of the cursor. Beyond, a second click finishes.
 */
const KILLS_PER_SIDE = 160;

/**
 * Claude Code reads a large write as a paste and drops the control keys in it:
 * measured on v2.1.307, 41 bytes in one write cleared the prompt, 81 did
 * nothing. Hence small writes, spaced so the PTY doesn't merge them back.
 */
const CHUNK_BYTES = 16;
export const CLEAR_CHUNK_GAP_MS = 20;

/** The clearing keys, cut into the writes to send one after the other. */
export function clearPromptChunks(): number[][] {
  const keys = [
    CTRL_E,
    ...Array<number>(KILLS_PER_SIDE).fill(CTRL_K),
    ...Array<number>(KILLS_PER_SIDE).fill(CTRL_U),
  ];
  const chunks: number[][] = [];
  for (let i = 0; i < keys.length; i += CHUNK_BYTES) {
    chunks.push(keys.slice(i, i + CHUNK_BYTES));
  }
  return chunks;
}
