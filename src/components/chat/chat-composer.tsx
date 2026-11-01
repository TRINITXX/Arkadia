import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatAttachments } from "@/components/chat/chat-attachments";
import type { AttachmentSource } from "@/components/chat/chat-attachment-card";
import { messageDraft, withAttachedPaths } from "@/lib/chat/chatAttachments";
import { usePastedPaths } from "@/lib/chat/usePastedPaths";
import { ChatRailActions } from "@/components/chat/chat-rail-actions";
import { ChatSlashMenu } from "@/components/chat/chat-slash-menu";
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
}

const VOICE_TITLES: Record<VoiceStatus, string> = {
  idle: "Dicter (Ctrl+Espace)",
  starting: "Démarrage du vocal… (clic pour annuler)",
  listening: "J'écoute : clic ou Ctrl+Espace pour arrêter",
  transcribing: "Transcription…",
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const NO_FILES: DraftFile[] = [];

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
  /** A `!` command runs: Esc stops it before anything else of Claude's. */
  onStopBash?: () => void;
  /** Claude Code sleeps: the empty input says a key wakes it. */
  asleep?: boolean;
}) {
  const { text, images } = draft;
  const files = draft.files ?? NO_FILES;
  const setText = (value: string) => onDraft((d) => ({ ...d, text: value }));
  const setImages = (update: (prev: Attachment[]) => Attachment[]) =>
    onDraft((d) => ({ ...d, images: update(d.images) }));
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

  const addFiles = async (files: Iterable<File>) => {
    const picked = [...files].filter((f) => IMAGE_TYPES.includes(f.type));
    const read = await Promise.all(picked.map(readImage));
    setImages((prev) => [...prev, ...read]);
  };

  const pastePaths = usePastedPaths(onDraft);
  // Pasted images first, then the files, as the user's frame shows them.
  const cards = useMemo<AttachmentSource[]>(
    () => [
      ...images.map((img, n) => ({
        kind: "pasted" as const,
        key: img.id,
        url: img.url,
        name: `Image collée ${n + 1}`,
      })),
      ...files.map((f) => ({ kind: "path" as const, key: f.id, path: f.path })),
    ],
    [images, files],
  );
  const removeCard = (key: string) =>
    onDraft((d) => ({
      ...d,
      images: d.images.filter((x) => x.id !== key),
      files: d.files?.filter((x) => x.id !== key),
    }));

  const queued = useMemo(() => hasQueued(items), [items]);
  const send = (now: boolean) => {
    const body = text.trim();
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
    // The attached files as Claude Code reads them: their quoted paths.
    onSend(
      withAttachedPaths(
        body,
        files.map((f) => f.path),
      ),
      images.map(({ mediaType, data }) => ({ mediaType, data })),
      now,
    );
    onDraft(EMPTY_DRAFT);
  };
  const { waiting, submit } = useSendAfterDictation(voice, send, onToast);

  // The rail's gesture: one click starts, the next stops (Ctrl+Space too).
  const toggleVoice = () => {
    if (voice.status === "idle") void voice.start();
    else if (voice.status !== "transcribing") void voice.stop();
    areaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      // Held down, the key repeats: only its first press toggles.
      if (!e.repeat) toggleVoice();
      return;
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

  const empty = !text.trim() && images.length === 0 && files.length === 0;
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
        onPaste={(e) => {
          const pasted = [...e.clipboardData.files];
          if (pasted.some((f) => IMAGE_TYPES.includes(f.type))) {
            e.preventDefault();
            void addFiles(pasted);
            return;
          }
          // Paths alone: cards, once they exist on disk.
          pastePaths(e);
        }}
      />
      {voice.interim && (
        <div className="chat-voice-live" title="Dictée en cours">
          {voice.interim}
        </div>
      )}
      <div className="chat-tools-row">
        {leading}
        {/* Insert, hide, mic, send: one group on the right, never split. */}
        <div className="chat-tools-end">
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
