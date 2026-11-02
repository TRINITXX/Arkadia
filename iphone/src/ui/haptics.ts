import * as Haptics from "expo-haptics";

/**
 * The app's touch feedback, the way Apple's own apps give it (Alexis's
 * choice of 02/11/2026): every control goes through here, so each feels
 * the same.
 * - `tick`: something picked (a menu item, a chip, a tab, a segment, an
 *   option, a row that unfolds);
 * - `tap`: an action set off (send, stop, answer, open or close a sheet);
 * - `success`, `warning`, `failure`: how it ended (copied, Claude asks,
 *   refused or failed).
 * Never while typing nor scrolling. A switch gets none: iOS plays its own.
 * A failed call is dropped: a missed buzz, never an uncaught error over
 * the app (`crash-store`).
 */
const quiet = () => {};

export function tick(): void {
  Haptics.selectionAsync().catch(quiet);
}

export function tap(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(quiet);
}

export function success(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    quiet,
  );
}

export function warning(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    quiet,
  );
}

export function failure(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
    quiet,
  );
}
