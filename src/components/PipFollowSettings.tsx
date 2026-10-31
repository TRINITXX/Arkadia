import { usePipFollow, type PipFollowNote } from "@/lib/pipFollow";

const NOTES: Record<Exclude<PipFollowNote, null>, string> = {
  saved: "Position enregistrée.",
  noPip:
    "Aucune fenêtre PiP de Twitch ouverte : ouvre-la, place-la, puis réessaie.",
  cleared: "Position effacée : la fenêtre PiP ne bouge plus.",
  failed: "Échec, réessaie.",
};

/** Settings section of the Twitch PiP window that follows Arkadia (Lab only). */
export function PipFollowSettings() {
  const { enabled, target, note, save, clear } = usePipFollow();
  if (!enabled) return null;

  return (
    <section>
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Fenêtre PiP de Twitch
      </h4>
      <p className="mb-3 text-[11px] text-zinc-500">
        {
          "Quand Arkadia passe au premier plan, la fenêtre PiP de Twitch va à la position enregistrée, et revient où elle était quand tu quittes Arkadia. Pour la régler : place la fenêtre PiP où tu veux, puis « Enregistrer la position »."
        }
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:border-zinc-500"
        >
          Enregistrer la position
        </button>
        {target && (
          <button
            type="button"
            onClick={() => void clear()}
            className="rounded border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
          >
            Effacer
          </button>
        )}
        <span className="text-[11px] text-zinc-500">
          {target
            ? `${target.width} × ${target.height} px à (${target.left}, ${target.top})`
            : "Aucune position enregistrée : la fenêtre ne bouge pas."}
        </span>
      </div>
      {note && <p className="mt-2 text-[11px] text-zinc-400">{NOTES[note]}</p>}
    </section>
  );
}
