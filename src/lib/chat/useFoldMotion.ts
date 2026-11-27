import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  FOLD_CLOSE_MS,
  FOLD_OPEN_MS,
  ScrollFoldContext,
} from "@/lib/chat/scrollFold";

/** A bottom sheet's curve (ui-craft, « drawer iOS »). */
const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The card's height as its motion starts: its height laid out now less what
 * the dock grew by in the same change (the input shown or hidden with the
 * sheet), so the dock starts at the height it had and the column above
 * glides from there. Unknown before (`null`): from where it is.
 */
export function foldStartHeight(
  card: number,
  dockNow: number,
  dockBefore: number | null,
): number {
  if (dockBefore === null) return card;
  return Math.max(0, card - (dockNow - dockBefore));
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * A question sheet folding to its head and unfolding (the user's ask of
 * 27/11/2026): its height moves, its body fades, the dock under the column
 * with it, so the conversation follows without a jump. The body stays in
 * while it folds; returns whether it shows. The height is measured, never
 * `auto` (ui-craft §8's accordion exception); none with reduced motion.
 */
export function useFoldMotion(
  folded: boolean,
  cardRef: RefObject<HTMLElement | null>,
): boolean {
  const column = useContext(ScrollFoldContext);
  const [seen, setSeen] = useState(folded);
  const [closing, setClosing] = useState(false);
  if (seen !== folded) {
    setSeen(folded);
    setClosing(folded && !reducedMotion());
  }
  const running = useRef<Animation[]>([]);
  // Only a change moves it: never its mount (nor React's second run of it).
  const last = useRef(folded);
  useLayoutEffect(() => {
    if (last.current === folded) return;
    last.current = folded;
    const card = cardRef.current;
    const body = card?.querySelector<HTMLElement>(":scope > .qs") ?? null;
    // Folding, its body takes nothing more: no key, no click, and the focus
    // it held goes (the input takes it back, `ChatView`), before the effect
    // that gives it. Unfolded again in mid-fold, it is the live one again.
    if (body) {
      body.inert = folded;
      if (folded && body.contains(document.activeElement))
        (document.activeElement as HTMLElement).blur();
    }
    // A fold or unfold in mid-motion: the new one starts where it stands,
    // its fade too (a transition, never a restart, ui-craft §12).
    const moving = running.current.length > 0;
    const fade = body ? Number(window.getComputedStyle(body).opacity) : 1;
    for (const a of running.current) a.cancel();
    running.current = [];
    const dock = card?.closest<HTMLElement>(".chat-bottom");
    if (!card || !dock || reducedMotion()) return;
    const head = card.querySelector<HTMLElement>(":scope > .hd");
    const start = foldStartHeight(
      card.offsetHeight,
      dock.offsetHeight,
      column?.dockHeight() ?? null,
    );
    const end = folded
      ? card.offsetHeight - card.clientHeight + (head?.offsetHeight ?? 0)
      : card.offsetHeight;
    // The column rides the same way: it hears how far the dock will grow.
    if (!folded) column?.setOpeningGrowth(end - start);
    // A body just shown fades in from nothing; one caught in mid-motion
    // goes on from where it stood.
    const fadeFrom = folded || moving ? fade : 0;
    const options: KeyframeAnimationOptions = {
      duration: folded ? FOLD_CLOSE_MS : FOLD_OPEN_MS,
      easing: SHEET_EASE,
      // Folded, it holds its end until the body is out (`closing`).
      fill: folded ? "forwards" : "none",
    };
    const height = card.animate(
      [
        { height: `${start}px`, minHeight: "0px" },
        { height: `${end}px`, minHeight: "0px" },
      ],
      options,
    );
    running.current = [height];
    if (body)
      running.current.push(
        body.animate(
          [{ opacity: fadeFrom }, { opacity: folded ? 0 : 1 }],
          options,
        ),
      );
    if (folded) height.onfinish = () => setClosing(false);
  }, [folded, cardRef, column]);
  // The body out after its fold: the card's own height is its head's now.
  useLayoutEffect(() => {
    if (closing || !folded) return;
    for (const a of running.current) a.cancel();
    running.current = [];
  }, [closing, folded]);
  return !folded || closing;
}
