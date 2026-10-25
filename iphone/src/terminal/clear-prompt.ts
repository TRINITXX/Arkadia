import { CLEAR_CHUNK_GAP_MS, clearPromptChunks } from "@/lib/promptClear";
import { isPromptField } from "@/lib/terminalChrome";
import { latestFrame, sendInputs } from "~/remote/connection";

/**
 * Empties Claude's prompt with the desktop rail's keys (`promptClear`), in
 * small writes spaced on the PC itself: one large write reads as a paste and
 * loses its control keys. Only on the prompt itself: in the transcript view
 * or a selector the same keys toggle views and scroll. False when the prompt
 * is not on screen or the PC cannot be reached.
 */
export function clearPrompt(paneId: string | null): boolean {
  if (!paneId || !isPromptField(latestFrame(paneId))) return false;
  const parts = clearPromptChunks().map((c) => String.fromCharCode(...c));
  return sendInputs(paneId, parts, CLEAR_CHUNK_GAP_MS);
}
