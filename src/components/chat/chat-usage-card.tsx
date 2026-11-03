import { useState } from "react";
import type { UsagePeriod, UsageReport } from "@/lib/chat/chatUsage";

/** « 24 % », the French narrow space before the sign. */
const NNBSP = String.fromCharCode(0x202f);
const pct = (n: number) => `${Math.round(n)}${NNBSP}%`;

/**
 * /usage's answer as the terminal shows it (the user's pick A of
 * 03/11/2026): a bar per window, amber once it runs hot, then what weighs
 * on them for the period its tab picks (24 h first).
 */
export function ChatUsageBody({ report }: { report: UsageReport }) {
  const [tab, setTab] = useState(0);
  const period: UsagePeriod | undefined =
    report.periods[tab] ?? report.periods[0];
  const lines = (rest: string[]) =>
    rest.length > 0 && (
      <div className="rest">
        {rest.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    );
  return (
    <div className="body chat-usage">
      {report.windows.map((w, i) => (
        <div key={i} className={w.hot ? "win hot" : "win"}>
          <div className="top">
            <span>{w.label}</span>
            <span className="pc">{pct(w.percent)}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, Math.max(0, w.percent))}%` }} />
          </div>
          {w.reset && <div className="sub">{w.reset}</div>}
        </div>
      ))}
      {lines(report.rest)}
      {(period || report.note) && (
        <>
          <div className="sect">
            <b>Ce qui pèse</b>
            {report.periods.length > 1 && (
              <span className="seg" role="group" aria-label="Période">
                {report.periods.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={p === period}
                    className={p === period ? "on" : undefined}
                    onClick={() => setTab(i)}
                  >
                    {p.label}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div className="sub">
            {[period?.summary, report.note].filter(Boolean).join(" · ")}
          </div>
          {period?.tips.map((t, i) => (
            <div key={i} className="tip">
              <span className="pc">{pct(t.percent)}</span>
              <span className="t">{t.text}</span>
              {t.detail && <span className="d">{t.detail}</span>}
            </div>
          ))}
          {period?.tops.map((top, i) => (
            <div key={i} className="tops">
              <div className="lbl">{top.label}</div>
              <div className="chips">
                {top.entries.map((e, j) => (
                  <span key={j} className="chip">
                    {e.name}
                    {e.percent !== null && <b> {pct(e.percent)}</b>}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {period && lines(period.rest)}
        </>
      )}
    </div>
  );
}
