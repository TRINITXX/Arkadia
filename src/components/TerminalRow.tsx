import { resolveColor } from "@/lib/palettes";
import type { CellRun, TerminalPalette } from "@/types";

function runStyle(run: CellRun, palette: TerminalPalette): React.CSSProperties {
  let fg = resolveColor(run.fg, palette, "fg");
  let bg = resolveColor(run.bg, palette, "bg");
  if (run.inverse) {
    [fg, bg] = [bg, fg];
  }
  const decorations: string[] = [];
  if (run.underline_style) {
    const styleMap: Record<number, string> = {
      1: "underline",
      2: "underline double",
      3: "underline wavy",
      4: "underline dotted",
      5: "underline dashed",
    };
    decorations.push(styleMap[run.underline_style] ?? "underline");
  }
  if (run.strikethrough) {
    decorations.push("line-through");
  }
  return {
    color: fg,
    backgroundColor: bg !== palette.bg ? bg : undefined,
    fontWeight: run.bold ? 600 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    opacity: run.dim ? 0.55 : undefined,
    textDecoration: decorations.length > 0 ? decorations.join(" ") : undefined,
    cursor: run.hyperlink ? "pointer" : undefined,
  };
}

interface TerminalRowProps {
  runs: CellRun[];
  cursorCol: number | null;
  focused: boolean;
  palette: TerminalPalette;
}

/** One row of the terminal grid, cursor included (desktop and phone). */
export function TerminalRow({
  runs,
  cursorCol,
  focused,
  palette,
}: TerminalRowProps) {
  if (cursorCol === null) {
    return (
      <div className="min-h-[1.25em]">
        {runs.map((r, i) => (
          <span key={i} style={runStyle(r, palette)}>
            {r.text}
          </span>
        ))}
      </div>
    );
  }

  const out: React.ReactNode[] = [];
  let col = 0;
  let placedCursor = false;
  runs.forEach((r, i) => {
    const len = [...r.text].length;
    if (!placedCursor && cursorCol >= col && cursorCol < col + len) {
      const localIdx = cursorCol - col;
      const chars = [...r.text];
      const before = chars.slice(0, localIdx).join("");
      const at = chars[localIdx] ?? " ";
      const after = chars.slice(localIdx + 1).join("");
      if (before) {
        out.push(
          <span key={`${i}-b`} style={runStyle(r, palette)}>
            {before}
          </span>,
        );
      }
      const cursorRun: CellRun = { ...r, inverse: !r.inverse };
      out.push(
        <span
          key={`${i}-c`}
          style={focused ? runStyle(cursorRun, palette) : runStyle(r, palette)}
          className={focused ? "" : "outline outline-1 outline-zinc-500"}
        >
          {at}
        </span>,
      );
      if (after) {
        out.push(
          <span key={`${i}-a`} style={runStyle(r, palette)}>
            {after}
          </span>,
        );
      }
      placedCursor = true;
    } else {
      out.push(
        <span key={i} style={runStyle(r, palette)}>
          {r.text}
        </span>,
      );
    }
    col += len;
  });

  if (!placedCursor) {
    out.push(
      <span
        key="end-cursor"
        style={
          focused
            ? { backgroundColor: palette.fg, color: palette.bg }
            : undefined
        }
        className={focused ? "" : "outline outline-1 outline-zinc-500"}
      >
        {" "}
      </span>,
    );
  }

  return <div className="min-h-[1.25em]">{out}</div>;
}
