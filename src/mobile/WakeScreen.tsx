import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { openArkadia, wakePc, type Reach } from "@/mobile/remote";
import { isLate, type WakeProgress } from "@/mobile/wake";

type StepState = "done" | "now" | "fail" | "todo";

/**
 * A wake asked from this phone, step by step: the order, the PC back on the
 * network, Windows ready. A step that takes over 30 s says so, and the screen
 * moves on by itself if the PC comes up after all.
 */
export function WakeScreen({
  wake,
  reach,
}: {
  wake: WakeProgress;
  reach: Reach;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const late = isLate(wake, now);
  const up = wake.done === 3;
  const stateOf = (step: number): StepState =>
    step < wake.done
      ? "done"
      : step > wake.done
        ? "todo"
        : late
          ? "fail"
          : "now";
  const labels = [
    "Ordre envoyé",
    wake.done >= 2 ? "PC allumé" : "Le PC démarre",
    "Windows prêt",
  ];
  const failLabel = wake.failed ? "L’ordre n’est pas parti" : "Rien après 30 s";
  const seconds = Math.max(0, Math.floor((now - wake.since) / 1000));

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-lg text-zinc-100">
        {up ? "PC allumé" : late ? "Le PC ne répond pas" : "Allumage du PC"}
      </p>
      <ul className="flex w-full max-w-[220px] flex-col gap-3 text-left">
        {labels.map((label, step) => {
          const state = stateOf(step);
          // Once late, what would come after the stuck step is not shown.
          if (late && state === "todo") return null;
          return (
            <Step
              key={step}
              state={state}
              label={state === "fail" ? failLabel : label}
              seconds={state === "now" && step > 0 ? seconds : null}
            />
          );
        })}
      </ul>
      {late && (
        <>
          <p className="text-sm text-zinc-500">
            Si le PC s’allume quand même, cet écran changera tout seul.
          </p>
          <button
            type="button"
            onClick={() => void wakePc()}
            className="rounded-lg bg-zinc-800 px-5 py-2.5 text-sm text-zinc-100 active:bg-zinc-700"
          >
            Réessayer
          </button>
        </>
      )}
      {up &&
        (reach === "closed" ? (
          <button
            type="button"
            onClick={() => void openArkadia()}
            className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 active:bg-zinc-300"
          >
            Ouvrir Arkadia
          </button>
        ) : (
          <p className="text-sm text-zinc-400">Connexion à Arkadia…</p>
        ))}
    </div>
  );
}

function Step({
  state,
  label,
  seconds,
}: {
  state: StepState;
  label: string;
  seconds: number | null;
}) {
  return (
    <li
      className={`flex items-center gap-2.5 text-sm ${
        state === "fail"
          ? "text-red-300"
          : state === "todo"
            ? "text-zinc-500"
            : "text-zinc-100"
      }`}
    >
      {state === "done" && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-green-950">
          <Check size={13} strokeWidth={3} />
        </span>
      )}
      {state === "fail" && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-900 text-red-200">
          <X size={13} strokeWidth={3} />
        </span>
      )}
      {state === "now" && (
        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200" />
      )}
      {state === "todo" && (
        <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-zinc-700" />
      )}
      {label}
      {seconds !== null && (
        <span className="ml-auto text-xs text-zinc-600 tabular-nums">
          {seconds} s
        </span>
      )}
    </li>
  );
}
