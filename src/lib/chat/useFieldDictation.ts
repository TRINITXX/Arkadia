import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { ChatVoice } from "@/components/chat/chat-composer";
import { redirectDictation, releaseDictation } from "@/lib/chat/chatDrafts";

/**
 * The pane's dictation, for a field that isn't the input: a visual's remark
 * (`ChatVisualFrame`), the « Autre réponse » of Claude's questions
 * (`ChatQuestionPanel`). `onElsewhere` tells the input a field holds it: the
 * input's mic stays lit, its words show in that field only.
 */
export interface ChatDictation {
  paneKey: string;
  voice: ChatVoice;
  onElsewhere: (on: boolean) => void;
}

export const ChatDictationContext = createContext<ChatDictation | null>(null);

/** A plain Space, as push-to-talk takes it (`ChatComposer`'s). */
export const plainSpace = (e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) => e.key === " " && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;

export interface FieldDictation {
  /** The pane can dictate here (a pane, its voice). */
  can: boolean;
  /** This field holds the dictation under way. */
  mine: boolean;
  /** Listening or transcribing elsewhere: this field's mic waits. */
  busy: boolean;
  /** The words so far, while this field holds the dictation. */
  interim: string;
  status: ChatVoice["status"];
  toggle: () => void;
  start: () => void;
  stop: () => void;
}

/**
 * One field's share of the pane's dictation: its text lands through
 * `onText` once listening began (a start refused leaves no target), and
 * falls back to the input's draft if the field goes before it lands.
 */
export function useFieldDictation(
  dictation: ChatDictation | null,
  onText: (text: string) => void,
): FieldDictation {
  const [mine, setMine] = useState(false);
  const mineRef = useRef(false);
  const live = useRef({ dictation, onText });
  useEffect(() => {
    live.current = { dictation, onText };
  });
  const status = dictation?.voice.status ?? "idle";
  // The dictation over (text in, failed or cancelled): nothing held.
  useEffect(() => {
    if (status !== "idle") return;
    mineRef.current = false;
    setMine(false);
  }, [status]);
  const holds = mine && status !== "idle";
  const onElsewhere = dictation?.onElsewhere;
  useEffect(() => {
    if (!holds || !onElsewhere) return;
    onElsewhere(true);
    return () => onElsewhere(false);
  }, [holds, onElsewhere]);
  // The field gone while it holds the dictation: it stops, its text goes
  // to the draft (no target left).
  /** The target this field set: the only one it may take back. */
  const targetRef = useRef<((text: string) => void) | null>(null);
  useEffect(
    () => () => {
      if (!mineRef.current) return;
      mineRef.current = false;
      const d = live.current.dictation;
      if (!d) return;
      releaseDictation(d.paneKey, targetRef.current);
      const s = d.voice.status;
      if (s === "starting" || s === "listening") void d.voice.stop();
    },
    [],
  );

  const start = useCallback(() => {
    const d = live.current.dictation;
    if (!d || d.voice.status !== "idle") return;
    mineRef.current = true;
    setMine(true);
    void Promise.resolve(d.voice.start()).then((started) => {
      if (started === true && mineRef.current) {
        const target = (text: string) => live.current.onText(text);
        targetRef.current = target;
        redirectDictation(d.paneKey, target);
        return;
      }
      // Listening began for a field gone or stopped meanwhile: no one
      // would take it, it stops (its words then go to the draft).
      if (started === true) void d.voice.stop();
      mineRef.current = false;
      setMine(false);
    });
  }, []);
  const stop = useCallback(() => {
    const d = live.current.dictation;
    if (!d || !mineRef.current) return;
    const s = d.voice.status;
    if (s === "starting" || s === "listening") void d.voice.stop();
  }, []);
  const toggle = useCallback(() => {
    const d = live.current.dictation;
    if (!d) return;
    if (d.voice.status === "idle") start();
    else if (mineRef.current) stop();
  }, [start, stop]);

  return {
    can: dictation !== null,
    mine: holds,
    busy: !holds && status !== "idle",
    interim: holds ? (dictation?.voice.interim ?? "") : "",
    status,
    toggle,
    start,
    stop,
  };
}

/**
 * Space held talks into a React field, as in the input: the tap's space
 * typed a moment ago goes, the release (or the field left) stops it;
 * Ctrl+Space toggles. `keyDown` says whether it took the key.
 */
export function usePushToTalk(
  field: FieldDictation,
  text: string,
  setText: (text: string) => void,
) {
  const talkRef = useRef<{ talking: boolean; at: number } | null>(null);
  const release = () => {
    const talking = talkRef.current?.talking;
    talkRef.current = null;
    if (talking) field.stop();
  };
  const keyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): boolean => {
    if (!field.can) return false;
    if (e.key === " " && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (!e.repeat) field.toggle();
      return true;
    }
    if (!plainSpace(e)) return false;
    const el = e.currentTarget;
    if (!e.repeat) {
      // A selection the space replaced can't come back: no talk.
      talkRef.current =
        el.selectionStart === el.selectionEnd
          ? { talking: false, at: el.selectionStart ?? text.length }
          : null;
      return false;
    }
    const talk = talkRef.current;
    if (!talk) return false;
    e.preventDefault();
    if (talk.talking || field.status !== "idle") return true;
    talk.talking = true;
    if (text[talk.at] === " ")
      setText(text.slice(0, talk.at) + text.slice(talk.at + 1));
    field.start();
    return true;
  };
  const keyUp = (e: React.KeyboardEvent) => {
    if (e.key === " " && talkRef.current) release();
  };
  return { keyDown, keyUp, blur: release };
}
