import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isCommandSent } from "@/lib/chat/chatCommands";
import type {
  EffortLevel,
  ElicitationAnswer,
  PermissionMode,
  PermissionResult,
  RewindPoint,
  SessionChoice,
} from "@/lib/chat/chatProtocol";
import type { McpAction } from "@/lib/chat/chatSlash";
import type { RewindMode } from "@/lib/chat/useSlashActions";
import { reduceChat } from "@/lib/chat/chatState";
import { sendNowPlan, stopTurnPlan } from "@/lib/chat/chatTasks";
import { phoneDrives } from "@/lib/chat/phoneChat";
import type { PhoneChatCommand } from "@/lib/remoteActions";
import {
  chatLive,
  keepChat,
  markWithdrawing,
  subscribeChat,
  updateChat,
} from "~/chat/chat-store";
import { acquireChat, act } from "~/remote/connection";

/** How many older messages « Charger les messages plus anciens » brings. */
const OLDER_PAGE = 200;
/** A subagent's sheet: its latest messages. */
const AGENT_PAGE = 400;
/** The PC waits a minute on an MCP action (`MCP_ACTION_TIMEOUT_MS`): longer. */
const MCP_WAIT_MS = 75_000;

/**
 * Runs a chat command on the PC. What the user does (`phoneDrives`) names the
 * pane: the iPhone drives the tab from then on (notifications, Live Activity).
 */
export function chatDo(chatId: string, command: PhoneChatCommand) {
  return act({
    kind: "chatCommand",
    chatId,
    ...(phoneDrives(command.type) ? { paneId: chatId } : {}),
    command,
  });
}

/**
 * One chat pane on screen: its events stream to the app while the screen is
 * up, its life replayed first (`chatOpen`, which starts a chat never started
 * or ended, as a desktop pane coming back does). The actions mirror the
 * desktop's `useChatSession`.
 */
export function useChat(chatId: string) {
  useEffect(() => {
    keepChat(chatId);
    // In order on the socket: the stream is on before the replay asks. The
    // release hands the stream to the screen below, which catches up.
    const release = acquireChat(chatId);
    void act({ kind: "chatOpen", chatId, restart: true }).catch((e: unknown) =>
      fail(chatId, e),
    );
    return release;
  }, [chatId]);

  const live = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeChat(chatId, cb), [chatId]),
    () => chatLive(chatId),
  );
  const { state } = live;
  // Read at call time: the actions keep one identity.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  return useMemo(() => {
    const run = (command: PhoneChatCommand) =>
      chatDo(chatId, command).catch((e: unknown) => fail(chatId, e));
    return {
      /** `now`: Ctrl+Entrée on the desktop, the turn under way stops for it. */
      send(text: string, now = false) {
        if (!now) return run({ type: "send", text });
        const s = stateRef.current;
        const plan = sendNowPlan(
          s.subagents,
          isCommandSent(s, { type: "user_sent", chatId, text, images: 0 }),
        );
        return run(
          plan.priority
            ? { type: "send", text, priority: "now" }
            : { type: "send", text, spare: plan.spare },
        );
      },
      /** Échap: never a subagent nor a waiting message (`stopTurnPlan`). */
      interrupt() {
        const { subagents, items } = stateRef.current;
        const plan = stopTurnPlan(subagents, items);
        if (!plan.interrupt)
          return run({ type: "background", toolUseIds: plan.spare });
        return run({ type: "interrupt", spare: plan.spare });
      },
      answer: (requestId: string, result: PermissionResult) =>
        run({ type: "answer", requestId, result }),
      elicitAnswer: (requestId: string, result: ElicitationAnswer) =>
        run({ type: "elicit_answer", requestId, result }),
      setMode: (mode: PermissionMode) => run({ type: "set_mode", mode }),
      setModel: (model: string) => run({ type: "set_model", model }),
      setEffort: (effort: EffortLevel) => run({ type: "set_effort", effort }),
      background: () => run({ type: "background" }),
      stopTask: (taskId: string) => run({ type: "stop_task", taskId }),
      cancelQueued: (uuid: string) => {
        markWithdrawing(chatId, uuid);
        return run({ type: "cancel_queued", uuid });
      },
      wake: () => run({ type: "wake" }),
      bash: (command: string) =>
        run({
          type: "bash",
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          command,
        }),
      stopBash: (id: string) => run({ type: "bash_stop", id }),
      taskOutput: (taskId: string) => run({ type: "task_output", taskId }),
      visualHtml: (toolUseId: string) =>
        run({ type: "visual_html", toolUseId }),
      loadOlder() {
        const cursor = stateRef.current.historyCursor;
        if (cursor)
          void run({ type: "older", before: cursor, limit: OLDER_PAGE });
      },
      openAgent(agentId: string) {
        const s = stateRef.current;
        if (!agentId || !s.sessionId) return;
        void run({
          type: "agent_history",
          sessionId: s.sessionId,
          cwd: "",
          limit: AGENT_PAGE,
          agentId,
        });
      },
      /** « Reprendre »: an ended chat starts again on its session. */
      restart: () =>
        act({ kind: "chatOpen", chatId, restart: true }).catch((e: unknown) =>
          fail(chatId, e),
        ),
      /** Chat ⇄ terminal, as the desktop toolbar's switch. */
      toggle: () => act({ kind: "chatToggle", paneId: chatId }),
      /**
       * /resume, /rewind and /mcp, run by the desktop with its own rules
       * (Claude at rest, a session open elsewhere): each throws why not.
       */
      sessions: async (): Promise<SessionChoice[]> =>
        (await act({ kind: "chatSessions", chatId })).sessions ?? [],
      resume: (sessionId: string) =>
        act({ kind: "chatResume", chatId, paneId: chatId, sessionId }),
      rewindPoints: async (): Promise<RewindPoint[]> =>
        (await act({ kind: "chatRewindPoints", chatId })).points ?? [],
      rewind: (before: string, mode: RewindMode) =>
        act({ kind: "chatRewind", chatId, paneId: chatId, before, mode }),
      /** Resolves with the sign-in's page, opened in the PC's browser. */
      mcp: async (server: string, action: McpAction) =>
        (
          await act(
            { kind: "chatMcp", chatId, paneId: chatId, server, action },
            MCP_WAIT_MS,
          )
        ).authUrl,
      /** The MCP servers' state asked again (their list opened). */
      refreshMcp: () => run({ type: "mcp_status" }),
    };
  }, [chatId]);
}

export type ChatActions = ReturnType<typeof useChat>;

/** Its state and its subagents' conversations, for the screen. */
export function useChatLive(chatId: string) {
  return useSyncExternalStore(
    useCallback((cb: () => void) => subscribeChat(chatId, cb), [chatId]),
    () => chatLive(chatId),
  );
}

function fail(chatId: string, e: unknown) {
  updateChat(chatId, (s) =>
    reduceChat(
      s,
      {
        type: "error",
        chatId,
        message: e instanceof Error ? e.message : String(e),
      },
      Date.now(),
    ),
  );
}
