import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Whether the app is in front (`active`): a clock or a poll stops while it
 * isn't, as a desktop pane's stops while its tab is hidden. A chat's own
 * clocks read `useChatShown`, which adds its screen being on top.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    // A change between the first render and this subscription isn't lost.
    setActive(AppState.currentState === "active");
    return () => sub.remove();
  }, []);
  return active;
}
