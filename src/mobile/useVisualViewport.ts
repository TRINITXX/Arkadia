import { useEffect, useState } from "react";

export interface ViewportBox {
  /** Visible height: shrinks when the on-screen keyboard opens. */
  height: number;
  /** How far iOS scrolled the page to show the focused field. */
  top: number;
  keyboardOpen: boolean;
}

/** Above this many hidden pixels, the shrink is the keyboard, not a toolbar. */
const KEYBOARD_MIN_PX = 120;

function read(): ViewportBox {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  return {
    height,
    top: vv?.offsetTop ?? 0,
    keyboardOpen: window.innerHeight - height > KEYBOARD_MIN_PX,
  };
}

/**
 * The part of the screen the keyboard leaves free. iOS does not shrink the
 * page when the keyboard opens, only the visual viewport: sizing the app to it
 * keeps the bottom of the terminal (Claude's prompt or question) in view.
 */
export function useVisualViewport(): ViewportBox {
  const [box, setBox] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setBox(read());
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return box;
}
