import { useEffect, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { UsageRing } from "@/components/UsageRing";
import { ACCOUNT_COLORS, formatCountdown, type Account } from "@/lib/accounts";
import type { RemoteAction } from "@/lib/remoteActions";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";

/** What the editor changed; absent fields stay as they are. */
interface AccountPatch {
  label?: string;
  color?: string;
}

/** The reset countdown moves by the minute. */
const TICK_MS = 30_000;

interface AccountsScreenProps {
  snapshot: RemoteSnapshot;
  run: (action: RemoteAction) => Promise<boolean>;
}

/**
 * The Claude accounts: usage over 5 hours and the week, time left before the
 * 5-hour reset, the account new tabs open on (tap to change), name and
 * colour, and the automatic switch when a limit is reached. Adding or
 * removing an account stays on the desktop.
 */
export function AccountsScreen({ snapshot, run }: AccountsScreenProps) {
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const state = snapshot.accounts;
  if (!state)
    return (
      <p className="px-4 py-6 text-center text-sm text-zinc-500">
        Comptes indisponibles.
      </p>
    );

  return (
    <div className="pb-4">
      <button
        type="button"
        role="switch"
        aria-checked={snapshot.autoSwitch}
        onClick={() =>
          void run({ kind: "autoSwitch", on: !snapshot.autoSwitch })
        }
        className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-zinc-900"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-zinc-100">
            Changement automatique
          </span>
          <span className="block text-xs text-zinc-500">
            Passe sur un autre compte quand la limite est atteinte
          </span>
        </span>
        <span
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
            snapshot.autoSwitch ? "bg-emerald-500" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              snapshot.autoSwitch ? "left-[18px]" : "left-0.5"
            }`}
          />
        </span>
      </button>
      <h2 className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        Nouveaux onglets sur
      </h2>
      {state.accounts.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          current={a.id === state.current}
          now={now}
          editing={editing === a.id}
          onSelect={() => void run({ kind: "setAccount", accountId: a.id })}
          onEdit={() => setEditing(editing === a.id ? null : a.id)}
          onSave={(patch) => {
            setEditing(null);
            if (patch.label !== undefined || patch.color !== undefined)
              void run({ kind: "updateAccount", accountId: a.id, ...patch });
          }}
        />
      ))}
    </div>
  );
}

function AccountRow({
  account,
  current,
  now,
  editing,
  onSelect,
  onEdit,
  onSave,
}: {
  account: Account;
  current: boolean;
  now: number;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onSave: (patch: AccountPatch) => void;
}) {
  const u = account.usage;
  const countdown = formatCountdown(u?.fiveHour?.resetsAt, now);
  return (
    <div className="border-b border-zinc-900">
      <div className="flex items-center pr-2">
        <button
          type="button"
          disabled={!account.loggedIn}
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:bg-zinc-900 disabled:opacity-50"
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: account.color }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] text-zinc-100">
              {account.label}
              {account.plan && (
                <span className="text-zinc-500"> · {account.plan}</span>
              )}
            </span>
            <span className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
              {account.loggedIn ? (
                <>
                  <span className="flex items-center gap-1">
                    5 h
                    <UsageRing
                      window={u?.fiveHour}
                      color={account.color}
                      stale={account.stale}
                    />
                  </span>
                  {countdown && <span>reset dans {countdown}</span>}
                  <span className="flex items-center gap-1">
                    sem.
                    <UsageRing
                      window={u?.sevenDay}
                      color={account.color}
                      stale={account.stale}
                    />
                  </span>
                </>
              ) : (
                "non connecté"
              )}
            </span>
          </span>
          {current && <Check size={18} className="shrink-0 text-emerald-400" />}
        </button>
        <button
          type="button"
          aria-label={`Modifier ${account.label}`}
          onClick={onEdit}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 active:bg-zinc-800"
        >
          <Pencil size={15} />
        </button>
      </div>
      {editing && <AccountEditor account={account} onSave={onSave} />}
    </div>
  );
}

function AccountEditor({
  account,
  onSave,
}: {
  account: Account;
  onSave: (patch: AccountPatch) => void;
}) {
  // An automatic name (plan, "Non connecté") is not the user's: start empty,
  // as on the desktop, so saving a colour never freezes it as a custom name.
  const initialLabel = account.customLabel ? account.label : "";
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState(account.color);
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={account.label}
        aria-label="Nom du compte"
        // 16px: iOS zooms the page into any field with a smaller font.
        className="rounded-lg bg-zinc-900 px-3 py-2 text-[16px] text-zinc-100 outline-none"
      />
      <div className="flex gap-3">
        {ACCOUNT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Couleur ${c}`}
            onClick={() => setColor(c)}
            className={`h-8 w-8 rounded-full ${c === color ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <button
        type="button"
        // Only what changed; an emptied name goes back to the automatic one.
        onClick={() =>
          onSave({
            label: label.trim() !== initialLabel ? label.trim() : undefined,
            color: color !== account.color ? color : undefined,
          })
        }
        className="self-start rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 active:bg-zinc-300"
      >
        Enregistrer
      </button>
    </div>
  );
}
