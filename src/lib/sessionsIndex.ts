/**
 * Pure logic behind the "recent sessions" overlay: how the flat list coming
 * from `list_claude_sessions` is filtered, grouped and dated, and which
 * sidepanel project a session must reopen into.
 *
 * The backend already dropped the sessions that can't be listed (no title, no
 * prompt, or a folder that no longer exists), so everything here is display
 * logic over a list of live, resumable conversations.
 */

import { matchesAllTerms, queryTerms } from "@/lib/searchTerms";
import type { Project } from "@/types";

/** One session, as `list_claude_sessions` returns it. */
export interface ClaudeSession {
  /** Claude session id = what `--resume` takes. */
  id: string;
  /** Absolute transcript path, for the reading view. */
  path: string;
  /** Directory the session ran in — a resumed pane must spawn there. */
  cwd: string;
  title: string;
  /** True when `title` falls back to the first prompt (rendered in italics). */
  from_prompt: boolean;
  /** Last write, ms since epoch. */
  mtime: number;
}

/** A content-search hit, as `search_claude_sessions` returns it. */
export interface SessionMatch {
  id: string;
  excerpt: string;
  /** Term occurrences in the session's prose — the row's "12×" badge. */
  count: number;
}

/** A session as the list renders it: the entry plus why it is being shown. */
export interface ListedSession extends ClaudeSession {
  /** Set when the session surfaced through the content search. */
  excerpt?: string;
  /** Occurrences behind the badge; absent when the session matched on title. */
  count?: number;
}

export interface SessionGroup {
  label: string;
  sessions: ListedSession[];
}

/** One project section of the list, in the "by project" layout. */
export interface ProjectGroup {
  /** Stable key: the sidepanel project id, or the normalised cwd when there is none. */
  key: string;
  name: string;
  /** Sidepanel colour; null for a folder that has no project (rendered grey). */
  color: string | null;
  /** Folder behind the section — the project's path, or the sessions' cwd. */
  path: string;
  /** Newest session in the section: shown on the header and drives the order. */
  mtime: number;
  /** Sessions of this project, newest first. */
  sessions: ListedSession[];
}

