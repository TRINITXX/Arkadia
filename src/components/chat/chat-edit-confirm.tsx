import { Pencil } from "lucide-react";

/**
 * Asked before an edit drops messages: the conversation goes back to just
 * before the user's message, and what came after it leaves the column.
 */
export function ChatEditConfirm({
  later,
  going,
  onConfirm,
  onCancel,
}: {
  later: number;
  going: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="chat-edit-confirm" role="alertdialog">
      <Pencil />
      <span>
        Modifier ce message : la conversation revient juste avant, et{" "}
        {later > 1
          ? `les ${later} messages suivants partent`
          : "le message suivant part"}
        .
      </span>
      <button type="button" className="chat-btn ghost" onClick={onCancel}>
        Annuler
      </button>
      <button
        type="button"
        className="chat-btn primary"
        disabled={going}
        onClick={onConfirm}
      >
        {going ? "Retour…" : "Revenir et modifier"}
      </button>
    </div>
  );
}
