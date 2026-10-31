import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { attachPaths } from "@/lib/chat/chatAttachments";
import type { ChatDraft } from "@/lib/chat/chatDrafts";

/** Gap kept between the picker and the input card, and below the pane's top. */
export const PICKER_GAP_PX = 8;

/** Least height given to the panel, even in a pane too short for it. */
const MIN_ROOM_PX = 140;

/**
 * The terminal rail's file picker (`FilePicker`) for the chat's input: the
 * picked files become cards above the input (`chatAttachments`), added to
 * the draft of the moment (a dictation may have landed meanwhile), and the
 * input takes the focus back. Nothing is sent.
 *
 * `active`: the pane is the active one and on screen. The picker closes as
 * soon as it is not, and only an active pane's input gets the focus back.
 * `wrapRef` goes on the element holding both the button and the panel: a
 * click outside it closes the picker (and leaves the focus where it lands).
 */
export function useDraftFilePicker(
  areaRef: RefObject<HTMLTextAreaElement | null>,
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>,
  active: boolean,
) {
  const [open, setOpen] = useState(false);
  // Height the panel may take between the input card and the pane's top.
  const [room, setRoom] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef(active);

  // Another pane activated, or the tab hidden: the panel goes, without
  // taking the focus anywhere.
  useEffect(() => {
    activeRef.current = active;
    if (!active) setOpen(false);
  }, [active]);

  const show = useCallback(() => {
    // The panel opens over the input card (over the buttons if they move out).
    const wrap = wrapRef.current;
    const box = (wrap?.closest(".chat-box") ?? wrap)?.getBoundingClientRect();
    const pane = wrap?.closest(".chat-root")?.getBoundingClientRect();
    const fits = box && pane ? box.top - pane.top - 2 * PICKER_GAP_PX : 0;
    setRoom(Math.max(MIN_ROOM_PX, fits));
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (activeRef.current) areaRef.current?.focus();
  }, [areaRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const insert = useCallback(
    (paths: string[]) => {
      onDraft((d) => attachPaths(d, paths));
      close();
    },
    [onDraft, close],
  );

  return { open, room, wrapRef, show, close, insert };
}
