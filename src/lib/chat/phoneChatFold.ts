import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";

/**
 * A chat as the iPhone holds it, built from the events the PC relays: the
 * same reducer as the desktop page (`chatLive`), the same replay rule.
 */
export interface PhoneChatLive {
  state: ChatState;
  /** A replay (`attached` … `replayed`), built apart until its end. */
  replay: ChatState | null;
  /** Subagent conversations asked for (`agent_history`), by agent id. */
  agents: Record<string, ChatState>;
  /**
   * A chat server stopped while this chat showed (`phoneServerExit`), and
   * its replay hasn't started again since (`attached`).
   */
  serverGone: boolean;
}

export const NEW_PHONE_CHAT: PhoneChatLive = {
  state: EMPTY_CHAT,
  replay: null,
  agents: {},
  serverGone: false,
};

/**
 * Folds a batch of events in. A replay builds apart and shows at its end, as
 * on the desktop. `catchUp`: an event came live for a chat this phone holds
 * as ended, so it started again elsewhere (« Reprendre » on the PC, a resume
 * after its server stopped): its new life must be replayed from the start.
 */
export function foldPhoneChat(
  chat: PhoneChatLive,
  events: readonly ChatEvent[],
  now: number,
): { chat: PhoneChatLive; catchUp: boolean } {
  let { state, replay, agents, serverGone } = chat;
  let catchUp = false;
  for (const event of events) {
    if (event.type === "history" && event.agentId) {
      agents = {
        ...agents,
        [event.agentId]: reduceChat(
          EMPTY_CHAT,
          { ...event, agentId: undefined },
          0,
        ),
      };
      continue;
    }
    if (event.type === "attached") {
      // Replayed by its server: one runs it again.
      serverGone = false;
      replay = reduceChat(EMPTY_CHAT, event, now);
      continue;
    }
    if (replay) {
      replay = reduceChat(replay, event, now);
      if (event.type === "replayed" || event.type === "closed") {
        state = replay;
        replay = null;
      }
      continue;
    }
    if (state.closed && event.type !== "closed" && event.type !== "error")
      catchUp = true;
    state = reduceChat(state, event, now);
  }
  const same =
    state === chat.state &&
    replay === chat.replay &&
    agents === chat.agents &&
    serverGone === chat.serverGone;
  return {
    chat: same ? chat : { state, replay, agents, serverGone },
    catchUp,
  };
}

/**
 * A chat server stopped (`server_exit`, which names no chat): the chat shown
 * may have gone with it, until its replay starts again (`attached`).
 */
export function phoneServerExit(chat: PhoneChatLive): PhoneChatLive {
  return chat.serverGone ? chat : { ...chat, serverGone: true };
}

/**
 * Whether a read the app asks on its own (a shell's output each second, an
 * agent's transcript every 2 s, the context's count) may go to this chat:
 * never to one ended, asleep, or whose server stopped. The PC hands the
 * phone's commands to Rust, which starts a server again for any but a
 * replay (`starts_server`): the read would start one for nothing.
 */
export function phoneChatReadable(chat: PhoneChatLive): boolean {
  return !chat.serverGone && chat.state.closed === null && !chat.state.asleep;
}
