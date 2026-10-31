import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { chatCommand } from "@/lib/chat/chatEvents";
import {
  attachLiveChat,
  liveChatAgents,
  liveChatState,
  startLiveChat,
  subscribeLiveChat,
  updateLiveChat,
} from "@/lib/chat/chatLive";
import type { PermissionMode, PermissionResult } from "@/lib/chat/chatProtocol";
import { isCommandSent } from "@/lib/chat/chatCommands";
import { reduceChat, type ChatState } from "@/lib/chat/chatState";
import { sendNowPlan, stopTurnPlan } from "@/lib/chat/chatTasks";

export interface ChatStart {
  cwd: string;
  /** The session to go on with (the terminal's, after a switch). */
  resume?: string;
  /** The folder's latest session (the toolbar's `ccdr`). */
  continue?: boolean;
}

export interface ChatImage {
  mediaType: string;
  /** Base64, no `data:` prefix. */
  data: string;
}

/** How many older messages « Charger les messages plus anciens » brings. */
const OLDER_PAGE = 200;

/**
 * One chat, driven by its pane. Its state lives page-side (`chatLive`) and
 * outlives the pane: back on screen, it shows at once and starts nothing.
 * Starting it on a running conversation (page reload) reattaches: the chat
 * ends only with `close`, which the pane's owner sends when the pane goes
 * away or switches to the terminal.
 */
export function useChatSession(
  chatId: string,
  accountId: string | undefined,
  start: ChatStart,
) {
  const startRef = useRef(start);
  // Declared before the reads below: React runs it before they subscribe.
  useEffect(() => {
    if (attachLiveChat(chatId, accountId)) {
      void startLiveChat(chatId, accountId, startRef.current);
    }
  }, [chatId, accountId]);
  const subscribe = useCallback(
    (cb: () => void) => subscribeLiveChat(chatId, cb),
    [chatId],
  );
  const state = useSyncExternalStore(subscribe, () => liveChatState(chatId));
  /** Subagent conversations opened from the drawer, by agent id. */
  const agents = useSyncExternalStore(subscribe, () => liveChatAgents(chatId));
  const setState = useCallback(
    (update: (s: ChatState) => ChatState) => updateLiveChat(chatId, update),
    [chatId],
  );

  const run = useCallback(
    (command: Parameters<typeof chatCommand>[1]) =>
      chatCommand(accountId, command).catch((e: unknown) =>
        setState((s) =>
          reduceChat(
            s,
            { type: "error", chatId, message: String(e) },
            Date.now(),
          ),
        ),
      ),
    [accountId, chatId, setState],
  );

  // What ends the turn (Esc, « Envoyer maintenant », Ctrl+Entrée) never
  // ends a subagent nor a waiting message (`stopTurnPlan`). Read at call
  // time: the actions keep one identity.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const send = useCallback(
    (text: string, images: ChatImage[] = [], now = false) => {
      const command = { type: "send" as const, chatId, text, images };
      if (!now) return run(command);
      // Foreground agents running: queued, then they go to the background
      // and Claude takes it there (`sendNowPlan`).
      const s = stateRef.current;
      const plan = sendNowPlan(
        s.subagents,
        isCommandSent(s, {
          type: "user_sent",
          chatId,
          text,
          images: images.length,
        }),
      );
      return run(
        plan.priority
          ? { ...command, priority: "now" as const }
          : { ...command, spare: plan.spare },
      );
    },
    [run, chatId],
  );
  const interrupt = useCallback(() => {
    const { subagents, items } = stateRef.current;
    const plan = stopTurnPlan(subagents, items);
    // A message waits: the backgrounding alone moves Claude on to it.
    if (!plan.interrupt)
      return run({ type: "background", chatId, toolUseIds: plan.spare });
    return run({ type: "interrupt", chatId, spare: plan.spare });
  }, [run, chatId]);
  /** Ctrl+B: the running Bash commands and subagents go to the background. */
  const background = useCallback(
    () => run({ type: "background", chatId }),
    [run, chatId],
  );
  /** « Arrêter le workflow »: that one task. */
  const stopTask = useCallback(
    (taskId: string) => run({ type: "stop_task", chatId, taskId }),
    [run, chatId],
  );
  /** A background shell's output, answered by a `task_output` event. */
  const taskOutput = useCallback(
    (taskId: string) => run({ type: "task_output", chatId, taskId }),
    [run, chatId],
  );
  const answer = useCallback(
    (requestId: string, result: PermissionResult) =>
      run({ type: "answer", chatId, requestId, result }),
    [run, chatId],
  );
  const setMode = useCallback(
    (mode: PermissionMode) => run({ type: "set_mode", chatId, mode }),
    [run, chatId],
  );
  const setModel = useCallback(
    (model: string) => run({ type: "set_model", chatId, model }),
    [run, chatId],
  );
  const openAgent = useCallback(
    (agentId: string) => {
      // No agent, no request: never the session's past in a sheet.
      if (!agentId || !state.sessionId) return;
      void run({
        type: "agent_history",
        chatId,
        sessionId: state.sessionId,
        cwd: startRef.current.cwd,
        limit: 400,
        agentId,
      });
    },
    [run, chatId, state.sessionId],
  );

  /** A chat that ended starts again on its session, its past reloaded. */
  const restart = useCallback(() => {
    // The pane's chat as it is now: after a /clear it names no session.
    startRef.current = {
      cwd: start.cwd,
      resume: state.sessionId ?? start.resume,
    };
    void startLiveChat(chatId, accountId, startRef.current);
  }, [chatId, accountId, state.sessionId, start.cwd, start.resume]);

  /** The page of messages before the oldest shown (`older`, server-side). */
  const loadOlder = useCallback(() => {
    if (!state.historyCursor) return;
    void run({
      type: "older",
      chatId,
      before: state.historyCursor,
      limit: OLDER_PAGE,
    });
  }, [run, chatId, state.historyCursor]);

  return {
    state,
    agents,
    restart,
    loadOlder,
    send,
    interrupt,
    background,
    stopTask,
    taskOutput,
    answer,
    setMode,
    setModel,
    openAgent,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
