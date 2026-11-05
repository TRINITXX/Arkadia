import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ChromeProfile {
  /** Folder ("Profile 3"). */
  dir: string;
  /** Display name, as Chrome shows it: what the table holds. */
  name: string;
}

/**
 * Which Chrome profile each Claude account browses in: the panel's Chrome
 * window and "open in browser" open there (`~/.claude/chrome-profiles.json`,
 * read by the Claude Code hook `chrome-profile-open.ps1` too).
 */
export function useChromePairing() {
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [pairing, setPairing] = useState<Record<string, string>>({});

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        invoke<ChromeProfile[]>("chrome_profiles_list"),
        invoke<Record<string, string>>("chrome_pairing_get"),
      ]);
      if (!mounted.current) return;
      setProfiles(p);
      setPairing(t);
    } catch {
      // No Chrome: the section stays empty.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pair = useCallback(
    async (email: string, name: string | null) => {
      await invoke("chrome_pairing_set", { email, name });
      await refresh();
    },
    [refresh],
  );

  return { profiles, pairing, pair };
}

/** The profile paired with `email`, the table's keys compared ignoring case. */
export function pairedProfile(
  pairing: Record<string, string>,
  email: string,
): string | null {
  const key = Object.keys(pairing).find(
    (k) => k.toLowerCase() === email.toLowerCase(),
  );
  return key ? pairing[key] : null;
}
