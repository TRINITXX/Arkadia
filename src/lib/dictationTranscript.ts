/**
 * The full dictation from expo-speech-recognition "result" events, for the
 * iPhone app (taken from KalorApp, where it runs on Alexis's iPhone).
 * In continuous mode on iOS 18+, a pause closes a segment (isFinal: true) and
 * the next results carry only the new words, so final segments add up; the
 * last event can be a final one with no result, which must not wipe the text.
 * On older iOS, results are cumulative and the single final one holds it all.
 */

export interface TranscriptState {
  committed: string;
  interim: string;
  lastFinal: string;
}

export const EMPTY_TRANSCRIPT: TranscriptState = {
  committed: "",
  interim: "",
  lastFinal: "",
};

export function addResult(
  state: TranscriptState,
  event: { isFinal: boolean; results: { transcript: string }[] },
): TranscriptState {
  const text = event.results[0]?.transcript ?? "";
  if (text.trim() === "")
    return event.isFinal ? { ...state, interim: "" } : state;
  if (!event.isFinal) return { ...state, interim: text };
  // The same closing segment can be reported twice in a row.
  if (text.trim() === state.lastFinal && state.interim === "") return state;
  return {
    committed: joinWords(state.committed, text),
    interim: "",
    lastFinal: text.trim(),
  };
}

export function transcriptText(state: TranscriptState): string {
  return joinWords(state.committed, state.interim).trim();
}

function joinWords(a: string, b: string): string {
  if (a.trim() === "") return b.trim();
  if (b.trim() === "") return a.trim();
  return `${a.trim()} ${b.trim()}`;
}
