import { useCallback, useRef, useState } from "react";
import { useDictation } from "~/dictation/use-dictation";

/**
 * The iPhone's dictation for a panel's own-words field: its words land, on
 * « Écrire », in the field that started it, even when another question shows
 * meanwhile (the desktop sheet's rule). Leaving the panel stops the mic
 * (`useDictation`).
 */
export function useAskDictation() {
  const dictation = useDictation();
  const { start, finish, cancel } = dictation;
  const write = useRef<((text: string) => void) | null>(null);
  const [field, setField] = useState<string | null>(null);

  /** Listens for the field `id`; `onText` gets the words. */
  const listen = useCallback(
    (id: string, onText: (text: string) => void) => {
      write.current = onText;
      setField(id);
      void start();
    },
    [start],
  );

  /** Waits on `writeOut` that a cancel ends: they get null. */
  const waiting = useRef(new Set<() => void>());

  /** « Écrire »: the words so far go to their field, and come back (a send
   *  that waited for them reads them before its field's state shows them).
   *  Null when « Annuler » cut the dictation meanwhile: nothing is written,
   *  and a send that waited lets go (it never hangs). */
  const writeOut = useCallback(async (): Promise<string | null> => {
    let end = () => {};
    const dropped = new Promise<null>((resolve) => {
      end = () => resolve(null);
      waiting.current.add(end);
    });
    const said = await Promise.race([finish(), dropped]);
    waiting.current.delete(end);
    if (said === null) return null;
    const text = said.trim();
    const onText = write.current;
    write.current = null;
    if (text && onText) onText(text);
    return text;
  }, [finish]);

  const drop = useCallback(() => {
    write.current = null;
    for (const end of waiting.current) end();
    waiting.current.clear();
    cancel();
  }, [cancel]);

  return {
    ...dictation,
    /** The field listened for, none once the mic is off. */
    field: dictation.phase === "idle" ? null : field,
    listen,
    writeOut,
    drop,
  };
}

export type AskDictation = ReturnType<typeof useAskDictation>;
