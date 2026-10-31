import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

/** The chat's Ctrl+F box, top right of the conversation (`useChatSearch`). */
export function ChatSearchBox({
  query,
  total,
  at,
  focusKey,
  onQuery,
  onStep,
  onClose,
}: {
  query: string;
  total: number;
  /** The current match, -1 for none. */
  at: number;
  /** Changes with each Ctrl+F: the field takes the focus again. */
  focusKey: number;
  onQuery: (query: string) => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);
  return (
    <div className="chat-search">
      <input
        ref={inputRef}
        value={query}
        placeholder="Rechercher dans la conversation…"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="count">{total ? `${at + 1}/${total}` : "0"}</span>
      <button
        type="button"
        title="Précédent (Maj+Entrée)"
        aria-label="Précédent"
        onClick={() => onStep(-1)}
      >
        <ChevronUp />
      </button>
      <button
        type="button"
        title="Suivant (Entrée)"
        aria-label="Suivant"
        onClick={() => onStep(1)}
      >
        <ChevronDown />
      </button>
      <button
        type="button"
        title="Fermer (Échap)"
        aria-label="Fermer la recherche"
        onClick={onClose}
      >
        <X />
      </button>
    </div>
  );
}
