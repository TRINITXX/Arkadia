import type { ContextDetail } from "@/lib/chat/chatProtocol";
import { act, onChatEvent } from "~/remote/connection";

/** A breakdown this recent answers the next look, as the desktop's (`CONTEXT_CACHE_MS`). */
const CACHE_MS = 30_000;

/** The PC counts tokens: a few seconds at most, as the desktop waits. */
const WAIT_MS = 20_000;

/** A desktop from before 02/11/2026 refuses the ask (`phoneChatCommand`, App's words). */
const REFUSED = "commande refusée depuis le téléphone";

/** The latest breakdown asked, by chat: the sheet opened again shows at once. */
const cache = new Map<string, { at: number; detail: Promise<ContextDetail> }>();

/**
 * The context by category for the context ring's sheet, as the desktop's
 * gauge asks it on hover (`useChatSdkActions`): `getContextUsage` full,
 * answered to this phone alone (`to`). A look, never an action: the tab
 * stays the PC's. Rejects with words to show: an older desktop's refusal
 * says the PC needs updating.
 */
export function contextDetail(chatId: string): Promise<ContextDetail> {
  const now = Date.now();
  const cached = cache.get(chatId);
  if (cached && now - cached.at < CACHE_MS) return cached.detail;
  const detail = ask(chatId);
  cache.set(chatId, { at: now, detail });
  // A failure is asked again on the next look.
  detail.catch(() => {
    if (cache.get(chatId)?.detail === detail) cache.delete(chatId);
  });
  return detail;
}

function ask(chatId: string): Promise<ContextDetail> {
  return new Promise<ContextDetail>((resolve, reject) => {
    const requestId = `context:${Date.now()}:${Math.random()}`;
    const done = () => {
      clearTimeout(timer);
      off();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("Le chat ne répond pas"));
    }, WAIT_MS);
    const off = onChatEvent((event) => {
      if (event.type !== "context_detail" || event.requestId !== requestId)
        return;
      done();
      if (event.detail) resolve(event.detail);
      else reject(new Error(event.error ?? "Détail indisponible"));
    });
    act({
      kind: "chatCommand",
      chatId,
      command: { type: "context_detail", requestId },
    }).catch((e: unknown) => {
      done();
      const message = e instanceof Error ? e.message : String(e);
      reject(
        new Error(
          message === REFUSED ? "mets à jour Arkadia sur le PC" : message,
        ),
      );
    });
  });
}
