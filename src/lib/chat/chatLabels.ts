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

/** "21:00" for an epoch-seconds reset. */
export function resetLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
