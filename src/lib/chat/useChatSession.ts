import { useCallback, useEffect, useRef, useState } from "react";
import {
  chatCommand,
  chatEventsReady,
  subscribeChat,
  subscribeServerExit,
} from "@/lib/chat/chatEvents";
import type {
  ChatEvent,
  PermissionMode,
  PermissionResult,
} from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";

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

/**
 * Events come in bursts while Claude streams: they are folded in at most
 * every 16 ms. A timer rather than an animation frame: frames stop while the
 * window is minimized, and a long stream would pile up meanwhile.
 */
const FLUSH_MS = 16;

/**
 * One chat, driven by its pane. Starting it again (remount, page reload)
 * reattaches to the running conversation: the chat ends only with `close`,
 * which the pane's owner sends when the pane goes away or switches to the
 * terminal.
 */
export function useChatSession(
  chatId: string,
  accountId: string | undefined,
  start: ChatStart,
) {
  const [state, setState] = useState<ChatState>(EMPTY_CHAT);
  /** Subagent conversations opened from the drawer, by agent id. */
  const [agents, setAgents] = useState<Record<string, ChatState>>({});
  const startRef = useRef(start);
  /** Bumped by `restart`: starts the chat again, on its session. */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    let queue: ChatEvent[] = [];
    let timer: number | undefined;
    const flush = () => {
      timer = undefined;
      const batch = queue;
      queue = [];
      const now = Date.now();
      setState((s) => batch.reduce((acc, e) => reduceChat(acc, e, now), s));
    };
    const push = (event: ChatEvent) => {
      queue.push(event);
      timer ??= window.setTimeout(flush, FLUSH_MS);
    };
    const unsubscribe = subscribeChat(chatId, (event) => {
      if (event.type === "history" && event.agentId) {
        const agentId = event.agentId;
        setAgents((prev) => ({
          ...prev,
          [agentId]: reduceChat(
            EMPTY_CHAT,
            { ...event, agentId: undefined },
            0,
          ),
        }));
        return;
      }
      push(event);
    });
    const unsubscribeExit = subscribeServerExit((account) => {
      if (account !== (accountId ?? "main")) return;
      push({
        type: "closed",
        chatId,
        error: "Le serveur du chat s'est arrêté",
      });
    });
    void chatEventsReady()
      .then(() => {
        if (!alive) return;
        return chatCommand(accountId, {
          type: "start",
          chatId,
          ...startRef.current,
        });
      })
      .catch((e: unknown) =>
        push({ type: "closed", chatId, error: String(e) }),
      );
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeExit();
      window.clearTimeout(timer);
    };
  }, [chatId, accountId, generation]);

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
    [accountId, chatId],
  );

  const send = useCallback(
    (text: string, images: ChatImage[] = []) =>
      run({ type: "send", chatId, text, images }),
    [run, chatId],
  );
  const interrupt = useCallback(
    () => run({ type: "interrupt", chatId }),
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
      if (!state.sessionId) return;
      void run({
        type: "history",
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
    startRef.current = {
      cwd: startRef.current.cwd,
      resume: state.sessionId ?? startRef.current.resume,
    };
    setState(EMPTY_CHAT);
    setGeneration((g) => g + 1);
  }, [state.sessionId]);

  return {
    state,
    agents,
    restart,
    send,
    interrupt,
    answer,
    setMode,
    setModel,
    openAgent,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
