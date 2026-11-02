import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_CONV_FILTERS, type ConvFilters } from "@/lib/convFilters";

// One choice for every pane, kept while the app runs: the desktop's (App's
// state, the same for all its reading views, back to the default at launch).
let current: ConvFilters = DEFAULT_CONV_FILTERS;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The Messages tab's filters, and how to change them. */
export function useConvFilters() {
  const filters = useSyncExternalStore(subscribe, () => current);
  const toggle = useCallback((key: keyof ConvFilters) => {
    current = { ...current, [key]: !current[key] };
    for (const listener of listeners) listener();
  }, []);
  return { filters, toggle };
}
