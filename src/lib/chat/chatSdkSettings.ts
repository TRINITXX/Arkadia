import type {
  ChatEvent,
  ContextDetail,
  EffortLevel,
  ElicitationInfo,
  JsonObject,
  McpServerInfo,
} from "@/lib/chat/chatProtocol";
import type { ChatItem, ChatState } from "@/lib/chat/chatState";

/**
 * The session's settings as the chat shows them: the model menu and the
 * effort (`supportedModels`, `getSettings`), fast mode, the MCP servers and
 * their requests (`onElicitation`), the hooks running, the plugins that
 * failed to load. Pure: `reduceChat` hands it the events and SDK messages.
 */

/** A model of the menu. */
export interface ModelChoice {
  /** What `setModel` takes: an alias (`opus`) or an id. */
  value: string;
  /** The model id it runs (`claude-opus-5-5`), to find the session's. */
  model: string;
  label: string;
  /** The effort levels it takes, low to max; none: no effort. */
  efforts: EffortLevel[];
  /** It can run in fast mode. */
  fast: boolean;
}

export interface PendingElicitation extends ElicitationInfo {
  requestId: string;
}

export interface RunningHook {
  id: string;
  /** `PreToolUse:Bash`, `Stop`… */
  name: string;
  startedAt: number;
}

export interface SdkState {
  /** Empty until Claude Code lists them. */
  models: ModelChoice[];
  /** The next message's; null: the model takes none, or not known yet. */
  effort: EffortLevel | null;
  /** `init.fast_mode_state`: on, or paused after a rate limit. */
  fastMode: "on" | "cooldown" | null;
  mcpServers: McpServerInfo[];
  /** MCP requests waiting on the user, oldest first. */
  elicitations: PendingElicitation[];
  /** Hooks running now, oldest first. */
  hooks: RunningHook[];
}

export const EMPTY_SDK: SdkState = {
  models: [],
  effort: null,
  fastMode: null,
  mcpServers: [],
  elicitations: [],
  hooks: [],
};

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const EFFORT_LEVELS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Max",
};

export function effortLabel(effort: EffortLevel): string {
  return EFFORT_LABELS[effort];
}

const isEffort = (v: unknown): v is EffortLevel =>
  EFFORT_LEVELS.includes(v as EffortLevel);

/** « Opus 5.5 · 1M » for « Opus 5.5 (1M context) » or a `[1m]` id. */
function shortLabel(name: string, value: string): string {
  const wide = /\s*\((\d+\s*[MK])\s*context\)\s*$/i.exec(name);
  const base = wide ? name.slice(0, wide.index) : name;
  const size =
    wide?.[1].replace(/\s/g, "") ?? (/\[1m\]$/i.test(value) ? "1M" : null);
  return size ? `${base} · ${size.toUpperCase()}` : base;
}

/**
 * The menu from `supportedModels`, in its order, labels short and in French:
 * the « Default (recommended) » row names the model it runs.
 */
export function modelChoices(raw: unknown[]): ModelChoice[] {
  const rows = raw.map(obj).filter((r) => str(r.value));
  const choices = rows.map((r): ModelChoice => {
    const value = str(r.value) ?? "";
    return {
      value,
      model: str(r.resolvedModel) ?? value,
      label: shortLabel(str(r.displayName) ?? value, value),
      efforts: arr(r.supportedEffortLevels).filter(isEffort),
      fast: r.supportsFastMode === true,
    };
  });
  return choices.map((c) => {
    if (c.value !== "default") return c;
    const same = choices.find(
      (o) => o.value !== "default" && o.model === c.model,
    );
    return { ...c, label: same ? `Par défaut · ${same.label}` : "Par défaut" };
  });
}

const baseModel = (id: string) => id.replace(/\[.*\]$/, "");

/**
 * The menu's row for the session's model (an id, `[1m]` for the wide
 * window): its own value, else the row running it, not « Par défaut ».
 */
