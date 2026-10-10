/**
 * Module-level store of what the client holds of each live pane's
 * conversation, keyed by pane id — it outlives the modern view.
 *
 * Switching project unmounts that project's tabs. A remounted view seeded from
 * here paints the conversation at once and asks the backend only for what was
 * appended meanwhile, instead of going see-through over the bare terminal while
 * it re-reads the whole transcript.
 */

import type { ConvBlock } from "@/components/ModernConversationView";

/** A conversation as the client holds it (mirrors the backend cache contract). */
export interface HeldConv {
  generation: number;
  blocks: ConvBlock[];
  sessionId: string | null;
  /** The session's working directory (latest `cwd` in the transcript). */
  cwd: string | null;
}

/** One incremental read: `blocks` replace everything from index `base` on. */
export interface ConvDelta {
  generation: number;
  base: number;
  blocks: ConvBlock[];
  sessionId?: string | null;
  cwd?: string | null;
}

/** Nothing read, or no conversation behind the pane. */
export const EMPTY_CONV: HeldConv = {
  generation: 0,
  blocks: [],
  sessionId: null,
  cwd: null,
};

/** `held` once `delta` — answered against it — is applied. */
export function applyDelta(held: HeldConv, delta: ConvDelta): HeldConv {
  return {
    generation: delta.generation,
    blocks:
      delta.base === 0
        ? delta.blocks
        : held.blocks.slice(0, delta.base).concat(delta.blocks),
    sessionId: delta.sessionId ?? null,
    cwd: delta.cwd ?? null,
  };
}

const held = new Map<string, HeldConv>();

/** What a pane's view last read, or undefined if it never read anything. */
export function getHeldConv(paneId: string): HeldConv | undefined {
  return held.get(paneId);
}

export function setHeldConv(paneId: string, conv: HeldConv): void {
  held.set(paneId, conv);
}

/** Forgets a closed pane's conversation. */
export function dropHeldConv(paneId: string): void {
  held.delete(paneId);
}
