// An artifact's reply « sent to Claude » reaches a session through a
// watcher that lives in its Claude Code process. A chat put to sleep
// (`sleep.ts`) loses it, and a session the SDK runs never gets it back when
// resumed: only a terminal's `--resume` re-arms it, a message doesn't
// either, while a `/compact` keeps it (probed live on 10/11/2026, Claude
// Code 2.1.322). The reply then waits on claude.ai, unseen. So the page
// tells the chat a reply was sent (`artifact_reply`), and the chat says it
// to Claude itself unless its Claude Code still listens. Pure.

type Message = Record<string, unknown>;

type TaskInfo = { task_type?: unknown; description?: unknown };

/** An artifact's own page on claude.ai: `/artifact/<id>`. */
const ARTIFACT_PATH = /^\/(?:code\/)?artifact\/[A-Za-z0-9-]+$/;
/** That link in a watcher's description. */
const ARTIFACT_IN_TEXT = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+/;

/**
 * An artifact's link without query nor fragment, or null for anything else:
 * the address itself must be claude.ai's, never one it merely quotes.
 */
export function artifactLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "claude.ai" || !ARTIFACT_PATH.test(parsed.pathname)) {
    return null;
  }
  return `https://claude.ai${parsed.pathname}`;
}

/**
 * The artifacts this Claude Code listens to, by link: its live-update
 * watchers, `monitor_ws` tasks whose description names the artifact
 * (« live updates for artifact <link> (…) »). `background_tasks_changed`
 * says them all at each change, a watcher's start and end included; a new
 * process says nothing until its first change, so its set starts empty
 * (`Chat.run`).
 */
export function watchedAfter(watched: readonly string[], m: Message): readonly string[] {
  if (m.type !== "system" || m.subtype !== "background_tasks_changed" || !Array.isArray(m.tasks)) return watched;
  const links = (m.tasks as TaskInfo[]).flatMap((t) => {
    const link =
      t.task_type === "monitor_ws" && typeof t.description === "string"
        ? ARTIFACT_IN_TEXT.exec(t.description)?.[0]
        : undefined;
    return link ? [link] : [];
  });
  return [...new Set(links)];
}

/**
 * A Claude Code that runs listens to that artifact: it hands the comment
 * over itself. A watcher names the link Claude Code published
 * (`/artifact/<id>`): the same artifact under its other address
 * (`/code/artifact/<uuid>`) isn't known for it.
 */
export function listensTo(url: string, running: boolean, watched: readonly string[]): boolean {
  const link = artifactLink(url);
  return link !== null && running && watched.includes(link);
}

/**
 * The chat says the reply to Claude itself: no Claude Code runs (asleep,
 * starting), or the one that does doesn't listen to that artifact (started
 * again since its publish). Listening, a second word would run the reply
 * twice.
 */
export function replyRelayDue(url: string, running: boolean, watched: readonly string[]): boolean {
  return artifactLink(url) !== null && !listensTo(url, running, watched);
}

/**
 * What the chat sends in the user's name, or null for a link that isn't an
 * artifact's: the link alone, never a word of the page's (its title is the
 * page's to write). Claude reads the reply with its own tools, which mark
 * it as a viewer's.
 */
export function replyRelayText(url: string): string | null {
  const link = artifactLink(url);
  return link ? `J'ai répondu dans l'artefact ${link}. Lis ma réponse et continue.` : null;
}
