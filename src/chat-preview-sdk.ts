import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { reduceChat, type ChatState } from "@/lib/chat/chatState";
import type { ChatSdkActions } from "@/lib/chat/useChatSdkActions";

/**
 * The chat preview's SDK settings scenarios (`chat-preview.html?s=…`): the
 * model and effort chips, fast mode, the MCP chip, a hook running, plugins
 * that failed, an MCP form and sign-in, a cautious permission, a queued
 * message withdrawn. Their figures come from the live checks of 31/10/2026.
 */

const ALL = ["low", "medium", "high", "xhigh", "max"];

const MODELS: JsonObject[] = [
  ["default", "claude-opus-5-5", "Default (recommended)", ALL],
  ["opus", "claude-opus-5-5", "Opus 5.5", ALL],
  ["opus[1m]", "claude-opus-5-5[1m]", "Opus 5.5 (1M context)", ALL],
  ["fable", "claude-fable-5-2", "Fable 5.2", ALL],
  ["sonnet", "claude-sonnet-5-5", "Sonnet 5.5", ALL],
  ["haiku", "claude-haiku-5-5", "Haiku 5.5", ALL],
  ["claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001", "Haiku 4.5", []],
  ["claude-opus-4-8", "claude-opus-4-8", "Opus 4.8", ALL],
  [
    "claude-opus-4-6",
    "claude-opus-4-6",
    "Opus 4.6",
    ["low", "medium", "high", "max"],
  ],
].map(([value, resolvedModel, displayName, levels]) => ({
  value,
  resolvedModel,
  displayName,
  supportedEffortLevels: levels,
}));

const MCP = [
  {
    name: "broken-test",
    status: "failed",
    error: "Connection closed",
    source: "project",
  },
  {
    name: "plugin:chrome-devtools-mcp:chrome-devtools",
    status: "failed",
    error: "spawn npx ENOENT",
    source: "plugin",
  },
  { name: "cloudflare", status: "needs-auth", source: "user" },
  { name: "claude.ai Notion", status: "needs-auth", source: "claudeai" },
  { name: "sentry", status: "disabled", source: "user" },
  { name: "exa", status: "connected", source: "user" },
  { name: "playwright", status: "pending", source: "user" },
  { name: "claude.ai Gmail", status: "connected", source: "claudeai" },
];

const ev = (type: string, rest: JsonObject = {}) =>
  ({ type, chatId: "preview", ...rest }) as ChatEvent;
const sdk = (message: JsonObject) => ev("sdk", { message });

function apply(state: ChatState, events: ChatEvent[], at = Date.now()) {
  return events.reduce((s, e) => reduceChat(s, e, at), state);
}

/** Effort, fast mode, two MCP servers failed, a slow hook, a plugin missing. */
function settings(base: ChatState): ChatState {
  const state = apply(base, [
    ev("models", { models: MODELS }),
    ev("effort", { effort: "high" }),
    sdk({
      type: "system",
      subtype: "init",
      model: "claude-opus-5-5",
      fast_mode_state: "on",
      mcp_servers: MCP.map(({ name, status, source }) => ({
        name,
        status,
        source,
      })),
      plugin_errors: [
        {
          plugin: "inline[0]",
          type: "path-not-found",
          message: "Path not found: C:\\plugins\\mon-plugin",
          path: "C:\\plugins\\mon-plugin",
        },
      ],
    }),
    ev("mcp", { servers: MCP }),
  ]);
  // Started 5 s ago: long enough for the live line.
  return apply(
    state,
    [
      sdk({
        type: "system",
        subtype: "hook_started",
        hook_id: "h1",
        hook_name: "PostToolUse:Edit",
      }),
    ],
    Date.now() - 5_000,
  );
}

/** The test MCP server's form, as Claude Code passed it. */
function elicitForm(base: ChatState): ChatState {
  return apply(base, [
    ev("elicitation", {
      requestId: "e1",
      request: {
        serverName: "elicit-test",
        message: "Ton nom et ton âge, pour le test ?",
        mode: "form",
        requestedSchema: {
          type: "object",
          properties: {
            name: { type: "string", title: "Nom", description: "Ton prénom" },
            age: { type: "integer", title: "Âge", minimum: 0, maximum: 150 },
            plan: {
              type: "string",
              title: "Formule",
              enum: ["free", "pro"],
              enumNames: ["Gratuite", "Pro"],
            },
            newsletter: {
              type: "boolean",
              title: "Recevoir la lettre",
              default: false,
            },
          },
          required: ["name"],
        },
      },
    }),
  ]);
}

