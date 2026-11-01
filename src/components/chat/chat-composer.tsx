import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatAttachments } from "@/components/chat/chat-attachments";
import type { AttachmentSource } from "@/components/chat/chat-attachment-card";
import { messageDraft, withAttachedPaths } from "@/lib/chat/chatAttachments";
import { usePastedPaths } from "@/lib/chat/usePastedPaths";
import type { ActionButton } from "@/types";
import { ChatCommandsMenu } from "@/components/chat/chat-commands-menu";
import { ChatRailActions } from "@/components/chat/chat-rail-actions";
import { ChatPasteTags } from "@/components/chat/chat-paste-tags";
import { ChatSlashMenu } from "@/components/chat/chat-slash-menu";
import {
  brokenPastes,
  dropTag,
  editPaste,
  expandPastes,
  pasteInto,
  pasteSpans,
  rememberPastes,
  tagAt,
  unfoldPaste,
  type PastedText,
} from "@/lib/chat/chatPastes";
import { useSlashMenu, type ChatSlash } from "@/lib/chat/useSlashMenu";
import { useChatLayers } from "@/lib/chat/useChatLayers";
import type { ChatImage } from "@/lib/chat/useChatSession";
import { hasQueued, type ChatItem } from "@/lib/chat/chatState";
import { useSendAfterDictation } from "@/lib/chat/useSendAfterDictation";
import { useChatSuggestion } from "@/lib/chat/useChatSuggestion";
import { attachedKey, useInputHistory } from "@/lib/chat/useInputHistory";
import { useTypeToInput } from "@/lib/chat/useTypeToInput";
import {
  EMPTY_DRAFT,
  insertDictation,
  redirectDictation,
  type ChatDraft,
  type DraftFile,
  type DraftImage as Attachment,
} from "@/lib/chat/chatDrafts";
import type { DictationEnd, VoiceStatus } from "@/lib/useHiddenVoice";
import type { PermissionMode } from "@/lib/chat/chatProtocol";
import { nextMode } from "@/lib/chat/chatLabels";
import { bashCommand } from "@/lib/chat/chatBash";

/** Claude's dictation (`useHiddenVoice`): its text lands in the draft. */
export interface ChatVoice {
  status: VoiceStatus;
  /** True once listening (`useHiddenVoice`); the preview's says nothing. */
  start: () => unknown;
  /** Resolves once the dictated text is in the draft, or with why not
   *  (`quiet`: true while the caller is there to show the failure). */
  stop: (options?: { quiet?: () => boolean }) => Promise<DictationEnd>;
  /** The words so far, dim under the text until the dictation lands. */
  interim?: string;
  /** Another field takes this dictation (the question sheet's): no wave here. */
  elsewhere?: boolean;
}

