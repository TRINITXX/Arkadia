import { useEffect, useState } from "react";

/** A panel's list as loaded: the rows' « hier 14:32 » count from `at`. */
export interface PanelList<T> {
  /** Null while it loads, or when it failed. */
  data: T | null;
  at: number;
  error: string | null;
}

const LOADING = { data: null, at: 0, error: null };

/**
 * /resume's or /rewind's list, asked of the PC each time its sheet opens
 * (as the desktop's panel): another tab may have opened a session since.
 * Kept once closed, so the sheet slides out with its rows.
 */
export function usePanelList<T>(
  visible: boolean,
  load: () => Promise<T>,
): PanelList<T> {
  const [list, setList] = useState<PanelList<T>>(LOADING);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setList(LOADING);
    load().then(
      (data) => {
        if (alive) setList({ data, at: Date.now(), error: null });
      },
      (e: unknown) => {
        if (alive)
          setList({
            data: null,
            at: Date.now(),
            error: e instanceof Error ? e.message : String(e),
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [visible, load]);
  return list;
}
