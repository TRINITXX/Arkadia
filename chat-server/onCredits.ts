/**
 * The API credits' chat server (`src-tauri/src/credits.rs`, account `api`):
 * Rust put the key in this process's env, and its Claude Code takes it over
 * the claude.ai sign-in. Pure, so the page's tests check it.
 */

/** The account key Rust starts that server with (`ARKADIA_CHAT_ACCOUNT`). */
export const CREDITS_ACCOUNT = "api";

/** Always this model on the credits, whatever the pane asked: never Fable. */
export const CREDITS_MODEL = "claude-opus-5-5";

/** The model a session runs: Opus 5.5 on the credits, else the one asked. */
export function sessionModel(
  account: string | null,
  model: string | undefined,
): string | undefined {
  return account === CREDITS_ACCOUNT ? CREDITS_MODEL : model;
}

/**
 * The model a credits session goes back to, or null: one it reports (its
 * init, a context read) other than Opus 5.5, `/model fable` typed in the
 * chat. Never on a subscription.
 */
export function strayModel(
  account: string | null,
  reported: string | undefined,
): string | null {
  if (account !== CREDITS_ACCOUNT || !reported) return null;
  // `claude-opus-5-5[1m]` is Opus 5.5 too.
  return reported.startsWith(CREDITS_MODEL) ? null : CREDITS_MODEL;
}

/**
 * Claude Code's extra flags. Claude in Chrome (`--chrome`) only on a
 * subscription: a key turns it off anyway (checked 13/11/2026).
 */
export function sessionArgs(account: string | null): Record<string, string | null> {
  return {
    "replay-user-messages": null,
    ...(account === CREDITS_ACCOUNT ? {} : { chrome: null }),
    "thinking-display": "summarized",
  };
}

/**
 * A `!` command's env: the user's own shell never pays with the credits
 * (a `claude` typed there would take the key).
 */
export function bangEnv(env: Record<string, string>): Record<string, string> {
  const { ANTHROPIC_API_KEY: _key, ...rest } = env;
  return rest;
}
