import type { EditDiff } from "@/lib/chat/chatDiff";

/** Rows past this are left out, counted at the end. */
const SHOWN_LINES = 400;

const SIGNS = { add: "+", del: "-", ctx: " " } as const;
const CLASSES = { add: "p", del: "m", ctx: "c" } as const;

/**
 * A file change's lines: with the file's line numbers before and after when
 * the real diff is known (`editDiff`), the unchanged lines between two hunks
 * folded into one row. `children`: what follows (the change's error).
 */
export function ChatDiffRows({
  diff,
  children,
}: {
  diff: EditDiff;
  children?: React.ReactNode;
}) {
  const shown = diff.rows.slice(0, SHOWN_LINES);
  // One width for every number of the card: its largest line's digits.
  const widest = shown.reduce(
    (n, row) =>
      row.kind === "gap" ? n : Math.max(n, row.old ?? 0, row.new ?? 0),
    0,
  );
  const style = diff.numbered
    ? ({
        "--chat-diff-no": `${String(widest).length}ch`,
      } as React.CSSProperties)
    : undefined;
  return (
    <div
      className={`chat-diff${diff.numbered ? " numbered" : ""}`}
      style={style}
    >
      {shown.map((row, i) =>
        row.kind === "gap" ? (
          <div key={i} className="gap">
            {row.lines > 1
              ? `⋯ ${row.lines} lignes inchangées`
              : "⋯ 1 ligne inchangée"}
          </div>
        ) : diff.numbered ? (
          <div key={i} className={CLASSES[row.kind]}>
            <span className="no">{row.old ?? ""}</span>
            <span className="no">{row.new ?? ""}</span>
            <span className="sign">{SIGNS[row.kind]}</span>
            <span className="txt">{row.text}</span>
          </div>
        ) : (
          <div key={i} className={CLASSES[row.kind]}>
            {SIGNS[row.kind]} {row.text}
          </div>
        ),
      )}
      {diff.rows.length > SHOWN_LINES && (
        <div className="more">
          … {diff.rows.length - SHOWN_LINES} lignes de plus
        </div>
      )}
      {diff.note && <div className="more">{diff.note}</div>}
      {children}
    </div>
  );
}