export function currentChoice(
  models: ModelChoice[],
  model: string | null,
): ModelChoice | undefined {
  if (!model) return undefined;
  const exact = models.find((m) => m.value === model);
  if (exact) return exact;
  const wide = /\[1m\]$/i.test(model);
  const same = models.filter(
    (m) => m.value !== "default" && baseModel(m.model) === baseModel(model),
  );
  return (
    same.find((m) => /\[1m\]$/i.test(m.value) === wide) ??
    same[0] ??
    models.find((m) => baseModel(m.model) === baseModel(model))
  );
}

/**
 * The effort levels the session's model takes: none hides the picker. A
 * model the menu lacks keeps them all while Claude Code reports an effort.
 */
export function effortChoices(state: {
  models: ModelChoice[];
  model: string | null;
  effort: EffortLevel | null;
}): EffortLevel[] {
  const choice = currentChoice(state.models, state.model);
  if (choice) return choice.efforts;
  return state.effort ? EFFORT_LEVELS : [];
}

/** The order the list shows them in: what needs the user first. */
const MCP_ORDER = ["failed", "needs-auth", "pending", "connected", "disabled"];

const MCP_LABELS: Record<string, string> = {
  connected: "connecté",
  failed: "en échec",
  "needs-auth": "connexion à faire",
  pending: "connexion en cours",
  disabled: "désactivé",
};

export function mcpStatusLabel(status: string): string {
  return MCP_LABELS[status] ?? status;
}

/** « context7 (plugin) » for `plugin:context7:context7`. */
export function mcpName(name: string): string {
  const plugin = /^plugin:([^:]+):(.+)$/.exec(name);
  if (!plugin) return name;
  return plugin[1] === plugin[2]
    ? `${plugin[2]} (plugin)`
    : `${plugin[2]} (plugin ${plugin[1]})`;
}

export function mcpFailed(servers: McpServerInfo[]): McpServerInfo[] {
  return servers.filter((s) => s.status === "failed");
}

export function mcpSorted(servers: McpServerInfo[]): McpServerInfo[] {
  const rank = (s: McpServerInfo) => {
    const i = MCP_ORDER.indexOf(s.status);
    return i < 0 ? MCP_ORDER.length : i;
  };
  return [...servers].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
}

/**
 * A turn's `init` states over the list known: it carries no error text, so
 * a server still failed keeps the last reason `mcpServerStatus` gave.
 */
export function mergeMcp(
  prev: McpServerInfo[],
  next: McpServerInfo[],
): McpServerInfo[] {
  return next.map((s) => {
    if (s.error || s.status !== "failed") return s;
    const before = prev.find((p) => p.name === s.name);
    return before?.status === "failed" && before.error
      ? { ...s, error: before.error }
      : s;
  });
}

function mcpList(raw: unknown): McpServerInfo[] {
  return arr(raw).flatMap((v) => {
    const s = obj(v);
    const name = str(s.name);
    const status = str(s.status);
    if (!name || !status) return [];
    return [{ name, status, error: str(s.error), source: str(s.source) }];
  });
}

/** One row of the context's hover. */
export interface ContextRow {
  label: string;
  tokens: number;
  /** Of the window, 0-1. */
  share: number;
  kind: "used" | "buffer" | "free";
}

const CONTEXT_GROUPS: [string[], string][] = [
  [["system_prompt", "system_tools"], "Système et outils"],
  [["mcp_tools", "mcp_instructions"], "Outils MCP"],
  [["custom_agents"], "Agents"],
  [["memory_files"], "Fichiers mémoire"],
  [["skills"], "Skills"],
  [["messages"], "Messages"],
  [["autocompact_buffer", "compact_buffer"], "Réserve de compaction"],
  [["free_space"], "Libre"],
];

/**
 * The context by category, as `/context` groups it: what is in the window
 * (tools, memory files, messages…), the compaction reserve, the free space.
 * Deferred tools are out of the window: left out. An unknown used row goes
 * to « Autre ».
 */
