import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { CONVERSATION_CSS } from "@/components/ConversationView";
import {
  BlockRow,
  navKindOf,
  type MatchState,
} from "@/components/modern/BlockRow";
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

/** Imperative nav surface: jump to the prev/next user (1) or Claude (2) block. */
export interface ModernNavHandle {
  navigate: (kind: 1 | 2, dir: -1 | 1) => void;
}

/**
 * Reads the structured blocks for `paneId` and keeps them live (refreshes on
 * `agent-state-changed` events for this pane's session). Incremental: each
 * refresh fetches only what the transcript appended since the previous one
 * (`read_conversation_delta`), instead of re-reading the whole JSONL.
 */
export function useConversationBlocks(paneId: string | null) {
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
    if (!paneId) {
      genRef.current = 0;
      haveRef.current = 0;
      sessionRef.current = null;
      setBlocks([]);
      setError(null);
      return;
    }
    const run = () => {
      inflightRef.current = true;
      void invoke<ConvDelta>("read_conversation_delta", {
        paneId,
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
  }, [paneId]);

  useEffect(() => {
    // New pane: drop everything the previous pane's deltas accumulated.
    genRef.current = 0;
    haveRef.current = 0;
    sessionRef.current = null;
    setGeneration(0);
    setBlocks([]);
    refresh();
  }, [refresh]);

  useEffect(() => {
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
  }, [refresh]);

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
  /** Surfaces errors (unopenable file path…) in the app's toaster. */
  onToast?: ToastFn;
}

/**
 * The structured "modern" conversation view: renders every block (prose,
 * thinking, tool cards) filtered by `filters`, live. Exposes an imperative
 * `navigate` so the message-nav arrows can jump between user/Claude blocks.
 */
export const ModernConversationView = memo(
  forwardRef<ModernNavHandle, ModernConversationViewProps>(
    function ModernConversationView(
      {
        paneId,
        filters,
        onFiltersChange,
        density,
        palette,
        backgroundCss,
        agentState,
        isActive,
        onToast,
      },
      ref,
    ) {
      const { blocks, generation } = useConversationBlocks(paneId);
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
      const animKey = `${paneId ?? ""}:${generation}`;
      const [anim, setAnim] = useState<{ key: string; initial: number | null }>(
        { key: animKey, initial: null },
      );
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

      const registerEl = useCallback(
        (index: number, el: HTMLDivElement | null) => {
          if (el) rowEls.current.set(index, el);
          else rowEls.current.delete(index);
        },
        [],
      );

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

      // Indices into `visible` whose text matches the search query.
      const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [] as number[];
        const out: number[] = [];
        visible.forEach(({ block: b }, i) => {
          const hay =
            b.kind === "tool"
              ? `${b.tool_name ?? ""} ${b.tool_input ?? ""} ${b.tool_output ?? ""}`
              : (b.text ?? "");
          if (hay.toLowerCase().includes(q)) out.push(i);
        });
        return out;
      }, [visible, query]);

      const nextMatch = (dir: 1 | -1) => {
        if (matches.length === 0) return;
        setMatchIdx((i) => (i + dir + matches.length) % matches.length);
      };

      // Follow the conversation only when already pinned near the bottom.
      useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
      }, [visible]);

      const onScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        atBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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

      // Scroll the current match into view.
      useEffect(() => {
        if (!searchOpen || matches.length === 0) return;
        const visIdx = matches[Math.min(matchIdx, matches.length - 1)];
        const el = rowEls.current.get(visIdx);
        if (el) {
          atBottomRef.current = false;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, [searchOpen, matchIdx, matches]);

      // The nav arrows need each row's kind: mirror `visible` in a ref so the
      // imperative handle reads the latest without re-creating itself.
      const visibleRef = useRef(visible);
      useEffect(() => {
        visibleRef.current = visible;
      }, [visible]);

      useImperativeHandle(
        ref,
        () => ({
          navigate(kind, dir) {
            const el = scrollRef.current;
            if (!el) return;
            const tops: number[] = [];
            for (const [i, rowEl] of rowEls.current) {
              const entry = visibleRef.current[i];
              if (entry && navKindOf(entry.block.kind) === kind) {
                tops.push(rowEl.offsetTop);
              }
            }
            tops.sort((a, b) => a - b);
            if (tops.length === 0) return;
            const cur = el.scrollTop;
            let target: number | undefined;
            if (dir > 0) {
              target = tops.find((t) => t > cur + 4);
            } else {
              const before = tops.filter((t) => t < cur - 4);
              target = before.length ? before[before.length - 1] : undefined;
            }
            if (target !== undefined) {
              atBottomRef.current = false;
              el.scrollTo({ top: target, behavior: "smooth" });
            }
          },
        }),
        [],
      );

      const matchSet = searchOpen ? new Set(matches) : null;
      const currentVisIdx =
        searchOpen && matches.length
          ? matches[Math.min(matchIdx, matches.length - 1)]
          : -1;

      // No conversation for this pane (plain shell, or a Claude tab before its first
      // message) → render see-through so the real terminal stays visible and usable.
      const hasConversation = blocks.length > 0;

      // Live activity indicator, driven by Arkadia's agent state (reliable, unlike
      // scraping the terminal spinner): "busy" while Claude works (with the current
      // tool), "waiting" when it needs an answer in the footer (AskUserQuestion…).
      const working =
        agentState?.kind === "busy" || agentState?.kind === "waiting";
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
          {hasConversation && searchOpen && (
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
                {matches.length
                  ? `${Math.min(matchIdx, matches.length - 1) + 1}/${matches.length}`
                  : "0"}
              </span>
              <button
                type="button"
                onClick={() => nextMatch(-1)}
                title="Précédent"
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => nextMatch(1)}
                title="Suivant"
              >
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
                    (matchSet?.has(i)
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
            <div
              className={`modern-working${workingWaiting ? " waiting" : ""}`}
            >
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
    },
  ),
);
