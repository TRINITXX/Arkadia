import { useEffect, useState } from "react";

/** From this width (the old PC's browser), the list stays beside the terminal. */
const WIDE_QUERY = "(min-width: 900px)";

export function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}
