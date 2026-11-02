/**
 * The iPhone app's stack of terminal and chat screens (`acquireWatch`,
 * `acquireChat` in `iphone/src/remote/connection.ts`): only the topmost one
 * streams, since the PC holds one pane per phone as on screen.
 */

export interface PhoneScreen {
  kind: "frames" | "chat";
  pane: string;
}

export interface TopStreams {
  /** The pane whose frames stream, or none. */
  frames: string | null;
  /** The chat whose events stream, or none. */
  chat: string | null;
  /** A chat back on top after the screen above it left: it missed events. */
  catchUp: string | null;
}

/**
 * What streams for this stack. `shownChat`: the chat streaming before;
 * `uncovered`: a screen just left (a screen just opened asks for its own
 * replay, never a catch-up).
 */
export function topStreams(
  screens: readonly PhoneScreen[],
  shownChat: string | null,
  uncovered: boolean,
): TopStreams {
  const top = screens[screens.length - 1];
  const frames = top?.kind === "frames" ? top.pane : null;
  const chat = top?.kind === "chat" ? top.pane : null;
  const back = uncovered && chat !== null && chat !== shownChat;
  return { frames, chat, catchUp: back ? chat : null };
}
