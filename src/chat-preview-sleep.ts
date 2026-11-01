import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { cutTurn, reduceChat, type ChatState } from "@/lib/chat/chatState";

/**
 * The chat preview's scenarios of the chats at rest (`chat-preview.html?s=…`):
 * - `asleep`: Claude Code sleeps, the conversation stays, the empty input
 *   says a key wakes it.
 * - `bash`: `!` commands in the column: done, failed, cut for Claude, and
 *   one running (`&draft=!git log` puts the input in shell mode).
 * - `restarted`: the server stopped mid-turn and the chat resumed by itself.
 */

const fold = (state: ChatState, events: ChatEvent[]): ChatState =>
  events.reduce((s, e) => reduceChat(s, e, Date.now()), state);

const chatId = "preview";

/** A command and its end, as the server sends them. */
function bash(
  id: string,
  command: string,
  end: Partial<Extract<ChatEvent, { type: "bash" }>> | null,
  live: [stream: "stdout" | "stderr", text: string][] = [],
): ChatEvent[] {
  return [
    { type: "bash", chatId, id, command, state: "running" },
    ...live.map(
      ([stream, text]): ChatEvent => ({
        type: "bash_output",
        chatId,
        id,
        stream,
        text,
      }),
    ),
    ...(end
      ? [
          {
            type: "bash",
            chatId,
            id,
            command,
            state: "done",
            ...end,
          } as ChatEvent,
        ]
      : []),
  ];
}

const STATUS = [
  "On branch master-lab",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  "\tmodified:   chat-server/server.ts",
  "\tmodified:   src/lib/chat/chatState.ts",
  "",
  "Untracked files:",
  "\tchat-server/sleep.ts",
  "",
].join("\n");

const FAILED = [
  " FAIL  src/lib/chat/chatSleep.test.ts > the stored delay",
  "AssertionError: expected 1800000 to be 900000",
  " Test Files  1 failed | 96 passed (97)",
].join("\n");

const LOG_LINE = "2026-11-01 09:14:03 INFO  sync: 412 rows in 38 ms\n";

function bashEvents(): ChatEvent[] {
  const big = LOG_LINE.repeat(12);
  return [
    ...bash("b1", "git status", {
      stdout: STATUS,
      code: 0,
      sent: STATUS.length,
      total: STATUS.length,
    }),
    ...bash("b2", "pnpm vitest run src/lib/chat/chatSleep.test.ts", {
      stdout: "",
      stderr: FAILED,
      code: 1,
      sent: FAILED.length,
      total: FAILED.length,
    }),
    ...bash("b3", "cat logs/sync.log", {
      stdout: `${big}\n… [182 345 characters cut] …\n${big}`,
      code: 0,
      sent: 30_000,
      total: 212_345,
    }),
    ...bash("b4", "ping -n 30 127.0.0.1", null, [
      [
        "stdout",
        "\nEnvoi d'une requête 'Ping'  127.0.0.1 avec 32 octets de données :\n",
      ],
      [
        "stdout",
        "Réponse de 127.0.0.1 : octets=32 temps<1ms TTL=128\n".repeat(4),
      ],
    ]),
  ];
}

export function sleepScenarios(
  tools: () => ChatState,
  live: () => ChatState,
): Record<string, () => ChatState> {
  return {
    asleep: () => fold(tools(), [{ type: "asleep", chatId }]),
    bash: () => fold(tools(), bashEvents()),
    restarted: () =>
      fold(cutTurn(live(), Date.now()), [
        {
          type: "notice",
          chatId,
          text: "Claude Code a redémarré : le tour en cours a été coupé.",
          tone: "error",
        },
      ]),
  };
}
