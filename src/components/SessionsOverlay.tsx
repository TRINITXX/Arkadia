import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Play,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  DEFAULT_CONV_FILTERS,
  ModernConversationView,
  type ConvFilters,
} from "@/components/ModernConversationView";
import {
  describeWindow,
  fetchCandidates,
  forgetCandidates,
  planSearch,
  readAnswer,
  worthAsking,
  type CandidateRow,
  type SearchAnswer,
  type SearchPlan,
} from "@/lib/aiSearch";
import { queryTerms, segmentByTerms } from "@/lib/searchTerms";
import {
  filterByMeta,
  formatWhen,
  groupByProject,
  groupByRecency,
  mergeSearchResults,
  baseName,
  type ClaudeSession,
  type ListedSession,
  type ProjectGroup,
  type SessionMatch,
} from "@/lib/sessionsIndex";
import { shortenPath } from "@/store";
import type {
  Project,
  SessionsGrouping,
  TerminalPalette,
  ToolDensity,
} from "@/types";

/** Idle time after the last keystroke before the (expensive) content search runs. */
const SEARCH_DEBOUNCE_MS = 300;
/**
 * Idle time before the AI stage fires. Far longer than the content search: each
 * run costs two model calls against the subscription's rolling quota, and
 * firing one per keystroke would spend it on half-typed sentences.
 */
const AI_DEBOUNCE_MS = 1200;
/** Rows rendered at once (newest first); the count line reports the full total. */
const MAX_ROWS = 400;
/** Sessions shown per project section, and how many more each "voir plus" adds. */
const PROJECT_PAGE = 5;
/** Section-header dot for a folder that has no sidepanel project. */
const NO_PROJECT_COLOR = "#52525b";

/** How far the AI pipeline has got, for the panel at the bottom of the list. */
type AiPhase = "idle" | "planning" | "gathering" | "reading" | "done";

interface SessionsOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Reopen this session: resolve its project, spawn a tab on `ccd --resume`. */
  onResume: (session: ClaudeSession) => void;
  /** Focus the pane already running this session (id → pane), when there is one. */
  livePaneBySession: Record<string, string>;
  onFocusPane: (paneId: string) => void;
  /** Sidepanel projects: what the "by project" layout groups the sessions under. */
  projects: Project[];
  grouping: SessionsGrouping;
  onGroupingChange: (grouping: SessionsGrouping) => void;
  density: ToolDensity;
  palette: TerminalPalette;
}

/**
 * The "recent sessions" overlay: every Claude Code conversation across every
 * folder, newest first, searchable, with a read-only preview and a one-click
 * resume.
 *
 * One field drives everything. It filters the list instantly on titles and
 * folders, then a backend scan of the transcripts' prose merges its hits in —
 * and it also paints the matches inside whichever session is being previewed,
 * so the arrows in the preview header walk from one occurrence to the next
 * without ever retyping the query.
 *
 * Type a sentence rather than keywords and a third stage joins in, below the
 * results: Claude turns the sentence into constraints — above all a time
 * window, which is what actually narrows three thousand transcripts — then
 * reads the best passages and answers in prose. It lives in its own section
 * because it answers a different question than the exact matches above, and
 * mixing the two would make neither trustworthy.
 */
