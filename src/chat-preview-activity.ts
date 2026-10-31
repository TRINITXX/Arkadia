import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";
import type { ShellOutput } from "@/lib/chat/useShellOutputs";
import activity from "../chat-server/fixtures/activity.jsonl?raw";

/**
 * The chat preview's live activity scenarios (`chat-preview.html?s=…`), from
 * a real recording (`record.ts activity`, 31/10/2026): a background shell,
 * two background subagents and a two-phase workflow at once.
 * - `activity`: up to the first of them ending: the agent cards, the
 *   workflow card (a click opens it), the shells chip with its output.
 * - `activity-done`: all ended: « Agents terminés (2) » opens the drawer,
 *   for 30 s after the page loads (`doneAgentsUntil`).
 * - `activity-resumed`: the session reopened while they ran: its subagent
 *   rows say « interrompu ».
 */

const all = activity
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as ChatEvent & { at?: number });

const live = all.filter((e) => e.type !== "history");

/** Up to the first end of a background task (shell, agent or workflow). */
function untilFirstEnd(): ChatEvent[] {
  const background = new Set<unknown>();
  const end = live.findIndex((e) => {
    if (e.type !== "sdk") return false;
    const m = e.message;
    if (
      m.subtype === "task_started" &&
      (m.is_backgrounded === true || m.task_type === "local_workflow")
    )
      background.add(m.task_id);
    // Its end: the notification, or the update just before it.
    const ended =
      m.subtype === "task_notification" ||
      (m.subtype === "task_updated" &&
        ["completed", "failed", "killed"].includes(
          String((m.patch as JsonObject | undefined)?.status),
        ));
    return ended && background.has(m.task_id);
  });
  return end < 0 ? live : live.slice(0, end);
}

/** The times an event carries: the server's stamp, a workflow agent's. */
const STAMPS = new Set([
  "at",
  "startedAt",
  "queuedAt",
  "lastProgressAt",
  "lastActivityAt",
]);

/** Replayed as if its last event were now: the cards' clocks run from there. */
function replayNow(events: (ChatEvent & { at?: number })[]): ChatState {
  const stamps = events.flatMap((e) =>
    typeof e.at === "number" ? [e.at] : [],
  );
  const shift = Date.now() - Math.max(...stamps, 0);
  return events.reduce(
    (s, e) =>
      reduceChat(
        s,
        JSON.parse(JSON.stringify(e), (key, value: unknown) =>
          STAMPS.has(key) && typeof value === "number" ? value + shift : value,
        ) as ChatEvent,
        Date.now(),
      ),
    EMPTY_CHAT,
  );
}

/** The session reopened before its agents ended: its past up to their notes. */
function resumed(): ChatState {
  const history = all.find((e) => e.type === "history");
  const messages = history?.type === "history" ? history.messages : [];
  const note = messages.findIndex((m: JsonObject) =>
    JSON.stringify(m.message ?? "").includes("<task-notification>"),
  );
  return reduceChat(
    EMPTY_CHAT,
    {
      type: "history",
      chatId: "preview",
      messages: note < 0 ? messages : messages.slice(0, note),
      truncated: false,
    },
    Date.now(),
  );
}

const replayAsIs = (events: ChatEvent[]) =>
  events.reduce((s, e) => reduceChat(s, e, Date.now()), EMPTY_CHAT);

/** `ago` seconds before now, as the server stamps its events. */
const sdkAt = (ago: number, message: JsonObject) =>
  ({
    type: "sdk",
    chatId: "preview",
    message,
    at: Date.now() - ago * 1000,
  }) as ChatEvent;

/** A turn under way: Claude's thinking ticks (`thinking`), then a long command (`tool-running`). */
function turnEvents(withTool: boolean): ChatEvent[] {
  const thinking = [120, 480, 1240].map((total, i, all) =>
    sdkAt(withTool ? 48 : 6 - i, {
      type: "system",
      subtype: "thinking_tokens",
      estimated_tokens: total,
      estimated_tokens_delta: total - (all[i - 1] ?? 0),
    }),
  );
  const events: ChatEvent[] = [
    {
      type: "user_sent",
      chatId: "preview",
      text: "Lance les tests et corrige ce qui casse.",
      images: 0,
      at: Date.now() - (withTool ? 50_000 : 8_000),
    } as ChatEvent,
    sdkAt(withTool ? 49 : 7, {
      type: "stream_event",
      api_message_id: "m1",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking" },
      },
    }),
    ...thinking,
  ];
  if (!withTool) return events;
  return [
    ...events,
    sdkAt(42, {
      type: "assistant",
      uuid: "a1",
      message: {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "bash1",
            name: "Bash",
            input: { command: "pnpm test --run" },
          },
        ],
      },
    }),
  ];
}

export function activityScenarios(): Record<string, () => ChatState> {
  return {
    activity: () => replayNow(untilFirstEnd()),
    "activity-done": () => replayNow(live),
    "activity-resumed": resumed,
    // Stamped `ago` already: replayed as they are.
    thinking: () => replayAsIs(turnEvents(false)),
    "tool-running": () => replayAsIs(turnEvents(true)),
  };
}

/** The shells' outputs the recording asked (`task_output`), the latest of each. */
export const PREVIEW_SHELL_OUTPUTS: Record<string, ShellOutput> =
  Object.fromEntries(
    live.flatMap((e) =>
      e.type === "task_output"
        ? [[e.taskId, { output: e.output, truncated: e.truncated }]]
        : [],
    ),
  );
