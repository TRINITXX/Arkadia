/**
 * The API credits' pseudo-account, with no import: the iPhone app reaches
 * `accounts.ts`, which marks it, and Metro finds no Tauri there
 * (`phoneBundle.test`). The rest lives in `credits.ts`.
 */

/** The pseudo-account of a chat on the credits (`credits::ACCOUNT`). */
export const CREDITS_ACCOUNT_ID = "api";
/** Always this model on the credits (`credits::MODEL`). */
export const CREDITS_MODEL = "claude-opus-5-5";
/** The credits' own colour, apart from the accounts' and Fable's. */
export const CREDITS_COLOR = "#34d399";
export const CREDITS_LABEL = "Crédits API";
