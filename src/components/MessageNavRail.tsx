import { ChevronDown, ChevronUp, Filter } from "lucide-react";

/**
 * Vertical message-navigation rail, pinned to the dead zone on the right edge of
 * the pane. Backgrounds match the terminal line tints (green = your messages,
 * purple = Claude's). Tailwind arbitrary values must be literal strings.
 */
const MESSAGE_NAV = [
  {
    kind: 1,
    dir: -1,
    title: "Message précédent (toi)",
    className: "bg-[rgba(34,197,94,0.10)] hover:bg-[rgba(34,197,94,0.20)]",
  },
  {
    kind: 1,
    dir: 1,
    title: "Message suivant (toi)",
    className: "bg-[rgba(34,197,94,0.10)] hover:bg-[rgba(34,197,94,0.20)]",
  },
  {
    kind: 2,
    dir: -1,
    title: "Message précédent (Claude)",
    className: "bg-[rgba(168,85,247,0.10)] hover:bg-[rgba(168,85,247,0.20)]",
  },
  {
    kind: 2,
    dir: 1,
    title: "Message suivant (Claude)",
    className: "bg-[rgba(168,85,247,0.10)] hover:bg-[rgba(168,85,247,0.20)]",
  },
] as const;

interface MessageNavRailProps {
  onNavigate: (kind: 1 | 2, dir: -1 | 1) => void;
  disabled?: boolean;
  /** Whether focus mode (mask everything but framed messages) is on. */
  focusActive: boolean;
  onToggleFocus: () => void;
}

export function MessageNavRail({
  onNavigate,
  disabled = false,
  focusActive,
  onToggleFocus,
}: MessageNavRailProps) {
  return (
    <div className="pointer-events-none absolute right-1 bottom-2 z-10 flex flex-col gap-1">
      <button
        onClick={onToggleFocus}
        className={`pointer-events-auto mb-1 flex size-6 items-center justify-center rounded border transition-colors ${
          focusActive
            ? "border-zinc-500 bg-zinc-700 text-zinc-100"
            : "border-transparent bg-zinc-800/70 text-zinc-400 hover:text-zinc-100"
        }`}
        title={
          focusActive
            ? "Tout afficher"
            : "Afficher uniquement les messages encadrés"
        }
        aria-label={
          focusActive
            ? "Tout afficher"
            : "Afficher uniquement les messages encadrés"
        }
        aria-pressed={focusActive}
        type="button"
      >
        <Filter size={12} />
      </button>
      {MESSAGE_NAV.map((b) => (
        <button
          key={`${b.kind}:${b.dir}`}
          onClick={() => onNavigate(b.kind, b.dir)}
          disabled={disabled}
          className={`pointer-events-auto flex size-6 items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 ${b.className}`}
          title={b.title}
          aria-label={b.title}
          type="button"
        >
          {b.dir < 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      ))}
    </div>
  );
}
