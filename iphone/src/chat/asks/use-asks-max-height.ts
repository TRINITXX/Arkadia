import { useEffect, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";

/** What waits takes at most this share of the screen above the keyboard. */
const SHARE = 0.6;

/**
 * The asks' card height at most: 60 % of the screen, of what the keyboard
 * leaves once it opens, so the feed keeps a strip and a field's card stays
 * whole above the keys. The card scrolls inside past it.
 */
export function useAsksMaxHeight(): number {
  const { height } = useWindowDimensions();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardWillShow", (e) =>
      setKeyboard(e.endCoordinates.height),
    );
    const hidden = Keyboard.addListener("keyboardWillHide", () =>
      setKeyboard(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return Math.round((height - keyboard) * SHARE);
}
