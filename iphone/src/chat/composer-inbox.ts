/**
 * Text other screens put into a chat's composer, never sent by itself: the
 * PC's photos picked (`/pick?chat=1`), a visual's choice. The composer of
 * that chat takes it as the desktop's input takes a drop or a choice: paths
 * after what is written, a choice in place of the one before (`withChoice`).
 */

export type ComposerInsert = { text: string; kind: "paths" | "choice" };

const inboxes = new Map<string, Set<(insert: ComposerInsert) => void>>();

export function putInComposer(
  chatId: string,
  text: string,
  kind: ComposerInsert["kind"] = "paths",
) {
  for (const cb of inboxes.get(chatId) ?? []) cb({ text, kind });
}

export function onComposerInsert(
  chatId: string,
  cb: (insert: ComposerInsert) => void,
): () => void {
  let subs = inboxes.get(chatId);
  if (!subs) inboxes.set(chatId, (subs = new Set()));
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
