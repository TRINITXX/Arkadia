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
 * - `agent-live`: one background subagent at work (not recorded): its sheet.
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

/**
 * A background subagent at work: thinking then tool calls, eight times, no
 * sentence yet. Its pill opens its sheet, its whole conversation unfolded.
 */
function agentAtWork(): ChatEvent[] {
  const CALL = "agent-live";
  const prompt =
    "Review round 2 of the iPhone-Control fixes. Check each defect against the code before reporting it.\n\nReport: start with the count, then per bug `file:line`, a concrete failure scenario and its severity.";
  const sub = (type: "assistant" | "user", content: JsonObject[], i: number) =>
    sdkAt(60 - i, {
      type,
      uuid: `agent-live-${type}-${i}`,
      parent_tool_use_id: CALL,
      message: { id: `agent-live-m${i}`, content },
    });
  const steps: [string, string, JsonObject][] = [
    [
      "I'm starting with the diff of the fixes, to know which files the second round touched before reading any of them.",
      "Bash",
      {
        command: "git diff HEAD~3 --stat",
        description: "Lister les fichiers du lot",
      },
    ],
    [
      "serve() now wraps the session in try/finally. I'm reading it to see whether a cancel during unlock can skip the lock of the phone.",
      "Read",
      { file_path: "tools/iphone/serve.py" },
    ],
    [
      "The finally block awaits lock(). If the task is cancelled again there, the phone stays unlocked: I'm looking for a shield around it.",
      "Grep",
      { pattern: "asyncio.shield|CancelledError" },
    ],
    [
      "No shield, but run_script catches CancelledError and re-raises after cleanup, which covers it. Next, the unlock-failure counter.",
      "Read",
      { file_path: "tools/iphone/passcode.py" },
    ],
    [
      "I'm checking whether set-passcode resets the unlock-failures counter, since a stale count could block unlock after the owner changes the passcode.",
      "Grep",
      { pattern: "unlock_failures" },
    ],
    [
      "It doesn't, so the counter stays at 2 until the phone is unlocked by hand, and the tool's message covers that case.",
      "Read",
      { file_path: "tools/iphone/core_device/hid_service.py" },
    ],
    [
      "I'm checking whether an exception from tap_normalised could leak the passcode digit through a step error.",
      "Grep",
      { pattern: "raise .*coordinates|tap_normalised" },
    ],
    [
      "The keypad coordinates could reveal it if they show up in a message, so I'm going to look at whether send_touchscreen ever raises with coordinates in the text.",
      "Read",
      { file_path: "tools/iphone/core_device/touchscreen.py" },
    ],
  ];
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: "Relis les corrections du lot iPhone-Control.",
      images: 0,
      at: Date.now() - 70_000,
    } as ChatEvent,
    sdkAt(66, {
      type: "assistant",
      uuid: "agent-live-call",
      message: {
        id: "agent-live-main",
        content: [
          {
            type: "tool_use",
            id: CALL,
            name: "Agent",
            input: {
              description: "Review round 2 iPhone-Control fixes",
              prompt,
              run_in_background: true,
            },
          },
        ],
      },
    }),
    sdkAt(65, {
      type: "system",
      subtype: "task_started",
      task_id: "agent-live-task",
      tool_use_id: CALL,
      description: "Review round 2 iPhone-Control fixes",
      subagent_type: "general-purpose",
      is_backgrounded: true,
      task_type: "local_agent",
      prompt,
    }),
    ...steps.flatMap(([thought, name, input], i) => {
      const id = `agent-live-tool-${i}`;
      // Its last call still runs.
      const result =
        i === steps.length - 1
          ? []
          : [
              sub(
                "user",
                [{ type: "tool_result", tool_use_id: id, content: "ok" }],
                i * 6 + 4,
              ),
            ];
      return [
        sub("assistant", [{ type: "thinking", thinking: thought }], i * 6),
        sub("assistant", [{ type: "tool_use", id, name, input }], i * 6 + 2),
        ...result,
      ];
    }),
  ];
}

export function activityScenarios(): Record<string, () => ChatState> {
  return {
    activity: () => replayNow(untilFirstEnd()),
    "agent-live": () => replayAsIs(agentAtWork()),
    // A big fan-out: the agents' list scrolls, under an opaque line.
    "activity-crowded": () => crowded(replayNow(untilFirstEnd())),
    "activity-done": () => replayNow(live),
    "activity-resumed": resumed,
    // Stamped `ago` already: replayed as they are.
    thinking: () => replayAsIs(turnEvents(false)),
    "tool-running": () => replayAsIs(turnEvents(true)),
  };
}

/** The workflow given 40 more agents like its first, in its phase. */
function crowded(state: ChatState): ChatState {
  return {
    ...state,
    workflows: state.workflows.map((w) => {
      const first = w.agents[0];
      if (!first) return w;
      const more = Array.from({ length: 40 }, (_, i) => ({
        ...first,
        agentId: `${first.agentId}-${i}`,
        label: `${first.label}-${i + 1}`,
      }));
      return { ...w, agents: [...w.agents, ...more] };
    }),
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
