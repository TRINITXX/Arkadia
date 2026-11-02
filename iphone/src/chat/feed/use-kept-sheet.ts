import { useCallback, useState } from "react";

/**
 * What a sheet shows, kept while it slides away: iOS draws a Modal's content
 * until it is dismissed, so a subject set to null on close empties the
 * sheet as it goes (`FeedList` keeps its row the same way). `close` hides
 * it; the next `open` replaces what it held.
 */
export function useKeptSheet<T>() {
  const [subject, setSubject] = useState<T | null>(null);
  const [shown, setShown] = useState(false);
  const open = useCallback((next: T) => {
    setSubject(next);
    setShown(true);
  }, []);
  const close = useCallback(() => setShown(false), []);
  return { subject, shown, open, close };
}
