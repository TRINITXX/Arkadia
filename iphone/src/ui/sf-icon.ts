import type { SFSymbol } from "sf-symbols-typescript";

/** The desktop buttons' Lucide icons, as their closest SF Symbols. */
const SF_OF_LUCIDE: Record<string, SFSymbol> = {
  check: "checkmark",
  x: "xmark",
  database: "cylinder",
  play: "play",
  terminal: "terminal",
  upload: "square.and.arrow.up",
  folder: "folder",
  plus: "plus",
};

export function sfIcon(lucide: string): SFSymbol | undefined {
  return SF_OF_LUCIDE[lucide];
}
