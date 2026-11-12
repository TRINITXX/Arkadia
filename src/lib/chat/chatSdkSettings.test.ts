import { describe, expect, it } from "vitest";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import {
  compactTokens,
  contextBreakdown,
  currentChoice,
  effortChoices,
  latestModels,
  mcpFailed,
  mergeMcp,
  modelChoices,
  parseSavedModels,
  sessionChoice,
} from "@/lib/chat/chatSdkSettings";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";
import { slowHook } from "@/lib/chat/useRunningHook";

const ALL = ["low", "medium", "high", "xhigh", "max"];

/** `supportedModels()` of Claude Code 2.1.314, live check of 31/10/2026 (cut). */
const MODELS: JsonObject[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    supportedEffortLevels: ALL,
    supportsFastMode: true,
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus 5.5",
    supportedEffortLevels: ALL,
    supportsFastMode: true,
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Opus 5.5 (1M context)",
    supportedEffortLevels: ALL,
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-5-5",
    displayName: "Haiku 5.5",
    supportedEffortLevels: ALL,
  },
  {
    value: "claude-haiku-4-5-20251001",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku 4.5",
  },
  {
    value: "claude-opus-4-6",
    resolvedModel: "claude-opus-4-6",
    displayName: "Opus 4.6",
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
];

const run = (events: ChatEvent[], from: ChatState = EMPTY_CHAT) =>
  events.reduce((s, e, i) => reduceChat(s, e, 1_000 + i), from);
const sdk = (message: JsonObject): ChatEvent => ({
  type: "sdk",
  chatId: "c",
  message,
});

describe("model menu", () => {
  it("labels Claude Code's list short, the default row naming its model", () => {
    const labels = modelChoices(MODELS).map((m) => m.label);
    expect(labels).toEqual([
      "Par défaut · Opus 5.5",
      "Opus 5.5",
      "Opus 5.5 · 1M",
      "Haiku 5.5",
      "Haiku 4.5",
      "Opus 4.6",
    ]);
  });

  it("shows only the latest version of each family", () => {
    const rows = latestModels(
      modelChoices([
        ...MODELS,
        {
          value: "claude-sonnet-5",
          resolvedModel: "claude-sonnet-5",
          displayName: "Sonnet 5",
        },
        {
          value: "sonnet",
          resolvedModel: "claude-sonnet-5-5",
          displayName: "Sonnet 5.5",
        },
        {
          value: "fable",
          resolvedModel: "claude-fable-5-2",
          displayName: "Fable 5.2",
        },
        {
          value: "claude-fable-5-1",
          resolvedModel: "claude-fable-5-1",
          displayName: "Fable 5.1",
        },
        { value: "custom", resolvedModel: "custom", displayName: "Custom" },
      ]),
    );
    // Fable first, then Opus, Sonnet, Haiku: not Claude Code's order.
    expect(rows.map((m) => m.value)).toEqual([
      "fable",
      "opus",
      "opus[1m]",
      "sonnet",
      "haiku",
      "custom",
    ]);
  });

  it("finds the session's model by its id, the wide window apart", () => {
    const models = modelChoices(MODELS);
    expect(currentChoice(models, "claude-opus-5-5")?.value).toBe("opus");
    expect(currentChoice(models, "claude-opus-5-5[1m]")?.value).toBe(
      "opus[1m]",
    );
    expect(currentChoice(models, "haiku")?.value).toBe("haiku");
  });

  it("offers the efforts the model takes, none for a model without", () => {
    const models = modelChoices(MODELS);
    const efforts = (model: string) =>
      effortChoices({ models, model, effort: "medium" });
    expect(efforts("claude-haiku-4-5-20251001")).toEqual([]);
    expect(efforts("claude-opus-4-6")).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    // A model the list lacks: all of them while an effort is reported.
    expect(efforts("claude-unknown-9")).toEqual(ALL);
  });

  it("names, before Claude Code does, the model « Par défaut » runs", () => {
    const models = modelChoices(MODELS);
    // A chat asleep since it opened: its efforts can be picked too.
    expect(sessionChoice(models, null)?.value).toBe("opus");
    expect(effortChoices({ models, model: null, effort: null })).toEqual(ALL);
    expect(sessionChoice([], null)).toBeUndefined();
  });

  it("shows a model picked in the menu at once, the turn's init after", () => {
    const picked = run([{ type: "info", chatId: "c", model: "haiku" }], {
      ...EMPTY_CHAT,
      model: "claude-opus-5-5",
    });
    expect(currentChoice(modelChoices(MODELS), picked.model)?.value).toBe(
      "haiku",
    );
    const after = run(
      [sdk({ type: "system", subtype: "init", model: "claude-haiku-5-5" })],
      picked,
    );
    expect(after.model).toBe("claude-haiku-5-5");
  });

  it("reads back a kept menu, dropping what isn't a row", () => {
    const models = modelChoices(MODELS);
    expect(parseSavedModels(JSON.stringify(models))).toEqual(models);
    expect(
      parseSavedModels(
        JSON.stringify([{ value: "x" }, { ...models[1], efforts: ["huge"] }]),
      ),
    ).toEqual([{ ...models[1], efforts: [] }]);
    expect(parseSavedModels("{oops")).toEqual([]);
    expect(parseSavedModels(null)).toEqual([]);
  });
});

