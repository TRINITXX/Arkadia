import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { accountTooltip, formatPct, type AccountsState } from "@/lib/accounts";
import { AccountDot } from "./AccountDot";

interface AccountChipProps {
  state: AccountsState;
  onSelect: (id: string) => void;
}

/**
 * Toolbar stand-in for the accounts block while the sidepanel is hidden: the
 * account new tabs open on, and a dropdown to pick another one.
 */
export function AccountChip({ state, onSelect }: AccountChipProps) {
  // Anchor of the dropdown (null = closed). The dropdown is portalled to
  // <body>: inside the toolbar (a .chrome-surface) the glass background
  // preset would turn its fill translucent.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const open = anchor !== null;
  const setOpen = (v: boolean) => {
    if (!v) setAnchor(null);
  };
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = state.accounts.find((a) => a.id === state.current);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t))
        setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAnchor(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!current) return null;
  return (
    <div ref={ref} className="relative mr-1 shrink-0">
      <button
        type="button"
        onClick={(e) => {
          if (open) return setAnchor(null);
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom + 4 });
        }}
        title={`Compte des nouveaux onglets\n${accountTooltip(current)}`}
        className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
      >
        <AccountDot color={current.color} label={current.label} />
        <span className="max-w-[110px] truncate">{current.label}</span>
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[220px] rounded border border-zinc-800 bg-zinc-950 py-1 shadow-xl"
            style={{ top: anchor.y, left: anchor.x }}
          >
            {state.accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onSelect(a.id);
                  setOpen(false);
                }}
                title={accountTooltip(a)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
                  a.id === state.current ? "text-zinc-100" : "text-zinc-400"
                }`}
              >
                <AccountDot color={a.color} label={a.label} />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                <span className={`tabular-nums ${a.stale ? "opacity-40" : ""}`}>
                  {formatPct(a.usage?.fiveHour)} ·{" "}
                  {formatPct(a.usage?.sevenDay)}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
