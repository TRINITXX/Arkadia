import { useMemo } from "react";
import {
  chatActivity,
  chatCommand,
  chatReplaying,
  subscribeChat,
} from "@/lib/chat/chatEvents";
import type {
  ChatEvent,
  RewindPoint,
  SessionChoice,
} from "@/lib/chat/chatProtocol";
import { markLive, resumeRefusal } from "@/lib/chat/chatSlash";
import { chatBusyReason } from "@/lib/chat/usePaneChats";

/** What /rewind brings back: the conversation, both, or the files alone. */
export type RewindMode = "conversation" | "both" | "code";

/**
 * What the page's own commands (/resume, /rewind) ask of the chat server.
 * `resume` and `rewind` answer why not now (Claude at work, a request open)
 * or null once asked: the chat restarts, its pane keeps its input.
 */
export interface SlashActions {
  sessions: () => Promise<SessionChoice[]>;
  rewindPoints: () => Promise<RewindPoint[]>;
  /**
   * Async: the panes are looked at again at the moment of the choice.
   * `whole`: a handoff's « Reprendre l'ancienne en entier », its next
   * message goes to it as is, never to another handoff.
   */
  resume: (
    sessionId: string,
    options?: { whole?: boolean },
  ) => Promise<string | null>;
  rewind: (point: RewindPoint, mode: RewindMode) => string | null;
  /**
   * The last pick's sending to the chat's server: rejects if it failed. The
   * phone waits on it (App's `chatResume`, `chatRewind`), the PC never.
   */
  sent?: () => Promise<void>;
}

type ListAnswer = Extract<ChatEvent, { type: "sessions" | "rewind_points" }>;

/** A list the server answers on the chat's events, matched by request id. */
const LIST_TIMEOUT_MS = 15_000;

const NONE = () => Promise.resolve(new Set<string>());

export function useSlashActions(
  chatId: string,
  accountId: string | undefined,
  onError: (message: string) => void,
  /** Sessions running in Arkadia's other panes (`usePaneChats`). */
  liveSessions: (exceptPaneId: string) => Promise<Set<string>> = NONE,
): SlashActions {
  return useMemo(
    () => slashActions(chatId, accountId, onError, liveSessions),
    [chatId, accountId, onError, liveSessions],
  );
}

/**
 * The same, outside a pane: the phone's /resume and /rewind (App's
 * `chatSessions`, `chatResume`…), with the desktop's rules. `from`: who asks
 * (`chatCommand`), the phone's never hands the chat back to the PC.
 */
export function slashActions(
  chatId: string,
  accountId: string | undefined,
  onError: (message: string) => void,
  liveSessions: (exceptPaneId: string) => Promise<Set<string>> = NONE,
  from: "desktop" | "phone" = "desktop",
): SlashActions {
  function ask(type: ListAnswer["type"]): Promise<ListAnswer> {
    return new Promise((resolve, reject) => {
      const requestId = `${type}:${Date.now()}:${Math.random()}`;
      const done = () => {
        window.clearTimeout(timer);
        off();
      };
      const timer = window.setTimeout(() => {
        done();
        reject(new Error("Le chat ne répond pas"));
      }, LIST_TIMEOUT_MS);
      const off = subscribeChat(chatId, (event) => {
        if (event.type !== "sessions" && event.type !== "rewind_points") return;
        if (event.requestId !== requestId) return;
        done();
        if (event.error) reject(new Error(event.error));
        else resolve(event);
      });
      chatCommand(accountId, { type, chatId, requestId }, from).catch(
        (e: unknown) => {
          done();
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }
  // Only Claude at rest: a relaunch ends its Claude Code, and with it a
  // turn, a request or a background task (as the switch to the terminal);
  // files restored under a working Claude would race its edits.
  const busy = () =>
    chatBusyReason(chatActivity(chatId), chatReplaying(chatId));
  let last: Promise<void> = Promise.resolve();
  const run = (command: Parameters<typeof chatCommand>[1]) => {
    const why = busy();
    if (why) return why;
    const sending = chatCommand(accountId, command, from);
    last = sending;
    sending.catch((e: unknown) => onError(String(e)));
    return null;
  };
  const lists = async () => {
    const [answer, live] = await Promise.all([
      ask("sessions"),
      liveSessions(chatId),
    ]);
    return {
      sessions: answer.type === "sessions" ? answer.sessions : [],
      live,
    };
  };
  return {
    sessions: async () => {
      const { sessions, live } = await lists();
      return markLive(sessions, live);
    },
    rewindPoints: () =>
      ask("rewind_points").then((e) =>
        e.type === "rewind_points" ? e.points : [],
      ),
    // The panel's list may date: a session may have opened elsewhere since.
    resume: async (sessionId, options) => {
      const why = busy();
      if (why) return why;
      const { sessions, live } = await lists();
      return (
        resumeRefusal(sessions, live, sessionId) ??
        run({
          type: "relaunch",
          chatId,
          resume: sessionId,
          ...(options?.whole ? { whole: true } : {}),
        })
      );
    },
    rewind: (point, mode) =>
      mode === "code"
        ? run({ type: "restore_code", chatId, before: point.uuid })
        : run({
            type: "relaunch",
            chatId,
            rewind: { before: point.uuid, code: mode === "both" },
          }),
    sent: () => last,
  };
}