export function SessionsOverlay({
  open,
  onClose,
  onResume,
  livePaneBySession,
  onFocusPane,
  projects,
  grouping,
  onGroupingChange,
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
  // "By project" layout only: sections the user folded away, and how many
  // sessions each unfolded section shows (absent = PROJECT_PAGE).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<ConvFilters>(DEFAULT_CONV_FILTERS);
  const [error, setError] = useState<string | null>(null);
  // Occurrence cursor inside the previewed session: the view counts them and
  // reports the total, we decide which one is current.
  const [occIdx, setOccIdx] = useState(0);
  const [occTotal, setOccTotal] = useState(0);
  // ─ AI stage ─
  const [aiPhase, setAiPhase] = useState<AiPhase>("idle");
  const [aiPlan, setAiPlan] = useState<SearchPlan | null>(null);
  const [aiRows, setAiRows] = useState<CandidateRow[]>([]);
  const [aiTotal, setAiTotal] = useState(0);
  const [aiAnswer, setAiAnswer] = useState<SearchAnswer | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  // "Now" is frozen at open time: the recency buckets and the dates in the rows
  // must not drift while the overlay is up (and reading the clock during render
  // is not allowed anyway).
  const [now, setNow] = useState(0);
  // Only the newest search may write results: an earlier, slower scan landing
  // late would otherwise overwrite the current query's hits.
  const searchSeq = useRef(0);
  const aiSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const terms = useMemo(() => queryTerms(query), [query]);

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

  // Reset transient state on close, and let the backend drop both the parsed
  // transcript it kept for the preview and the passages held for the reader.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setContentMatches(null);
    setSearching(false);
    setSelectedId(null);
    setAiPhase("idle");
    setAiPlan(null);
    setAiRows([]);
    setAiAnswer(null);
    setAiError(null);
    setDropped(new Set());
    searchSeq.current += 1;
    aiSeq.current += 1;
    void invoke("evict_transcript_cache").catch(() => {});
    void forgetCandidates().catch(() => {});
  }, [open]);

  // Stage two of the search: prose scan across the transcripts, debounced.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (terms.length === 0) {
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
  }, [query, terms, open]);

  // Stage three, first half: the sentence becomes constraints. Only a real
  // sentence qualifies — a keyword search never needs interpreting.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const seq = ++aiSeq.current;
    setAiAnswer(null);
    setAiError(null);
    setDropped(new Set());
    if (!worthAsking(q)) {
      setAiPhase("idle");
      setAiPlan(null);
      setAiRows([]);
      return;
    }
    setAiPhase("planning");
    const timer = window.setTimeout(() => {
      planSearch(q)
        .then((plan) => {
          if (seq !== aiSeq.current) return;
          setAiPlan(plan);
        })
        .catch((e) => {
          if (seq !== aiSeq.current) return;
          setAiError(String(e));
          setAiPhase("done");
        });
    }, AI_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  // Terms the AI stage actually searches: what it proposed, minus the ones
  // pruned by hand. Dropping a bad suggestion re-runs the search below without
  // spending another planning call.
  const activeAiTerms = useMemo(
    () => (aiPlan ? aiPlan.terms.filter((t) => !dropped.has(t)) : []),
    [aiPlan, dropped],
  );

  // Stage three, second half: gather locally, then read. Re-runs whenever a
  // term chip is removed.
  useEffect(() => {
    if (!open || !aiPlan || activeAiTerms.length === 0) return;
    const seq = aiSeq.current;
    let cancelled = false;
    const q = query.trim();
    setAiPhase("gathering");
    setAiAnswer(null);
    fetchCandidates({ ...aiPlan, terms: activeAiTerms })
      .then((list) => {
        if (cancelled || seq !== aiSeq.current) return null;
        setAiRows(list.rows);
        setAiTotal(list.total);
        if (list.rows.length === 0) {
          setAiPhase("done");
          return null;
        }
        setAiPhase("reading");
        return readAnswer(q, list.total);
      })
      .then((answer) => {
        if (cancelled || seq !== aiSeq.current || !answer) return;
        setAiAnswer(answer);
        setAiPhase("done");
      })
      .catch((e) => {
        if (cancelled || seq !== aiSeq.current) return;
        setAiError(String(e));
        setAiPhase("done");
      });
    return () => {
      cancelled = true;
    };
  }, [open, aiPlan, activeAiTerms, query]);

  const metaMatches = useMemo(
    () => filterByMeta(sessions, query),
    [sessions, query],
  );

  const matched = useMemo<ListedSession[]>(() => {
    if (query.trim() === "") return sessions;
    return mergeSearchResults(sessions, metaMatches, contentMatches ?? []);
  }, [sessions, metaMatches, contentMatches, query]);

  // Only the newest MAX_ROWS are rendered: with ~3000 sessions the rest is a
  // scroll nobody performs, and search is the way to reach an old one. The
  // counter above the list always states the full total.
  const listed = useMemo(() => matched.slice(0, MAX_ROWS), [matched]);

  const groups = useMemo(() => groupByRecency(listed, now), [listed, now]);

  // Sections are built off the full result set, not the MAX_ROWS slice: cutting
  // by recency first would drop whole projects out of the layout. The per-section
  // cap is what keeps the render bounded here.
  const projectGroups = useMemo(
    () => (grouping === "project" ? groupByProject(matched, projects) : []),
    [grouping, matched, projects],
  );

  const byId = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  // AI hits the exact search did not already show — the section below exists to
  // add, never to repeat.
  const aiOnly = useMemo(() => {
    const above = new Set(matched.map((s) => s.id));
    return aiRows
      .filter((r) => !above.has(r.id))
      .map((r) => ({ row: r, session: byId.get(r.id) }))
      .filter((x): x is { row: CandidateRow; session: ClaudeSession } =>
        Boolean(x.session),
      );
  }, [aiRows, matched, byId]);

  // Sessions actually on screen, in reading order: what ↑↓ walks and what the
  // selection is allowed to point at (a folded section holds none).
  const navList = useMemo<ListedSession[]>(() => {
    const out: ListedSession[] = [];
    if (grouping === "date") {
      out.push(...listed);
    } else {
      for (const g of projectGroups) {
        if (collapsed.has(g.key)) continue;
        out.push(...g.sessions.slice(0, shown[g.key] ?? PROJECT_PAGE));
      }
    }
    for (const { row, session } of aiOnly) {
      out.push({ ...session, count: row.count });
    }
    return out;
  }, [grouping, listed, projectGroups, collapsed, shown, aiOnly]);

  // Folding and paging are per result set: a new query, a layout switch or a
  // reopen all start every section back at PROJECT_PAGE, open.
  useEffect(() => {
    setCollapsed(new Set());
    setShown({});
  }, [open, query, grouping]);

  // Keep a selection that exists in the current results, so the preview never
  // shows a session the list no longer offers.
  useEffect(() => {
    if (navList.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && navList.some((s) => s.id === prev) ? prev : navList[0].id,
    );
  }, [navList]);

  const selected = useMemo(
    () => navList.find((s) => s.id === selectedId) ?? null,
    [navList, selectedId],
  );

  // A new session or a new query starts the occurrence walk over.
  useEffect(() => {
    setOccIdx(0);
  }, [selectedId, query]);

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

  // The one field drives the reader too: same query, painted in place, with the
  // arrows below stepping through the occurrences it reports back.
  const readerSearch = useMemo(
    () =>
      terms.length > 0
        ? { query, index: occIdx, onTotalChange: setOccTotal }
        : null,
    [terms.length, query, occIdx],
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

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const showMore = useCallback((key: string) => {
    setShown((prev) => ({
      ...prev,
      [key]: (prev[key] ?? PROJECT_PAGE) + PROJECT_PAGE,
    }));
  }, []);

  const dropTerm = useCallback((term: string) => {
    setDropped((prev) => new Set(prev).add(term));
  }, []);

  const stepOccurrence = useCallback(
    (dir: 1 | -1) => {
      if (occTotal === 0) return;
      setOccIdx((i) => (i + dir + occTotal) % occTotal);
    },
    [occTotal],
  );

  // ↑↓ walk the flat result list, Enter opens, Esc closes — the search field
  // keeps focus throughout, so typing and navigating never fight. F3 steps
  // through the occurrences inside the previewed session.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "F3") {
      e.preventDefault();
      stepOccurrence(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (navList.length === 0) return;
    const i = navList.findIndex((s) => s.id === selectedId);
    const next =
      e.key === "ArrowDown"
        ? Math.min(navList.length - 1, i + 1)
        : Math.max(0, i - 1);
    setSelectedId(navList[next].id);
    listRef.current
      ?.querySelector(`[data-session-id="${navList[next].id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  if (!open) return null;

  const occLabel =
    occTotal > 0 ? `${(occIdx % occTotal) + 1}/${occTotal}` : "0";

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
              placeholder="Rechercher, ou décrire ce que tu cherches…"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            {searching && (
              <Loader2
                size={13}
                className="shrink-0 animate-spin text-sky-400"
              />
            )}
          </div>
          <div className="flex gap-1 border-b border-zinc-800 px-3 py-2">
            <GroupingTab
              label="Date"
              active={grouping === "date"}
              onClick={() => onGroupingChange("date")}
            />
            <GroupingTab
              label="Projet"
              active={grouping === "project"}
              onClick={() => onGroupingChange("project")}
            />
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
            <span>
              {loading
                ? "lecture des transcripts…"
                : `${matched.length} session${matched.length > 1 ? "s" : ""}${
                    grouping === "project"
                      ? ` · ${projectGroups.length} projet${
                          projectGroups.length > 1 ? "s" : ""
                        }`
                      : matched.length > listed.length
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
            {!loading && matched.length === 0 && aiOnly.length === 0 && (
              <div className="px-3 py-3 text-xs text-zinc-500">
                {query.trim()
                  ? "aucune session ne correspond"
                  : "aucune session Claude trouvée"}
              </div>
            )}
            {grouping === "date" &&
              groups.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 bg-zinc-950/95 px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500 backdrop-blur">
                    {group.label}
                  </div>
                  {group.sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      terms={terms}
                      now={now}
                      selected={s.id === selectedId}
                      live={Boolean(livePaneBySession[s.id])}
                      onSelect={() => setSelectedId(s.id)}
                      onActivate={activate}
                    />
                  ))}
                </div>
              ))}
            {grouping === "project" &&
              projectGroups.map((group) => (
                <ProjectSection
                  key={group.key}
                  group={group}
                  terms={terms}
                  now={now}
                  collapsed={collapsed.has(group.key)}
                  shown={shown[group.key] ?? PROJECT_PAGE}
                  selectedId={selectedId}
                  livePaneBySession={livePaneBySession}
                  onToggle={() => toggleSection(group.key)}
                  onShowMore={() => showMore(group.key)}
                  onSelect={setSelectedId}
                  onActivate={activate}
                />
              ))}

            <AiSection
              phase={aiPhase}
              plan={aiPlan}
              activeTerms={activeAiTerms}
              answer={aiAnswer}
              error={aiError}
              rows={aiOnly}
              total={aiTotal}
              now={now}
              selectedId={selectedId}
              livePaneBySession={livePaneBySession}
              onDropTerm={dropTerm}
              onSelect={setSelectedId}
              onActivate={activate}
            />
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
            {/* Occurrence walk inside the previewed session — the same query as
                the list, so finding the session and finding the line are one
                gesture. */}
            {selected && terms.length > 0 && (
              <div className="flex shrink-0 items-center gap-0.5 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1">
                <span className="px-1 font-mono text-[10px] tabular-nums text-zinc-400">
                  {occLabel}
                </span>
                <button
                  type="button"
                  onClick={() => stepOccurrence(-1)}
                  disabled={occTotal === 0}
                  title="Occurrence précédente (Maj+F3)"
                  className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => stepOccurrence(1)}
                  disabled={occTotal === 0}
                  title="Occurrence suivante (F3)"
                  className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
                >
                  <ChevronDown size={12} />
                </button>
              </div>
            )}
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
                search={readerSearch}
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

