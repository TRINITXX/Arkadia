import { useEffect, useRef } from "react";

interface PaneContextMenuProps {
  x: number;
  y: number;
  canClose: boolean;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClose: () => void;
  onDismiss: () => void;
}

export function PaneContextMenu({
  x,
  y,
  canClose,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
  onDismiss,
}: PaneContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  const clampedX = Math.min(x, window.innerWidth - 200);
  const clampedY = Math.min(y, window.innerHeight - 140);

  const Item = ({
    label,
    danger = false,
    disabled = false,
    action,
  }: {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    action: () => void;
  }) => (
    <button
      disabled={disabled}
      onClick={() => {
        action();
        onDismiss();
      }}
      className={`block w-full px-3 py-1.5 text-left text-sm ${
        disabled
          ? "cursor-not-allowed text-zinc-600"
          : danger
            ? "text-red-400 hover:bg-zinc-800 hover:text-red-300"
            : "text-zinc-200 hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[190px] rounded border border-zinc-800 bg-zinc-950 py-1 shadow-xl"
      style={{ top: clampedY, left: clampedX }}
    >
      <Item label="Split horizontal (côte-à-côte)" action={onSplitHorizontal} />
      <Item label="Split vertical (empilé)" action={onSplitVertical} />
      <div className="my-1 border-t border-zinc-800" />
      <Item
        label="Fermer le pane"
        danger
        disabled={!canClose}
        action={onClose}
      />
    </div>
  );
}
