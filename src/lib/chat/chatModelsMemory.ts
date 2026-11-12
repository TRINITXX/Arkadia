import { parseSavedModels, type ModelChoice } from "@/lib/chat/chatSdkSettings";

/**
 * Claude Code's model menu, kept from the last chat that listed it: a chat
 * asleep since it opened has no Claude Code to ask, and the menu would fall
 * back on a list written by hand that ages with each new model (« Fable
 * 5.1 » shown after 5.2 was out, 12/11/2026).
 */

const KEY = "arkadia.chat.models";

const store: Storage | null =
  typeof localStorage === "undefined" ? null : localStorage;

let kept: { raw: string | null; models: ModelChoice[] } | null = null;

/** The last list kept; empty if none ever was. */
export function rememberedModels(): ModelChoice[] {
  if (kept) return kept.models;
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
  } catch {
    // Storage off: nothing kept.
  }
  kept = { raw, models: parseSavedModels(raw) };
  return kept.models;
}

/** A list Claude Code just gave: kept for the chats that can't ask. */
export function rememberModels(models: ModelChoice[]): void {
  if (models.length === 0) return;
  const raw = JSON.stringify(models);
  if (kept?.raw === raw) return;
  kept = { raw, models };
  try {
    store?.setItem(KEY, raw);
  } catch {
    // Storage full or off: kept until the page reloads.
  }
}
