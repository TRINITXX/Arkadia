import { useState } from "react";
import { ChatRing } from "@/components/chat/chat-ring";
import { formatReturnDate } from "@/lib/accounts";
import type { WindowRing } from "@/lib/chat/chatStatus";

/** A model's weekly share as the card shows it (Fable). */
export interface WeekModelShare {
  /** « Fable ». */
  model: string;
  /** 0-100; null: only a refusal said it out. */
  percent: number | null;
  /** Epoch seconds. */
  resetsAt?: number | null;
  /** Unix ms: a refusal holds it out till then. */
  outUntil: number | null;
}

const pct = (n: number) => `${Math.round(n)} %`;

function Row({
  label,
  percent,
  model = false,
  out = false,
}: {
  label: string;
  percent: number | null;
  model?: boolean;
  out?: boolean;
}) {
  const shown = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className={`row${model ? " model" : ""}${out ? " out" : ""}`}>
      <span className="l">{label}</span>
      <span className="bar">
        <i style={{ width: `${out ? 100 : shown}%` }} />
      </span>
      <span className="p">
        {out ? "épuisé" : percent === null ? "--" : pct(percent)}
      </span>
    </div>
  );
}

/**
 * The status bar's week ring and, on hover, the week and Fable's share of
 * it, each with the date it comes back (the user's pick 1 of 12/11/2026).
 */
export function ChatWeekGauge({
  week,
  fable,
  account,
  now,
}: {
  week: WindowRing;
  fable: WeekModelShare | null;
  /** The chat's account (« 3 alexis@vtc »). */
  account: string | null;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const at = new Date(now);
  const weekBack = formatReturnDate(week.resetsAt, at);
  const out = fable?.outUntil && fable.outUntil > now ? fable.outUntil : null;
  const fableBack = out
    ? formatReturnDate(out / 1000, at)
    : formatReturnDate(fable?.resetsAt, at);
  return (
    <span
      className="chat-week"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <ChatRing percent={week.percent} hot={week.hot} />
      Semaine
      {open && (
        <div className="chat-week-pop" role="tooltip">
          <div className="head">
            <b>Quota de la semaine</b>
            {account && <span>{account}</span>}
          </div>
          <Row label="Semaine" percent={week.percent} />
          {weekBack && <div className="when">Revient {weekBack}</div>}
          {fable && (
            <>
              <Row
                label={fable.model}
                percent={fable.percent}
                model
                out={out !== null}
              />
              {fableBack && (
                <div className="when">
                  {out
                    ? `Épuisé, revient ${fableBack}`
                    : `Revient ${fableBack}`}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
