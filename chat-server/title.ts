// When a chat's tab gets its session's title. Claude Code names a new
// session about a second after its first message (its `ai-title` line), when
// the terminal titles its tab; waiting for the turn's end is too late: a long
// first turn kept the folder's name on the tab for minutes (03/11/2026).

/** After each message, the chat looks for its title at these delays, until one comes. */
export const TITLE_LOOKS_MS = [1_500, 4_000, 10_000, 30_000] as const;

/** What `getSessionInfo` says of the title. */
export interface TitleInfo {
  /**
   * /rename's title, else Claude Code's own (`ai-title`): the SDK's code
   * (0.3.314) puts both here, though its doc names /rename's alone.
   */
  customTitle?: string;
  /** That title, else the last prompt, else the first. */
  summary: string;
}

/**
 * The tab's title from its session's info. `named`: a real title or
 * nothing, as during a turn, where the summary would be the prompt just
 * sent. A session opened by a command (/clear) has no title yet.
 */
export function sessionTitle(info: TitleInfo, named: boolean): string | undefined {
  if (info.customTitle) return info.customTitle;
  if (named || info.summary.startsWith("/")) return undefined;
  return info.summary;
}
