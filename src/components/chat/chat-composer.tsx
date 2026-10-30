import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Plus, Square, X, Zap } from "lucide-react";
import type { ChatImage } from "@/lib/chat/useChatSession";
import type { PermissionMode } from "@/lib/chat/chatProtocol";
import { MODELS, modeLabel, modelLabel, nextMode } from "@/lib/chat/chatLabels";

export interface Attachment extends ChatImage {
  id: string;
  url: string;
}

/** The input's content, kept by the view while a request hides the card. */
export interface ChatDraft {
  text: string;
  images: Attachment[];
}

export const EMPTY_DRAFT: ChatDraft = { text: "", images: [] };

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
 * paste or the + button, `/` commands, and the session's mode and model.
 * Esc interrupts a working Claude, Shift+Tab cycles the mode, as in the
 * terminal. A message sent while Claude works waits for its turn.
 */
export function ChatComposer({
  working,
  mode,
  model,
  slashCommands,
  draft,
  onDraft,
  focusKey,
  onSend,
  onInterrupt,
  onMode,
  onModel,
}: {
  working: boolean;
  mode: string | null;
  model: string | null;
  slashCommands: string[];
  draft: ChatDraft;
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  /** Changes when the composer should take the focus (pane activated). */
  focusKey: unknown;
  onSend: (text: string, images: ChatImage[]) => void;
  onInterrupt: () => void;
  onMode: (mode: PermissionMode) => void;
  onModel: (model: string) => void;
}) {
  const { text, images } = draft;
  const setText = (value: string) => onDraft((d) => ({ ...d, text: value }));
  const setImages = (update: (prev: Attachment[]) => Attachment[]) =>
    onDraft((d) => ({ ...d, images: update(d.images) }));
  const [slashIndex, setSlashIndex] = useState(0);
  const [menu, setMenu] = useState<"model" | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const slash = /^\/(\S*)$/.exec(text);
  const matches = slash
    ? slashCommands
        .filter((c) => c.toLowerCase().startsWith(slash[1].toLowerCase()))
        .slice(0, 50)
    : [];

  const addFiles = async (files: Iterable<File>) => {
    const picked = [...files].filter((f) => IMAGE_TYPES.includes(f.type));
    const read = await Promise.all(picked.map(readImage));
    setImages((prev) => [...prev, ...read]);
  };

  const submit = () => {
    const body = text.trim();
    if (!body && images.length === 0) return;
    onSend(
      body,
      images.map(({ mediaType, data }) => ({ mediaType, data })),
    );
    onDraft(EMPTY_DRAFT);
  };

  const complete = (command: string) => {
    setText(`/${command} `);
    setSlashIndex(0);
    areaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSlashIndex((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        complete(matches[Math.min(slashIndex, matches.length - 1)]);
        return;
      }
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onMode(nextMode(mode));
      return;
    }
    if (e.key === "Escape" && working) {
      e.preventDefault();
      onInterrupt();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const empty = !text.trim() && images.length === 0;
  return (
    <div className="chat-box">
      {matches.length > 0 && (
        <div className="chat-slash">
          {matches.map((c, i) => (
            <button
              key={c}
              type="button"
              className={i === slashIndex ? "on" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                complete(c);
              }}
            >
              /{c}
            </button>
          ))}
        </div>
      )}
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
        placeholder={
          working
            ? "Claude travaille… ton message attendra son tour"
            : "Écris à Claude…"
        }
        onChange={(e) => {
          setText(e.target.value);
          setSlashIndex(0);
        }}
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
        <button
          type="button"
          className="chat-ib"
          title="Ajouter une image"
          onClick={() => fileRef.current?.click()}
        >
          <Plus />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span
          className="chat-chip"
          title="Changer de mode (Maj+Tab)"
          onClick={() => onMode(nextMode(mode))}
        >
          <Zap /> {modeLabel(mode)}
        </span>
        <span className="chat-anchor">
          <span
            className="chat-chip"
            title="Changer de modèle"
            onClick={() => setMenu((m) => (m ? null : "model"))}
          >
            {modelLabel(model)}
          </span>
          {menu === "model" && (
            <div
              className="chat-menu"
              style={{ left: 0 }}
              onMouseLeave={() => setMenu(null)}
            >
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={modelLabel(model) === m.label ? "on" : undefined}
                  onClick={() => {
                    onModel(m.id);
                    setMenu(null);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </span>
        <button
          type="button"
          className="chat-round mic chat-push"
          title="Le vocal arrive après le chat"
          disabled
        >
          <Mic />
        </button>
        {working && empty ? (
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
            className="chat-round send"
            title="Envoyer (Entrée)"
            disabled={empty}
            onClick={submit}
          >
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  );
}