/**
 * Text with the search terms picked out. Terms the user typed are yellow;
 * terms the AI suggested are violet, so a session surfacing on a word that was
 * never typed is self-explanatory rather than baffling.
 */
function Marked({
  text,
  terms,
  ai = false,
}: {
  text: string;
  terms: string[];
  ai?: boolean;
}) {
  if (terms.length === 0) return <>{text}</>;
  const cls = ai
    ? "rounded-[2px] bg-violet-400/30 text-violet-100"
    : "rounded-[2px] bg-yellow-400/30 text-yellow-100";
  return (
    <>
      {segmentByTerms(text, terms).map((seg, i) =>
        seg.term === null ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <mark key={i} className={cls}>
            {seg.text}
          </mark>
        ),
      )}
    </>
  );
}

function GroupingTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-2 py-1 text-[11px] ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The natural-language results, under the exact ones. It never reorders what is
 * above it: the exact matches are what the user asked for, and watching them
 * shuffle ten seconds later would cost more than the extra hits are worth.
 */
function AiSection({
  phase,
  plan,
  activeTerms,
  answer,
  error,
  rows,
  total,
  now,
  selectedId,
  livePaneBySession,
  onDropTerm,
  onSelect,
  onActivate,
}: {
  phase: AiPhase;
  plan: SearchPlan | null;
  activeTerms: string[];
  answer: SearchAnswer | null;
  error: string | null;
  rows: { row: CandidateRow; session: ClaudeSession }[];
  total: number;
  now: number;
  selectedId: string | null;
  livePaneBySession: Record<string, string>;
  onDropTerm: (term: string) => void;
  onSelect: (id: string) => void;
  onActivate: () => void;
}) {
  if (phase === "idle") return null;
  const window = plan ? describeWindow(plan) : null;
  const busy =
    phase === "planning" || phase === "gathering" || phase === "reading";
  const label =
    phase === "planning"
      ? "lecture de ta phrase…"
      : phase === "gathering"
        ? "recherche dans les transcripts…"
        : phase === "reading"
          ? "lecture des extraits…"
          : `${rows.length} autre${rows.length > 1 ? "s" : ""}`;

  return (
    <div className="border-t border-violet-900/40">
      <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-zinc-950/95 px-3 py-1.5 backdrop-blur">
        <Sparkles size={11} className="shrink-0 text-violet-400" />
        <span className="text-[10px] uppercase tracking-wider text-violet-400">
          IA
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">
          {label}
        </span>
        {busy && (
          <Loader2
            size={11}
            className="shrink-0 animate-spin text-violet-400"
          />
        )}
      </div>

      {/* What it decided to look for. Removing a bad suggestion re-runs the
          search without another planning call. */}
      {plan && activeTerms.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1.5">
          {activeTerms.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onDropTerm(t)}
              title="Retirer ce terme"
              className="group flex items-center gap-1 rounded border border-violet-800/60 bg-violet-900/25 px-1.5 py-0.5 text-[10px] text-violet-200 hover:border-violet-600"
            >
              {t}
              <X size={9} className="opacity-40 group-hover:opacity-100" />
            </button>
          ))}
          {window && (
            <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {window}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 rounded border border-amber-800/50 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-300">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {answer && (
        <div className="mx-3 mb-2 rounded border border-violet-900/50 bg-violet-950/20 px-2.5 py-2">
          {/* The perimeter is stated here, from our own counts. Asked to
              declare it itself, the model dropped the instruction — and a
              confident "rien trouvé" over 3 % of the corpus is a lie. */}
          {answer.read < answer.total && (
            <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-400/80">
              lu {answer.read} session{answer.read > 1 ? "s" : ""} sur{" "}
              {answer.total}
            </div>
          )}
          <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-zinc-200">
            {answer.answer}
          </div>
        </div>
      )}

      {!busy && !error && rows.length === 0 && total === 0 && (
        <div className="px-3 pb-2 text-[11px] text-zinc-500">
          rien trouvé de plus que les résultats exacts
        </div>
      )}

      {rows.map(({ row, session }) => (
        <SessionRow
          key={session.id}
          session={{ ...session, count: row.count }}
          terms={activeTerms}
          aiTerms
          now={now}
          selected={session.id === selectedId}
          live={Boolean(livePaneBySession[session.id])}
          onSelect={() => onSelect(session.id)}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}

/**
 * One project's sessions: a foldable header carrying the project's colour, its
 * session count and its freshest date, then the sessions themselves — capped,
 * with a "voir plus" that reveals PROJECT_PAGE more at a time.
 */
function ProjectSection({
  group,
  terms,
  now,
  collapsed,
  shown,
  selectedId,
  livePaneBySession,
  onToggle,
  onShowMore,
  onSelect,
  onActivate,
}: {
  group: ProjectGroup;
  terms: string[];
  now: number;
  collapsed: boolean;
  shown: number;
  selectedId: string | null;
  livePaneBySession: Record<string, string>;
  onToggle: () => void;
  onShowMore: () => void;
  onSelect: (id: string) => void;
  onActivate: () => void;
}) {
  const visible = collapsed ? [] : group.sessions.slice(0, shown);
  const hidden = group.sessions.length - visible.length;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        title={group.path}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-zinc-950/95 px-2 py-1.5 text-left backdrop-blur hover:bg-zinc-900/95"
      >
        {collapsed ? (
          <ChevronRight size={12} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronDown size={12} className="shrink-0 text-zinc-600" />
        )}
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: group.color ?? NO_PROJECT_COLOR }}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
          <Marked text={group.name} terms={terms} />
        </span>
        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
          {group.sessions.length} · {formatWhen(group.mtime, now)}
        </span>
      </button>
      {visible.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          terms={terms}
          now={now}
          selected={s.id === selectedId}
          live={Boolean(livePaneBySession[s.id])}
          onSelect={() => onSelect(s.id)}
          onActivate={onActivate}
        />
      ))}
      {!collapsed && hidden > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="w-full px-3 py-1.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
        >
          + voir plus ({hidden})
        </button>
      )}
    </div>
  );
}

