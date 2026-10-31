import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearOccurrences,
  collectOccurrences,
  paintOccurrences,
  type HighlightNames,
  type Occurrence,
} from "@/lib/domHighlight";
import { queryTerms } from "@/lib/searchTerms";

/** What the search walks: the user's and Claude's words, nothing else
 *  (the bodies `ChatTimeline` marks with it). */
const PROSE_ATTR = "data-chat-prose";

/**
 * A chat pane's own highlight names: the registry is the page's, and another
 * pane (or the reading view) mounting or closing its search clears its names.
 * `id` is React's `useId`, whose colons no `::highlight()` selector takes.
 */
export function chatHighlightNames(id: string): HighlightNames {
  const key = id.replace(/[^A-Za-z0-9_-]/g, "");
  return { all: `chat-match-${key}`, current: `chat-match-current-${key}` };
}

/** The tints of those names (the reading view's). */
export function chatHighlightCss(names: HighlightNames): string {
  return `::highlight(${names.all}) { background: rgba(250,204,21,0.32); color: #fff8dc; }
::highlight(${names.current}) { background: #facc15; color: #1c1917; }`;
}

/**
 * Ctrl+F in a chat pane, as in the reading view (`ModernConversationView`):
 * the matches of the prose on screen are painted (`domHighlight`), Enter and
 * Shift+Enter step through them, each brought to the middle of the column.
 * Only an `armed` pane opens it: the active one, on screen, under no layer.
 * `onReach` runs as the column moves to a match: it stops following the
 * bottom, as a reader's scroll would.
 */
export function useChatSearch(
  scrollRef: React.RefObject<HTMLElement | null>,
  armed: boolean,
  onReach: () => void,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  /** Bumped by each Ctrl+F: the box takes the focus again. */
  const [focusKey, setFocusKey] = useState(0);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const terms = useMemo(() => queryTerms(query), [query]);
  const id = useId();
  const names = useMemo(() => chatHighlightNames(id), [id]);

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        setFocusKey((k) => k + 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed]);

  // Markdown, colouring and streamed text land after the first paint: the
  // subtree is watched, a frame coalescing each burst.
  const recount = useCallback(() => {
    const root = scrollRef.current;
    if (!open || terms.length === 0 || !root) {
      setOccurrences((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const rows = [...root.querySelectorAll<HTMLElement>(`[${PROSE_ATTR}]`)].map(
      (el, i) => ({ index: i, el }),
    );
    setOccurrences(collectOccurrences(rows, terms));
  }, [open, terms, scrollRef]);
  useLayoutEffect(() => {
    recount();
    const el = scrollRef.current;
    if (!el || !open) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recount);
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [recount, open, scrollRef]);

  const total = occurrences.length;
  const at = total === 0 ? -1 : ((index % total) + total) % total;
  const current = at < 0 ? null : occurrences[at];

  useLayoutEffect(() => {
    paintOccurrences(occurrences, current, names);
  }, [occurrences, current, names]);
  useEffect(() => () => clearOccurrences(names), [names]);

  // To the match when the query or the step changes, not at each recount: a
  // streamed reply recounts every frame and would pin the column there.
  const onReachRef = useRef(onReach);
  useLayoutEffect(() => {
    onReachRef.current = onReach;
  }, [onReach]);
  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    const key = current ? `${query}\n${at}` : null;
    if (key === shownRef.current) return;
    shownRef.current = key;
    const anchor = current?.range.startContainer.parentElement;
    if (!anchor) return;
    onReachRef.current();
    anchor.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current, query, at]);

  const step = (dir: 1 | -1) => {
    if (total > 0) setIndex((i) => (i + dir + total) % total);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
    setIndex(0);
  };
  const search = (q: string) => {
    setQuery(q);
    setIndex(0);
  };

  const css = useMemo(() => chatHighlightCss(names), [names]);
  return { open, query, search, total, at, step, close, focusKey, css };
}
