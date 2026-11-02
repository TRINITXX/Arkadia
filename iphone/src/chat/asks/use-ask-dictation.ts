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

  /** « Écrire »: the words so far go to their field. */
  const writeOut = useCallback(async () => {
    const text = (await finish()).trim();
    const onText = write.current;
    write.current = null;
    if (text && onText) onText(text);
  }, [finish]);

  const drop = useCallback(() => {
    write.current = null;
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
