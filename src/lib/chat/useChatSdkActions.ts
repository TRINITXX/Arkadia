import { useMemo } from "react";
import { chatCommand, subscribeChat } from "@/lib/chat/chatEvents";
import type { McpAction } from "@/lib/chat/chatSlash";
import type {
  ContextDetail,
  EffortLevel,
  ElicitationAnswer,
} from "@/lib/chat/chatProtocol";

/**
 * What the chat's settings ask of its server: effort, a queued message
 * withdrawn, an MCP request answered, the context's breakdown, the MCP
 * servers' state, plugins reloaded. The breakdown costs token counts: asked
 * on hover, kept `CONTEXT_CACHE_MS`.
 */
export interface ChatSdkActions {
  setEffort: (effort: EffortLevel) => void;
  /** The uuid of a message still « en attente ». */
  removeQueued: (uuid: string) => void;
  answerElicitation: (requestId: string, result: ElicitationAnswer) => void;
  contextDetail: () => Promise<ContextDetail>;
  refreshMcp: () => void;
  /** /mcp's buttons: resolves with the page to sign in on, if one is left. */
  mcpAction: (server: string, action: McpAction) => Promise<string | undefined>;
  reloadPlugins: () => void;
  /** A past visual's page with its images in (`visual_html` into the state). */
  visualHtml?: (toolUseId: string) => void;
  /** « Ouvrir dans le navigateur »: the page as its card shows it. */
  openVisual?: (html: string, title: string) => void;
}

/** A breakdown this recent answers the next hover. */
export const CONTEXT_CACHE_MS = 30_000;

/** The latest breakdown asked, by chat: a pane that remounts keeps it. */
const detailCache = new Map<
  string,
  { at: number; detail: Promise<ContextDetail> }
>();

/** A sign-in's page asked: a reconnection first, a few seconds. */
const MCP_ACTION_TIMEOUT_MS = 30_000;

/** `getContextUsage` full counts tokens: a few seconds at most. */
const DETAIL_TIMEOUT_MS = 20_000;

export function useChatSdkActions(
  chatId: string,
  accountId: string | undefined,
  onError: (message: string) => void,
): ChatSdkActions {
  return useMemo(() => {
    const run = (command: Parameters<typeof chatCommand>[1]) => {
      chatCommand(accountId, command).catch((e: unknown) => onError(String(e)));
    };
    const askDetail = () =>
      new Promise<ContextDetail>((resolve, reject) => {
        const requestId = `context:${Date.now()}:${Math.random()}`;
        const done = () => {
          window.clearTimeout(timer);
          off();
        };
        const timer = window.setTimeout(() => {
          done();
          reject(new Error("Le chat ne répond pas"));
        }, DETAIL_TIMEOUT_MS);
        const off = subscribeChat(chatId, (event) => {
          if (event.type !== "context_detail" || event.requestId !== requestId)
            return;
          done();
          if (event.detail) resolve(event.detail);
          else reject(new Error(event.error ?? "Détail indisponible"));
        });
        chatCommand(accountId, {
          type: "context_detail",
          chatId,
          requestId,
        }).catch((e: unknown) => {
          done();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    return {
      setEffort: (effort) => run({ type: "set_effort", chatId, effort }),
      removeQueued: (uuid) => run({ type: "cancel_queued", chatId, uuid }),
      answerElicitation: (requestId, result) =>
        run({ type: "elicit_answer", chatId, requestId, result }),
      contextDetail: () => {
        const now = Date.now();
        const cached = detailCache.get(chatId);
        if (cached && now - cached.at < CONTEXT_CACHE_MS) return cached.detail;
        const detail = askDetail();
        detailCache.set(chatId, { at: now, detail });
        // A failure is asked again on the next hover.
        detail.catch(() => {
          if (detailCache.get(chatId)?.detail === detail)
            detailCache.delete(chatId);
        });
        return detail;
      },
      refreshMcp: () => run({ type: "mcp_status", chatId }),
      mcpAction: (server, action) =>
        new Promise<string | undefined>((resolve, reject) => {
          const requestId = `mcp:${Date.now()}:${Math.random()}`;
          const done = () => {
            window.clearTimeout(timer);
            off();
          };
          const timer = window.setTimeout(() => {
            done();
            reject(new Error("Le chat ne répond pas"));
          }, MCP_ACTION_TIMEOUT_MS);
          const off = subscribeChat(chatId, (event) => {
            if (
              event.type !== "mcp_action_done" ||
              event.requestId !== requestId
            )
              return;
            done();
            if (event.error) reject(new Error(event.error));
            else resolve(event.authUrl);
          });
          chatCommand(accountId, {
            type: "mcp_action",
            chatId,
            requestId,
            server,
            action,
          }).catch((e: unknown) => {
            done();
            reject(e instanceof Error ? e : new Error(String(e)));
          });
        }),
      reloadPlugins: () => run({ type: "reload_plugins", chatId }),
      visualHtml: (toolUseId) =>
        run({ type: "visual_html", chatId, toolUseId }),
      openVisual: (html, title) =>
        run({ type: "visual_open", chatId, html, title }),
    };
  }, [chatId, accountId, onError]);
}