const VOICE_TITLES: Record<VoiceStatus, string> = {
  idle: "Dicter (Ctrl+Espace)",
  starting: "Démarrage du vocal… (clic pour annuler)",
  listening: "J'écoute : clic ou Ctrl+Espace pour arrêter",
  transcribing: "Transcription…",
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const NO_FILES: DraftFile[] = [];
const NO_PASTES: PastedText[] = [];
/** The wave's bars, each its own beat. */
const WAVE_DELAYS = [0, 180, 90, 320, 140, 260, 40, 210, 120, 300, 70, 240];

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        id: `${file.name}-${file.size}-${Math.random()}`,
        url,
        mediaType: file.type,
        data: url.slice(url.indexOf(",") + 1),
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The input card: text (Enter sends, Shift+Enter breaks the line), cards of
 * the attached files and pasted images above it (`chatAttachments`: picker,
 * drag & drop, Ctrl+V of an image or of paths), `/` commands, the terminal
 * rail's actions (`ChatRailActions`). Its bottom row starts with `leading`:
 * the session's button (model, effort, mode) and its rings.
 * Esc first closes what is open in the pane (`chatLayers`), then interrupts
 * a working Claude (its turn only: background agents and workflows go on), Ctrl+B sends its running command or agent to the
 * background, Shift+Tab cycles the mode, as in the terminal. A message sent while Claude works waits for its turn; Ctrl+Enter
 * sends it now (the turn under way stops), or, input empty, the ones waiting.
 * Sent mid-dictation, the draft goes once the dictated text is in. A message
 * that starts with `!` runs as a shell command (`onBash`), Esc stops it.
 * Asleep, the empty input says so: the first key wakes Claude (`ChatView`).
 */
export function ChatComposer({
  items,
  working,
  mode,
  slash,
  draft,
  onDraft,
  voice,
  focusKey,
  onSend,
  onInterrupt,
  onBackground,
  onMode,
  messagesOnly,
  onMessagesOnly,
  active,
  onToast,
  suggestion = null,
  onOpen,
  leading,
  paneKey,
  onBash,
  onStopBash,
  asleep = false,
}: {
  /** The conversation, for the copy of Claude's last code block. */
  items: ChatItem[];
  working: boolean;
  mode: string | null;
  /** The `/` menu's commands and the page's own (`useSlashMenu`). */
  slash: ChatSlash;
  draft: ChatDraft;
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  voice: ChatVoice;
  /** Changes when the composer should take the focus (pane activated). */
  focusKey: unknown;
  /** `now`: Claude Code ends the turn under way for it (Ctrl+Enter). */
  onSend: (text: string, images: ChatImage[], now?: boolean) => void;
  onInterrupt: () => void;
  /** Ctrl+B while Claude works: its running Bash and agents to the background. */
  onBackground?: () => void;
  onMode: (mode: PermissionMode) => void;
  messagesOnly: boolean;
  onMessagesOnly: (on: boolean) => void;
  /** The pane is the active one and on screen (`ChatRailActions`). */
  active: boolean;
  onToast?: ToastFn;
  /** Claude Code's guess at the next message: grey in the empty input. */
  suggestion?: string | null;
  /** An image card clicked: the lightbox. */
  onOpen?: (content: LightboxContent) => void;
  /** First in the bottom row: the session's button and rings (`ChatView`). */
  leading?: React.ReactNode;
  /** `!command`: runs in the tab's folder instead of going to Claude. */
  onBash?: (command: string) => void;
  /** The pane's key: a push-to-talk dictation lands at the caret (`redirectDictation`). */
  paneKey?: string;
  /** A `!` command runs: Esc stops it before anything else of Claude's. */
  onStopBash?: () => void;
  /** Claude Code sleeps: the empty input says a key wakes it. */
  asleep?: boolean;
}) {
  const { text, images } = draft;
  const files = draft.files ?? NO_FILES;
  const pastes = draft.pastes ?? NO_PASTES;
  const setText = (value: string) => onDraft((d) => ({ ...d, text: value }));
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const layers = useChatLayers();
  // Asleep, the input's only words are the sleep's (its first key wakes it).
  const ghost = useChatSuggestion(asleep ? null : suggestion, text, working);
  // ↑ / ↓ bring back the pane's last messages (empty input), their
  // attachments as cards.
  const history = useInputHistory(
    items,
    text,
    (message) => onDraft((d) => ({ ...d, ...messageDraft(message) })),
    attachedKey(
      files.map((f) => f.path),
      images.length,
    ),
  );
  // A key typed after a click in the conversation still lands here.
  useTypeToInput(
    areaRef,
    useCallback(
      (key: string) => onDraft((d) => ({ ...d, text: d.text + key })),
      [onDraft],
    ),
    active,
  );
  const slashMenu = useSlashMenu({
    text,
    setText,
    slash,
    send: (command, now) => {
      onSend(command, [], now);
      setText("");
    },
  });

  // The mic button lives here: whatever takes the input away (a request, the
  // chat ending) stops the recording it would no longer show.
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });
  useEffect(
    () => () => {
      const { status, stop } = voiceRef.current;
      if (status === "listening" || status === "starting") void stop();
    },
    [],
  );

  // Only when its pane is (or becomes) the active one: a chat beside a
  // terminal must not take the keyboard back from it.
  useEffect(() => {
    if (focusKey) areaRef.current?.focus();
  }, [focusKey]);

  // Grow with the text, up to the CSS max height.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    const max = parseFloat(window.getComputedStyle(area).maxHeight) || Infinity;
    // A scrollbar only once the text outgrows the card.
    area.style.overflowY = area.scrollHeight > max ? "auto" : "hidden";
    area.style.height = `${Math.min(area.scrollHeight + 2, max)}px`;
  }, [text]);

  // Each image numbered; pasted, its tag « [Image #n] » goes where the
  // caret was, so Claude knows which one the text means (the user's ask of
  // 01/11/2026, as Claude Code does).
  const addFiles = async (
    files: Iterable<File>,
    caret?: { start: number; end: number },
  ) => {
    const picked = [...files].filter((f) => IMAGE_TYPES.includes(f.type));
    const read = await Promise.all(picked.map(readImage));
    onDraft((d) => {
      // After every number in use, the cards' and the text's: never two
      // « [Image #2] ».
      let last = Math.max(
        0,
        ...d.images.map((img) => img.n ?? 0),
        ...[...d.text.matchAll(/\[Image #(\d+)\]/g)].map((m) => Number(m[1])),
      );
      const added = read.map((img) => ({ ...img, n: ++last }));
      if (!caret) return { ...d, images: [...d.images, ...added] };
      const tags = added.map((img) => `[Image #${img.n}]`).join(" ");
      const at = Math.min(caret.start, d.text.length);
      const to = Math.min(Math.max(caret.end, at), d.text.length);
      return {
        ...d,
        text: d.text.slice(0, at) + tags + d.text.slice(to),
        images: [...d.images, ...added],
      };
    });
  };

  const pastePaths = usePastedPaths(onDraft);
  // Pasted images first, then the files, as the user's frame shows them.
  const cards = useMemo<AttachmentSource[]>(
    () => [
      ...images.map((img, n) => ({
        kind: "pasted" as const,
        key: img.id,
        url: img.url,
        name: `Image collée ${img.n ?? n + 1}`,
      })),
      ...files.map((f) => ({ kind: "path" as const, key: f.id, path: f.path })),
    ],
    [images, files],
  );
  const removeCard = (key: string) =>
    onDraft((d) => {
      // An image's tag goes with it: no « [Image #2] » for nothing.
      const n = d.images.find((x) => x.id === key)?.n;
      return {
        ...d,
        text: n ? d.text.split(`[Image #${n}]`).join("") : d.text,
        images: d.images.filter((x) => x.id !== key),
        files: d.files?.filter((x) => x.id !== key),
      };
    });

  const queued = useMemo(() => hasQueued(items), [items]);
  const send = (now: boolean) => {
    // A tag typed over would send its words, not its text: said first.
    if (brokenPastes(text, pastes).length > 0) {
      onToast?.(
        "info",
        "Une étiquette de texte collé est abîmée : efface-la et recolle le texte",
      );
      return;
    }
    // The pasted texts' tags back as the texts themselves (`chatPastes`).
    const body = expandPastes(text, pastes).trim();
    if (!body && images.length === 0 && files.length === 0) {
      // Ctrl+Enter on an empty input: the messages waiting go now.
      if (now && queued) onInterrupt();
      return;
    }
    // `!command`: the shell's, not Claude's; the attachments stay for the next message.
    const command = onBash ? bashCommand(body) : null;
    if (command) {
      onBash?.(command);
      setText("");
      return;
    }
    // /resume, /rewind, a terminal-only command: the page answers.
    if (files.length === 0 && slashMenu.intercept(body)) return;
    // The user's frame shows them as tags again.
    rememberPastes(pasteSpans(text, pastes).map((s) => s.paste.text));
    // The attached files as Claude Code reads them: their quoted paths.
    onSend(
      withAttachedPaths(
        body,
        files.map((f) => f.path),
      ),
      images.map(({ mediaType, data, n }) => ({
        mediaType,
        data,
        ...(n ? { label: `Image #${n}` } : {}),
      })),
      now,
    );
    onDraft(EMPTY_DRAFT);
  };
  const { waiting, submit } = useSendAfterDictation(voice, send, onToast);
  // A prompt-bar command (« Commandes »): sent at once when set so, else
  // typed at the caret to edit. The draft being written is never lost.
  const runCommand = (button: ActionButton) => {
    const area = areaRef.current;
    if (button.submit) {
      // `!command`: the shell's, as typed.
      const command = onBash ? bashCommand(button.command) : null;
      if (command) {
        onBash?.(command);
        return;
      }
      if (slashMenu.takes(button.command)) {
        // /resume and the like open in the input: never over a draft.
        if (text.trim()) {
          onToast?.(
            "info",
            `Saisie en cours : envoie-la ou vide-la avant ${button.command}`,
          );
          return;
        }
        slashMenu.intercept(button.command);
        return;
      }
      onSend(button.command, []);
      return;
    }
    // As the terminal's bar types it: at the caret, the rest kept.
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? start;
    setText(text.slice(0, start) + button.command + text.slice(end));
    area?.focus();
    const caret = start + button.command.length;
    requestAnimationFrame(() => area?.setSelectionRange(caret, caret));
  };

  // The rail's gesture: one click starts, the next stops (Ctrl+Space too).
  const toggleVoice = () => {
    if (voice.status === "idle") void voice.start();
    else if (voice.status !== "transcribing") void voice.stop();
    areaRef.current?.focus();
  };

  // Space held talks, as Claude Code's push-to-talk, anywhere in the
  // input (the user's asks of 01/11/2026): a tap types its space; held, the
  // key's repeat takes that space back and dictates, the text landing where
  // the caret was; the release stops it.
  const talkRef = useRef<{ talking: boolean; at: number } | null>(null);
  // Space held: the dictation lands mid-text (its words show in the wave's
  // line) or at the end (in grey after the text, in place).
  const [pushTalk, setPushTalk] = useState<{ mid: boolean } | null>(null);
  // Where the caret was: a move into a tag goes over it, its way.
  const caretRef = useRef<number | null>(null);
  const plainSpace = (e: React.KeyboardEvent) =>
    e.key === " " && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // A pasted text's tag goes whole: Backspace just after it, Delete just
    // before it (`chatPastes.tagAt`).
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      const area = e.currentTarget;
      const span =
        area.selectionStart === area.selectionEnd &&
        tagAt(
          text,
          pastes,
          area.selectionStart,
          e.key === "Backspace" ? "after" : "before",
        );
      if (span) {
        e.preventDefault();
        onDraft((d) => ({ ...d, ...dropTag(d.text, d.pastes ?? [], span) }));
        requestAnimationFrame(() => {
          if (area.isConnected) area.setSelectionRange(span.start, span.start);
        });
        return;
      }
    }
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      // Held down, the key repeats: only its first press toggles.
      if (!e.repeat) toggleVoice();
      return;
    }
    if (plainSpace(e)) {
      const area = e.currentTarget;
      if (!e.repeat) {
        // A selection replaced by the space can't be given back: no talk.
        talkRef.current =
          area.selectionStart === area.selectionEnd
            ? { talking: false, at: area.selectionStart }
            : null;
        return;
      }
      const talk = talkRef.current;
      if (talk) {
        e.preventDefault();
        if (!talk.talking && voice.status === "idle") {
          talk.talking = true;
          setPushTalk({ mid: talk.at < text.trimEnd().length });
          // The tap's space, typed a moment ago, goes.
          const base =
            text[talk.at] === " "
              ? text.slice(0, talk.at) + text.slice(talk.at + 1)
              : text;
          if (base !== text) setText(base);
          const at = talk.at;
          // The input gets the dictation only once listening began: a start
          // refused (another pane dictating) leaves no target behind.
          void Promise.resolve(voice.start()).then((started) => {
            if (started !== true || !paneKey) return;
            redirectDictation(paneKey, (dictated) =>
              onDraft((d) => ({
                ...d,
                // The text changed meanwhile: the caret's spot is no
                // longer sure, the dictation goes at the end.
                text: insertDictation(
                  d.text,
                  d.text === base ? at : d.text.length,
                  dictated,
                ),
              })),
            );
          });
        }
        return;
      }
    }
    if (history.onKeyDown(e)) return;
    if (slashMenu.onKeyDown(e)) return;
    // Tab takes the suggestion, only in the empty input with no menu open.
    if (e.key === "Tab" && !e.shiftKey && ghost) {
      e.preventDefault();
      setText(ghost);
      return;
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onMode(nextMode(mode));
      return;
    }
    if (e.key === "Escape") {
      // A list, menu or sheet of the pane open: Esc is for it, never Claude.
      if (layers?.closeTop()) e.preventDefault();
      // The user's own `!` command first, as the terminal's bash mode.
      else if (onStopBash) {
        e.preventDefault();
        onStopBash();
      } else if (working) {
        e.preventDefault();
        onInterrupt();
      }
      return;
    }
    if (
      e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "b" &&
      working &&
      onBackground
    ) {
      e.preventDefault();
      onBackground();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(e.ctrlKey);
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== " " || !talkRef.current) return;
    const { talking } = talkRef.current;
    talkRef.current = null;
    setPushTalk(null);
    if (talking && voice.status !== "idle" && voice.status !== "transcribing")
      void voice.stop();
  };

  const empty = !text.trim() && images.length === 0 && files.length === 0;
  // The words as they come, in grey after the text when they land at its
  // end; mid-text, in the wave's line.
  const interimInPlace = !!voice.interim && !voice.elsewhere && !pushTalk?.mid;
  const bashMode = !!onBash && text.trimStart().startsWith("!");
  return (
    <div className="chat-box">
      <ChatSlashMenu menu={slashMenu} />
      <ChatAttachments
        sources={cards}
        onOpen={(content) => onOpen?.(content)}
        onRemove={removeCard}
        onToast={onToast}
      />
      <textarea
        ref={areaRef}
        rows={1}
        value={text}
        className={ghost ? "suggest" : bashMode ? "bash" : undefined}
        title={
          bashMode
            ? "Commande shell (Git Bash) dans le dossier de l'onglet"
            : undefined
        }
        // Only the suggested next message, never a help text (the user's
        // ask of 01/11/2026): Tab takes it, as in Claude Code.
        placeholder={voice.interim ? "" : (ghost ?? "")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        // A caret put inside a tag (a click, an arrow) goes to its end:
        // nothing is typed, dictated or inserted into it.
        onSelect={(e) => {
          const area = e.currentTarget;
          const from = caretRef.current;
          caretRef.current = area.selectionStart;
          if (area.selectionStart !== area.selectionEnd) return;
          const span = tagAt(text, pastes, area.selectionStart, "inside");
          if (!span) return;
          // Coming from its end (←, Ctrl+←): over it to its start; else
          // to its end. Never stuck behind it.
          const to = from !== null && from >= span.end ? span.start : span.end;
          caretRef.current = to;
          area.setSelectionRange(to, to);
        }}
        // Space released elsewhere: the dictation still stops.
        onBlur={() => {
          if (
            talkRef.current?.talking &&
            voice.status !== "idle" &&
            voice.status !== "transcribing"
          )
            void voice.stop();
          talkRef.current = null;
          setPushTalk(null);
        }}
        onPaste={(e) => {
          const pasted = [...e.clipboardData.files];
          if (pasted.some((f) => IMAGE_TYPES.includes(f.type))) {
            e.preventDefault();
            const area = e.currentTarget;
            // A `!` command takes no « [Image #n] » in its words.
            void addFiles(
              pasted,
              bashMode
                ? undefined
                : { start: area.selectionStart, end: area.selectionEnd },
            );
            return;
          }
          // Paths alone: cards, once they exist on disk.
          if (pastePaths(e)) return;
          // A long text: a tag at the caret, or the tag back as its text
          // when pasted again (the user's ask of 01/11/2026). Never for a
          // `!` command, typed as is.
          if (bashMode) return;
          const area = e.currentTarget;
          const clip = e.clipboardData
            .getData("text/plain")
            .replace(/\r\n/g, "\n");
          const r = pasteInto(
            text,
            area.selectionStart,
            area.selectionEnd,
            clip,
            pastes,
          );
          if (!r) return;
          e.preventDefault();
          onDraft((d) => ({ ...d, text: r.text, pastes: r.pastes }));
          requestAnimationFrame(() => {
            if (area.isConnected) area.setSelectionRange(r.caret, r.caret);
          });
        }}
      />
      <ChatPasteTags
        areaRef={areaRef}
        text={text}
        pastes={pastes}
        trailing={interimInPlace ? voice.interim : undefined}
        onEdit={(id, next) =>
          onDraft((d) => ({
            ...d,
            ...editPaste(d.text, d.pastes ?? [], id, next),
          }))
        }
        onUnfold={(id) =>
          onDraft((d) => ({ ...d, ...unfoldPaste(d.text, d.pastes ?? [], id) }))
        }
      />
      {/* While dictating: a live wave, the words as they come (in place
          after the text, or here when they go mid-text), how to finish
          (the user's pick 16 of 01/11/2026). */}
      {voice.status !== "idle" && !voice.elsewhere && (
        <div
          className={`chat-voice-wave${voice.status === "transcribing" ? " still" : ""}`}
          title="Dictée en cours"
        >
          <span className="wave" aria-hidden>
            {WAVE_DELAYS.map((d, i) => (
              <i key={i} style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
          {voice.interim && !interimInPlace && (
            <span className="words">{voice.interim}</span>
          )}
          <span className="hint">
            {voice.status === "transcribing"
              ? "transcription…"
              : pushTalk
                ? "Espace maintenu · relâche pour finir"
                : "clique sur le micro pour finir"}
          </span>
        </div>
      )}
      <div className="chat-tools-row">
        {leading}
        {/* Insert, hide, mic, send: one group on the right, never split. */}
        <div className="chat-tools-end">
          <ChatCommandsMenu onRun={runCommand} />
          <ChatRailActions
            onDraft={onDraft}
            areaRef={areaRef}
            messagesOnly={messagesOnly}
            onMessagesOnly={onMessagesOnly}
            active={active}
          />
          <button
            type="button"
            className={`chat-round mic${voice.status === "listening" ? " rec" : ""}`}
            title={VOICE_TITLES[voice.status]}
            disabled={voice.status === "transcribing"}
            onClick={toggleVoice}
          >
            {voice.status === "listening" ? (
              <Square />
            ) : voice.status === "idle" ? (
              <Mic />
            ) : (
              <span className="spin" />
            )}
          </button>
          {working && empty && voice.status === "idle" && !waiting ? (
            <button
              type="button"
              className="chat-round stop"
              title="Interrompre (Échap)"
              onClick={onInterrupt}
            >
              <Square />
            </button>
          ) : (
            <button
              type="button"
              className={`chat-round send${waiting ? " waiting" : ""}`}
              title={
                waiting
                  ? "Envoi dès la fin de la dictée…"
                  : working
                    ? "Envoyer après le tour en cours (Entrée) · tout de suite : Ctrl+Entrée"
                    : "Envoyer (Entrée)"
              }
              disabled={empty && voice.status === "idle"}
              onClick={(e) => void submit(e.ctrlKey)}
            >
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
