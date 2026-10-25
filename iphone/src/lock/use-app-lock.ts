import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

/** Face ID again after this long away from the app (choice of 25/10/2026). */
export const LOCK_AFTER_MS = 30 * 60_000;
const LEFT_AT_KEY = "arkadia-left-at";

/** Whether an absence from `leftAt` to `now` asks for Face ID again. */
export function lockedAfter(leftAt: number | null, now: number): boolean {
  return leftAt !== null && now - leftAt > LOCK_AFTER_MS;
}

/**
 * Locks the app behind Face ID when Alexis comes back after 30 min away,
 * including when iOS closed the app meanwhile (the time he left is kept).
 * "inactive" (Control Center, the Face ID prompt itself) is not leaving.
 */
export function useAppLock() {
  const [locked, setLocked] = useState(false);

  const unlock = useCallback(async () => {
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      setLocked(false);
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Déverrouiller Arkadia",
    });
    if (result.success) setLocked(false);
  }, []);

  useEffect(() => {
    let leftAt: number | null = null;
    // An absence counts once: forgotten as soon as it was checked, or the
    // return from the Face ID prompt itself ("inactive" → "active") would
    // lock again, prompt after prompt.
    const lockIfLongAway = () => {
      const longAway = lockedAfter(leftAt, Date.now());
      leftAt = null;
      void SecureStore.deleteItemAsync(LEFT_AT_KEY).catch(() => {});
      if (!longAway) return;
      setLocked(true);
      void unlock();
    };
    void SecureStore.getItemAsync(LEFT_AT_KEY).then((raw) => {
      leftAt = raw ? Number(raw) : null;
      lockIfLongAway();
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        leftAt = Date.now();
        void SecureStore.setItemAsync(LEFT_AT_KEY, String(leftAt));
      } else if (state === "active") lockIfLongAway();
    });
    return () => sub.remove();
  }, [unlock]);

  return { locked, unlock };
}
