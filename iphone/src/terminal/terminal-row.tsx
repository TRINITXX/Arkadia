import { memo } from "react";
import { Text, type TextStyle } from "react-native";
import { resolveColor } from "@/lib/palettes";
import type { CellRun, TerminalPalette } from "@/types";

/** SGR 2 (faint): nested Text has no opacity, so the color fades instead. */
function faded(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  return m ? `#${m[1]}8c` : hex;
}

function runStyle(run: CellRun, palette: TerminalPalette): TextStyle {
  let fg = resolveColor(run.fg, palette, "fg");
  let bg = resolveColor(run.bg, palette, "bg");
  if (run.inverse) [fg, bg] = [bg, fg];
  const lines: string[] = [];
  if (run.underline_style) lines.push("underline");
  if (run.strikethrough) lines.push("line-through");
  return {
    color: run.dim ? faded(fg) : fg,
    backgroundColor: bg !== palette.bg ? bg : undefined,
    fontWeight: run.bold ? "bold" : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    textDecorationLine:
      lines.length === 2
        ? "underline line-through"
        : (lines[0] as TextStyle["textDecorationLine"]),
  };
}

interface TerminalRowProps {
  runs: CellRun[];
  cursorCol: number | null;
  palette: TerminalPalette;
  style: TextStyle;
  /** The row's content as text: rows re-render only when it changes. */
  signature: string;
}

/** One row of the grid, cursor included, as nested native text. */
function TerminalRowView({
  runs,
  cursorCol,
  palette,
  style,
}: TerminalRowProps) {
  const parts: React.ReactNode[] = [];
  let col = 0;
  let placed = cursorCol === null;
  runs.forEach((r, i) => {
    const chars = [...r.text];
    if (!placed && cursorCol !== null && cursorCol < col + chars.length) {
      const at = cursorCol - col;
      const before = chars.slice(0, at).join("");
      const after = chars.slice(at + 1).join("");
      if (before)
        parts.push(
          <Text key={`${i}b`} style={runStyle(r, palette)}>
            {before}
          </Text>,
        );
      parts.push(
        <Text
          key={`${i}c`}
          style={runStyle({ ...r, inverse: !r.inverse }, palette)}
        >
          {chars[at] ?? " "}
        </Text>,
      );
      if (after)
        parts.push(
          <Text key={`${i}a`} style={runStyle(r, palette)}>
            {after}
          </Text>,
        );
      placed = true;
    } else {
      parts.push(
        <Text key={i} style={runStyle(r, palette)}>
          {r.text}
        </Text>,
      );
    }
    col += chars.length;
  });
  // Cursor past the row's text: blank cells up to it, then the cursor cell.
  if (!placed && cursorCol !== null) {
    if (cursorCol > col) parts.push(" ".repeat(cursorCol - col));
    parts.push(
      <Text key="cursor" style={{ backgroundColor: palette.fg }}>
        {" "}
      </Text>,
    );
  }
  return (
    <Text style={style} numberOfLines={1} ellipsizeMode="clip">
      {parts}
    </Text>
  );
}

export const TerminalRow = memo(
  TerminalRowView,
  (a, b) =>
    a.signature === b.signature &&
    a.cursorCol === b.cursorCol &&
    a.palette === b.palette &&
    a.style === b.style,
);
