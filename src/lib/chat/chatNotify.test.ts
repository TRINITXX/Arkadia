import { describe, expect, it } from "vitest";
import { IDLE_CHAT, nextActivity } from "@/lib/chat/chatEvents";
import {
  chatRing,
  EMPTY_TRACK,
  FRESH_MS,
  isLiveEvent,
  isNoReplyText,
  stepChatNotify,
  type ChatSignal,
} from "@/lib/chat/chatNotify";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";

const NOW = 1_000_000;

const sdk = (message: JsonObject, at?: number): ChatEvent =>
  ({ type: "sdk", chatId: "c", message, at }) as ChatEvent;
const said = (text: string, extra: JsonObject = {}) =>
  sdk({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    ...extra,
  });
const toolCall = sdk({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: "t1", name: "Bash" }] },
});
const result = (extra: JsonObject = {}) =>
  sdk({ type: "result", subtype: "success", num_turns: 2, ...extra });
const sent = (uuid?: string): ChatEvent => ({
  type: "user_sent",
  chatId: "c",
  text: "fais X",
  images: 0,
  uuid,
});
/** A prompt the page doesn't show, as the server names it (`user_origin`). */
const origin = (
  kind: string | null,
  marks: { artifact?: boolean; idleNotice?: boolean } = {},
): ChatEvent => ({
  type: "user_origin",
  chatId: "c",
  kind,
  artifact: marks.artifact ?? false,
  idleNotice: marks.idleNotice ?? false,
});
const report = origin("task-notification");
const started = (id: string, taskType?: string) =>
  sdk({
    type: "system",
    subtype: "task_started",
    task_id: id,
    task_type: taskType,
  });
const taskDone = (id: string) =>
  sdk({ type: "system", subtype: "task_notification", task_id: id });
const permission = (toolName: string, requestId = "r1"): ChatEvent => ({
  type: "permission",
  chatId: "c",
  requestId,
  toolName,
  input: {},
  toolUseId: "t9",
});
const done = (selfWoken: boolean): ChatSignal => ({
  kind: "done",
  selfWoken,
  round: false,
});
const ask: ChatSignal = { kind: "question", selfWoken: false, round: false };

/** Folds events as the page does (activity first), live unless said. */
function run(events: ChatEvent[], { live = true, now = NOW } = {}) {
  let track = EMPTY_TRACK;
  let activity = IDLE_CHAT;
  const signals: ChatSignal[] = [];
  for (const event of events) {
    activity = nextActivity(activity, event);
    const next = stepChatNotify(track, event, activity, live, now);
    track = next.track;
    if (next.signal) signals.push(next.signal);
  }
  return { signals, track, activity };
}

describe("a turn's end", () => {
  it("notifies the end of a turn the user started", () => {
    expect(run([sent(), said("Fait."), result()]).signals).toEqual([
      done(false),
    ]);
  });

  it("marks only a turn Claude opened on its own self-woken, as the hook places them", () => {
    const second = (opener: ChatEvent[]) =>
      run([sent(), result(), ...opener, said("Suite."), result()]).signals[1];
    expect(second([report])).toEqual(done(true));
    expect(second([origin("task-notification", { artifact: true })])).toEqual(
      done(false),
    );
    expect(
      second([sdk({ type: "user", origin: { kind: "peer" }, message: {} })]),
    ).toEqual(done(true));
    expect(
      second([
        sdk({ type: "system", subtype: "scheduled_task_fire" }),
        origin(null),
      ]),
    ).toEqual(done(true));
    expect(second([origin(null, { idleNotice: true })])).toEqual(done(true));
    // Nothing tells who opened it: the user's.
    expect(second([])).toEqual(done(false));
    expect(second([origin("coordinator")])).toEqual(done(false));
  });

  it("answers a message sent mid-turn in the turn that takes it", () => {
    const lifecycle = (uuid: string) =>
      sdk({ type: "command_lifecycle", command_uuid: uuid, state: "started" });
    // Taken after the turn: the next turn is his.
    const after = run([
      sent(),
      sent("u2"),
      result(),
      report,
      lifecycle("u2"),
      said("Et Y."),
      result(),
    ]);
    expect(after.signals[1]).toEqual(done(false));
    // Taken mid-turn: the next turn is Claude's own again.
    const during = run([
      sent(),
      sent("u2"),
      lifecycle("u2"),
      result(),
      report,
      said("Rapport."),
      result(),
    ]);
    expect(during.signals[1]).toEqual(done(true));
  });

  it("counts an error, the usage limit or Claude Code gone mid-turn as an end, its opener kept", () => {
    expect(
      run([
        sent(),
        said("You've hit your limit", { error: "rate_limit" }),
        result({ subtype: "error_during_execution", is_error: true }),
      ]).signals,
    ).toEqual([done(false)]);
    const crash: ChatEvent = { type: "closed", chatId: "c", error: "crash" };
    expect(run([sent(), crash]).signals).toEqual([done(false)]);
    expect(
      run([sent(), result(), report, said("…"), crash]).signals[1],
    ).toEqual(done(true));
  });

  it("stays silent on an end the user caused, and on a local command's answer", () => {
    expect(
      run([
        sent(),
        said("Je comm"),
        result({ terminal_reason: "aborted_streaming" }),
      ]).signals,
    ).toEqual([]);
    expect(run([sent(), result({ num_turns: 0 })]).signals).toEqual([]);
  });
});

