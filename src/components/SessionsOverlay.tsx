import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Play, Search, SquareArrowOutUpRight, X } from "lucide-react";
import {
  DEFAULT_CONV_FILTERS,
  ModernConversationView,
  type ConvFilters,
} from "@/components/ModernConversationView";
import {
  filterByMeta,
  formatWhen,
  groupByRecency,
  mergeSearchResults,
  baseName,
  type ClaudeSession,
  type ListedSession,
  type SessionMatch,
} from "@/lib/sessionsIndex";
import { shortenPath } from "@/store";
import type { TerminalPalette, ToolDensity } from "@/types";

/** Idle time after the last keystroke before the (expensive) content search runs. */
const SEARCH_DEBOUNCE_MS = 300;
/** Rows rendered at once (newest first); the count line reports the full total. */
const MAX_ROWS = 400;

interface SessionsOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Reopen this session: resolve its project, spawn a tab on `ccd --resume`. */
  onResume: (session: ClaudeSession) => void;
  /** Focus the pane already running this session (id → pane), when there is one. */
  livePaneBySession: Record<string, string>;
  onFocusPane: (paneId: string) => void;
  density: ToolDensity;
  palette: TerminalPalette;
}

/**
 * The "recent sessions" overlay: every Claude Code conversation across every
 * folder, newest first, searchable, with a read-only preview and a one-click
 * resume.
 *
 * Search runs in two stages so typing never stalls: the list filters instantly
 * on titles and folders (already in memory), and after a short pause the
 * backend scans the transcripts' prose and merges its hits in.
 */
