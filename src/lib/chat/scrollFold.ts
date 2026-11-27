import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * The question sheets (the ❓ sheet, Claude's questions) fold as the reader
 * scrolls up the conversation, and unfold back at its end when the scroll
 * folded them; one folded by hand stays folded (the user's ask of
 * 27/11/2026). The column keeps still meanwhile: room under its end
 * (`foldRoomLeft`) holds its place as the sheet frees the pane's height.
 */

/**
 * The reader scrolled up, or came down to the very end; or used the input a
 * scroll's fold showed (`keep`): that fold is the user's now, the end
 * leaves it, never covering an input in use.
 */
export type ScrollFoldEvent = "up" | "end" | "keep";

/** Below this gap (px) the column is at its end, sub-pixel rounding aside. */
const AT_END_PX = 2;

/**
 * What a scroll of the column says (`top` the new `scrollTop`, `lastTop` the
 * last one, `gap` what is left under the view): any step up away from the
 * end, or a step down onto it. A clamp from shrinking content lands at the
 * end without a step down: nothing.
 */
export function scrollFoldEvent(
  top: number,
  lastTop: number,
  gap: number,
): ScrollFoldEvent | null {
  if (gap <= AT_END_PX) return top > lastTop ? "end" : null;
  return top < lastTop ? "up" : null;
}

/**
 * Whether the column follows its end after a scroll while room a fold kept
 * sits under it (the column is then always near its scroll end): only
 * coming down onto the end follows again, never a step up reading a gap of
 * a pixel; a scroll that moved nothing (the column's own pinning, a rising
 * sheet growing the gap under it) leaves it as it was.
 */
export function followsInRoom(
  following: boolean,
  top: number,
  lastTop: number,
  fold: ScrollFoldEvent | null,
): boolean {
  return top === lastTop ? following : fold === "end";
}

/** A wheel down with the column already at its end: no scroll comes, the end is asked all the same. */
export function wheelAtEnd(deltaY: number, gap: number): boolean {
  return deltaY > 0 && gap <= AT_END_PX;
}

/**
 * The room left under the conversation (`room` px now): what keeps `top`
 * where it is in a view `client` tall, the column `scrollHeight` with the
 * room in. It only shrinks, and only by what is out of view: the reader
 * scrolling up uses it up, nothing jumps.
 */
export function foldRoomLeft(
  room: number,
  top: number,
  client: number,
  scrollHeight: number,
): number {
  return Math.max(
    0,
    Math.min(room, roomToKeep(room, top, client, scrollHeight)),
  );
}

/**
 * The room under a column that follows its end while a sheet opens: all of
 * it (`start`, what kept the text where it was) as the sheet starts, none
 * once the dock grew by `growth`, in between as far as it grew. The text's
 * end glides with the sheet in one motion to its place above it, whether
 * the sheet rises into blank room or takes back more than it adds.
 */
export function openingRoom(
  start: number,
  grown: number,
  growth: number,
): number {
  if (growth <= 0 || start <= 0) return 0;
  return Math.max(0, Math.round(start * (1 - Math.min(1, grown / growth))));
}

/**
 * The room that keeps `top` where it is, more than there is if need be: a
 * sheet rising at the column's end (`isOpening`) takes back the questions
 * its message showed, and the text keeps still while the sheet fills the
 * blank under it. Zero or less: none needed, the column follows its end.
 */
export function roomToKeep(
  room: number,
  top: number,
  client: number,
  scrollHeight: number,
): number {
  return Math.ceil(top + client - (scrollHeight - room));
}

/** A sheet's fold, and whether the scroll made it. */
export interface FoldState {
  /**
   * It shows and nothing holds it (a sheet closed or gone, or its dictation
   * under way, neither folds nor unfolds).
   */
  open: boolean;
  folded: boolean;
  /** Folded by the scroll, not by hand. */
  auto: boolean;
}

/** A sheet's next fold on the scroll's event; null: it stays as it is. */
export function scrollFoldStep(
  s: FoldState,
  e: ScrollFoldEvent,
): { folded: boolean; auto: boolean } | null {
  if (e === "keep") return s.auto ? { folded: s.folded, auto: false } : null;
  if (!s.open) return null;
  if (e === "up" && !s.folded) return { folded: true, auto: true };
  if (e === "end" && s.folded && s.auto) return { folded: false, auto: false };
  return null;
}

/** A sheet opening, then folding (`useFoldMotion`): folding is the faster. */
export const FOLD_OPEN_MS = 260;
export const FOLD_CLOSE_MS = 220;
/** What a sheet's render may lag behind its `opening()`. */
const OPENING_SLACK_MS = 120;

type Listener = (e: ScrollFoldEvent) => boolean;

/** The pane's sheets listening to its column's scroll. */
export interface ScrollFold {
  subscribe(listener: Listener): () => void;
  /** Tells the sheets; true when one of them folds or unfolds on it. */
  emit(e: ScrollFoldEvent): boolean;
  /**
   * A sheet starts opening, before its render: the pane puts room under the
   * column (`setOnOpening`) so nothing clamps it, and keeps its text still
   * while the sheet rises (`isOpening`).
   */
  opening(): void;
  isOpening(): boolean;
  setOnOpening(fn: (() => void) | null): void;
  /** The height the opening sheet adds to the dock (`useFoldMotion`), 0 unknown. */
  setOpeningGrowth(px: number): void;
  openingGrowth(): number;
  /**
   * The dock's height as last laid out (the pane observes it, always there):
   * a sheet's motion starts from it, even one shown after the pane's mount.
   */
  setDockHeight(px: number): void;
  dockHeight(): number | null;
}

export function createScrollFold(
  now: () => number = () => performance.now(),
): ScrollFold {
  const listeners = new Set<Listener>();
  let openingUntil = -Infinity;
  let onOpening: (() => void) | null = null;
  let growth = 0;
  let dock: number | null = null;
  return {
    setDockHeight(px) {
      dock = px;
    },
    dockHeight() {
      return dock;
    },
    // Said as the motion starts: the window runs to its real end from here.
    setOpeningGrowth(px) {
      growth = Math.max(0, px);
      openingUntil = Math.max(
        openingUntil,
        now() + FOLD_OPEN_MS + OPENING_SLACK_MS,
      );
    },
    openingGrowth() {
      return growth;
    },
    opening() {
      growth = 0;
      // Its render comes a moment after: the motion's frames all fall inside.
      openingUntil = now() + FOLD_OPEN_MS + OPENING_SLACK_MS;
      onOpening?.();
    },
    isOpening() {
      return now() < openingUntil;
    },
    setOnOpening(fn) {
      onOpening = fn;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(e) {
      let moved = false;
      for (const listener of listeners) if (listener(e)) moved = true;
      return moved;
    },
  };
}

/** The pane's (`ChatView`); null outside one: nothing folds on scroll. */
export const ScrollFoldContext = createContext<ScrollFold | null>(null);

/**
 * A sheet's side: folds on the reader's scroll up while it shows unfolded,
 * unfolds at the column's end only when that fold was the scroll's. Its
 * fold and `auto` live where the sheet keeps them (the ❓ sheet's store: a
 * new round starts afresh, a pane shown again remembers), `set` writes both.
 * Returns the fold its own button (or Esc) uses: by hand, the end leaves it.
 */
export function useScrollFold(
  state: FoldState,
  set: (folded: boolean, auto: boolean) => void,
): (on: boolean) => void {
  const column = useContext(ScrollFoldContext);
  const live = useRef({ ...state, set });
  // Before any scroll event of the next frame: never an old round's `set`.
  useLayoutEffect(() => {
    live.current = { ...state, set };
  });
  useEffect(() => {
    if (!column) return;
    return column.subscribe((e) => {
      const s = live.current;
      const next = scrollFoldStep(s, e);
      if (!next) return false;
      // Said at once: a second event before the render sees it done.
      live.current = { ...s, ...next };
      if (s.folded && !next.folded) column.opening();
      s.set(next.folded, next.auto);
      return e !== "keep";
    });
  }, [column]);
  return (on) => {
    if (live.current.folded && !on) column?.opening();
    live.current = { ...live.current, folded: on, auto: false };
    live.current.set(on, false);
  };
}