/** Normalise a Windows path for comparison: lowercase, forward slashes, no trailing sep. */
function norm(pathStr: string): string {
  return pathStr.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Last path segment, e.g. `C:\…\Desktop\Qwitt` → `Qwitt`. */
export function baseName(pathStr: string): string {
  const parts = norm(pathStr).split("/").filter(Boolean);
  const raw = pathStr.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return raw[raw.length - 1] || parts[parts.length - 1] || pathStr;
}

/**
 * Instant filter, on the metadata already in memory: title and folder path.
 * Every term must appear somewhere (title or path), so "arkadia worktree"
 * narrows instead of widening.
 */
export function filterByMeta(
  sessions: ClaudeSession[],
  query: string,
): ClaudeSession[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return sessions;
  return sessions.filter((s) => matchesAllTerms(`${s.title}\n${s.cwd}`, terms));
}

/**
 * Merges the content-search hits into the instant (metadata) results: metadata
 * matches keep the top — they matched the title, which is the strongest signal —
 * and content-only matches follow, each carrying its excerpt. Both halves stay
 * in recency order (the input already is).
 */
export function mergeSearchResults(
  sessions: ClaudeSession[],
  metaMatches: ClaudeSession[],
  contentMatches: SessionMatch[],
): ListedSession[] {
  const metaIds = new Set(metaMatches.map((s) => s.id));
  const hits = new Map(contentMatches.map((m) => [m.id, m]));
  // A title match keeps its place at the top, but still shows the badge when
  // the content scan also found occurrences inside it.
  const out: ListedSession[] = metaMatches.map((s) => {
    const hit = hits.get(s.id);
    return hit ? { ...s, count: hit.count } : { ...s };
  });
  for (const s of sessions) {
    if (metaIds.has(s.id)) continue;
    const hit = hits.get(s.id);
    if (hit) out.push({ ...s, excerpt: hit.excerpt, count: hit.count });
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight of `ts`'s day, local time. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Recency buckets, in display order. Empty groups are dropped, and the input's
 * order (newest first) is preserved inside each group.
 */
export function groupByRecency(
  sessions: ListedSession[],
  now: number,
): SessionGroup[] {
  const today = startOfDay(now);
  const groups: SessionGroup[] = [
    { label: "Aujourd'hui", sessions: [] },
    { label: "Hier", sessions: [] },
    { label: "7 derniers jours", sessions: [] },
    { label: "Ce mois-ci", sessions: [] },
    { label: "Plus ancien", sessions: [] },
  ];
  for (const s of sessions) {
    const day = startOfDay(s.mtime);
    const idx =
      day >= today
        ? 0
        : day >= today - DAY_MS
          ? 1
          : day > today - 7 * DAY_MS
            ? 2
            : day > today - 30 * DAY_MS
              ? 3
              : 4;
    groups[idx].sessions.push(s);
  }
  return groups.filter((g) => g.sessions.length > 0);
}

/**
 * Sections the list by project rather than by date: every session is attached
 * to the sidepanel project owning its folder (see `resolveProjectTarget`, so a
 * subfolder or a worktree lands under its parent project), and a folder with no
 * project at all becomes a section of its own.
 *
 * Sections are ordered by their freshest session, and so are the sessions
 * inside each one — the input's order is not relied upon, since the search
 * merge deliberately floats title matches to the top.
 */
export function groupByProject(
  sessions: ListedSession[],
  projects: Project[],
): ProjectGroup[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    const target = resolveProjectTarget(projects, s.cwd);
    const project =
      target.kind === "existing" ? byId.get(target.projectId) : undefined;
    const key = project ? project.id : norm(s.cwd);
    const group = groups.get(key);
    if (group) {
      group.sessions.push(s);
      if (s.mtime > group.mtime) group.mtime = s.mtime;
      continue;
    }
    groups.set(key, {
      key,
      name: project ? project.name : baseName(s.cwd),
      color: project ? project.color : null,
      path: project ? project.path : s.cwd,
      mtime: s.mtime,
      sessions: [s],
    });
  }
  const out = [...groups.values()];
  for (const g of out) g.sessions.sort((a, b) => b.mtime - a.mtime);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Sessions available under each existing sidepanel project, newest first.
 * Unmatched folders are intentionally omitted: the Inactive sidebar only has
 * rows for projects that already exist, unlike the full sessions overlay.
 */
export function recentSessionsByProject(
  sessions: ClaudeSession[],
  projects: Project[],
): Record<string, ClaudeSession[]> {
  const out: Record<string, ClaudeSession[]> = {};
  for (const session of sessions) {
    const target = resolveProjectTarget(projects, session.cwd);
    if (target.kind !== "existing") continue;
    (out[target.projectId] ??= []).push(session);
  }
  for (const projectSessions of Object.values(out)) {
    projectSessions.sort((a, b) => b.mtime - a.mtime);
  }
  return out;
}

/** Initial sidebar page and every subsequent "Voir plus" step are two rows. */
export function nextSidebarSessionCount(
  shown: number | undefined,
  total: number,
): number {
  return Math.min(total, (shown ?? 0) + 2);
}

/** One Inactive project may expose its discussions at a time. */
export function toggleSidebarSessionProject(
  openProjectId: string | null,
  clickedProjectId: string,
): string | null {
  return openProjectId === clickedProjectId ? null : clickedProjectId;
}

const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avril",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/** Time of day for today, else day + month, else with the year. */
export function formatWhen(mtime: number, now: number): string {
  const d = new Date(mtime);
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  if (startOfDay(mtime) >= startOfDay(now)) return `${hh}:${mm}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return sameYear ? date : `${date} ${d.getFullYear()}`;
}

/** What reopening a session must do about the sidepanel project. */
export type ProjectTarget =
  | { kind: "existing"; projectId: string }
  | { kind: "create"; name: string; path: string };

/**
 * Which project a session's tab belongs to. Exact path wins; otherwise the
 * project whose path is the longest prefix of the cwd adopts it (a session run
 * in `Arkadia\src-tauri` opens as an Arkadia tab, with the pane in the
 * subfolder); with no match at all, a new project named after the folder.
 *
 * Prefix matching is segment-aware so `…\Arkadia` never adopts `…\Arkadia-old`.
 */
export function resolveProjectTarget(
  projects: Project[],
  cwd: string,
): ProjectTarget {
  const target = norm(cwd);
  let best: { id: string; len: number } | null = null;
  for (const p of projects) {
    const path = norm(p.path);
    if (path === "") continue;
    if (path === target) return { kind: "existing", projectId: p.id };
    if (
      target.startsWith(`${path}/`) &&
      (best === null || path.length > best.len)
    ) {
      best = { id: p.id, len: path.length };
    }
  }
  if (best) return { kind: "existing", projectId: best.id };
  return { kind: "create", name: baseName(cwd), path: cwd };
}
