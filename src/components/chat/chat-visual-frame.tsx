import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  clampVisualHeight,
  firstFrameGrowth,
  nextFrameHeight,
  refitFrameGrowth,
} from "@/lib/chat/chatVisual";
import {
  frameDictationNow,
  frameGestureNow,
  loadVisualFrame,
} from "@/lib/chat/chatVisualDom";
import { glideBy, wheelPixels } from "@/lib/chat/glideScroll";
import {
  ChatDictationContext,
  useFieldDictation,
} from "@/lib/chat/useFieldDictation";

interface ChatVisualFrameProps {
  /** The page, its local images in (`ChatState.visuals`). */
  html: string;
  title: string;
  /** Fills its box (« Agrandir »), the page as written: its media not fitted. */
  fill?: boolean;
  /** The probe checked it clean: its growth is never stopped (`nextFrameHeight`). */
  verified?: boolean;
  /** A choice of the page (`arkadia.choose`), on the user's click in it. */
  onChoose?: (text: string) => void;
  /** A link of the page, on the user's click: the browser opens it. */
  onLink?: (url: string) => void;
}

/** Height before the page says its own (`size`). */
const FIRST_HEIGHT = 160;

const px = (value: string) => parseFloat(value) || 0;

/**
 * A wheel the page left unused (the page cancels its own scroll then), on
 * the conversation around the frame. WebView2 doesn't hand it on by itself:
 * the pointer over a visual froze the column (the user's report of
 * 01/11/2026). In « Agrandir » nothing scrolls around: the page scrolls.
 */
function scrollAround(
  iframe: HTMLIFrameElement,
  wheel: { dx: number; dy: number; mode: number },
): void {
  for (let n = iframe.parentElement; n; n = n.parentElement) {
    const style = window.getComputedStyle(n);
    if (!/(auto|scroll)/.test(style.overflowY)) continue;
    if (n.scrollHeight <= n.clientHeight + 1) continue;
    glideBy(n, wheelPixels(wheel.dy, wheel.mode, n.clientHeight));
    return;
  }
}

/**
 * The room a card has in its column, read from the layout itself: the
 * column's visible height less its own padding, the card's band (the
 * element over the frame), its foot (« Replier », under it) and the card's
 * border. Null in a hidden tab (a column sized to nothing).
 */
function roomIn(box: HTMLElement): number | null {
  const scroller = box.closest<HTMLElement>(".chat-scroll");
  const visible = scroller?.clientHeight ?? 0;
  if (!scroller || visible <= 0) return null;
  const column = scroller.firstElementChild;
  const columnStyle = column ? window.getComputedStyle(column) : null;
  const pad = columnStyle
    ? px(columnStyle.paddingTop) + px(columnStyle.paddingBottom)
    : 0;
  const card = box.parentElement;
  const cardStyle = card ? window.getComputedStyle(card) : null;
  const border = cardStyle
    ? px(cardStyle.borderTopWidth) + px(cardStyle.borderBottomWidth)
    : 0;
  const band =
    (box.previousElementSibling as HTMLElement | null)?.offsetHeight ?? 0;
  const foot =
    (box.nextElementSibling as HTMLElement | null)?.offsetHeight ?? 0;
  return Math.max(0, Math.floor(visible - pad - band - foot - border));
}

/**
 * The page's own height on the frame. True when it changed: the page may
 * answer it (`nextFrameHeight`).
 */
function applySize(iframe: HTMLIFrameElement, height: number): boolean {
  const resized = iframe.style.height !== `${height}px`;
  iframe.style.height = `${height}px`;
  return resized;
}

/**
 * A visual's sandboxed frame (`loadVisualFrame`). In the column its media
 * take the room the card has (`--ark-fit-h`); the page itself is never
 * scaled down (Alexis, 13/11/2026: scaled from its centre, it no longer
 * took the card's width): a page taller than the pane keeps its size and
 * the conversation scrolls. Never a scrollbar inside: the frame is the
 * page's whole height, except a page that grows with its frame, stopped
 * (`nextFrameHeight`). A new page gets a new frame, never the old one's
 * state.
 */