function SessionRow({
  session,
  terms,
  aiTerms = false,
  now,
  selected,
  live,
  onSelect,
  onActivate,
}: {
  session: ListedSession;
  terms: string[];
  /** Paint the terms as AI suggestions rather than as what the user typed. */
  aiTerms?: boolean;
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
          <Marked text={session.title} terms={terms} ai={aiTerms} />
        </span>
        {live && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-emerald-400"
            title="session en cours"
          />
        )}
        {/* How much this session has to say on the subject — the number that
            lets you pick between forty results without opening any of them. */}
        {session.count !== undefined && session.count > 0 && (
          <span
            className={`shrink-0 rounded px-1 font-mono text-[10px] tabular-nums ${
              aiTerms
                ? "bg-violet-900/40 text-violet-300"
                : "bg-yellow-900/30 text-yellow-300/90"
            }`}
            title={`${session.count} occurrence${session.count > 1 ? "s" : ""}`}
          >
            {session.count}×
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
          {formatWhen(session.mtime, now)}
        </span>
      </div>
      <div className="truncate font-mono text-[10px] text-zinc-500">
        <Marked text={baseName(session.cwd)} terms={terms} ai={aiTerms} />
        {" · "}
        <Marked text={shortenPath(session.cwd)} terms={terms} ai={aiTerms} />
      </div>
      {session.excerpt && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">
          <Marked text={session.excerpt} terms={terms} ai={aiTerms} />
        </div>
      )}
    </div>
  );
}