describe("MCP servers", () => {
  it("counts the failed only: a connector to sign in to is no failure", () => {
    expect(
      mcpFailed([
        { name: "a", status: "failed" },
        { name: "claude.ai Gmail", status: "needs-auth" },
        { name: "b", status: "connected" },
      ]).map((s) => s.name),
    ).toEqual(["a"]);
  });

  it("keeps the last failure's reason over a turn's init, which has none", () => {
    const prev = [
      { name: "broken", status: "failed", error: "Connection closed" },
    ];
    expect(mergeMcp(prev, [{ name: "broken", status: "failed" }])).toEqual(
      prev,
    );
    expect(mergeMcp(prev, [{ name: "broken", status: "connected" }])).toEqual([
      { name: "broken", status: "connected" },
    ]);
  });

  it("takes init's states into the chat", () => {
    const state = run([
      sdk({
        type: "system",
        subtype: "init",
        mcp_servers: [
          { name: "broken-test", status: "failed", source: "dynamic" },
        ],
        fast_mode_state: "on",
      }),
    ]);
    expect(state.sdk.mcpServers).toEqual([
      {
        name: "broken-test",
        status: "failed",
        source: "dynamic",
        error: undefined,
      },
    ]);
    expect(state.sdk.fastMode).toBe("on");
  });
});

describe("context breakdown", () => {
  it("groups /context's rows, leaves deferred tools out, reserve and free last", () => {
    // `getContextUsage({ detail: 'full' })`, live check of 31/10/2026.
    const rows = contextBreakdown({
      totalTokens: 27_257,
      rawMaxTokens: 1_000_000,
      memoryFiles: [],
      categories: [
        {
          id: "system_prompt",
          name: "System prompt",
          tokens: 142,
          kind: "used",
        },
        {
          id: "system_tools",
          name: "System tools",
          tokens: 3611,
          kind: "used",
        },
        { id: "mcp_tools", name: "MCP tools", tokens: 609, kind: "used" },
        {
          id: "mcp_tools_deferred",
          name: "MCP tools (deferred)",
          tokens: 51_294,
          kind: "deferred",
        },
        {
          id: "memory_files",
          name: "Memory files",
          tokens: 10_090,
          kind: "used",
        },
        { id: "messages", name: "Messages", tokens: 91, kind: "used" },
        {
          id: "autocompact_buffer",
          name: "Autocompact buffer",
          tokens: 33_000,
          kind: "buffer",
        },
        { id: "free_space", name: "Free space", tokens: 939_743, kind: "free" },
      ],
    });
    expect(rows.map((r) => [r.label, r.tokens])).toEqual([
      ["Système et outils", 3753],
      ["Outils MCP", 609],
      ["Fichiers mémoire", 10_090],
      ["Messages", 91],
      ["Réserve de compaction", 33_000],
      ["Libre", 939_743],
    ]);
    expect(rows[2].share).toBeCloseTo(0.01009);
  });

  it("says tokens short", () => {
    expect([820, 27_257, 312_000, 1_000_000].map(compactTokens)).toEqual([
      "820",
      "27,3 k",
      "312 k",
      "1 M",
    ]);
  });
});

