/**
 * A reply's « Détail technique » (Alexis's report template: a `---` line,
 * then « Détail technique : … »): shown greyed under the reply, apart from
 * what he reads first (03/11/2026). The last such block only, and only
 * when nothing but it follows the rule: a `---` between two questions of a
 * round stays a plain rule.
 */
export interface TechDetail {
  /** The reply without it, its trailing blank lines dropped. */
  main: string;
  /** « Détail technique : … » to the end. */
  tech: string;
}

const TECH = /^\s*(?:\*\*)?d[ée]tail technique\b/i;

export function splitTechDetail(text: string): TechDetail | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) continue;
    let next = i + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    if (next >= lines.length || !TECH.test(lines[next])) return null;
    const main = lines.slice(0, i).join("\n").trimEnd();
    if (!main) return null;
    return { main, tech: lines.slice(next).join("\n").trim() };
  }
  return null;
}
