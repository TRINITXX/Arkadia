import { useState } from "react";

/**
 * The next message Claude Code suggests after a turn (`prompt_suggestion`),
 * as grey text in the empty input: Tab takes it, typing dismisses it for
 * good (an input emptied again doesn't bring it back).
 */
export function ghostSuggestion(
  suggestion: string | null,
  text: string,
  working: boolean,
  dismissed: string | null,
): string | null {
  if (!suggestion || working || text !== "" || dismissed === suggestion)
    return null;
  return suggestion;
}

export function useChatSuggestion(
  suggestion: string | null,
  text: string,
  working: boolean,
): string | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Something typed over it: this suggestion is done (set while rendering,
  // React's way of keeping what an earlier render saw).
  if (suggestion && text !== "" && dismissed !== suggestion)
    setDismissed(suggestion);
  return ghostSuggestion(suggestion, text, working, dismissed);
}
