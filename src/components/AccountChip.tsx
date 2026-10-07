import { useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = state.accounts.find((a) => a.id === state.current);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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
        onClick={() => setOpen((v) => !v)}
        title={`Compte des nouveaux onglets\n${accountTooltip(current)}`}
        className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
      >
        <AccountDot color={current.color} />
        <span className="max-w-[110px] truncate">{current.label}</span>
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 min-w-[220px] rounded border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
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
              <AccountDot color={a.color} />
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              <span className={`tabular-nums ${a.stale ? "opacity-40" : ""}`}>
                {formatPct(a.usage?.fiveHour)} · {formatPct(a.usage?.sevenDay)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
