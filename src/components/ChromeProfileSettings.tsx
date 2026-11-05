import { useAccounts } from "@/lib/useAccounts";
import { pairedProfile, useChromePairing } from "@/lib/useChromePairing";

/** Settings section: the Chrome profile each Claude account browses in. */
export function ChromeProfileSettings() {
  const { state } = useAccounts();
  const { profiles, pairing, pair } = useChromePairing();
  const accounts = (state?.accounts ?? []).filter((a) => a.email);
  if (accounts.length === 0 || profiles.length === 0) return null;

  return (
    <section>
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Chrome de chaque compte
      </h4>
      <p className="mb-3 text-[11px] text-zinc-500">
        {
          "Quand Claude navigue, sa fenêtre Chrome s'ouvre dans le panneau, sur le profil choisi ici. L'extension Claude de ce profil doit être connectée au même compte."
        }
      </p>
      <div className="flex flex-col gap-2">
        {accounts.map((account) => {
          const email = account.email ?? "";
          const current = pairedProfile(pairing, email) ?? "";
          return (
            <label
              key={account.id}
              className="flex items-center justify-between gap-3 text-sm text-zinc-200"
            >
              <span className="min-w-0 truncate" title={email}>
                {account.label}
                <span className="ml-2 text-[11px] text-zinc-500">{email}</span>
              </span>
              <select
                value={current}
                onChange={(e) => void pair(email, e.target.value || null)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
              >
                <option value="">Aucun</option>
                {profiles.map((p) => (
                  <option key={p.dir} value={p.name}>
                    {p.name}
                  </option>
                ))}
                {current && !profiles.some((p) => p.name === current) && (
                  <option value={current}>{current} (introuvable)</option>
                )}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}
