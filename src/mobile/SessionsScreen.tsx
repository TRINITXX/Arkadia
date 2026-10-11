import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { RemoteAction } from "@/lib/remoteActions";
import {
  baseName,
  filterByMeta,
  formatWhen,
  groupByRecency,
  mergeSearchResults,
  type ClaudeSession,
  type ListedSession,
  type SessionMatch,
} from "@/lib/sessionsIndex";
import { listSessions, searchSessions, type Status } from "@/mobile/remote";

/** Rows drawn at once: the full history runs into the thousands. */
const MAX_ROWS = 200;
/** Typing pause before searching inside the conversations (a full scan). */
const SEARCH_DELAY_MS = 400;

interface SessionsScreenProps {
  status: Status;
  run: (action: RemoteAction) => Promise<boolean>;
}

/**
 * Past Claude sessions, newest first, searchable by title, folder and
 * content. Tapping one resumes it in a new tab of its project.
 */
export function SessionsScreen({ status, run }: SessionsScreenProps) {
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SessionMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  // Recency buckets and times are relative to when the list was opened.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "open") return;
    let live = true;
    listSessions()
      .then((list) => live && setSessions(list))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [status]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchSessions(q)
        .then((found) => live && setMatches(found))
        .catch(() => {})
        .finally(() => live && setSearching(false));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const groups = useMemo(() => {
    if (!sessions) return [];
    const listed: ListedSession[] = query.trim()
      ? mergeSearchResults(sessions, filterByMeta(sessions, query), matches)
      : sessions;
    return groupByRecency(listed.slice(0, MAX_ROWS), now);
  }, [sessions, query, matches, now]);

  const resume = async (session: ClaudeSession) => {
    setResuming(session.id);
    await run({ kind: "resume", session });
    setResuming(null);
  };

  return (
    <div className="pb-4">
      <div className="sticky top-0 z-10 bg-[#0a0a0a] px-4 pt-3 pb-2">
        <label className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3">
          <Search size={15} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher une session"
            // 16px: iOS zooms the page into any field with a smaller font.
            className="min-w-0 flex-1 bg-transparent py-2 text-[16px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </label>
      </div>
      {!sessions && (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">
          {failed ? "Liste indisponible." : "Chargement…"}
        </p>
      )}
      {searching && (
        <p className="px-4 pt-1 text-xs text-zinc-500">
          Recherche dans les conversations…
        </p>
      )}
      {sessions && groups.length === 0 && !searching && (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">
          Aucune session.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.label} className="pt-2">
          <h2 className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            {g.label}
          </h2>
          {g.sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={resuming !== null}
              onClick={() => void resume(s)}
              className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left active:bg-zinc-900 disabled:opacity-60"
            >
              <span
                className={`line-clamp-2 text-sm text-zinc-100 ${s.from_prompt ? "italic" : ""}`}
              >
                {resuming === s.id ? "Reprise…" : s.title}
              </span>
              <span className="flex gap-2 text-[11px] text-zinc-500">
                <span className="truncate">{baseName(s.cwd)}</span>
                <span className="shrink-0">· {formatWhen(s.mtime, now)}</span>
                {s.count ? (
                  <span className="shrink-0">· {s.count}×</span>
                ) : null}
              </span>
              {s.excerpt && (
                <span className="line-clamp-2 text-xs text-zinc-400">
                  {s.excerpt}
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
