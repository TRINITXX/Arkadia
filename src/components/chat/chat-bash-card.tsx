import { useLayoutEffect, useRef } from "react";
import { SquareTerminal } from "lucide-react";
import { bashCutNote } from "@/lib/chat/chatBash";
import type { ChatItem } from "@/lib/chat/chatState";
import { outputTail } from "@/lib/chat/chatTasks";

type BashItem = Extract<ChatItem, { kind: "bash" }>;

/** Every line of an output, its colours and cursor moves dropped. */
const plain = (text: string) => outputTail(text, Number.MAX_SAFE_INTEGER);

/**
 * A `!` command of the user, as the terminal's bash mode shows it: the
 * command, its output as it comes (errors apart, in red), then how it
 * ended. Claude gets both with the next message; past `BANG_SENT_MAX` its
 * output is cut for Claude, and the card says so (`bashCutNote`).
 */
export function ChatBashCard({
  item,
  onStop,
}: {
  item: BashItem;
  /** Running: the card's stop (Esc in the input does the same). */
  onStop?: () => void;
}) {
  const stdout = plain(item.stdout);
  const stderr = plain(item.stderr);
  const outRef = useRef<HTMLDivElement>(null);
  // Live, the output follows its end, as a terminal does.
  useLayoutEffect(() => {
    const el = outRef.current;
    if (el && item.running) el.scrollTop = el.scrollHeight;
  }, [stdout, stderr, item.running]);
  const cut = bashCutNote(item);
  const end = item.running
    ? null
    : item.error
      ? "n'a pas pu démarrer"
      : item.stopped
        ? "arrêtée"
        : item.code !== undefined && item.code !== null && item.code !== 0
          ? `code ${item.code}`
          : null;
  return (
    <div
      className={`chat-unit chat-cmd chat-bash${item.running ? " running" : ""}`}
    >
      <div className="head">
        <SquareTerminal />
        <span className="name">!</span>
        <span className="args">{item.command}</span>
        {item.running ? (
          <button
            type="button"
            className="stop"
            title="Arrêter la commande (Échap)"
            onClick={onStop}
          >
            <span className="spin" /> Arrêter
          </button>
        ) : (
          end && (
            // Stopped by the user: said plainly; a failure in red.
            <span className={`end${item.stopped && !item.error ? "" : " bad"}`}>
              {end}
            </span>
          )
        )}
      </div>
      {(stdout || stderr || item.error) && (
        <div className="body out" ref={outRef}>
          {stdout}
          {(stderr || item.error) && (
            <div className="chat-stderr">{item.error ?? stderr}</div>
          )}
        </div>
      )}
      {cut && <div className="note">{cut}</div>}
    </div>
  );
}
