/**
 * The phone's pencil on the user's messages (the desktop's `useMessageEdit`,
 * `chat-edit-confirm.tsx`): what its confirm and its refusal say. Pure.
 */

/** Asked before an edit drops messages: the desktop's sentence, as an iOS alert. */
export function editConfirmText(later: number): {
  title: string;
  message: string;
} {
  return {
    title: "Modifier ce message",
    message: `La conversation revient juste avant, et ${
      later > 1
        ? `les ${later} messages suivants partent`
        : "le message suivant part"
    }.`,
  };
}

/** The SDK reads the session from its last compaction on: older can't be reached. */
export const EDIT_BEFORE_COMPACTION =
  "Impossible d'y revenir : ce message précède une compaction";

/**
 * The phone's input takes no image: a message with pasted ones is edited on
 * the PC, never retyped without them.
 */
export const EDIT_WITH_IMAGES =
  "Message avec images collées : à modifier sur le PC, sinon elles se perdent";
