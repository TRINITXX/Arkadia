/**
 * What a choice visual holds before it is validated (picks, tab, remarks,
 * their images), by its tool call, outside React: its frame goes with its
 * project leaving the screen, or scrolled far, and its page came back
 * blank (the user's report of 15/11/2026). The page sends it (`keep`) and
 * asks it back once loaded (`restore`). Its zoomed copy shares it: each
 * frame hears the other's changes. In memory only, the latest kept.
 */

const MAX = 40;

const states = new Map<string, unknown>();
type Listener = (state: unknown, from: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

/** `from`: the frame it came from, which doesn't hear it back. */
export function keepVisualState(
  key: string,
  state: unknown,
  from: unknown,
): void {
  states.delete(key);
  states.set(key, state);
  while (states.size > MAX) {
    const oldest = states.keys().next().value;
    if (oldest === undefined) break;
    states.delete(oldest);
  }
  for (const cb of listeners.get(key) ?? []) cb(state, from);
}

/** Its state kept, or null: none yet. */
export function visualState(key: string): unknown {
  return states.get(key) ?? null;
}

export function onVisualState(key: string, cb: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) listeners.delete(key);
  };
}