export function contextBreakdown(detail: ContextDetail): ContextRow[] {
  const max = detail.rawMaxTokens > 0 ? detail.rawMaxTokens : 1;
  const rows = new Map<string, ContextRow>();
  const add = (label: string, tokens: number, kind: ContextRow["kind"]) => {
    const row = rows.get(label) ?? { label, tokens: 0, share: 0, kind };
    row.tokens += tokens;
    row.share = row.tokens / max;
    rows.set(label, row);
  };
  for (const c of detail.categories) {
    if (c.kind === "deferred" || c.tokens <= 0) continue;
    const group = CONTEXT_GROUPS.find(([ids]) => c.id && ids.includes(c.id));
    const kind = c.kind === "free" || c.kind === "buffer" ? c.kind : "used";
    add(group?.[1] ?? (kind === "used" ? "Autre" : c.name), c.tokens, kind);
  }
  const order = CONTEXT_GROUPS.map(([, label]) => label);
  const at = (label: string) => {
    const i = order.indexOf(label);
    // « Autre » just before the reserve.
    return i < 0 ? order.length - 2.5 : i;
  };
  return [...rows.values()].sort((a, b) => at(a.label) - at(b.label));
}

/** « 820 », « 27,3 k », « 312 k », « 1 M »: a context's tokens, short. */
export function compactTokens(n: number): string {
  const fr = (x: number, digits: number) =>
    x.toFixed(digits).replace(/\.0+$/, "").replace(".", ",");
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${fr(n / 1000, n < 100_000 ? 1 : 0)} k`;
  return `${fr(n / 1_000_000, 1)} M`;
}

/** A failed hook's words kept under its notice. */
const HOOK_DETAIL_CHARS = 600;

/** The notice of a hook that failed: its name and code, what it wrote under. */
export function hookFailure(m: JsonObject): { text: string; detail?: string } {
  const name = str(m.hook_name) ?? "?";
  const code = typeof m.exit_code === "number" ? ` (code ${m.exit_code})` : "";
  const said = (str(m.stderr) || str(m.output) || str(m.stdout) || "").trim();
  return {
    text: `Hook ${name} en échec${code}`,
    detail: said
      ? said.length > HOOK_DETAIL_CHARS
        ? `${said.slice(0, HOOK_DETAIL_CHARS)}…`
        : said
      : undefined,
  };
}

const PLUGIN_ERRORS: Record<string, string> = {
  "path-not-found": "dossier introuvable",
  "manifest-validation-error": "manifeste invalide",
  "dependency-unsatisfied": "dépendance manquante",
  "hook-load-failed": "hooks non chargés",
};

/** « Plugins non chargés : x (dossier introuvable), y (…) ». */
export function pluginErrorsText(errors: JsonObject[]): string {
  const list = errors.map((e) => {
    const name = str(e.plugin) ?? "?";
    const why = PLUGIN_ERRORS[str(e.type) ?? ""] ?? str(e.message) ?? "erreur";
    // `inline[0]`: a directory that failed before it had a name.
    const shown = /^(inline|synced)\[\d+\]$/.test(name)
      ? (str(e.path) ?? name)
      : name;
    return `${shown} (${why})`;
  });
  return `${list.length > 1 ? "Plugins non chargés" : "Plugin non chargé"} : ${list.join(", ")}`;
}

/** A turn's `init`: fast mode, MCP states, and plugins that failed once. */
function addInit(state: ChatState, m: JsonObject, now: number): ChatState {
  const fast = m.fast_mode_state;
  const sdk: SdkState = {
    ...state.sdk,
    fastMode: fast === "on" || fast === "cooldown" ? fast : null,
    mcpServers: Array.isArray(m.mcp_servers)
      ? mergeMcp(state.sdk.mcpServers, mcpList(m.mcp_servers))
      : state.sdk.mcpServers,
  };
  const errors = arr(m.plugin_errors).map(obj);
  if (errors.length === 0) return { ...state, sdk };
  // Each init says them again: one notice per set of errors.
  const text = pluginErrorsText(errors);
  const id = `plugins:${text}`;
  if (state.items.some((x) => x.id === id)) return { ...state, sdk };
  const notice: ChatItem = {
    kind: "notice",
    id,
    text,
    tone: "error",
    action: "reload_plugins",
    at: now,
  };
  return { ...state, sdk, items: [...state.items, notice] };
}

/**
 * What the SDK's messages say of the settings: `init`, hooks starting and
 * ending (a failure becomes a notice), an MCP sign-in finished. A turn's end
 * forgets the hooks: Claude Code ran its Stop hooks before it.
 */
export function addSdkSettings(
  state: ChatState,
  m: JsonObject,
  now: number,
): ChatState {
  if (m.type === "result") {
    return state.sdk.hooks.length === 0
      ? state
      : { ...state, sdk: { ...state.sdk, hooks: [] } };
  }
  if (m.type !== "system") return state;
  switch (m.subtype) {
    case "init":
      return addInit(state, m, now);
    case "hook_started": {
      const id = str(m.hook_id);
      if (!id) return state;
      const hook = { id, name: str(m.hook_name) ?? "?", startedAt: now };
      return {
        ...state,
        sdk: {
          ...state.sdk,
          hooks: [...state.sdk.hooks.filter((h) => h.id !== id), hook],
        },
      };
    }
    case "hook_response": {
      const hooks = state.sdk.hooks.filter((h) => h.id !== m.hook_id);
      const ended = { ...state, sdk: { ...state.sdk, hooks } };
      if (m.outcome !== "error") return ended;
      const notice: ChatItem = {
        kind: "notice",
        id: `hook:${str(m.hook_id) ?? str(m.uuid) ?? now}`,
        ...hookFailure(m),
        tone: "error",
        at: now,
      };
      return { ...ended, items: [...ended.items, notice] };
    }
    case "elicitation_complete": {
      const server = mcpName(str(m.mcp_server_name) ?? "?");
      const notice: ChatItem = {
        kind: "notice",
        id: `elicited:${str(m.uuid) ?? now}`,
        text: `${server} : connexion terminée`,
        tone: "info",
        at: now,
      };
      return { ...state, items: [...state.items, notice] };
    }
    default:
      return state;
  }
}

type SdkEvent = Extract<
  ChatEvent,
  {
    type:
      | "models"
      | "effort"
      | "mcp"
      | "elicitation"
      | "elicitation_resolved"
      | "queued_removed";
  }
>;

/**
 * A message withdrawn by the user: gone from the column (its text goes back
 * to the input, `chatLive`), never as taken.
 */
function withdraw(items: ChatItem[], uuid: string): ChatItem[] {
  const item = withdrawnItem(items, uuid);
  return item ? items.filter((x) => x !== item) : items;
}

/** The message `queued_removed` withdraws, while it still waits. */
export function withdrawnItem(
  items: ChatItem[],
  uuid: string,
): Extract<ChatItem, { kind: "user" | "command" }> | null {
  const item = items.find((x) => x.id === `sent:${uuid}`);
  if (!item || (item.kind !== "user" && item.kind !== "command")) return null;
  // Taken meanwhile (neither waiting nor dropped): it went.
  return item.queued || item.dropped ? item : null;
}

/** The chat server's own events about the settings. */
export function reduceSdkEvent(state: ChatState, event: SdkEvent): ChatState {
  const sdk = state.sdk;
  switch (event.type) {
    case "models":
      return { ...state, sdk: { ...sdk, models: modelChoices(event.models) } };
    case "effort":
      return { ...state, sdk: { ...sdk, effort: event.effort } };
    case "mcp":
      return {
        ...state,
        sdk: { ...sdk, mcpServers: mergeMcp(sdk.mcpServers, event.servers) },
      };
    case "elicitation":
      return {
        ...state,
        sdk: {
          ...sdk,
          elicitations: [
            ...sdk.elicitations.filter((e) => e.requestId !== event.requestId),
            { ...event.request, requestId: event.requestId },
          ],
        },
      };
    case "elicitation_resolved":
      return {
        ...state,
        sdk: {
          ...sdk,
          elicitations: sdk.elicitations.filter(
            (e) => e.requestId !== event.requestId,
          ),
        },
      };
    case "queued_removed": {
      const items = withdraw(state.items, event.uuid);
      return items === state.items ? state : { ...state, items };
    }
  }
}

/** The chat ended: nothing runs nor waits on the user any more. */
export function closeSdk(sdk: SdkState): SdkState {
  return { ...sdk, elicitations: [], hooks: [] };
}
