import { useEffect, useRef, useState } from "react";
import { ChatRing } from "@/components/chat/chat-ring";
import type { ContextDetail } from "@/lib/chat/chatProtocol";
import {
  compactTokens,
  contextBreakdown,
  type ContextRow,
} from "@/lib/chat/chatSdkSettings";

/** A pointer only passing over the ring asks nothing (the count costs). */
const HOVER_DELAY_MS = 250;

/** Memory files named under their row, the biggest first. */
const MEMORY_SHOWN = 4;

/** « .claude/CLAUDE.md »: several memory files share a name. */
const shortPath = (p: string) => p.split(/[\\/]/).slice(-2).join("/");
const pct = (share: number) =>
  share > 0 && share < 0.01 ? "< 1 %" : `${Math.round(share * 100)} %`;

type Detail = {
  rows: ContextRow[];
  total: number;
  max: number;
  memory: ContextDetail["memoryFiles"];
};

/**
 * The status bar's context ring and, on hover, what fills the window: tools,
 * memory files, messages, the compaction reserve, the free space
 * (`getContextUsage` full, fetched on hover only, kept a while by
 * `useChatSdkActions`). Without `onDetail` (preview), the ring alone.
 */
export function ChatContextGauge({
  percentage,
  hot,
  onDetail,
}: {
  /** Of the usable window, as the terminal's « Ctx(u) ». */
  percentage: number;
  hot: boolean;
  onDetail?: () => Promise<ContextDetail>;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** Bumped on leave and unmount: a late answer for a closed hover is dropped. */
  const hover = useRef(0);
  useEffect(
    () => () => {
      hover.current += 1;
      window.clearTimeout(timer.current);
    },
    [],
  );

  const enter = () => {
    if (!onDetail) return;
    const at = ++hover.current;
    timer.current = window.setTimeout(() => {
      setOpen(true);
      onDetail().then(
        (d) => {
          if (hover.current !== at) return;
          setError(null);
          setDetail({
            rows: contextBreakdown(d),
            total: d.totalTokens,
            max: d.rawMaxTokens,
            memory: [...d.memoryFiles]
              .sort((a, b) => b.tokens - a.tokens)
              .slice(0, MEMORY_SHOWN),
          });
        },
        (e: unknown) => {
          if (hover.current === at) setError(String(e));
        },
      );
    }, HOVER_DELAY_MS);
  };
  const leave = () => {
    hover.current += 1;
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="chat-ctx"
      title={
        onDetail ? undefined : `Contexte utilisé : ${Math.round(percentage)} %`
      }
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <ChatRing percent={percentage} hot={hot} />
      Contexte
      {open && (
        <div className="chat-ctx-pop" role="tooltip">
          <div className="head">
            <b>Contexte</b>
            <span>
              {detail
                ? `${compactTokens(detail.total)} / ${compactTokens(detail.max)} jetons`
                : ""}
            </span>
          </div>
          {!detail && !error && <div className="wait">Calcul…</div>}
          {error && !detail && (
            <div className="wait">Détail indisponible : {error}</div>
          )}
          {detail?.rows.map((row) => (
            <div key={row.label}>
              <div className={`row ${row.kind}`}>
                <span className="l">{row.label}</span>
                <span className="bar">
                  <i style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                </span>
                <span className="n">{compactTokens(row.tokens)}</span>
                <span className="p">{pct(row.share)}</span>
              </div>
              {row.label === "Fichiers mémoire" &&
                detail.memory.map((f) => (
                  <div key={f.path} className="sub" title={f.path}>
                    <span>{shortPath(f.path)}</span>
                    <span>{compactTokens(f.tokens)}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
