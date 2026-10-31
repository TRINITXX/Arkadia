/**
 * May a request panel (permission, MCP request) take the keyboard? Only from
 * nowhere, or from a button of its own chat: never from what accepts typing
 * (a field, the Ctrl+F search box, an editable block), an open menu, or
 * anything outside the chat (a terminal, another pane). Taken from the search
 * box, an Enter meant for « next match » would answer the request.
 */

/** What matters of the focused element, read by `focusOf`. */
export interface FocusInfo {
  /** Lower-case tag name. */
  tag: string;
  /** `contenteditable` (or inside one). */
  editable: boolean;
  /** Inside the panel's own `.chat-root`. */
  inChat: boolean;
  /** Inside the search box, a menu or a list of choices. */
  inMenu: boolean;
}

const TYPING_TAGS = new Set(["input", "textarea", "select"]);

/** Null: nothing has the focus (the page's body). */
export function focusIsFree(focused: FocusInfo | null): boolean {
  if (!focused) return true;
  if (TYPING_TAGS.has(focused.tag) || focused.editable) return false;
  if (focused.inMenu) return false;
  return focused.inChat;
}

/** Search box, menus, popovers, choice lists: never taken from. */
const MENU_SELECTOR =
  '.chat-search, .chat-menu, .chat-tasks, .chat-mcp-list, [role="menu"], [role="listbox"], [role="dialog"]';

/** The focused element as `focusIsFree` reads it, for a panel inside `panel`. */
export function focusOf(panel: Element | null): FocusInfo | null {
  const focused = document.activeElement;
  if (!focused || focused === document.body) return null;
  const chat = panel?.closest(".chat-root");
  return {
    tag: focused.tagName.toLowerCase(),
    editable: (focused as HTMLElement).isContentEditable === true,
    inChat: !!chat?.contains(focused),
    inMenu: !!focused.closest(MENU_SELECTOR),
  };
}
