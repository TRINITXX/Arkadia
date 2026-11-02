import { useEffect, useRef, useState } from "react";
import type { McpServerInfo } from "@/lib/chat/chatProtocol";
import {
  settleMcpPending,
  type McpAction,
  type McpPending,
  type McpRow,
} from "@/lib/chat/chatSlash";
import { mcpTapAction } from "@/lib/chat/phoneSlash";
import { failure, success, tap } from "~/ui/haptics";
import { showNotice } from "~/ui/notice";

/** A sign-in left open this long is let go: the chat server stops looking then. */
const MCP_SIGNIN_MS = 3 * 60_000;

/**
 * /mcp's actions under way, by server (the desktop's `mcpPick`): asked, its
 * sign-in open in the PC's browser, or why it failed. A server whose state
 * changes ends its sign-in or its error (`settleMcpPending`). Lives with
 * the composer: a sign-in still shows when the sheet opens again.
 */
export function useMcpPending(
  servers: McpServerInfo[],
  act: (server: string, action: McpAction) => Promise<string | undefined>,
) {
  const [pending, setPending] = useState<Record<string, McpPending>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
    };
  }, []);

  // A server whose state changed since: its sign-in or its error is over.
  useEffect(() => {
    setPending((all) => settleMcpPending(all, servers));
  }, [servers]);

  /** `toggle`: its switch (cut off or switch back on); else its button. */
  const pick = (row: McpRow, toggle: boolean) => {
    const action = mcpTapAction(row, toggle, pending[row.id]);
    if (!action) return;
    // Its button taps; its switch plays iOS's own.
    if (!toggle) tap();
    const server = row.id;
    const { status } = row;
    const set = (p: McpPending | null) =>
      setPending((all) => {
        const next = { ...all };
        if (p) next[server] = p;
        else delete next[server];
        return next;
      });
    set({ state: "asking", status });
    act(server, action).then(
      (authUrl) => {
        if (!authUrl) return set(null);
        // Signed in in the PC's browser: the row turns green once the chat
        // sees it, or lets go when the chat stops looking.
        const signin: McpPending = { state: "signin", status };
        set(signin);
        success();
        showNotice("Page de connexion ouverte sur le PC");
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          setPending((all) => {
            if (all[server] !== signin) return all;
            const next = { ...all };
            delete next[server];
            return next;
          });
        }, MCP_SIGNIN_MS);
        timers.current.add(timer);
      },
      (e: unknown) => {
        failure();
        set({ error: e instanceof Error ? e.message : String(e), status });
      },
    );
  };

  return { pending, pick };
}
