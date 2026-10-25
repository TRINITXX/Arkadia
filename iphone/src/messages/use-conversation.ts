import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDelta,
  EMPTY_CONV,
  getHeldConv,
  setHeldConv,
  type ConvDelta,
  type HeldConv,
} from "@/lib/convStore";
import { onEvent, readConversation } from "~/remote/connection";

/**
 * The pane's conversation, read incrementally like the desktop's modern view
 * (`useConversationBlocks`): what was held paints at once, each refresh asks
 * only for what was appended, and `agent-state-changed` events of this
 * session trigger the refreshes.
 */
export function useConversation(paneId: string | null) {
  const [conv, setConv] = useState<HeldConv>(
    () => (paneId && getHeldConv(paneId)) || EMPTY_CONV,
  );
  const [loaded, setLoaded] = useState(
    () => !!paneId && getHeldConv(paneId) !== undefined,
  );
  const heldRef = useRef(conv);
  // The pane the view shows now: a read answered for another is stale.
  const paneRef = useRef(paneId);
  paneRef.current = paneId;
  // One read in flight at a time; a burst of events collapses into one more.
  const inflight = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!paneId) return;
    if (inflight.current) {
      pending.current = true;
      return;
    }
    inflight.current = true;
    try {
      const held = heldRef.current;
      const delta = await readConversation<ConvDelta>(
        paneId,
        held.generation,
        held.blocks.length,
      );
      // Unmounted or moved to another pane meanwhile: the answer is stale.
      if (
        !mounted.current ||
        paneRef.current !== paneId ||
        heldRef.current !== held
      )
        return;
      const next = applyDelta(held, delta);
      heldRef.current = next;
      setHeldConv(paneId, next);
      setConv(next);
      setLoaded(true);
    } catch {
      // Down or no conversation: the next event tries again.
    } finally {
      inflight.current = false;
      if (pending.current) {
        pending.current = false;
        // The current pane's refresh, not this closure's: the view may have
        // moved to another pane while this read was out.
        void refreshRef.current();
      }
    }
  }, [paneId]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const held = (paneId && getHeldConv(paneId)) || EMPTY_CONV;
    heldRef.current = held;
    setConv(held);
    setLoaded(!!paneId && getHeldConv(paneId) !== undefined);
    void refresh();
  }, [paneId, refresh]);

  useEffect(
    () =>
      onEvent("agent-state-changed", (payload) => {
        // Only this pane's session; before it is known, any event.
        const sid = (payload as { session_id?: string } | null)?.session_id;
        const own = heldRef.current.sessionId;
        if (own && sid && sid !== own) return;
        void refresh();
      }),
    [refresh],
  );

  return { blocks: conv.blocks, loaded };
}
