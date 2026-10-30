import type { RefObject } from "react";
import { Check, Copy, Eraser, Images, MessagesSquare } from "lucide-react";
import { FilePicker, prefetchPhotos } from "@/components/FilePicker";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { EMPTY_DRAFT, type ChatDraft } from "@/lib/chat/chatDrafts";
import type { ChatItem } from "@/lib/chat/chatState";
import { useCopyLastCode } from "@/lib/chat/useCopyLastCode";
import {
  PICKER_GAP_PX,
  useDraftFilePicker,
} from "@/lib/chat/useDraftFilePicker";

/**
 * The terminal rail's buttons (`PaneInputRail`) in the chat's input, with
 * their icons and accents: insert files, copy Claude's last code block, show
 * the messages alone, erase the draft. Kept together so the group can move.
 */
export function ChatRailActions({
  items,
  draft,
  onDraft,
  areaRef,
  messagesOnly,
  onMessagesOnly,
  active,
  onToast,
}: {
  items: ChatItem[];
  draft: ChatDraft;
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  /** The input: the picked paths land at its caret, and it keeps the focus. */
  areaRef: RefObject<HTMLTextAreaElement | null>;
  messagesOnly: boolean;
  onMessagesOnly: (on: boolean) => void;
  /** The pane is the active one and on screen (the file picker closes otherwise). */
  active: boolean;
  onToast?: ToastFn;
}) {
  const {
    open: picking,
    room,
    wrapRef,
    show,
    close,
    insert,
  } = useDraftFilePicker(areaRef, draft.text, onDraft, active);
  const { copied, copy } = useCopyLastCode(items, onToast);
  const empty = !draft.text && draft.images.length === 0;

  return (
    <span
      ref={wrapRef}
      className="chat-rail"
      // The input keeps the focus (the picker panel stops this, it wants it).
      onMouseDown={(e) => e.preventDefault()}
    >
      {picking && (
        <FilePicker
          onInsert={insert}
          onClose={close}
          bottom={PICKER_GAP_PX}
          maxHeight={room}
          above
        />
      )}
      <button
        type="button"
        className={`chat-ib sky${picking ? " on" : ""}`}
        title="Insérer des fichiers (photos, téléchargements)"
        aria-label="Insérer des fichiers"
        aria-pressed={picking}
        // Warm the listing while the pointer travels (the rail does too).
        onMouseEnter={prefetchPhotos}
        onClick={picking ? close : show}
      >
        <Images />
      </button>
      <button
        type="button"
        className={`chat-ib amber${copied ? " on" : ""}`}
        title="Copier le dernier bloc de code de Claude"
        aria-label="Copier le dernier bloc de code"
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
      </button>
      <button
        type="button"
        className={`chat-ib rose${messagesOnly ? " on" : ""}`}
        title={
          messagesOnly ? "Tout afficher" : "Messages seuls (cache les outils)"
        }
        aria-label={messagesOnly ? "Tout afficher" : "Messages seuls"}
        aria-pressed={messagesOnly}
        onClick={() => onMessagesOnly(!messagesOnly)}
      >
        <MessagesSquare />
      </button>
      <button
        type="button"
        className="chat-ib slate"
        title="Effacer tout le message en cours d'écriture"
        aria-label="Effacer le message"
        disabled={empty}
        onClick={() => {
          onDraft(EMPTY_DRAFT);
          areaRef.current?.focus();
        }}
      >
        <Eraser />
      </button>
    </span>
  );
}
