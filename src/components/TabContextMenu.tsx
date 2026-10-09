import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { Account } from "@/lib/accounts";
import { AccountDot } from "./AccountDot";

interface TabContextMenuProps {
  x: number;
  y: number;
  accounts: Account[];
  /** Account of the tab's focused pane, shown ticked. */
  currentAccountId: string;
  /** False when no pane of the tab runs Claude: nothing to move. */
  hasClaude: boolean;
  onSwitchAccount: (accountId: string) => void;
  onDismiss: () => void;
}

export function TabContextMenu({
  x,
  y,
  accounts,
  currentAccountId,
  hasClaude,
  onSwitchAccount,
  onDismiss,
}: TabContextMenuProps) {
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

  const clampedX = Math.min(x, window.innerWidth - 220);
  const clampedY = Math.min(
    y,
    window.innerHeight - (60 + accounts.length * 30),
  );

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[210px] rounded border border-zinc-800 bg-zinc-950 py-1 shadow-xl"
      style={{ top: clampedY, left: clampedX }}
    >
      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-zinc-500">
        Changer de compte
      </div>
      {!hasClaude && (
        <div className="px-3 pb-1 text-xs text-zinc-500">
          Aucune conversation Claude dans cet onglet
        </div>
      )}
      {accounts.map((a) => {
        const current = a.id === currentAccountId;
        const disabled = !hasClaude || current || !a.loggedIn;
        return (
          <button
            key={a.id}
            disabled={disabled}
            onClick={() => {
              onSwitchAccount(a.id);
              onDismiss();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
              disabled
                ? "cursor-not-allowed text-zinc-600"
                : "text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            <AccountDot color={a.color} label={a.label} />
            <span className="truncate">{a.label}</span>
            {!a.loggedIn && (
              <span className="text-xs text-zinc-600">non connecté</span>
            )}
            {current && (
              <Check size={13} className="ml-auto shrink-0 text-zinc-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}
