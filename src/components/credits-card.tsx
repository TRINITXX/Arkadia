import { AccountDot } from "./AccountDot";
import {
  CREDITS_COLOR,
  CREDITS_LABEL,
  creditsLines,
  dollars,
  expiryShort,
  openConsoleLogin,
  trancheName,
  type CreditsState,
} from "@/lib/credits";

/** The Console's sign-in in Arkadia's window: Google often refuses it. */
const LOGIN_HINT =
  "La Console Anthropic s'ouvre dans une fenêtre d'Arkadia. Choisissez « Continuer avec l'e-mail » : Google refuse souvent ce navigateur.";

/**
 * The API credits in the « Comptes » menu, as an account's card (the user's
 * pick A of 13/11/2026): their total, then one line per credit with its bar
 * of what is left, the amount and its expiry. Signed out of the Console: a
 * button to sign in again.
 */
export function CreditsCard({
  credits,
  now,
}: {
  credits: CreditsState;
  /** Unix ms the expiries read from. */
  now: number;
}) {
  const connected = credits.console === "connected";
  return (
    <div
      className="rounded border border-zinc-800/70 px-2 py-1.5 text-xs text-zinc-400"
      title={
        connected
          ? [
              `${CREDITS_LABEL} de la Console Anthropic`,
              ...creditsLines(credits, now),
            ].join("\n")
          : `${CREDITS_LABEL} : solde illisible sans la Console`
      }
    >
      <div className="flex items-center gap-1.5">
        <AccountDot color={CREDITS_COLOR} label="$" />
        <span
          className={`min-w-0 flex-1 truncate ${connected ? "" : "italic text-zinc-500"}`}
        >
          {CREDITS_LABEL}
        </span>
        {connected && credits.total !== null && (
          <span className="shrink-0 rounded-full border border-zinc-700 px-1.5 text-[9.5px] leading-[14px] text-zinc-400 tabular-nums">
            {dollars(credits.total)}
          </span>
        )}
      </div>
      {connected ? (
        credits.tranches.map((t, i) => {
          const left =
            t.granted > 0
              ? Math.min(100, Math.max(0, (t.remaining / t.granted) * 100))
              : 0;
          return (
            <div
              key={`${t.kind}-${i}`}
              className="mt-1 grid grid-cols-[52px_minmax(0,1fr)_40px_72px] items-center gap-1.5 text-[10.5px]"
            >
              <span className="truncate text-zinc-500">
                {trancheName(t.kind)}
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${left}%`, backgroundColor: CREDITS_COLOR }}
                />
              </span>
              <span
                className={`text-right tabular-nums ${t.remaining < 100 ? "text-red-400" : "text-zinc-300"}`}
              >
                {dollars(t.remaining)}
              </span>
              <span className="truncate text-right text-zinc-500">
                {t.expiresAt ? `exp. ${expiryShort(t.expiresAt, now)}` : ""}
              </span>
            </div>
          );
        })
      ) : (
        <div className="mt-1 flex items-center gap-2 text-[10.5px]">
          <span className="min-w-0 flex-1 text-zinc-500">
            {credits.console === "disconnected"
              ? "Console déconnectée"
              : "Console pas encore connectée"}
          </span>
          <button
            type="button"
            title={LOGIN_HINT}
            onClick={openConsoleLogin}
            className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-200 hover:bg-zinc-800"
          >
            {credits.console === "disconnected"
              ? "Se reconnecter à la Console"
              : "Se connecter à la Console"}
          </button>
        </div>
      )}
    </div>
  );
}
