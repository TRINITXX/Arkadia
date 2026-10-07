import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { AccountDot } from "./AccountDot";
import {
  ACCOUNT_COLORS,
  MAIN_ACCOUNT_ID,
  accountTooltip,
  formatPct,
  type Account,
  type AccountsState,
  type UsageWindow,
} from "@/lib/accounts";

interface AccountsPanelProps {
  state: AccountsState;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onLogin: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onRecolor: (id: string, color: string) => void;
  onRemove: (id: string) => void;
  /** Open panes per account id: an account in use cannot be removed. */
  openPanesByAccount: Record<string, number>;
}

/**
 * Compact "Comptes" block at the bottom of the sidepanel: one line per Claude
 * account with its 5-hour and weekly usage. Clicking a line makes it the
 * account new tabs open on; right-click for login / rename / colour / remove.
 */
export function AccountsPanel({
  state,
  onSelect,
  onAdd,
  onLogin,
  onRename,
  onRecolor,
  onRemove,
  openPanesByAccount,
}: AccountsPanelProps) {
  const [menu, setMenu] = useState<{
    account: Account;
    x: number;
    y: number;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  return (
    <div className="border-t border-zinc-800/60 px-1.5 pt-1.5 pb-2">
      <div className="mb-0.5 flex items-center gap-1 px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
        <span className="flex-1">Comptes</span>
        <span
          className="w-9 text-right normal-case"
          title="Limite des 5 heures"
        >
          5 h
        </span>
        <span
          className="w-9 text-right normal-case"
          title="Limite de la semaine"
        >
          sem.
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={state.accounts.length >= state.max}
          className="ml-0.5 flex size-4 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
          title={
            state.accounts.length >= state.max
              ? `${state.max} comptes au maximum`
              : "Ajouter un compte Claude"
          }
          aria-label="Ajouter un compte"
        >
          <Plus size={12} />
        </button>
      </div>
      {state.accounts.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          current={account.id === state.current}
          renaming={renamingId === account.id}
          onSelect={() => onSelect(account.id)}
          onContextMenu={(x, y) => setMenu({ account, x, y })}
          onRenameDone={(label) => {
            setRenamingId(null);
            if (label !== null) onRename(account.id, label);
          }}
        />
      ))}
      {menu && (
        <AccountMenu
          account={menu.account}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onLogin={() => onLogin(menu.account.id)}
          onRename={() => setRenamingId(menu.account.id)}
          onRecolor={(color) => onRecolor(menu.account.id, color)}
          onRemove={() => onRemove(menu.account.id)}
          openPanes={openPanesByAccount[menu.account.id] ?? 0}
        />
      )}
    </div>
  );
}

interface AccountRowProps {
  account: Account;
  current: boolean;
  renaming: boolean;
  onSelect: () => void;
  onContextMenu: (x: number, y: number) => void;
  /** New label, "" for the automatic one, null when cancelled. */
  onRenameDone: (label: string | null) => void;
}

function AccountRow({
  account,
  current,
  renaming,
  onSelect,
  onContextMenu,
  onRenameDone,
}: AccountRowProps) {
  const u = account.usage;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !renaming && onSelect()}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ")) onSelect();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      title={`${accountTooltip(account)}${
        current ? "\n\nLes nouveaux onglets s'ouvrent sur ce compte" : ""
      }`}
      className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-[3px] text-xs ${
        current
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      <AccountDot color={account.color} />
      {renaming ? (
        <RenameInput
          initial={account.customLabel ? account.label : ""}
          placeholder={account.label}
          onDone={onRenameDone}
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate ${account.loggedIn ? "" : "italic text-zinc-500"}`}
        >
          {account.label}
        </span>
      )}
      <Gauge window={u?.fiveHour} color={account.color} stale={account.stale} />
      <Gauge window={u?.sevenDay} color={account.color} stale={account.stale} />
      {/* Keeps the gauges aligned under the header's "+" column. */}
      <span className="ml-0.5 w-4 shrink-0" />
    </div>
  );
}

function Gauge({
  window,
  color,
  stale,
}: {
  window: UsageWindow | null | undefined;
  color: string;
  stale: boolean;
}) {
  const pct = window ? Math.min(100, Math.max(0, window.pct)) : 0;
  const high = pct >= 90;
  return (
    <div
      className={`flex w-9 shrink-0 flex-col items-end ${stale ? "opacity-40" : ""}`}
    >
      <span
        className={`text-[10px] leading-3 tabular-nums ${high ? "text-red-400" : ""}`}
      >
        {formatPct(window)}
      </span>
      <span className="mt-[1px] h-[2px] w-full rounded-full bg-zinc-800">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
    </div>
  );
}

function RenameInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string;
  placeholder: string;
  onDone: (label: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (label: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(label);
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      maxLength={24}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value.trim());
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value.trim())}
      title="Vide = nom automatique"
      className="min-w-0 flex-1 rounded bg-zinc-950 px-1 text-xs text-zinc-100 outline-none ring-1 ring-zinc-700"
    />
  );
}

interface AccountMenuProps {
  account: Account;
  x: number;
  y: number;
  onClose: () => void;
  onLogin: () => void;
  onRename: () => void;
  onRecolor: (color: string) => void;
  onRemove: () => void;
  openPanes: number;
}

function AccountMenu({
  account,
  x,
  y,
  onClose,
  onLogin,
  onRename,
  onRecolor,
  onRemove,
  openPanes,
}: AccountMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
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

  const item = (label: string, action: () => void, danger = false) => (
    <button
      type="button"
      onClick={() => {
        action();
        onClose();
      }}
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-800 ${
        danger ? "text-red-400 hover:text-red-300" : "text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded border border-zinc-800 bg-zinc-950 py-1 shadow-xl"
      style={{
        top: Math.min(y, window.innerHeight - 190),
        left: Math.min(x, window.innerWidth - 200),
      }}
    >
      {item(account.loggedIn ? "Se reconnecter" : "Se connecter", onLogin)}
      {item("Renommer", onRename)}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        {ACCOUNT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onRecolor(c);
              onClose();
            }}
            title="Couleur du compte"
            aria-label={`Couleur ${c}`}
            className={`size-4 rounded-[3px] ${
              c === account.color
                ? "ring-2 ring-zinc-300 ring-offset-1 ring-offset-zinc-950"
                : ""
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      {account.id !== MAIN_ACCOUNT_ID && (
        <>
          <div className="my-1 border-t border-zinc-800" />
          {openPanes > 0 ? (
            <div className="px-3 py-1.5 text-xs text-zinc-500">
              {`Ferme d'abord ses ${openPanes} onglet${openPanes > 1 ? "s" : ""} pour le retirer`}
            </div>
          ) : confirmRemove ? (
            item("Confirmer le retrait", onRemove, true)
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="block w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300"
            >
              Retirer ce compte
            </button>
          )}
        </>
      )}
    </div>
  );
}
