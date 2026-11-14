import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Users } from "lucide-react";
import { AccountDot } from "./AccountDot";
import {
  ACCOUNT_COLORS,
  MAIN_ACCOUNT_ID,
  accountTooltip,
  formatIn,
  formatReset,
  type Account,
  type AccountsState,
} from "@/lib/accounts";
import { useModelQuota } from "@/lib/accountQuota";
import { refreshCredits, showsCreditsCard, useCredits } from "@/lib/credits";
import { CreditsCard } from "./credits-card";

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
 * "Comptes" button of the sidepanel. Clicking it opens a popover with one card
 * per Claude account: its 5-hour, weekly and Fable usage, each with its return. Clicking a line makes it
 * the account new tabs open on; right-click for login / rename / colour /
 * remove. Below them, the API credits (`CreditsCard`), read again from the
 * Console each time the menu opens.
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
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  const current = state.accounts.find((a) => a.id === state.current);
  const credits = useCredits();
  // Countdown clock: set on opening, then ticks while the popover is up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [open]);

  // The context menu and the rename field own clicks and keys while they are
  // up: closing the popover under them would drop their action.
  const canClose = menu === null && renamingId === null;
  useEffect(() => {
    if (!open || !canClose) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
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
  }, [open, canClose]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setNow(Date.now());
          if (!open) refreshCredits();
          setAnchor(
            open ? null : (buttonRef.current?.getBoundingClientRect() ?? null),
          );
        }}
        title="Comptes Claude : compte des nouveaux onglets et consommation"
        className={`flex items-center justify-center gap-1.5 rounded border border-zinc-800/60 px-2 py-1.5 text-xs hover:bg-zinc-900 hover:text-zinc-200 ${
          open ? "bg-zinc-900 text-zinc-200" : "bg-transparent text-zinc-400"
        }`}
      >
        <Users size={13} className="shrink-0" />
        Comptes
        {current && <AccountDot color={current.color} label={current.label} />}
      </button>
      {anchor &&
        // Portalled to <body>: inside the sidepanel (a .chrome-surface) the
        // glass background preset would turn its fill translucent.
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-40 rounded border border-zinc-800 bg-zinc-950 px-1.5 pt-1.5 pb-2 shadow-xl"
            style={{
              left: anchor.left,
              bottom: window.innerHeight - anchor.top + 4,
              width: Math.max(anchor.width, 300),
              // Cards are tall: a low window scrolls them, never cuts the top.
              maxHeight: Math.max(120, anchor.top - 8),
              overflowY: "auto",
            }}
          >
            <div className="mb-0.5 flex items-center gap-1 px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
              <span className="flex-1">Comptes</span>
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
            <div className="flex flex-col gap-1">
              {state.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  current={account.id === state.current}
                  renaming={renamingId === account.id}
                  now={now}
                  onSelect={() => {
                    onSelect(account.id);
                    setAnchor(null);
                  }}
                  onContextMenu={(x, y) => setMenu({ account, x, y })}
                  onRenameDone={(label) => {
                    setRenamingId(null);
                    if (label !== null) onRename(account.id, label);
                  }}
                />
              ))}
              {showsCreditsCard(credits) && (
                <CreditsCard credits={credits} now={now} />
              )}
            </div>
          </div>,
          document.body,
        )}
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
    </>
  );
}

interface AccountRowProps {
  account: Account;
  current: boolean;
  renaming: boolean;
  /** Unix ms the countdowns read from. */
  now: number;
  onSelect: () => void;
  onContextMenu: (x: number, y: number) => void;
  /** New label, "" for the automatic one, null when cancelled. */
  onRenameDone: (label: string | null) => void;
}

function AccountRow({
  account,
  current,
  renaming,
  now,
  onSelect,
  onContextMenu,
  onRenameDone,
}: AccountRowProps) {
  const u = account.usage;
  const fable = useModelQuota(account.id);
  // A refusal holds it out (a « Fable limit »), whatever the poll's figure.
  const fableOut =
    fable?.blockedUntil && fable.blockedUntil > now ? fable.blockedUntil : null;
  const at = new Date(now);
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
      // The account new tabs open on: framed in its own colour (Alexis, 14/11/2026).
      style={current ? { borderColor: account.color } : undefined}
      className={`cursor-pointer rounded border px-2 py-1.5 text-xs ${
        current
          ? "bg-zinc-900 text-zinc-100"
          : "border-zinc-800/70 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <AccountDot color={account.color} label={account.label} />
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
      </div>
      {account.loggedIn ? (
        <div className={account.stale ? "opacity-40" : ""}>
          <QuotaLine
            label="5 heures"
            pct={u?.fiveHour?.pct}
            color={account.color}
            when={formatIn(u?.fiveHour?.resetsAt, now)}
          />
          <QuotaLine
            label="Semaine"
            pct={u?.sevenDay?.pct}
            color={account.color}
            when={formatReset(u?.sevenDay?.resetsAt, at)}
          />
          {fable && (
            <QuotaLine
              label={fable.model}
              pct={fableOut ? 100 : fable.pct}
              color={MODEL_SHARE_COLOR}
              out={fableOut !== null}
              when={
                fableOut
                  ? `retour ${formatReset(fableOut / 1000, at) ?? ""}`
                  : formatReset(fable.resetsAt, at)
              }
            />
          )}
        </div>
      ) : (
        <div className="mt-1 text-[10.5px] text-zinc-500">
          Non connecté · clic droit pour se connecter
        </div>
      )}
    </div>
  );
}

/** A model's own share (Fable): the chat's accent, apart from the account's colour. */
const MODEL_SHARE_COLOR = "#e2865f";

/**
 * One quota of a card (the user's pick B of 12/11/2026): its name, its bar,
 * its figure, red from 90 %, and when it comes back.
 */
function QuotaLine({
  label,
  pct,
  color,
  when,
  out = false,
}: {
  label: string;
  pct: number | null | undefined;
  color: string;
  when: string | null;
  /** A refusal holds it: « épuisé », whatever the figure. */
  out?: boolean;
}) {
  const shown =
    pct === null || pct === undefined ? null : Math.min(100, Math.max(0, pct));
  const high = out || (shown ?? 0) >= 90;
  return (
    <div className="mt-1 grid grid-cols-[52px_minmax(0,1fr)_40px_72px] items-center gap-1.5 text-[10.5px]">
      <span className="truncate text-zinc-500">{label}</span>
      <span className="h-1 overflow-hidden rounded-full bg-zinc-800">
        <span
          className="block h-full rounded-full"
          style={{ width: `${shown ?? 0}%`, backgroundColor: color }}
        />
      </span>
      <span
        className={`text-right tabular-nums ${high ? "text-red-400" : "text-zinc-300"}`}
      >
        {out ? "épuisé" : shown === null ? "--" : `${Math.round(shown)} %`}
      </span>
      <span className="truncate text-right text-zinc-500">{when ?? ""}</span>
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

  // Portalled to <body>: inside the sidepanel (a .chrome-surface) the glass
  // background preset would turn its fill translucent.
  return createPortal(
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
    </div>,
    document.body,
  );
}
