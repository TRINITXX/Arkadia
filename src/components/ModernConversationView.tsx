import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { CONVERSATION_CSS } from "@/components/ConversationView";
import { BlockRow, type MatchState } from "@/components/modern/BlockRow";
import {
  clearOccurrences,
  collectOccurrences,
  paintOccurrences,
  type Occurrence,
  type Row,
} from "@/lib/domHighlight";
import { queryTerms } from "@/lib/searchTerms";
import { HLJS_CSS, MODERN_CSS } from "@/components/modern/css";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { Lightbox } from "@/components/modern/Lightbox";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { toolIcon } from "@/components/modern/toolIcons";
import type { TerminalPalette, ToolDensity } from "@/types";
import type { AgentStateValue } from "@/lib/agentState";

/** One transcript image, materialized in the backend's imgcache. */
export interface ConvImage {
  path: string;
  media_type: string;
}

/** One structured block from `read_conversation_delta`. */
export interface ConvBlock {
  kind: "user" | "assistant" | "thinking" | "tool";
  text?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  /** Images pasted in this turn (user blocks). */
  images?: ConvImage[];
  /** Images inside the paired tool_result (screenshots, image reads). */
  tool_output_images?: ConvImage[];
}

/** Incremental response: keep the first `base` blocks, append `blocks`. */
interface ConvDelta {
  generation: number;
  base: number;
  blocks: ConvBlock[];
  sessionId?: string | null;
}

/** Which message types the modern view shows. */
export interface ConvFilters {
  user: boolean;
  assistant: boolean;
  thinking: boolean;
  tools: boolean;
  /** When false, tool cards render without their output (header/input only). */
  results: boolean;
}

// Default to a clean "reading" view — your messages + Claude's prose only. The
// filter popover reveals thinking / tools / results on demand.
export const DEFAULT_CONV_FILTERS: ConvFilters = {
  user: true,
  assistant: true,
  thinking: false,
  tools: false,
  results: false,
};

export const FILTER_LABELS: { key: keyof ConvFilters; label: string }[] = [
  { key: "user", label: "Toi" },
  { key: "assistant", label: "Claude" },
  { key: "thinking", label: "Pensées" },
  { key: "tools", label: "Outils" },
  { key: "results", label: "Résultats" },
];

/**
 * Where the blocks come from: a live pane (resolved to its transcript through
 * the hook-written pane map, and kept live) or a transcript read straight off
 * disk — the sessions overlay previewing a conversation that no process owns.
 */
export type ConvSource =
  | { kind: "pane"; paneId: string }
  | { kind: "transcript"; sessionId: string; path: string };

/** Identity of a source, for effects that must restart when it changes. */
function sourceKey(source: ConvSource | null): string {
  if (!source) return "";
  return source.kind === "pane"
    ? `pane:${source.paneId}`
    : `transcript:${source.sessionId}`;
}

/**
 * Reads the structured blocks of `source`. A pane source stays live (refreshes
 * on `agent-state-changed` events for its session); a transcript source is read
 * once, since no process is appending to it while the overlay shows it.
 * Incremental either way: each refresh fetches only what was appended since the
 * previous one, instead of re-reading the whole JSONL.
 */
