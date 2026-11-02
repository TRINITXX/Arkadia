import type { JsonObject } from "@/lib/chat/chatProtocol";

/** An artifact's own page, never one of its assets or files. */
const ARTIFACT_URL = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+$/;

/**
 * The artifact a chat's message just published, or null. In the terminal,
 * Claude Code opens a first publish itself (its `BROWSER`, Arkadia's relay
 * into the tab's panel); from the SDK the chats run, it never does, so the
 * page opens it there (asked on 02/11/2026). A republish (`updated`) stays
 * the `artifact-refresh` hook's, as in the terminal: it reloads only a page
 * the panel holds. A read, a listing or an asset has no such result.
 */
export function publishedArtifact(message: JsonObject): string | null {
  // A subagent's publish stays in its sheet, as the terminal never opens it.
  if (message.type !== "user" || message.parent_tool_use_id) return null;
  const result = message.tool_use_result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const { url, updated } = result as JsonObject;
  if (updated === true) return null;
  return typeof url === "string" && ARTIFACT_URL.test(url) ? url : null;
}
