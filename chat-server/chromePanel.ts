import { join } from "node:path";

/**
 * Whether a Claude in Chrome call's result names one of the session's tabs:
 * only then does the session's group exist, so the pane's window may close
 * its launch tab (`note_ran` in `src-tauri/src/chrome_view.rs`). A call that
 * opens none (`list_connected_browsers`, `select_browser`, a
 * `tabs_context_mcp` before any group) proves nothing: the launch tab was
 * then the window's only tab, and closing it closed the window, Claude's
 * group landing in another one (06/11/2026). `~/.claude/hooks/chrome-profile-open.ps1`
 * applies the same test in a terminal.
 */
export function callShowsTab(response: unknown): boolean {
  let text: string;
  try {
    text =
      typeof response === "string"
        ? response
        : (JSON.stringify(response) ?? "");
  } catch {
    return false;
  }
  // A tab's number, not the bare word: an error tells Claude to « get a
  // tabId first » with no tab anywhere.
  return /\btab ?id\b\\?"?\s*[:=]?\s*\d/i.test(text);
}

/**
 * The file whose age lets a pane ask for its Chrome window at most every
 * 20 s: the marker `~/.claude/hooks/chrome-profile-open.ps1` keeps for a
 * terminal, same folder, same name. Arkadia deletes it when the pane's
 * window closes (`forget_asked` in `src-tauri/src/chrome_view.rs`): Claude's
 * next call asks for a new window at once, else its new tab group was born
 * in the profile's last-focused window, the parked anchor or another
 * session's (12/11/2026).
 */
export function askedMarker(tmp: string, paneId: string): string {
  return join(tmp, "claude-chrome-panel", paneId.replace(/[^\w-]/g, ""));
}
