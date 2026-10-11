import { ChevronDown } from "lucide-react";

/**
 * The keys a phone keyboard lacks, and the paste a hidden field cannot offer
 * (no long-press menu on it). The keyboard's own return key submits.
 */
const KEYS: { label: string; data: string | "paste" }[] = [
  { label: "Échap", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "Coller", data: "paste" },
  { label: "Ctrl+C", data: "\x03" },
];

interface KeyRowProps {
  onKey: (data: string) => void;
  onPaste: () => void;
  keyboardOpen: boolean;
  onHideKeyboard: () => void;
}

export function KeyRow({
  onKey,
  onPaste,
  keyboardOpen,
  onHideKeyboard,
}: KeyRowProps) {
  // preventDefault on pointerdown: a tap must not take the focus from the
  // hidden field, or the keyboard would close.
  const keep = (e: React.PointerEvent) => e.preventDefault();
  return (
    <div
      className="flex shrink-0 gap-1.5 border-t border-zinc-800 bg-zinc-950 px-2 pt-1.5"
      style={{
        paddingBottom: keyboardOpen
          ? 6
          : "max(6px, env(safe-area-inset-bottom))",
      }}
    >
      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          onPointerDown={keep}
          onClick={() => (k.data === "paste" ? onPaste() : onKey(k.data))}
          className="h-9 flex-1 rounded-md bg-zinc-800 text-[13px] font-medium text-zinc-100 active:bg-zinc-600"
        >
          {k.label}
        </button>
      ))}
      {keyboardOpen && (
        <button
          type="button"
          aria-label="Fermer le clavier"
          onPointerDown={keep}
          onClick={onHideKeyboard}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-300 active:bg-zinc-600"
        >
          <ChevronDown size={18} />
        </button>
      )}
    </div>
  );
}
