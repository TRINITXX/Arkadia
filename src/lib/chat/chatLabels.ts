import type { PermissionMode } from "@/lib/chat/chatProtocol";

/** A folder's last name: a chat's label before Claude names its session. */
export function folderOf(path: string | null | undefined): string {
  return path?.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** Shift+Tab's order, as in the terminal. */
export const MODE_CYCLE: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
];

const MODE_LABELS: Record<string, string> = {
  default: "Demande avant d'agir",
  acceptEdits: "Modifs acceptées",
  plan: "Mode plan",
  auto: "Auto",
  bypassPermissions: "Sans garde-fou",
  dontAsk: "Sans question",
};

export function modeLabel(mode: string | null): string {
  return mode ? (MODE_LABELS[mode] ?? mode) : "…";
}

export function nextMode(mode: string | null): PermissionMode {
  const i = MODE_CYCLE.indexOf((mode ?? "default") as PermissionMode);
  return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
}

export const MODELS: { id: string; label: string }[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
];

/** "Opus 5.5" for `claude-opus-5-5`, `claude-opus-5-5[1m]` or `opus`. */
export function modelLabel(model: string | null): string {
  if (!model) return "…";
  const base = model.replace(/\[.*\]$/, "");
  const known = MODELS.find((m) => m.id === base);
  if (known) return known.label;
  const family = /(opus|sonnet|haiku|fable)/i.exec(base)?.[1];
  return family
    ? family[0].toUpperCase() + family.slice(1).toLowerCase()
    : base;
}

/** "1 min 12 s" / "45 s". */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60
    ? `${s} s`
    : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** "4,2 k" past a thousand. */
export function tokensLabel(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(".", ",")} k`;
}

/**
 * Time left before an epoch-seconds reset, whole minutes down as the
 * terminal's "2hr 15m": "2 h 15 min", "45 min", "< 1 min"; null once past.
 */
export function resetLabel(epochSeconds: number, now: number): string | null {
  const ms = epochSeconds * 1000 - now;
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "< 1 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
