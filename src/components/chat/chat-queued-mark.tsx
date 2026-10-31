import { CircleSlash, Clock, CornerDownLeft, X } from "lucide-react";

/**
 * The foot of a message Claude hasn't taken yet (`queued`): it waits for the
 * turn under way, and « Envoyer maintenant » stops that turn so Claude takes
 * it at once (Ctrl+Entrée in the input does the same with a new message);
 * × withdraws it (`onRemove`): once Claude Code confirms, it leaves the
 * column and its text goes back to the input. `dropped`: it never went
 * (cancelled, or the chat ended first).
 */
export function ChatQueuedMark({
  dropped,
  onSendNow,
  onRemove,
}: {
  dropped?: boolean;
  onSendNow?: () => void;
  onRemove?: () => void;
}) {
  if (dropped) {
    return (
      <span
        className="chat-queued-mark dropped"
        title="Claude n'a jamais reçu ce message"
      >
        <CircleSlash /> non envoyé
      </span>
    );
  }
  return (
    <span className="chat-queued-mark">
      <Clock /> en attente
      {onSendNow && (
        <button
          type="button"
          title="Arrêter le tour en cours pour que Claude prenne ce message maintenant"
          onClick={onSendNow}
        >
          <CornerDownLeft /> Envoyer maintenant
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          className="chat-queued-remove"
          title="Retirer ce message : Claude ne le recevra pas, il revient dans la saisie"
          aria-label="Retirer ce message"
          onClick={onRemove}
        >
          <X />
        </button>
      )}
    </span>
  );
}