export function ChatVisualFrame({
  html,
  title,
  fill = false,
  verified = false,
  onChoose,
  onLink,
}: ChatVisualFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const setFitRef = useRef<((height: number) => void) | null>(null);
  const [growth, setGrowth] = useState(() => firstFrameGrowth(FIRST_HEIGHT));
  const [room, setRoom] = useState<number | null>(null);
  /** The room as last measured, for a frame created before the next render. */
  const roomRef = useRef<number | null>(null);
  /** The page's own height, for whichever frame is there. */
  const sizeRef = useRef(FIRST_HEIGHT);
  /** Read by the frame's listener: a check that comes later counts at once. */
  const verifiedRef = useRef(verified);
  useEffect(() => {
    verifiedRef.current = verified;
  }, [verified]);
  /** When the Lab last changed the frame's height (`performance.now()`). */
  const resizedAtRef = useRef<number | null>(null);
  const resize = (iframe: HTMLIFrameElement) => {
    if (applySize(iframe, sizeRef.current))
      resizedAtRef.current = performance.now();
  };
  // The page's mic (the choice kit's remark): the pane's dictation, its
  // text back to this frame only (the user's ask of 14/11/2026).
  const field = useFieldDictation(useContext(ChatDictationContext), (text) =>
    frameRef.current?.contentWindow?.postMessage(
      { arkadiaVisualDictated: text },
      "*",
    ),
  );
  const voiceState = {
    can: field.can,
    mine: field.mine,
    status: field.status,
    interim: field.interim,
  };
  const handlers = useRef({ onChoose, onLink, field, voiceState });
  useEffect(() => {
    handlers.current = { onChoose, onLink, field, voiceState };
  });
  // Where the dictation stands, for the page's mics (said again once the
  // page is in: `loaded`).
  const sayVoice = () =>
    frameRef.current?.contentWindow?.postMessage(
      { arkadiaVisualVoice: handlers.current.voiceState },
      "*",
    );
  useEffect(() => {
    if (voiceState.can) sayVoice();
  }, [voiceState.can, voiceState.mine, voiceState.status, voiceState.interim]);
  // The pane's height, as it changes (resize, split, the input growing).
  useLayoutEffect(() => {
    const box = boxRef.current;
    const scroller = box?.closest<HTMLElement>(".chat-scroll");
    if (fill || !box || !scroller) return;
    // Any change of the column (its height, its width) is the Lab's: the
    // page's growths that follow never mean it follows its frame.
    const measure = () => {
      setGrowth(refitFrameGrowth);
      const next = roomIn(box);
      if (next === null) return;
      roomRef.current = next;
      setRoom(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [fill]);
  // The frame keeps the page's own height.
  useLayoutEffect(() => {
    sizeRef.current = growth.height;
    if (frameRef.current && !fill) resize(frameRef.current);
  });
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const iframe = document.createElement("iframe");
    iframe.title = title;
    box.appendChild(iframe);
    frameRef.current = iframe;
    // A new page starts its own count, at the height shown.
    setGrowth(firstFrameGrowth(sizeRef.current));
    // Its size before its first report: until then no render would give
    // it, and a frame left at 100% scrolls inside.
    if (!fill) resize(iframe);
    const { stop, setFit } = loadVisualFrame(
      iframe,
      html,
      (m) => {
        if (m.kind === "loaded") {
          if (handlers.current.voiceState.can) sayVoice();
        } else if (m.kind === "size") {
          const at = resizedAtRef.current;
          const since = at === null ? null : performance.now() - at;
          setGrowth((g) =>
            nextFrameHeight(
              g,
              clampVisualHeight(m.height),
              since,
              !verifiedRef.current,
            ),
          );
        }
        // A wheel the page doesn't use scrolls the conversation, wherever
        // the pointer is over the visual (the user's report of 01/11/2026).
        else if (m.kind === "wheel") scrollAround(iframe, m);
        // Only the user's click in this frame acts (`frameGestureOk`).
        else if (m.kind === "choose" && frameGestureNow(iframe)) {
          const choose = handlers.current.onChoose;
          if (choose) {
            choose(m.text);
            // The page may say so (the choice kit's « Ajouté »): it went in.
            iframe.contentWindow?.postMessage({ arkadiaVisualChosen: 1 }, "*");
          }
        } else if (m.kind === "link" && frameGestureNow(iframe))
          handlers.current.onLink?.(m.url);
        // Listening starts only on the user's own click or key in this frame
        // (`frameDictationOk`): a page can't open the mic by itself.
        else if (m.kind === "dictate") {
          if (!m.on) handlers.current.field.stop();
          else if (frameDictationNow(iframe)) handlers.current.field.start();
        }
      },
      fill ? undefined : (roomRef.current ?? undefined),
      !fill,
    );
    setFitRef.current = setFit;
    return () => {
      stop();
      iframe.remove();
      if (frameRef.current === iframe) frameRef.current = null;
      setFitRef.current = null;
    };
  }, [html, title, fill]);
  // A new room: the page refits its media to it (held until the page is in).
  useEffect(() => {
    if (fill || room === null) return;
    setGrowth(refitFrameGrowth);
    setFitRef.current?.(room);
  }, [room, fill]);
  return (
    <div
      ref={boxRef}
      className="chat-visual-box"
      style={fill ? undefined : { height: growth.height }}
    />
  );
}