export function useConversationBlocks(source: ConvSource | null) {
  const [blocks, setBlocks] = useState<ConvBlock[]>([]);
  // Backend cache generation of `blocks` — bumps when the transcript was
  // reset/rewritten, so consumers can tell "rebuilt history" from "append".
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // What this client already holds (mirrors the backend cache contract).
  const genRef = useRef(0);
  const haveRef = useRef(0);
  // Claude session id of this pane's transcript — used to ignore
  // agent-state-changed events from other panes' sessions.
  const sessionRef = useRef<string | null>(null);
  // Coalesce refreshes: one in-flight delta at a time, bursts collapse into
  // a single trailing call.
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);

  const refresh = useCallback(() => {
    if (!source) {
      genRef.current = 0;
      haveRef.current = 0;
      sessionRef.current = null;
      setBlocks([]);
      setError(null);
      return;
    }
    const run = () => {
      inflightRef.current = true;
      const [cmd, args] =
        source.kind === "pane"
          ? (["read_conversation_delta", { paneId: source.paneId }] as const)
          : ([
              "read_transcript_delta",
              { sessionId: source.sessionId, path: source.path },
            ] as const);
      void invoke<ConvDelta>(cmd, {
        ...args,
        generation: genRef.current,
        have: haveRef.current,
      })
        .then((d) => {
          sessionRef.current = d.sessionId ?? null;
          genRef.current = d.generation;
          setGeneration(d.generation);
          setBlocks((prev) => {
            const next =
              d.base === 0 ? d.blocks : prev.slice(0, d.base).concat(d.blocks);
            haveRef.current = next.length;
            return next;
          });
          setError(null);
        })
        .catch((e) => {
          genRef.current = 0;
          haveRef.current = 0;
          setGeneration(0);
          setBlocks([]);
          setError(String(e));
        })
        .finally(() => {
          inflightRef.current = false;
          if (pendingRef.current) {
            pendingRef.current = false;
            run();
          }
        });
    };
    if (inflightRef.current) {
      pendingRef.current = true;
      return;
    }
    run();
    // `source` must be referentially stable per conversation — callers build it
    // with useMemo, so this only re-runs on an actual source change.
  }, [source]);

  useEffect(() => {
    // New source: drop everything the previous one's deltas accumulated.
    genRef.current = 0;
    haveRef.current = 0;
    sessionRef.current = null;
    setGeneration(0);
    setBlocks([]);
    refresh();
  }, [refresh]);

  useEffect(() => {
    // A transcript read off disk has no live writer: nothing to follow.
    if (source?.kind !== "pane") return;
    let unlisten: UnlistenFn | undefined;
    let active = true;
    void listen<{ session_id?: string }>("agent-state-changed", (e) => {
      if (!active) return;
      // Only this pane's session triggers a re-read; before the session is
      // known (fresh pane) any event does, so the first turn still surfaces.
      const sid = e.payload?.session_id;
      if (sessionRef.current && sid && sid !== sessionRef.current) return;
      refresh();
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh, source]);

  return { blocks, generation, error, refresh };
}

function FilterPopover({
  filters,
  onChange,
}: {
  filters: ConvFilters;
  onChange: (next: ConvFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (key: keyof ConvFilters) =>
    onChange({ ...filters, [key]: !filters[key] });

  // Right-click = solo this type; right-click an already-soloed type = restore all.
  const solo = (key: keyof ConvFilters) => {
    const isSolo =
      filters[key] &&
      FILTER_LABELS.every((f) => (f.key === key ? true : !filters[f.key]));
    if (isSolo) {
      onChange({ ...DEFAULT_CONV_FILTERS });
      return;
    }
    const next: ConvFilters = {
      user: false,
      assistant: false,
      thinking: false,
      tools: false,
      results: false,
    };
    next[key] = true;
    onChange(next);
  };

  const anyHidden = FILTER_LABELS.some((f) => !filters[f.key]);

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: 8, right: 8, zIndex: 20 }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filtrer les messages (clic droit sur un type = solo)"
        aria-label="Filtrer les messages"
        className={`flex size-7 items-center justify-center rounded border transition-colors ${
          open || anyHidden
            ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
            : "border-zinc-700 bg-zinc-800/70 text-zinc-400 hover:text-zinc-100"
        }`}
      >
        <Filter size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
          {FILTER_LABELS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => toggle(f.key)}
              onContextMenu={(e) => {
                e.preventDefault();
                solo(f.key);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <span
                className={`flex size-3.5 items-center justify-center rounded-[3px] border text-[9px] ${
                  filters[f.key]
                    ? "border-emerald-500 bg-emerald-500 text-emerald-950"
                    : "border-zinc-600 text-transparent"
                }`}
              >
                ✓
              </span>
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ModernConversationViewProps {
  paneId: string | null;
  /**
   * Read this transcript off disk instead of resolving `paneId`'s — the
   * sessions overlay previewing a conversation no live pane owns. Takes
   * precedence over `paneId` when set.
   */
  transcript?: { sessionId: string; path: string } | null;
  filters: ConvFilters;
  onFiltersChange: (next: ConvFilters) => void;
  density: ToolDensity;
  palette: TerminalPalette;
  /**
   * Gradient CSS to paint as the view's background so a translucent background
   * preset shows the app gradient (not the opaque terminal underneath the
   * overlay). Undefined for the "noir" preset → falls back to the palette bg.
   */
  backgroundCss?: string;
  /** Live agent state for this pane — drives the "Claude travaille…" indicator. */
  agentState?: AgentStateValue;
  /** Only the active pane's view captures Ctrl+F to open search. */
  isActive: boolean;
  /**
   * Search driven from outside — the sessions overlay, whose single field owns
   * both the list and this view. While set, it replaces the view's own Ctrl+F
   * query and the owner renders the counter and the arrows.
   */
  search?: ExternalSearch | null;
  /** Surfaces errors (unopenable file path…) in the app's toaster. */
  onToast?: ToastFn;
}

/** The owner drives the query and which occurrence is current; we report how
 *  many there are. */
export interface ExternalSearch {
  query: string;
  /** Index into the occurrences, clamped by us before use. */
  index: number;
  onTotalChange: (total: number) => void;
}

/**
 * The structured "modern" conversation view: renders every block (prose,
 * thinking, tool cards) filtered by `filters`, live.
 */
export const ModernConversationView = memo(function ModernConversationView({
  paneId,
  transcript,
  filters,
  onFiltersChange,
  density,
  palette,
  backgroundCss,
  agentState,
  isActive,
  search,
  onToast,
}: ModernConversationViewProps) {
  const source = useMemo<ConvSource | null>(
    () =>
      transcript
        ? {
            kind: "transcript",
            sessionId: transcript.sessionId,
            path: transcript.path,
          }
        : paneId
          ? { kind: "pane", paneId }
          : null,
    [transcript, paneId],
  );
  const { blocks, generation } = useConversationBlocks(source);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  // Every visible row's element, by visible index, for search scroll /
  // highlight / nav. Rows register via a stable ref callback (memoized
  // rows keep their registration; unmount clears it).
  const rowEls = useRef<Map<number, HTMLDivElement>>(new Map());
  // Block count at the first non-empty render of this (pane, generation):
  // rows past it were appended live and get the entrance animation. A
  // pane switch or a transcript reset mints a new key, so rebuilt history
  // never animates. State adjusted during render (official derived-state
  // pattern) — it must be right in the very render that shows the blocks.
  const animKey = `${sourceKey(source)}:${generation}`;
  const [anim, setAnim] = useState<{ key: string; initial: number | null }>({
    key: animKey,
    initial: null,
  });
  if (anim.key !== animKey) {
    setAnim({
      key: animKey,
      initial: blocks.length > 0 ? blocks.length : null,
    });
  } else if (anim.initial === null && blocks.length > 0) {
    setAnim({ key: animKey, initial: blocks.length });
  }
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxContent | null>(null);

  const openLightbox = useCallback(
    (content: LightboxContent) => setLightbox(content),
    [],
  );
  const closeLightbox = useCallback(() => setLightbox(null), []);

  const registerEl = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(index, el);
    else rowEls.current.delete(index);
  }, []);

  const visible = useMemo(() => {
    const out: { block: ConvBlock; blockIndex: number }[] = [];
    blocks.forEach((b, i) => {
      const show =
        b.kind === "user"
          ? filters.user
          : b.kind === "assistant"
            ? filters.assistant
            : b.kind === "thinking"
              ? filters.thinking
              : filters.tools;
      if (show) out.push({ block: b, blockIndex: i });
    });
    return out;
  }, [blocks, filters]);

  // The query in force: the overlay's field when it drives us, else our own.
  const activeQuery = search ? search.query : query;
  const terms = useMemo(() => queryTerms(activeQuery), [activeQuery]);
  const searching = search !== null && search !== undefined ? true : searchOpen;

  // Which visible rows may hold a match: prose only — what the user and Claude
  // actually said. Tool inputs and outputs match on nearly every session and
  // drown the real hits, and the backend excludes them too, so the counter here
  // can never exceed what made the session surface in the first place.
  const proseRows = useMemo(
    () =>
      visible
        .map(({ block: b }, i) => ({ kind: b.kind, index: i }))
        .filter((r) => r.kind === "user" || r.kind === "assistant"),
    [visible],
  );

  // Occurrences live in the rendered DOM, not in the block data: highlighting a
  // word inside markdown that hljs has already coloured means painting ranges,
  // not rewriting HTML. Recomputed whenever the text on screen changes.
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const recount = useCallback(() => {
    if (!searching || terms.length === 0) {
      setOccurrences((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const rows: Row[] = [];
    for (const r of proseRows) {
      const el = rowEls.current.get(r.index);
      if (el) rows.push({ index: r.index, el });
    }
    setOccurrences(collectOccurrences(rows, terms));
  }, [searching, terms, proseRows]);

  // Markdown, syntax colouring, images and mermaid all land after the first
  // paint, and a delta appends rows live. Watching the subtree covers every one
  // of those without having to enumerate them; the frame delay coalesces the
  // burst a single render produces.
  useLayoutEffect(() => {
    recount();
    const el = scrollRef.current;
    if (!el || !searching) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recount);
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [recount, searching]);

  const total = occurrences.length;
  const rawIdx = search ? search.index : matchIdx;
  const currentIdx = total === 0 ? -1 : ((rawIdx % total) + total) % total;
  const current = currentIdx < 0 ? null : occurrences[currentIdx];

  // Report the count upward so the overlay can render "3/12" in its own header.
  const onTotalChange = search?.onTotalChange;
  useEffect(() => {
    onTotalChange?.(total);
  }, [onTotalChange, total]);

  // Paint, and repaint as the cursor moves between occurrences.
  useLayoutEffect(() => {
    paintOccurrences(occurrences, current);
  }, [occurrences, current]);
  useEffect(() => clearOccurrences, []);

  const nextMatch = (dir: 1 | -1) => {
    if (total === 0) return;
    setMatchIdx((i) => (i + dir + total) % total);
  };

  // Follow the conversation only when already pinned near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  // Where the view lands when it opens: the first Claude reply that follows
  // your last message. Falls back to whatever comes right after it (Claude's
  // prose filtered out), then to that message itself (no reply yet).
  const landingIndex = useMemo(() => {
    let lastUser = -1;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].block.kind === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return -1;
    for (let i = lastUser + 1; i < visible.length; i++) {
      if (visible[i].block.kind === "assistant") return i;
    }
    return lastUser + 1 < visible.length ? lastUser + 1 : lastUser;
  }, [visible]);

  // Land there once, then hold the spot while the rows above keep sizing
  // (images decoding, code highlighting): without that the transcript grows
  // under the scroll and you get dropped in the middle of a message. Any
  // wheel/drag from the user, or a second of quiet, releases the hold.
  // Which conversation we already landed on — swapping the source on this
  // instance (pane change, another session previewed) lands again.
  const landedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = sourceKey(source);
    if (landedRef.current === key || landingIndex < 0) return;
    const el = scrollRef.current;
    const row = rowEls.current.get(landingIndex);
    if (!el || !row) return;
    landedRef.current = key;
    let timer = 0;
    const ro = new ResizeObserver(() => pin());
    const release = () => {
      window.clearTimeout(timer);
      ro.disconnect();
      el.removeEventListener("wheel", release);
      el.removeEventListener("pointerdown", release);
    };
    const pin = () => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(Math.max(0, row.offsetTop - 8), max);
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      window.clearTimeout(timer);
      timer = window.setTimeout(release, 1000);
    };
    for (const r of rowEls.current.values()) ro.observe(r);
    pin();
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("pointerdown", release);
    return release;
  }, [landingIndex, source]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Ctrl/Cmd+F opens search — but only on the active pane's view.
  useEffect(() => {
    if (!isActive || blocks.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isActive, blocks.length]);

  // Bring the current occurrence into view — the word itself, not just the
  // message holding it: a long reply can push its own match off-screen.
  useEffect(() => {
    if (!current) return;
    const anchor =
      current.range.startContainer.parentElement ??
      rowEls.current.get(current.rowIndex);
    if (!anchor) return;
    atBottomRef.current = false;
    anchor.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current]);

  // The tinted block survives alongside the word-level paint: it is what lets
  // you spot dense passages while scrolling, which a few coloured letters
  // cannot do on their own.
  const matchSet = useMemo(
    () => new Set(occurrences.map((o) => o.rowIndex)),
    [occurrences],
  );
  const currentVisIdx = current ? current.rowIndex : -1;

  // No conversation for this pane (plain shell, or a Claude tab before its first
  // message) → render see-through so the real terminal stays visible and usable.
  const hasConversation = blocks.length > 0;

  // Live activity indicator, driven by Arkadia's agent state (reliable, unlike
  // scraping the terminal spinner): "busy" while Claude works (with the current
  // tool), "waiting" when it needs an answer in the footer (AskUserQuestion…).
  const working = agentState?.kind === "busy" || agentState?.kind === "waiting";
  const workingWaiting = agentState?.kind === "waiting";
  const workingTool =
    agentState?.kind === "busy" ? (agentState.tool ?? null) : null;
  const WorkingToolIcon = workingTool ? toolIcon(workingTool) : null;
  const workingLabel =
    agentState?.kind === "waiting"
      ? "En attente de ta réponse ↓"
      : agentState?.kind === "busy"
        ? workingTool
          ? `Claude travaille · ${workingTool}`
          : "Claude travaille…"
        : "";

  const initialCount = anim.initial ?? Number.POSITIVE_INFINITY;

  return (
    <div
      className={`reading-root flex h-full w-full flex-col ${
        hasConversation ? "" : "pointer-events-none"
      }`}
      style={{
        // A gradient preset paints the app gradient here (the view is an
        // overlay ON TOP of the opaque terminal, so a translucent bg would
        // reveal the terminal, not the gradient). "noir" keeps palette.bg.
        background: hasConversation
          ? (backgroundCss ?? palette.bg)
          : "transparent",
        color: palette.fg,
      }}
    >
      <style>
        {CONVERSATION_CSS}
        {MODERN_CSS}
        {HLJS_CSS}
      </style>
      {hasConversation && (
        <FilterPopover filters={filters} onChange={onFiltersChange} />
      )}
      {/* The overlay's single field owns the query when it drives us, so the
          in-view bar stays out of the way — Ctrl+F there searches the list. */}
      {hasConversation && searchOpen && !search && (
        <div className="modern-search">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                nextMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setSearchOpen(false);
                setQuery("");
              }
            }}
            placeholder="Rechercher…"
          />
          <span className="count">
            {total ? `${currentIdx + 1}/${total}` : "0"}
          </span>
          <button type="button" onClick={() => nextMatch(-1)} title="Précédent">
            <ChevronUp size={13} />
          </button>
          <button type="button" onClick={() => nextMatch(1)} title="Suivant">
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            title="Fermer"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {!hasConversation ? null : visible.length === 0 ? (
        <div className="modern-empty">tout est masqué par les filtres</div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="modern-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          {visible.map(({ block: b, blockIndex }, i) => (
            <BlockRow
              key={i}
              block={b}
              index={i}
              speakerChange={i > 0 && visible[i - 1].block.kind !== b.kind}
              density={density}
              showResults={filters.results}
              matchState={
                (matchSet.has(i)
                  ? i === currentVisIdx
                    ? 2
                    : 1
                  : 0) as MatchState
              }
              animate={blockIndex >= initialCount}
              registerEl={registerEl}
              onOpen={openLightbox}
              onToast={onToast}
            />
          ))}
        </div>
      )}
      {hasConversation && working && (
        <div className={`modern-working${workingWaiting ? " waiting" : ""}`}>
          {workingWaiting ? (
            <span className="dot" />
          ) : (
            <span className="spin" />
          )}
          {WorkingToolIcon && (
            <span className="tool-ico">
              <WorkingToolIcon size={12} />
            </span>
          )}
          {workingLabel}
        </div>
      )}
      {lightbox && <Lightbox content={lightbox} onClose={closeLightbox} />}
    </div>
  );
});
