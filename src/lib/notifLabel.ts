import { isStatusGlyph } from "@/lib/agentState";

/**
 * Strips the live status glyph Claude Code stamps at the head of the terminal
 * title (`✳` while waiting, a spinner glyph while busy) plus surrounding
 * whitespace, leaving the human-meaningful part of the title. A title with no
 * glyph (a plain shell) is returned trimmed.
 */
export function stripStatusGlyph(title: string): string {
  const trimmed = title.trimStart();
  const first = trimmed.charAt(0);
  const body = isStatusGlyph(first) ? trimmed.slice(1) : trimmed;
  return body.trim();
}

/** Last path segment of a cwd (handles `/` and `\`, ignores trailing seps). */
function folderName(cwd: string): string {
  const cleaned = cwd.replace(/[\\/]+$/, "");
  return cleaned.split(/[\\/]/).pop() || cleaned;
}

/**
 * Splits the compact notification into its two lines: the project name (top)
 * and the tab name (bottom).
 *
 * - The project name falls back to the cwd's folder name when empty.
 * - The tab title has its status glyph stripped.
 * - `tab` is `null` when the cleaned title is empty or duplicates the project
 *   name (case-insensitive) — the notification then shows a single line.
 */
export function formatNotifLines(
  projectName: string,
  tabTitle: string,
  cwd: string,
): { project: string; tab: string | null } {
  const project = projectName.trim() || folderName(cwd);
  const cleaned = stripStatusGlyph(tabTitle);
  const tab =
    !cleaned || cleaned.toLowerCase() === project.toLowerCase()
      ? null
      : cleaned;
  return { project, tab };
}
