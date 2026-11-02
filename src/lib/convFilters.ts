import type { ConvBlock } from "@/lib/convStore";

/**
 * Which message types the reading view shows: the desktop's modern view, the
 * web page and the iPhone's Messages tab, so all three read the same.
 */
export interface ConvFilters {
  user: boolean;
  assistant: boolean;
  thinking: boolean;
  tools: boolean;
  /** When false, tool cards render without their output (header/input only). */
  results: boolean;
}

// Default to a clean "reading" view — your messages + Claude's prose only. The
// filters reveal thinking / tools / results on demand.
export const DEFAULT_CONV_FILTERS: ConvFilters = {
  user: true,
  assistant: true,
  thinking: false,
  tools: false,
  results: false,
};

export const FILTER_LABELS: { key: keyof ConvFilters; label: string }[] = [
  { key: "user", label: "Toi" },
  { key: "assistant", label: "Claude" },
  { key: "thinking", label: "Pensées" },
  { key: "tools", label: "Outils" },
  { key: "results", label: "Résultats" },
];

/** Whether `filters` let a block of this kind show. */
export function blockShown(
  kind: ConvBlock["kind"],
  filters: ConvFilters,
): boolean {
  switch (kind) {
    case "user":
      return filters.user;
    case "assistant":
      return filters.assistant;
    case "thinking":
      return filters.thinking;
    default:
      return filters.tools;
  }
}

/** Something is hidden: the filter button shows it is active. */
export function filtersHideAny(filters: ConvFilters): boolean {
  return FILTER_LABELS.some((f) => !filters[f.key]);
}
