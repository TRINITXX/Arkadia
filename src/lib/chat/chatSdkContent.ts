import type { JsonObject } from "@/lib/chat/chatProtocol";
import { retryOf } from "@/lib/chat/chatErrors";
import { quotaAlerts } from "@/lib/chat/chatQuota";
import type { ChatItem, ChatState } from "@/lib/chat/chatState";

/**
 * What Claude Code says besides the conversation, for `reduceChat`: its
 * retries (live line), the next message it suggests (input), and its
 * notices in the column: hook messages and warnings, its notifications,
 * the tool calls it refused on its own, quota alerts, a compaction that
 * failed. Pure.
 */

type Notice = Extract<ChatItem, { kind: "notice" }>;

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** A notice with its own id: never twice (a replay rebuilds from empty). */
function addNotice(
  state: ChatState,
  notice: Omit<Notice, "kind" | "at">,
  now: number,
): ChatState {
  if (state.items.some((x) => x.id === notice.id)) return state;
  return {
    ...state,
    items: [...state.items, { kind: "notice", ...notice, at: now }],
  };
}

/** « 180 k » for 180 000 tokens. */
function kTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 999_500) return `${Math.round(n / 1000)} k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} M`;
}

/** « Compacté automatiquement · 180 k → 32 k tokens » (`compact_boundary`). */
export function compactNotice(m: JsonObject): string {
  const meta = obj(m.compact_metadata);
  const head =
    meta.trigger === "auto"
      ? "Compacté automatiquement"
      : "Conversation compactée";
  const pre = num(meta.pre_tokens);
  const post = num(meta.post_tokens);
  if (pre === undefined) return head;
  return post === undefined
    ? `${head} · ${kTokens(pre)} tokens avant`
    : `${head} · ${kTokens(pre)} → ${kTokens(post)} tokens`;
}

/** A long text: its first line as the notice, the rest under it. */
function split(content: string): { text: string; detail?: string } {
  const [first = "", ...rest] = content.trim().split("\n");
  const detail = rest.join("\n").trim();
  return { text: first.replace(/:$/, ""), detail: detail || undefined };
}

/**
 * A banner of Claude Code's loop (`informational`): a hook's block reason,
 * a Stop hook's denial, a warning. `info` lines only show in its transcript
 * mode: none here.
 */
export function informationalNotice(
  m: JsonObject,
): Omit<Notice, "kind" | "at" | "id"> | null {
  const level = str(m.level);
  const content = str(m.content)?.trim() ?? "";
  if (level === "info" || !content) return null;
  const outcome = obj(m.prompt_submit_outcome);
  if (outcome.kind === "blocked_by_hook") {
    return {
      text:
        outcome.prompt_kept === true
          ? "Message retenu par un hook"
          : "Message bloqué par un hook, il n'est pas parti",
      tone: "warning",
      detail: str(outcome.reason),
    };
  }
  const tone =
    level === "warning" || m.prevent_continuation === true ? "warning" : "info";
  return { ...split(content), tone };
}

/** Claude Code's notifications it names itself, in words of the chat. */
const NOTIFICATIONS: Record<string, string> = {
  "stop-hook-error": "Un hook Stop a renvoyé une erreur",
};

/** The terminal's key hints (« · ctrl+o to see ») mean nothing here. */
const KEY_HINT = /\s*·\s*(ctrl|shift|alt|esc|tab)\b[^·]*$/i;

/**
 * A notification (`notification`): one per key in the column, the latest
 * at the end, so a repeated one never piles up.
 */
function addNotification(
  state: ChatState,
  m: JsonObject,
  now: number,
): ChatState {
  const key = str(m.key) ?? "";
  const raw = str(m.text)?.replace(KEY_HINT, "").trim() ?? "";
  const text = NOTIFICATIONS[key] ?? raw;
  if (!text) return state;
  const id = `notif:${key || raw}`;
  const prev = state.items.find((x) => x.id === id);
  if (prev?.kind === "notice" && prev.text === text) return state;
  const tone =
    m.priority === "high" || m.priority === "immediate" ? "warning" : "info";
  return addNotice(
    { ...state, items: state.items.filter((x) => x.id !== id) },
    { id, text, tone, detail: text !== raw ? raw : undefined },
    now,
  );
}

/** How Claude Code words a Stop hook's denial it hands back to Claude. */
const STOP_FEEDBACK = "Stop hook feedback:";

/** A Stop hook that sent Claude back to work (its synthetic user message). */
function stopFeedback(m: JsonObject): string | null {
  if (m.isSynthetic !== true) return null;
  const content = obj(m.message).content;
  const text =
    typeof content === "string"
      ? content
      : (Array.isArray(content) ? content : [])
          .map((b) => str(obj(b).text) ?? "")
          .join("\n");
  return text.startsWith(STOP_FEEDBACK)
    ? text.slice(STOP_FEEDBACK.length).trim()
    : null;
}

/** The main loop's frames only: a subagent's are its own. */
const isMain = (m: JsonObject) => !m.parent_tool_use_id;

export function addSdkContent(
  state: ChatState,
  m: JsonObject,
  now: number,
): ChatState {
  switch (m.type) {
    case "stream_event":
    case "assistant": {
      if (!isMain(m)) return state;
      // A frame of the reply: the retry worked, a new turn hides the suggestion.
      let next =
        state.retry || state.suggestion
          ? { ...state, retry: null, suggestion: null }
          : state;
      if (m.type === "assistant" && typeof m.error === "string")
        next = { ...next, apiError: m.error };
      return next;
    }
    case "user": {
      const feedback = isMain(m) ? stopFeedback(m) : null;
      if (feedback === null) return state;
      return addNotice(
        state,
        {
          id: `stop:${str(m.uuid) ?? state.items.length}`,
          text: "Un hook Stop renvoie Claude au travail",
          tone: "info",
          detail: feedback || undefined,
        },
        now,
      );
    }
    case "prompt_suggestion":
      return { ...state, suggestion: str(m.suggestion)?.trim() || null };
    case "rate_limit_event": {
      const fresh = quotaAlerts(obj(m.rate_limit_info)).filter(
        (a) => !state.quotaSeen.includes(a.key),
      );
      return fresh.reduce(
        (s, a) =>
          addNotice(
            { ...s, quotaSeen: [...s.quotaSeen, a.key] },
            { id: `quota:${a.key}`, text: a.text, tone: a.tone },
            now,
          ),
        state,
      );
    }
    case "system":
      break;
    default:
      return state;
  }
  switch (m.subtype) {
    case "api_retry":
      return { ...state, retry: retryOf(m, now) };
    case "informational": {
      const notice = informationalNotice(m);
      if (!notice) return state;
      // Progress lines of one tool call share its id: the latest stays.
      const tool = str(m.tool_use_id);
      const id = tool ? `info:${tool}` : `info:${str(m.uuid) ?? now}`;
      return addNotice(
        { ...state, items: state.items.filter((x) => x.id !== id) },
        { id, ...notice },
        now,
      );
    }
    case "notification":
      return addNotification(state, m, now);
    // A call refused without a question: no line in the chat (the user's
    // ask of 01/11/2026: they took whole screens). Its tool still counts
    // « en erreur » in the work line.
    case "permission_denied":
      return state;
    case "status":
      if (m.compact_result !== "failed") return state;
      return addNotice(
        state,
        {
          id: `compact-failed:${str(m.uuid) ?? now}`,
          text: "La compaction a échoué : la conversation reste entière",
          tone: "error",
          detail: str(m.compact_error),
        },
        now,
      );
    default:
      return state;
  }
}
