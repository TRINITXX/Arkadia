import { describe, expect, it } from "vitest";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import {
  EMPTY_CHAT,
  reduceChat,
  type ChatItem,
  type ChatState,
} from "@/lib/chat/chatState";

/** SDK messages as the chat server relays them (shapes of live runs, 31/10/2026). */
const sdk = (message: JsonObject): ChatEvent => ({
  type: "sdk",
  chatId: "t",
  message,
});

function run(events: ChatEvent[], from: ChatState = EMPTY_CHAT): ChatState {
  return events.reduce((s, e, i) => reduceChat(s, e, 1_000 + i * 10), from);
}

const notices = (state: ChatState) =>
  state.items.filter(
    (i): i is Extract<ChatItem, { kind: "notice" }> => i.kind === "notice",
  );

const warning = (threshold: number) =>
  sdk({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      rateLimitType: "five_hour",
      unifiedWindows: {
        five_hour: {
          utilization: threshold + 0.01,
          resetsAt: 1_793_424_000,
          status: "allowed_warning",
          surpassedThreshold: threshold,
        },
      },
    },
  });

describe("Claude Code's notices in the column", () => {
  it("says nothing of a quota threshold: the rings show it", () => {
    const state = run([warning(0.9), warning(0.9)]);
    expect(notices(state)).toEqual([]);
  });

  it("says nothing of a refused call: its tool counts in error", () => {
    const state = run([
      sdk({
        type: "assistant",
        uuid: "a1",
        message: {
          id: "m1",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Bash",
              input: {
                command: "mkdir sous-dossier",
                description: "Create subfolder",
              },
            },
          ],
        },
      }),
      sdk({
        type: "system",
        subtype: "permission_denied",
        tool_name: "Bash",
        tool_use_id: "toolu_1",
        decision_reason_type: "mode",
        message:
          "Permission to use Bash has been denied because Claude Code is running in don't ask mode. IMPORTANT: …",
      }),
    ]);
    expect(notices(state)).toEqual([]);
  });

  it("says a hook blocked the message, with its reason", () => {
    const state = run([
      sdk({
        type: "system",
        subtype: "informational",
        uuid: "i1",
        level: "warning",
        prevent_continuation: true,
        content:
          "UserPromptSubmit operation blocked by hook:\nBloqué par le hook de test\n\nOriginal prompt: Dis OK.",
        prompt_submit_outcome: {
          kind: "blocked_by_hook",
          prompt_kept: false,
          reason: "Bloqué par le hook de test",
        },
      }),
    ]);
    expect(notices(state)).toMatchObject([
      {
        text: "Message bloqué par un hook, il n'est pas parti",
        detail: "Bloqué par le hook de test",
        tone: "warning",
      },
    ]);
  });

  it("keeps one notification per key, without the terminal's key hint", () => {
    const notification = (text: string) =>
      sdk({
        type: "system",
        subtype: "notification",
        key: "ide",
        text,
        priority: "low",
      });
    const state = run([
      notification("IDE disconnected · ctrl+o to see"),
      notification("IDE disconnected · ctrl+o to see"),
      notification("IDE connected"),
    ]);
    expect(notices(state).map((n) => n.text)).toEqual(["IDE connected"]);
  });

  it("says an automatic compaction's figures, and a failed one", () => {
    const state = run([
      sdk({
        type: "system",
        subtype: "compact_boundary",
        uuid: "c1",
        compact_metadata: {
          trigger: "auto",
          pre_tokens: 180_400,
          post_tokens: 32_100,
        },
      }),
      sdk({
        type: "system",
        subtype: "status",
        uuid: "s1",
        status: null,
        compact_result: "failed",
        compact_error: "Not enough messages to compact.",
      }),
    ]);
    expect(notices(state).map((n) => [n.text, n.tone])).toEqual([
      ["Compacté automatiquement · 180 k → 32 k tokens", "info"],
      ["La compaction a échoué : la conversation reste entière", "error"],
    ]);
  });

  it("fills no command card with its own compaction's end, and adds no turn line", () => {
    const state = run([
      sdk({ type: "system", subtype: "init", uuid: "i1", slash_commands: ["usage"] }),
      { type: "user_sent", chatId: "c", text: "/usage", images: 0, uuid: "u1" },
      sdk({ type: "result", subtype: "success", uuid: "r1", num_turns: 0, duration_ms: 90_000, result: "", autoCompact: "turn" }),
    ]);
    const card = state.items.find((x) => x.kind === "command");
    expect(card?.kind === "command" && card.output).toBeUndefined();
    expect(state.items.some((x) => x.kind === "turn")).toBe(false);
  });

  it("says who compacted when the chat server did", () => {
    const boundary = (autoCompact: string, uuid: string) =>
      sdk({
        type: "system",
        subtype: "compact_boundary",
        uuid,
        autoCompact,
        compact_metadata: { trigger: "manual", pre_tokens: 812_000, post_tokens: 31_000 },
      });
    expect(notices(run([boundary("turn", "c1"), boundary("idle", "c2")])).map((n) => n.text)).toEqual([
      "Compacté en fin de tour · 812 k → 31 k tokens",
      "Compacté en veille · 812 k → 31 k tokens",
    ]);
  });
});