export function SessionsOverlay({
  open,
  onClose,
  onResume,
  livePaneBySession,
  onFocusPane,
  density,
  palette,
}: SessionsOverlayProps) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [contentMatches, setContentMatches] = useState<SessionMatch[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ConvFilters>(DEFAULT_CONV_FILTERS);
  const [error, setError] = useState<string | null>(null);
  // "Now" is frozen at open time: the recency buckets and the dates in the rows
  // must not drift while the overlay is up (and reading the clock during render
  // is not allowed anyway).
  const [now, setNow] = useState(0);
  // Only the newest search may write results: an earlier, slower scan landing
  // late would otherwise overwrite the current query's hits.
  const searchSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh scan on every open — sessions accrue while the overlay is closed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNow(Date.now());
    invoke<ClaudeSession[]>("list_claude_sessions")
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset transient state on close, and let the backend drop the parsed
  // transcript it kept for the preview.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setContentMatches(null);
    setSearching(false);
    setSelectedId(null);
    searchSeq.current += 1;
    void invoke("evict_transcript_cache").catch(() => {});
  }, [open]);

  // Stage two of the search: prose scan across the transcripts, debounced.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setContentMatches(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      invoke<SessionMatch[]>("search_claude_sessions", { query: q })
        .then((hits) => {
          if (seq !== searchSeq.current) return;
          setContentMatches(hits);
        })
        .catch(() => {
          if (seq === searchSeq.current) setContentMatches([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const metaMatches = useMemo(
    () => filterByMeta(sessions, query),
    [sessions, query],
  );

  const matched = useMemo<ListedSession[]>(() => {
    if (query.trim() === "") return sessions;
    return mergeSearchResults(sessions, metaMatches, contentMatches ?? []);
  }, [sessions, metaMatches, contentMatches, query]);

  // Only the newest MAX_ROWS are rendered: with ~700 sessions the rest is a
  // scroll nobody performs, and search is the way to reach an old one. The
  // counter above the list always states the full total.
  const listed = useMemo(() => matched.slice(0, MAX_ROWS), [matched]);

  const groups = useMemo(() => groupByRecency(listed, now), [listed, now]);

  // Keep a selection that exists in the current results, so the preview never
  // shows a session the list no longer offers.
  useEffect(() => {
    if (listed.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && listed.some((s) => s.id === prev) ? prev : listed[0].id,
    );
  }, [listed]);

  const selected = useMemo(
    () => listed.find((s) => s.id === selectedId) ?? null,
    [listed, selectedId],
  );

  // Keyed on the id/path, not on `selected`: the merge rebuilds session objects
  // on every keystroke, and a fresh object identity here would restart the
  // reader's incremental read from scratch each time.
  const selectedPath = selected?.path ?? null;
  const transcript = useMemo(
    () =>
      selectedId && selectedPath
        ? { sessionId: selectedId, path: selectedPath }
        : null,
    [selectedId, selectedPath],
  );

  const livePaneId = selected ? livePaneBySession[selected.id] : undefined;

  const activate = useCallback(() => {
    if (!selected) return;
    if (livePaneId) {
      onFocusPane(livePaneId);
      onClose();
      return;
    }
    onResume(selected);
    onClose();
  }, [selected, livePaneId, onFocusPane, onResume, onClose]);

  // ↑↓ walk the flat result list, Enter opens, Esc closes — the search field
  // keeps focus throughout, so typing and navigating never fight.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (listed.length === 0) return;
    const i = listed.findIndex((s) => s.id === selectedId);
    const next =
      e.key === "ArrowDown"
        ? Math.min(listed.length - 1, i + 1)
        : Math.max(0, i - 1);
    setSelectedId(listed[next].id);
    listRef.current
      ?.querySelector(`[data-session-id="${listed[next].id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-full max-h-[860px] w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onKeyDown={onKeyDown}
      >
        {/* ─── Results ─── */}
        <div className="flex w-[380px] shrink-0 flex-col border-r border-zinc-800">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
            <Search size={14} className="shrink-0 text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une session…"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            {searching && (
              <Loader2
                size={13}
                className="shrink-0 animate-spin text-sky-400"
              />
            )}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
            <span>
              {loading
                ? "lecture des transcripts…"
                : `${matched.length} session${matched.length > 1 ? "s" : ""}${
                    matched.length > listed.length
                      ? ` · ${listed.length} affichées`
                      : ""
                  }`}
            </span>
            {searching && <span className="text-sky-500">recherche…</span>}
          </div>

          <div ref={listRef} className="scrollbar-none flex-1 overflow-y-auto">
            {error && (
              <div className="px-3 py-2 text-xs text-red-400">{error}</div>
            )}
            {!loading && matched.length === 0 && (
              <div className="px-3 py-3 text-xs text-zinc-500">
                {query.trim()
                  ? "aucune session ne correspond"
                  : "aucune session Claude trouvée"}
              </div>
            )}
            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 bg-zinc-950/95 px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500 backdrop-blur">
                  {group.label}
                </div>
                {group.sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    now={now}
                    selected={s.id === selectedId}
                    live={Boolean(livePaneBySession[s.id])}
                    onSelect={() => setSelectedId(s.id)}
                    onActivate={activate}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ─── Preview ─── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-zinc-100">
                {selected?.title ?? "—"}
              </div>
              {selected && (
                <div className="truncate font-mono text-[10px] text-zinc-500">
                  {baseName(selected.cwd)} · {selected.cwd}
                </div>
              )}
            </div>
            {selected &&
              (livePaneId ? (
                <button
                  type="button"
                  onClick={activate}
                  title="Cette session tourne déjà — aller à son onglet"
                  className="flex shrink-0 items-center gap-1.5 rounded border border-emerald-600/50 bg-emerald-600/15 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-600/25"
                >
                  <SquareArrowOutUpRight size={13} /> Aller à l&apos;onglet
                </button>
              ) : (
                <button
                  type="button"
                  onClick={activate}
                  title={`Rouvrir dans ${selected.cwd} (ccd --resume)`}
                  className="flex shrink-0 items-center gap-1.5 rounded border border-sky-600/50 bg-sky-600/15 px-2.5 py-1.5 text-xs text-sky-300 hover:bg-sky-600/25"
                >
                  <Play size={13} /> Reprendre
                </button>
              ))}
            <button
              type="button"
              onClick={onClose}
              title="Fermer"
              className="flex size-7 shrink-0 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {selected ? (
              <ModernConversationView
                key={selected.id}
                paneId={null}
                transcript={transcript}
                filters={filters}
                onFiltersChange={setFilters}
                density={density}
                palette={palette}
                // Never captures Ctrl+F: the overlay's own field owns the
                // keyboard while it is open.
                isActive={false}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                sélectionne une session pour la lire
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  now,
  selected,
  live,
  onSelect,
  onActivate,
}: {
  session: ListedSession;
  now: number;
  selected: boolean;
  live: boolean;
  onSelect: () => void;
  onActivate: () => void;
}) {
  return (
    <div
      data-session-id={session.id}
      onClick={onSelect}
      onDoubleClick={onActivate}
      className={`cursor-pointer border-l-2 px-3 py-2 ${
        selected
          ? "border-sky-500 bg-zinc-800/80"
          : "border-transparent hover:bg-zinc-900"
      }`}
      title={session.cwd}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            session.from_prompt ? "italic text-zinc-400" : "text-zinc-100"
          }`}
        >
          {session.title}
        </span>
        {live && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-emerald-400"
            title="session en cours"
          />
        )}
        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
          {formatWhen(session.mtime, now)}
        </span>
      </div>
      <div className="truncate font-mono text-[10px] text-zinc-500">
        {baseName(session.cwd)} · {shortenPath(session.cwd)}
      </div>
      {session.excerpt && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">
          {session.excerpt}
        </div>
      )}
    </div>
  );
}