function elicitUrl(base: ChatState): ChatState {
  return apply(base, [
    ev("elicitation", {
      requestId: "e2",
      request: {
        serverName: "plugin:context7:context7",
        message: "Connecte-toi à Context7 pour continuer",
        mode: "url",
        url: "https://context7.com/oauth/authorize?client=claude-code&state=f3a9",
        elicitationId: "elic-1",
      },
    }),
  ]);
}

/** A subagent's `rm -rf` outside what it may touch: Refuser first, no « always ». */
function cautious(base: ChatState): ChatState {
  const agent = base.subagents[0];
  return {
    ...base,
    requests: [
      {
        requestId: "p2",
        toolName: "Bash",
        toolUseId: "p2",
        input: {
          command: "rm -rf ./build",
          description: "Supprimer le dossier build",
        },
        description: "Supprimer le dossier build",
        displayName: "Bash",
        defaultToNo: true,
        suppressAlwaysAllowRule: true,
        agentId: agent?.taskId,
        blockedPath:
          "C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia-lab\\build",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "rm -rf ./build" }],
            behavior: "allow",
            destination: "localSettings",
          },
        ],
      },
    ],
  };
}

/** The queued message withdrawn: Claude Code's « cancelled », then ours. */
function removed(queued: ChatState): ChatState {
  return apply(queued, [
    sdk({
      type: "command_lifecycle",
      command_uuid: "preview-queued",
      state: "cancelled",
    }),
    ev("queued_removed", { uuid: "preview-queued" }),
  ]);
}

export function sdkScenarios(
  tools: () => ChatState,
  subagent: () => ChatState,
  queued: () => ChatState,
): Record<string, () => ChatState> {
  return {
    settings: () => settings(tools()),
    elicit: () => elicitForm(tools()),
    "elicit-url": () => elicitUrl(tools()),
    cautious: () => cautious(subagent()),
    removed: () => removed(queued()),
  };
}

/** `getContextUsage({ detail: 'full' })` of the live check, after a short wait. */
export const PREVIEW_SDK: ChatSdkActions = {
  setEffort: () => {},
  removeQueued: () => {},
  answerElicitation: () => {},
  refreshMcp: () => {},
  // A sign-in in the preview: connected at once, no browser.
  mcpAction: () =>
    new Promise((resolve) => setTimeout(() => resolve(undefined), 600)),
  reloadPlugins: () => {},
  contextDetail: () =>
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            totalTokens: 27_257,
            rawMaxTokens: 1_000_000,
            memoryFiles: [
              { path: "C:\\Users\\TRINITX\\.claude\\CLAUDE.md", tokens: 6_210 },
              {
                path: "C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia-lab\\CLAUDE.md",
                tokens: 2_480,
              },
              {
                path: "C:\\Users\\TRINITX\\.claude\\rules\\coding-style.md",
                tokens: 410,
              },
            ],
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
                tokens: 3_611,
                kind: "used",
              },
              { id: "mcp_tools", name: "MCP tools", tokens: 609, kind: "used" },
              {
                id: "mcp_instructions",
                name: "MCP server instructions",
                tokens: 1_315,
                kind: "used",
              },
              {
                id: "mcp_tools_deferred",
                name: "MCP tools (deferred)",
                tokens: 51_294,
                kind: "deferred",
              },
              {
                id: "custom_agents",
                name: "Custom agents",
                tokens: 729,
                kind: "used",
              },
              {
                id: "memory_files",
                name: "Memory files",
                tokens: 10_090,
                kind: "used",
              },
              { id: "skills", name: "Skills", tokens: 10_670, kind: "used" },
              { id: "messages", name: "Messages", tokens: 91, kind: "used" },
              {
                id: "autocompact_buffer",
                name: "Autocompact buffer",
                tokens: 33_000,
                kind: "buffer",
              },
              {
                id: "free_space",
                name: "Free space",
                tokens: 939_743,
                kind: "free",
              },
            ],
          }),
        600,
      ),
    ),
};