describe("Claude Code's turn around the column", () => {
  it("keeps the suggestion for the next message until something is sent", () => {
    const suggested = run([
      sdk({ type: "prompt_suggestion", suggestion: "Écris le script complet" }),
    ]);
    expect(suggested.suggestion).toBe("Écris le script complet");
    const sent = reduceChat(
      suggested,
      { type: "user_sent", chatId: "t", text: "Autre chose", images: 0 },
      2_000,
    );
    expect(sent.suggestion).toBeNull();
  });

  it("holds a retry until the reply streams, and marks a reply cut by Esc", () => {
    const retrying = run([
      sdk({
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 581,
        error_status: null,
        error: "unknown",
      }),
    ]);
    expect(retrying.retry).toMatchObject({ attempt: 1, cause: "connexion" });
    const cut = run(
      [
        sdk({
          type: "stream_event",
          api_message_id: "m1",
          event: { type: "message_start" },
        }),
        sdk({
          type: "assistant",
          uuid: "a1",
          aborted: true,
          message: {
            id: "m1",
            content: [{ type: "text", text: "La mer s'éveille" }],
          },
        }),
        sdk({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          terminal_reason: "aborted_streaming",
          uuid: "r1",
        }),
      ],
      retrying,
    );
    expect(cut.retry).toBeNull();
    expect(cut.items.find((i) => i.kind === "text")).toMatchObject({
      aborted: true,
    });
    expect(notices(cut).map((n) => n.text)).toEqual(["Tour interrompu"]);
  });

  it("says « Tour interrompu » for an Esc while a Stop hook runs", () => {
    // Live run of 31/10/2026: the reply is in, a Stop hook runs, Esc.
    const reply = sdk({
      type: "assistant",
      uuid: "a1",
      message: { id: "m1", content: [{ type: "text", text: "ok" }] },
    });
    const stopped = (extra: ChatEvent[]) =>
      run([
        reply,
        ...extra,
        sdk({
          type: "result",
          subtype: "success",
          is_error: false,
          terminal_reason: "stop_hook_prevented",
          uuid: "r1",
        }),
      ]);
    const esc = stopped([
      sdk({
        type: "user",
        uuid: "u2",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user]" }],
        },
      }),
    ]);
    expect(notices(esc).map((n) => n.text)).toEqual(["Tour interrompu"]);
    // The hook's own stop says so, and the next turn starts clean.
    expect(notices(stopped([])).map((n) => n.text)).toEqual([
      "Claude arrêté par un hook Stop",
    ]);
    expect(esc.interrupted).toBe(false);
  });

  it("hides Claude Code's stand-in reply « No response requested. »", () => {
    const state = run([
      sdk({
        type: "assistant",
        uuid: "a1",
        message: {
          id: "m1",
          model: "<synthetic>",
          content: [{ type: "text", text: "No response requested." }],
        },
      }),
    ]);
    expect(state.items.filter((i) => i.kind === "text")).toEqual([]);
  });

  it("gives a tool call its structured result: a command's streams apart", () => {
    const state = run([
      sdk({
        type: "assistant",
        uuid: "a1",
        message: {
          id: "m1",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Bash",
              input: { command: "x" },
            },
          ],
        },
      }),
      sdk({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "sortie\nattention",
            },
          ],
        },
        tool_use_result: {
          stdout: "sortie",
          stderr: "attention",
          interrupted: false,
        },
      }),
    ]);
    const tool = state.items.find((i) => i.kind === "tool");
    expect(tool?.kind === "tool" && tool.result?.detail?.shell).toMatchObject({
      stdout: "sortie",
      stderr: "attention",
    });
  });
});
