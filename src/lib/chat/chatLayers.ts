/**
 * What is open in a chat pane, in the order it opened: the shells list, the
 * model and effort menus, the MCP list, the tasks, the agents' drawer and
 * sheet, the search box, the file picker, a confirmation. Esc closes the
 * latest; only an Esc with nothing open goes on to Claude, as an interrupt.
 * Closing a list with Esc stopped Claude's turn (31/10/2026). Pure: the
 * pane holds one (`useChatLayers`).
 */
export interface ChatLayers {
  /** A layer just opened; the function returned forgets it. */
  open(close: () => void): () => void;
  /** Closes the latest layer still open; false when none is. */
  closeTop(): boolean;
}

export function createChatLayers(): ChatLayers {
  const stack: { close: () => void }[] = [];
  return {
    open(close) {
      const entry = { close };
      stack.push(entry);
      return () => {
        const i = stack.indexOf(entry);
        if (i >= 0) stack.splice(i, 1);
      };
    },
    closeTop() {
      const top = stack.pop();
      top?.close();
      return top !== undefined;
    },
  };
}
