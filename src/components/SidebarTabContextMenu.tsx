import { useEffect, useRef } from "react";

interface SidebarTabContextMenuProps {
  x: number;
  y: number;
  onHide: () => void;
  onClose: () => void;
}

/** Right-click menu of a tab listed under a project in the sidebar "Active" list. */
export function SidebarTabContextMenu({
  x,
  y,
  onHide,
  onClose,
}: SidebarTabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const clampedX = Math.min(x, window.innerWidth - 290);
  const clampedY = Math.min(y, window.innerHeight - 50);

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded border border-zinc-800 bg-zinc-950 py-1 shadow-xl"
      style={{ top: clampedY, left: clampedX }}
    >
      <button
        onClick={() => {
          onHide();
          onClose();
        }}
        className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
      >
        {"Masquer jusqu'au prochain redémarrage"}
      </button>
    </div>
  );
}
