import { useCallback, useState } from "react";

const KEY = "arkadia.mobile.modern";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether this phone shows tabs in the modern view (the conversation drawn
 * above the terminal's prompt) rather than the bare terminal. Kept on the
 * phone: the desktop has its own setting.
 */
export function useModernPreference(): [boolean, (on: boolean) => void] {
  const [modern, setModern] = useState(read);
  const set = useCallback((on: boolean) => {
    setModern(on);
    try {
      window.localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      // Private browsing: the choice lasts until the page closes.
    }
  }, []);
  return [modern, set];
}