describe("Claude waiting on the user", () => {
  it("notifies a permission, AskUserQuestion or an MCP's request at once, background work or not", () => {
    const { signals } = run([
      sent(),
      started("a1"),
      permission("AskUserQuestion"),
      {
        type: "elicitation",
        chatId: "c",
        requestId: "e1",
        request: { serverName: "x", message: "?" },
      } as ChatEvent,
    ]);
    expect(signals).toEqual([ask, ask]);
  });

  it("notifies a ❓ round in the turn's last words as a question that counts as an end", () => {
    const round =
      "Deux points.\n\n❓ **Q1** - **Couleur** : laquelle ?\n➡️ Vert";
    expect(run([sent(), said(round), toolCall, result()]).signals).toEqual([
      { kind: "question", selfWoken: false, round: true },
    ]);
  });
});

describe("silences", () => {
  it("waits for the last background subagent, then notifies once", () => {
    const { signals } = run([
      sent(),
      started("a1"),
      said("Agent lancé."),
      result(),
      taskDone("a1"),
      report,
      said("Tout est prêt."),
      result(),
    ]);
    expect(signals).toEqual([done(true)]);
  });

  it("never waits on a background shell", () => {
    expect(
      run([
        sent(),
        started("b1", "local_bash"),
        said("Serveur lancé."),
        result(),
      ]).signals,
    ).toEqual([done(false)]);
  });

  it("waits on a non-persistent Monitor until its timeout, never on a persistent one", () => {
    const monitor = (persistent: boolean) => [
      started("m1", "monitor"),
      sdk(
        {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "t2" }] },
          tool_use_result: { taskId: "m1", timeoutMs: 60_000, persistent },
        },
        NOW,
      ),
      said("Je surveille."),
      result(),
    ];
    expect(run([sent(), ...monitor(false)]).signals).toEqual([]);
    expect(
      run([sent(), ...monitor(false)], { now: NOW + 61_000 }).signals,
    ).toEqual([done(false)]);
    expect(run([sent(), ...monitor(true)]).signals).toEqual([done(false)]);
  });

  it("keeps a turn that asks nothing silent, unless background work was silenced before it", () => {
    expect(
      run([sent(), said("No response requested."), result()]).signals,
    ).toEqual([]);
    expect(
      run([sent(), said("Rien à faire.\n`⏳`"), result()]).signals,
    ).toEqual([]);
    const late = run([
      sent(),
      started("a1"),
      said("Agent lancé."),
      result(),
      taskDone("a1"),
      report,
      said("⏳"),
      result(),
    ]);
    expect(late.signals).toEqual([done(true)]);
  });

  it("reads « nothing for the user » as the hook does", () => {
    expect(isNoReplyText("  no response requested  ")).toBe(true);
    expect(isNoReplyText("J'attends l'agent.\n⏳️")).toBe(true);
    expect(isNoReplyText("⏳ j'attends")).toBe(false);
    expect(isNoReplyText(null)).toBe(false);
  });
});

describe("replayed history", () => {
  it("folds a replay without notifying anything", () => {
    const round = "❓ **Q1** - **Couleur** : laquelle ?";
    const { signals, track } = run(
      [sent(), said(round), result(), permission("Bash")],
      { live: false },
    );
    expect(signals).toEqual([]);
    expect(track.roundPending).toBe(true);
  });

  it("takes only events of now: none inside a replay, none stamped long ago", () => {
    const at = (ms: number) => ({ ...result(), at: ms }) as ChatEvent;
    expect(isLiveEvent(at(NOW - 1000), false, NOW)).toBe(true);
    expect(isLiveEvent(at(NOW - 1000), true, NOW)).toBe(false);
    expect(isLiveEvent(at(NOW - FRESH_MS - 1), false, NOW)).toBe(false);
    expect(isLiveEvent({ type: "attached", chatId: "c" }, false, NOW)).toBe(
      false,
    );
  });
});

describe("chatRing", () => {
  it("rings blue for a background shell, green while a ❓ round or an AskUserQuestion waits", () => {
    const shell = run([
      sent(),
      started("b1", "local_bash"),
      said("ok"),
      result(),
    ]);
    expect(chatRing(shell.track, shell.activity)).toMatchObject({
      shells: 1,
      question: false,
    });
    const asked = run([sent(), permission("AskUserQuestion")]);
    expect(chatRing(asked.track, asked.activity).question).toBe(true);
    const plain = run([sent(), permission("Bash")]);
    expect(chatRing(plain.track, plain.activity).question).toBe(false);
    const round = run([sent(), said("❓ **Q1** - Couleur ?"), result()]);
    expect(chatRing(round.track, round.activity).question).toBe(true);
    const answered = run([
      sent(),
      said("❓ **Q1** - Couleur ?"),
      result(),
      sent(),
    ]);
    expect(chatRing(answered.track, answered.activity).question).toBe(false);
  });

  it("rings for a resumed session's unanswered round, not an answered one", () => {
    const history = (messages: JsonObject[]): ChatEvent => ({
      type: "history",
      chatId: "c",
      messages,
      truncated: false,
    });
    const asked = {
      type: "assistant",
      message: { content: [{ type: "text", text: "❓ **Q1** - Couleur ?" }] },
    };
    const open = run([history([asked])]);
    expect(chatRing(open.track, open.activity).question).toBe(true);
    const answered = run([
      history([asked, { type: "user", message: { content: "Vert" } }]),
    ]);
    expect(chatRing(answered.track, answered.activity).question).toBe(false);
  });
});
