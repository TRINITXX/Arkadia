/** What `restsWhileHidden` reads of the chat view's props. */
export interface HiddenViewProps {
  hidden?: boolean;
  voice: { status: string };
  draft: unknown;
}

/**
 * Whether a hidden chat view may skip a render (`ChatView`'s memo): only
 * while hidden before and after, and nothing it is finishing changed. Work
 * started on screen ends in props: a dictation that stops (Enter during it
 * sends once its text lands, `useSendAfterDictation`), its text landing in
 * the draft. Frozen through those, the message would wait until the tab
 * shows again.
 */
export function restsWhileHidden(
  prev: HiddenViewProps,
  next: HiddenViewProps,
): boolean {
  return (
    prev.hidden === true &&
    next.hidden === true &&
    prev.voice.status === next.voice.status &&
    prev.draft === next.draft
  );
}
