import type { RefObject } from "react";
import { Images, MessagesSquare } from "lucide-react";
import { FilePicker, prefetchPhotos } from "@/components/FilePicker";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import {
  PICKER_GAP_PX,
  useDraftFilePicker,
} from "@/lib/chat/useDraftFilePicker";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/**
 * The terminal rail's buttons (`PaneInputRail`) in the chat's input, with
 * their icons and accents: insert files, show the messages alone. Code is
 * copied from each block and each reply instead. Kept together so the group
 * can move.
 */
export function ChatRailActions({
  onDraft,
  areaRef,
  messagesOnly,
  onMessagesOnly,
  active,
}: {
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  /** The input: it keeps the focus, the picked files go above it as cards. */
  areaRef: RefObject<HTMLTextAreaElement | null>;
  messagesOnly: boolean;
  onMessagesOnly: (on: boolean) => void;
  /** The pane is the active one and on screen (the file picker closes otherwise). */
  active: boolean;
}) {
  const {
    open: picking,
    room,
    wrapRef,
    show,
    close,
    insert,
  } = useDraftFilePicker(areaRef, onDraft, active);
  // Esc with the focus back in the input closes it, not Claude's turn.
  useChatLayer(picking, close);

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
    </span>
  );
}
