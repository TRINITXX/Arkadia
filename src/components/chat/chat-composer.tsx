import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Mic, Square, X, Zap } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatRailActions } from "@/components/chat/chat-rail-actions";
import { ChatSlashMenu } from "@/components/chat/chat-slash-menu";
import { useSlashMenu, type ChatSlash } from "@/lib/chat/useSlashMenu";
import { useChatLayers } from "@/lib/chat/useChatLayers";
import type { ChatImage } from "@/lib/chat/useChatSession";
import { hasQueued, type ChatItem } from "@/lib/chat/chatState";
import { useSendAfterDictation } from "@/lib/chat/useSendAfterDictation";
import { useChatSuggestion } from "@/lib/chat/useChatSuggestion";
import { useInputHistory } from "@/lib/chat/useInputHistory";
import { useTypeToInput } from "@/lib/chat/useTypeToInput";
import type {
  ChatDraft,
  DraftImage as Attachment,
} from "@/lib/chat/chatDrafts";
import type { DictationEnd, VoiceStatus } from "@/lib/useHiddenVoice";
import type { PermissionMode } from "@/lib/chat/chatProtocol";
import { modeLabel, nextMode } from "@/lib/chat/chatLabels";
import { ChatModelPicker } from "@/components/chat/chat-model-picker";
import type { EffortLevel } from "@/lib/chat/chatProtocol";
import { EMPTY_SDK, type SdkState } from "@/lib/chat/chatSdkSettings";

/** Claude's dictation (`useHiddenVoice`): its text lands in the draft. */
export interface ChatVoice {
  status: VoiceStatus;
  /** True once listening (`useHiddenVoice`); the preview's says nothing. */
  start: () => unknown;
  /** Resolves once the dictated text is in the draft, or with why not
   *  (`quiet`: true while the caller is there to show the failure). */
  stop: (options?: { quiet?: () => boolean }) => Promise<DictationEnd>;
}

const VOICE_TITLES: Record<VoiceStatus, string> = {
  idle: "Dicter (Ctrl+Espace)",
  starting: "Démarrage du vocal… (clic pour annuler)",
  listening: "J'écoute : clic ou Ctrl+Espace pour arrêter",
  transcribing: "Transcription…",
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

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
 * The input card: text (Enter sends, Shift+Enter breaks the line), images by
 * paste, `/` commands, the terminal rail's actions (`ChatRailActions`), and
 * the session's mode and model.
 * Esc first closes what is open in the pane (`chatLayers`), then interrupts
 * a working Claude (its turn only: background agents and workflows go on), Ctrl+B sends its running command or agent to the
 * background, Shift+Tab cycles the mode, as in the terminal. A message sent while Claude works waits for its turn; Ctrl+Enter
 * sends it now (the turn under way stops), or, input empty, the ones waiting.
 * Sent mid-dictation, the draft goes once the dictated text is in.
 */
export function ChatComposer({
  items,
  working,
  mode,
  model,
  slash,
  draft,
  onDraft,
  voice,
  focusKey,
  onSend,
  onInterrupt,
  onBackground,
  onMode,
  onModel,
  messagesOnly,
  onMessagesOnly,
  active,
  onToast,
  suggestion = null,
  sdk = EMPTY_SDK,
  onEffort,
}: {
  /** The conversation, for the copy of Claude's last code block. */
  items: ChatItem[];
  working: boolean;
  mode: string | null;
  model: string | null;
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
  onModel: (model: string) => void;
  messagesOnly: boolean;
  onMessagesOnly: (on: boolean) => void;
  /** The pane is the active one and on screen (`ChatRailActions`). */
  active: boolean;
  onToast?: ToastFn;
  /** Claude Code's guess at the next message: grey in the empty input. */
  suggestion?: string | null;
  /** The model menu, effort and fast mode (`ChatModelPicker`). */
  sdk?: Pick<SdkState, "models" | "effort" | "fastMode">;
  /** The session's effort, this session only. */
  onEffort?: (effort: EffortLevel) => void;
}) {
  const { text, images } = draft;
  const setText = (value: string) => onDraft((d) => ({ ...d, text: value }));
  const setImages = (update: (prev: Attachment[]) => Attachment[]) =>
    onDraft((d) => ({ ...d, images: update(d.images) }));
  const [menu, setMenu] = useState<"model" | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const layers = useChatLayers();
  const ghost = useChatSuggestion(suggestion, text, working);
  // ↑ / ↓ bring back the pane's last messages (empty input).
  const history = useInputHistory(items, text, (t) =>
    onDraft((d) => ({ ...d, text: t })),
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

  const queued = useMemo(() => hasQueued(items), [items]);
  const send = (now: boolean) => {
    const body = text.trim();
    if (!body && images.length === 0) {
      // Ctrl+Enter on an empty input: the messages waiting go now.
      if (now && queued) onInterrupt();
      return;
    }
    // /resume, /rewind, a terminal-only command: the page answers.
    if (slashMenu.intercept(body)) return;
    onSend(
      body,
      images.map(({ mediaType, data }) => ({ mediaType, data })),
      now,
    );
    onDraft({ text: "", images: [] });
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
    if (e.key === "Tab" && !e.shiftKey && ghost && !menu) {
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
      else if (working) {
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

  const empty = !text.trim() && images.length === 0;
  return (
    <div className="chat-box">
      <ChatSlashMenu menu={slashMenu} />
      {images.length > 0 && (
        <div className="chat-attach">
          {images.map((img) => (
            <div key={img.id} className="img">
              <img src={img.url} alt="" />
              <button
                type="button"
                title="Retirer"
                onClick={() =>
                  setImages((prev) => prev.filter((x) => x.id !== img.id))
                }
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={areaRef}
        rows={1}
        value={text}
        className={ghost ? "suggest" : undefined}
        placeholder={
          ghost
            ? `${ghost}  ·  Tab`
            : working
              ? "Claude travaille… ton message attendra son tour (Ctrl+Entrée : tout de suite)"
              : "Écris à Claude…"
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.some((f) => IMAGE_TYPES.includes(f.type))) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
      />
      <div className="chat-tools-row">
        <ChatRailActions
          draft={draft}
          onDraft={onDraft}
          areaRef={areaRef}
          messagesOnly={messagesOnly}
          onMessagesOnly={onMessagesOnly}
          active={active}
        />
        <span
          className="chat-chip"
          title="Changer de mode (Maj+Tab)"
          onClick={() => onMode(nextMode(mode))}
        >
          <Zap /> <span className="lbl">{modeLabel(mode)}</span>
        </span>
        <ChatModelPicker
          model={model}
          sdk={sdk}
          onModel={onModel}
          onEffort={onEffort}
          onMenu={(open) => setMenu(open ? "model" : null)}
        />
        <button
          type="button"
          className={`chat-round mic chat-push${voice.status === "listening" ? " rec" : ""}`}
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
  );
}
