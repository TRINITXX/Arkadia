import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { getIcon } from "@/icons";
import { Sheet, SheetRow } from "@/mobile/Sheet";
import type { RemoteButton } from "@/lib/remoteSnapshot";

interface ButtonSheetProps {
  title: string;
  buttons: RemoteButton[];
  onPick: (buttonId: string) => void;
  /** Adds a "Nouvel onglet" row first. */
  onNewTab?: () => void;
  onClose: () => void;
}

/** The desktop's toolbar (or prompt bar) buttons, folders opening in place. */
export function ButtonSheet({
  title,
  buttons,
  onPick,
  onNewTab,
  onClose,
}: ButtonSheetProps) {
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggle = (id: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = (list: RemoteButton[], depth: number): React.ReactNode[] =>
    list.flatMap((b) => {
      const Icon = getIcon(b.icon);
      const open = openFolders.has(b.id);
      const row = (
        <SheetRow
          key={b.id}
          onClick={() => (b.kind === "folder" ? toggle(b.id) : onPick(b.id))}
        >
          {depth > 0 && (
            <span style={{ width: depth * 16 }} className="shrink-0" />
          )}
          <span className="flex w-5 shrink-0 justify-center text-zinc-400">
            {Icon && <Icon size={17} />}
          </span>
          <span className="min-w-0 flex-1 truncate">{b.label}</span>
          {b.kind === "folder" && (
            <ChevronRight
              size={17}
              className={`text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
            />
          )}
        </SheetRow>
      );
      return b.kind === "folder" && open
        ? [row, ...rows(b.children ?? [], depth + 1)]
        : [row];
    });

  return (
    <Sheet title={title} onClose={onClose}>
      {onNewTab && (
        <SheetRow onClick={onNewTab}>
          <span className="flex w-5 shrink-0 justify-center text-zinc-400">
            <Plus size={17} />
          </span>
          Nouvel onglet
        </SheetRow>
      )}
      {rows(buttons, 0)}
      {buttons.length === 0 && !onNewTab && (
        <p className="px-4 py-3 text-sm text-zinc-500">Aucun bouton.</p>
      )}
    </Sheet>
  );
}
