import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { History } from "lucide-react";

/** A page that never comes (the server's error is in the column) frees the button. */
const LOADING_MS = 15_000;

/**
 * The top of a resumed chat whose past goes further back: « Charger les
 * messages plus anciens » brings the page before (`older`), and the reader
 * stays on what they were reading. Rendered always, empty when there is
 * nothing more, so its correction runs on the very render that adds them.
 */
export function ChatOlderButton({
  truncated,
  cursor,
  scrollRef,
  onLoad,
}: {
  /** More messages exist before the oldest shown. */
  truncated: boolean;
  /** The oldest shown: it changes once the page is in. */
  cursor: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Absent: no server to ask (the preview), the old hint shows. */
  onLoad?: () => void;
}) {
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  /** The column's height and place at the click. */
  const before = useRef<{ cursor: string; height: number; top: number } | null>(
    null,
  );

  // Chromium keeps the reader's place when rows come above, except from the
  // very top, where this button sits: put them back on their line.
  useLayoutEffect(() => {
    const kept = before.current;
    const el = scrollRef.current;
    if (!kept || !el || kept.cursor === cursor) return;
    before.current = null;
    el.scrollTop = kept.top + (el.scrollHeight - kept.height);
  }, [cursor, scrollRef]);

  useEffect(() => {
    if (loadingFor === null) return;
    const timer = window.setTimeout(() => setLoadingFor(null), LOADING_MS);
    return () => window.clearTimeout(timer);
  }, [loadingFor]);

  if (!truncated) return null;
  if (!onLoad || !cursor) {
    return (
      <div className="chat-older">
        Les messages plus anciens sont dans le terminal.
      </div>
    );
  }
  const loading = loadingFor === cursor;
  return (
    <div className="chat-older">
      <button
        type="button"
        className="chat-older-btn"
        disabled={loading}
        onClick={() => {
          const el = scrollRef.current;
          if (el) {
            before.current = {
              cursor,
              height: el.scrollHeight,
              top: el.scrollTop,
            };
          }
          setLoadingFor(cursor);
          onLoad();
        }}
      >
        <History />
        {loading ? "Chargement…" : "Charger les messages plus anciens"}
      </button>
    </div>
  );
}
