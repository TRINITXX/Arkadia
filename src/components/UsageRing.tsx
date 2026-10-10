import { formatPct, type UsageWindow } from "@/lib/accounts";

/**
 * A usage window as a ring filled in the account's colour, with its
 * percentage beside it. Red from 90 %, faded when the figure is stale.
 */
export function UsageRing({
  window,
  color,
  stale,
  size = 14,
}: {
  window: UsageWindow | null | undefined;
  color: string;
  stale: boolean;
  size?: number;
}) {
  const pct = window ? Math.min(100, Math.max(0, window.pct)) : 0;
  const high = pct >= 90;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 ${stale ? "opacity-40" : ""}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-zinc-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={high ? "#f87171" : color}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          opacity={pct > 0 ? 1 : 0}
        />
      </svg>
      <span
        className={`min-w-[2.25rem] text-[11px] tabular-nums ${high ? "text-red-400" : "text-zinc-400"}`}
      >
        {formatPct(window)}
      </span>
    </span>
  );
}
