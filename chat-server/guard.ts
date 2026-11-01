// What keeps one chat's error from ending every chat of the account: the
// server outlives an error no chat caught (`uncaughtException`,
// `unhandledRejection`), unless they pile up, which says the process itself
// is broken: then it goes, Arkadia starts another on the next command, and
// the page resumes each chat on its session (`chatLive`).

/** Stray errors counted over this window… */
export const STRAY_WINDOW_MS = 60_000;
/** …past this many, the server exits. */
export const STRAY_LIMIT = 20;

/**
 * One more error no chat caught: the times still in the window, this one
 * included, and whether the server should exit.
 */
export function strayVerdict(
  times: readonly number[],
  now: number,
): { times: number[]; exit: boolean } {
  const kept = times.filter((t) => now - t < STRAY_WINDOW_MS);
  kept.push(now);
  return { times: kept, exit: kept.length > STRAY_LIMIT };
}

/** A write to a pipe Arkadia closed: nobody reads us any more. */
export function pipeGone(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "EOF";
}
