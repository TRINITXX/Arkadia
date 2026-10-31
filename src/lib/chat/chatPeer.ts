import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * A message another Claude session sent this one (its SendMessage), or a
 * background subagent of this session sent its main loop: Claude Code hands
 * it to Claude as a user message, wrapped in a harness note. Never the
 * user's words. Live it comes as the CLI's echo of that turn (the chat
 * server's `--replay-user-messages`), with `origin.kind: 'peer'`, the
 * sender's name and the body alone; the transcript keeps the same `origin`.
 * Without it, only the text tells: « Another Claude session sent a message:
 * <cross-session-message from-name="…">body</cross-session-message> This
 * came from… », or the bare envelope for one taken mid-turn (seen live on
 * 31/10/2026). Pure.
 */
export interface PeerMessage {
  /** The sender's name (`arkadia-85`, a subagent's type); absent if unsaid. */
  from?: string;
  /** Sent by a subagent of this session: its task id. */
  agentId?: string;
  text: string;
}

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** How Claude Code opens the note around a peer's message. */
const HARNESS_LEAD = "Another Claude session sent a message:";

/** A session's message, or a subagent's (`from` is then its task id). */
const ENVELOPE =
  /<(cross-session-message|agent-message)\b([^>]*)>([\s\S]*?)<\/\1>/g;

/** What a subagent's final report opens with, before the report itself. */
const HAND_BACK = /^\[Subagent hand-back\][\s\S]*?The report follows:\n/;

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] || undefined;
}

/** A user message's text: a string, or its text blocks. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (obj(b).type === "text" ? (str(obj(b).text) ?? "") : ""))
    .join("\n");
}

/** A subagent's report without the harness's frame (its lines indented by 2). */
function bodyText(body: string): string {
  const report = HAND_BACK.exec(body);
  if (!report) return body.trim();
  return body
    .slice(report[0].length)
    .split("\n")
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
}

function envelopes(text: string): PeerMessage[] {
  return [...text.matchAll(ENVELOPE)].map(([, tag, attrs, body]) =>
    tag === "agent-message"
      ? { agentId: attr(attrs, "from"), text: bodyText(body) }
      : { from: attr(attrs, "from-name"), text: bodyText(body) },
  );
}

/** The peer messages a user message carries, or null for any other. */
export function peerMessages(m: JsonObject): PeerMessage[] | null {
  const origin = obj(m.origin);
  const text = contentText(obj(m.message).content).trim();
  if (origin.kind === "peer") {
    const from = str(origin.name)?.trim() || undefined;
    const agentId = str(origin.senderTaskId) || undefined;
    const body = str(origin.body);
    if (body !== undefined) return [{ from, agentId, text: bodyText(body) }];
    const found = envelopes(text);
    if (found.length === 0) return [{ from, agentId, text }];
    return found.map((p) => ({
      ...p,
      from: p.from ?? from,
      agentId: p.agentId ?? agentId,
    }));
  }
  // A message the user typed may quote an envelope: never one stamped as
  // theirs, and only one that opens with it (a transcript without origin).
  if (
    origin.kind === "human" ||
    (!text.startsWith(HARNESS_LEAD) &&
      !text.startsWith("<cross-session-message") &&
      !text.startsWith("<agent-message"))
  )
    return null;
  const found = envelopes(text);
  return found.length > 0 ? found : null;
}

/**
 * A peer frame's head: « Message de arkadia-85 », or the subagent of this
 * session by its task (its description when known).
 */
export function peerLabel(
  peer: { from?: string; agentId?: string },
  subagents: readonly { taskId: string; description: string }[] = [],
): string {
  if (peer.agentId) {
    const agent = subagents.find((s) => s.taskId === peer.agentId);
    if (agent?.description)
      return `Message du sous-agent « ${agent.description} »`;
    return peer.from
      ? `Message du sous-agent ${peer.from}`
      : "Message d'un sous-agent";
  }
  return peer.from ? `Message de ${peer.from}` : "Message d'une autre session";
}