describe("plugins and hooks", () => {
  const init = (errors: JsonObject[]) =>
    sdk({ type: "system", subtype: "init", plugin_errors: errors });
  const missing = {
    plugin: "inline[0]",
    type: "path-not-found",
    message: "Path not found: C:\\nonexistent",
    path: "C:\\nonexistent",
  };

  it("says plugins that failed once, with « Recharger », though each turn repeats them", () => {
    const state = run([init([missing]), init([missing])]);
    const notices = state.items.filter((x) => x.kind === "notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      text: "Plugin non chargé : C:\\nonexistent (dossier introuvable)",
      tone: "error",
      action: "reload_plugins",
    });
  });

  it("follows a hook from start to end, a failure as a notice", () => {
    const started = run([
      sdk({
        type: "system",
        subtype: "hook_started",
        hook_id: "h1",
        hook_name: "PreToolUse:Bash",
      }),
    ]);
    expect(started.sdk.hooks.map((h) => h.name)).toEqual(["PreToolUse:Bash"]);
    const failed = run(
      [
        sdk({
          type: "system",
          subtype: "hook_response",
          hook_id: "h1",
          hook_name: "PreToolUse:Bash",
          outcome: "error",
          exit_code: 1,
          stderr: "lint.ps1 introuvable\n",
        }),
      ],
      started,
    );
    expect(failed.sdk.hooks).toEqual([]);
    expect(failed.items.at(-1)).toMatchObject({
      kind: "notice",
      text: "Hook PreToolUse:Bash en échec (code 1)",
      detail: "lint.ps1 introuvable",
    });
  });

  it("names in the live line only a hook that lasts", () => {
    const hooks = [{ id: "h1", name: "Stop", startedAt: 1_000 }];
    expect(slowHook(hooks, 1_500)).toBeNull();
    expect(slowHook(hooks, 2_000)).toBe("Stop");
  });
});

describe("queued message withdrawn", () => {
  const working = run([
    { type: "user_sent", chatId: "c", text: "un", images: 0, uuid: "u1" },
    { type: "user_sent", chatId: "c", text: "deux", images: 0, uuid: "u2" },
  ]);
  const item = (s: ChatState) => s.items.find((x) => x.id === "sent:u2");

  it("leaves the column after Claude Code's « cancelled », never as taken", () => {
    expect(item(working)).toMatchObject({ queued: true });
    // The order of the live check: the lifecycle frame, then the answer.
    const removed = run(
      [
        sdk({
          type: "command_lifecycle",
          command_uuid: "u2",
          state: "cancelled",
        }),
        { type: "queued_removed", chatId: "c", uuid: "u2" },
      ],
      working,
    );
    expect(item(removed)).toBeUndefined();
    expect(removed.items.find((x) => x.id === "sent:u1")).toBeDefined();
  });

  it("leaves a message Claude already took as taken", () => {
    const taken = run(
      [
        sdk({
          type: "command_lifecycle",
          command_uuid: "u2",
          state: "started",
        }),
        { type: "queued_removed", chatId: "c", uuid: "u2" },
      ],
      working,
    );
    expect(item(taken)).toMatchObject({ queued: false });
    expect(item(taken)).not.toHaveProperty("dropped");
  });
});

describe("MCP requests", () => {
  it("wait in the chat until answered, and go with the chat", () => {
    const asked = run([
      {
        type: "elicitation",
        chatId: "c",
        requestId: "r1",
        request: {
          serverName: "elicit-test",
          message: "Ton nom ?",
          mode: "form",
        },
      },
    ]);
    expect(asked.sdk.elicitations.map((e) => e.requestId)).toEqual(["r1"]);
    expect(
      run(
        [{ type: "elicitation_resolved", chatId: "c", requestId: "r1" }],
        asked,
      ).sdk.elicitations,
    ).toEqual([]);
    expect(
      run([{ type: "closed", chatId: "c" }], asked).sdk.elicitations,
    ).toEqual([]);
  });
});
