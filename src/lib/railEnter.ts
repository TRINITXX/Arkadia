/**
 * Lets the input rail take a typed Enter for its pane. While the rail dictates
 * the key must do what its send button does — end the dictation, wait for the
 * transcript, then send — instead of reaching Claude Code at once.
 */
type EnterHandler = () => boolean;

const handlers = new Map<string, EnterHandler>();

/** Registers the rail's handler (true = it took the key); returns the unregister. */
export function claimEnter(paneId: string, handler: EnterHandler): () => void {
  handlers.set(paneId, handler);
  return () => {
    // A newer rail of the same pane may have registered meanwhile: keep it.
    if (handlers.get(paneId) === handler) handlers.delete(paneId);
  };
}

/**
 * Whether the rail took the key whose bytes the terminal is about to send;
 * the terminal then sends nothing itself. Only a bare CR — Enter or Alt+Enter,
 * the keys that submit — is offered.
 */
export function railTakesKey(paneId: string, bytes: Uint8Array): boolean {
  if (bytes.length !== 1 || bytes[0] !== 0x0d) return false;
  return handlers.get(paneId)?.() ?? false;
}
