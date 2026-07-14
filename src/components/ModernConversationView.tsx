import {
  Fragment,
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
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Check, ChevronDown, ChevronUp, Copy, Filter, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CONVERSATION_CSS } from "@/components/ConversationView";
import { CLAUDE_TINT, USER_TINT, hexToRgba } from "@/lib/messageTint";
import type { TerminalPalette, ToolDensity } from "@/types";
import type { AgentStateValue } from "@/lib/agentState";

/** One structured block from `read_conversation_delta`. */
export interface ConvBlock {
  kind: "user" | "assistant" | "thinking" | "tool";
  text?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
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

const TINT: Record<string, string> = {
  user: USER_TINT,
  assistant: CLAUDE_TINT,
  thinking: "#6b7280",
  tool: "#38bdf8",
};

// Extra styling for the tool cards, on top of `CONVERSATION_CSS`. Ligatures off
// so code reads literally (`=>` stays `=>`, not `⇒`).
const MODERN_CSS = `
.modern-tool { border: 1px solid rgba(56,189,248,0.35); border-radius: 9px; overflow: hidden; background: rgba(56,189,248,0.04); }
.modern-tool-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-family: ui-monospace, "JetBrains Mono", monospace; font-variant-ligatures: none; font-size: 12px; cursor: pointer; user-select: none; }
.modern-tool-head .ico { color: #38bdf8; }
.modern-tool-head .name { color: #7dd3fc; font-weight: 600; }
.modern-tool-head .arg { color: #c9c9d2; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modern-tool-head .stat { color: #8a9099; font-size: 10.5px; flex-shrink: 0; }
.modern-tool-head .chev { margin-left: auto; color: #6f6f78; font-size: 11px; flex-shrink: 0; }
.modern-tool-body { border-top: 1px solid rgba(56,189,248,0.18); padding: 8px 10px; font-family: ui-monospace, "JetBrains Mono", monospace; font-variant-ligatures: none; font-size: 11.5px; line-height: 1.55; background: rgba(0,0,0,0.25); overflow-x: auto; }
.modern-tool-body pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.modern-code { margin: 0; white-space: pre-wrap; word-break: break-word; color: #c9c9d2; }
.modern-code .p { color: #7ee787; }
.modern-diff .dl, .modern-diff .al { white-space: pre-wrap; word-break: break-word; padding: 0 3px; border-radius: 2px; }
.modern-diff .dl { color: #fca5a5; background: rgba(248,113,113,0.10); }
.modern-diff .al { color: #86efac; background: rgba(134,239,172,0.10); }
.modern-diff .cl { color: #6b7280; white-space: pre-wrap; word-break: break-word; padding: 0 3px; }
.modern-params { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.modern-params .k { color: #7dd3fc; }
.modern-params .v { color: #c9c9d2; white-space: pre-wrap; word-break: break-word; }
.modern-tool-out { border-top: 1px solid rgba(255,255,255,0.08); }
.modern-tool-out .lbl { display: block; color: #6f6f78; font-size: 9px; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 4px; }
.modern-tool-more { color: #5a6573; font-style: italic; font-size: 11px; padding: 4px 10px; cursor: pointer; }
.modern-empty { display: flex; flex: 1; align-items: center; justify-content: center; padding: 0 1.5rem; text-align: center; font-size: 12px; color: #6b6b72; }
.modern-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
.modern-scroll::-webkit-scrollbar-track { background: transparent; }
.modern-scroll::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.14); border: 3px solid transparent; border-radius: 8px; background-clip: padding-box; }
.modern-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.26); }
.modern-working { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 7px 14px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: #c9c9d2; }
.modern-working .dot { width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; animation: modern-pulse 1.1s ease-in-out infinite; }
.modern-working.waiting .dot { background: #f5b301; animation: none; }
@keyframes modern-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.7); } }
.modern-msg .modern-copy { position: absolute; top: 6px; right: 6px; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; color: #8a8a93; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); opacity: 0; transition: opacity .12s; cursor: pointer; }
.modern-msg:hover .modern-copy { opacity: 1; }
.modern-msg .modern-copy:hover { color: #e8e8ee; background: rgba(0,0,0,0.5); }
/* Fenced code blocks get their own copy button, bottom-right. The wrapper (not
   the <pre>) is the positioning context so the button doesn't ride along when
   the code scrolls horizontally. */
.modern-codeblock { position: relative; margin: 0 0 10px; }
.modern-codeblock pre { margin: 0; }
.modern-code-copy { position: absolute; bottom: 6px; right: 6px; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; color: #8a8a93; background: rgba(20,20,24,0.88); border: 1px solid rgba(255,255,255,0.1); opacity: 0; transition: opacity .12s; cursor: pointer; }
.modern-codeblock:hover .modern-code-copy { opacity: 1; }
.modern-code-copy:hover { color: #e8e8ee; background: rgba(0,0,0,0.6); }
.modern-code-copy.copied { opacity: 1; color: #86efac; border-color: rgba(134,239,172,0.4); }
/* Off-screen blocks skip layout/paint entirely (their height is estimated),
   so a huge conversation costs only what's visible. */
.modern-block { content-visibility: auto; contain-intrinsic-size: auto 90px; }
.modern-match { outline: 1.5px solid rgba(250,204,21,0.4); outline-offset: -1px; }
.modern-match-current { outline: 2px solid #facc15; outline-offset: -1px; }
.modern-search { position: absolute; top: 8px; left: 8px; right: 44px; z-index: 25; display: flex; align-items: center; gap: 3px; padding: 4px 6px; border-radius: 9px; background: #16161a; border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 6px 20px rgba(0,0,0,.5); }
.modern-search input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: #e8e8ee; font-size: 12.5px; }
.modern-search .count { font-size: 11px; color: #8a8a93; padding: 0 4px; white-space: nowrap; }
.modern-search button { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 5px; color: #a6a6ae; flex-shrink: 0; }
.modern-search button:hover { background: rgba(255,255,255,0.08); color: #e8e8ee; }
`;

/**
 * A fenced code block with a hover-revealed "copy" button in its bottom-right
 * corner. The text is read back from the rendered `<pre>` so whatever the
 * highlighter put in there is what lands on the clipboard.
 */
function CodeBlock({ children, ...rest }: React.ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="modern-codeblock">
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
      <button
        type="button"
        className={`modern-code-copy${copied ? " copied" : ""}`}
        title="Copier le bloc de code"
        aria-label="Copier le bloc de code"
        onClick={(e) => {
          e.stopPropagation();
          const text = preRef.current?.textContent ?? "";
          if (!text) return;
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
            .catch(() => {});
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

const MD_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      onClick={(e) => {
        e.preventDefault();
        if (href) void openExternal(href).catch(() => {});
      }}
      title={href}
    >
      {children}
    </a>
  ),
  pre: CodeBlock,
};

/**
 * Reads the structured blocks for `paneId` and keeps them live (refreshes on
 * `agent-state-changed` events for this pane's session). Incremental: each
 * refresh fetches only what the transcript appended since the previous one
 * (`read_conversation_delta`), instead of re-reading the whole JSONL.
 */
export function useConversationBlocks(paneId: string | null) {
  const [blocks, setBlocks] = useState<ConvBlock[]>([]);
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

  return { blocks, error, refresh };
}

/** Best-effort one-line summary of a tool call for the card header. */
function toolSummary(input: Record<string, unknown>): string {
  const pick =
    input.command ??
    input.file_path ??
    input.path ??
    input.pattern ??
    input.url ??
    input.query ??
    input.description;
  const s = typeof pick === "string" ? pick.split("\n")[0] : "";
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

/** Parses the tool input JSON; `{}` on failure or non-object. */
function parseInput(json?: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Trims the common leading/trailing lines between `oldText` and `newText` so a
 * diff shows only what actually changed (+ 2 lines of context), like a terminal
 * unified diff — not the whole block dumped twice.
 */
function trimmedDiff(oldText: string, newText: string) {
  const o = oldText.length ? oldText.split("\n") : [];
  const n = newText.length ? newText.split("\n") : [];
  let start = 0;
  while (start < o.length && start < n.length && o[start] === n[start]) start++;
  let endO = o.length;
  let endN = n.length;
  while (endO > start && endN > start && o[endO - 1] === n[endN - 1]) {
    endO--;
    endN--;
  }
  return {
    before: o.slice(Math.max(0, start - 2), start),
    removed: o.slice(start, endO),
    added: n.slice(start, endN),
    after: o.slice(endO, endO + 2),
  };
}

/** "+5 −1" style change counter for a tool card header. */
function statStr(removed: number, added: number): string {
  const parts: string[] = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`−${removed}`);
  return parts.join(" ");
}

function toolStat(name: string, input: Record<string, unknown>): string {
  if (name === "Edit") {
    const d = trimmedDiff(
      str(input, "old_string") ?? "",
      str(input, "new_string") ?? "",
    );
    return statStr(d.removed.length, d.added.length);
  }
  if (name === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    let rem = 0;
    let add = 0;
    for (const e of edits) {
      const eo = (e ?? {}) as Record<string, unknown>;
      const d = trimmedDiff(
        typeof eo.old_string === "string" ? eo.old_string : "",
        typeof eo.new_string === "string" ? eo.new_string : "",
      );
      rem += d.removed.length;
      add += d.added.length;
    }
    return statStr(rem, add);
  }
  if (name === "Write") {
    const c = str(input, "content") ?? "";
    return c ? `+${c.split("\n").length}` : "";
  }
  return "";
}

/** A tight unified diff: a little context (dim) + removed (red) + added (green). */
function DiffLines({
  oldText,
  newText,
}: {
  oldText?: string;
  newText?: string;
}) {
  const d = trimmedDiff(oldText ?? "", newText ?? "");
  return (
    <div className="modern-diff">
      {d.before.map((l, i) => (
        <div key={`b${i}`} className="cl">{`  ${l}`}</div>
      ))}
      {d.removed.map((l, i) => (
        <div key={`r${i}`} className="dl">{`- ${l}`}</div>
      ))}
      {d.added.map((l, i) => (
        <div key={`a${i}`} className="al">{`+ ${l}`}</div>
      ))}
      {d.after.map((l, i) => (
        <div key={`f${i}`} className="cl">{`  ${l}`}</div>
      ))}
    </div>
  );
}

function GenericParams({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input);
  if (entries.length === 0) return null;
  return (
    <div className="modern-params">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <span className="k">{k}</span>
          <span className="v">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Renders a tool's input the way the terminal would — diff, code, or params. */
function ToolInputView({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  switch (name) {
    case "Edit":
      return (
        <DiffLines
          oldText={str(input, "old_string")}
          newText={str(input, "new_string")}
        />
      );
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return (
        <>
          {edits.map((e, i) => {
            const eo = (e ?? {}) as Record<string, unknown>;
            return (
              <DiffLines
                key={i}
                oldText={typeof eo.old_string === "string" ? eo.old_string : ""}
                newText={typeof eo.new_string === "string" ? eo.new_string : ""}
              />
            );
          })}
        </>
      );
    }
    case "Write":
      return <pre className="modern-code">{str(input, "content") ?? ""}</pre>;
    case "Bash":
      return (
        <pre className="modern-code">
          <span className="p">$ </span>
          {str(input, "command") ?? ""}
        </pre>
      );
    case "ExitPlanMode":
      return (
        <div className="reading-md">
          <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {str(input, "plan") ?? ""}
          </Markdown>
        </div>
      );
    case "Read":
    case "Grep":
    case "Glob":
    case "LS":
      // The header summary (path/pattern) + the output below already say it all.
      return null;
    default:
      return <GenericParams input={input} />;
  }
}

function ToolCard({
  block,
  density,
  showResults,
}: {
  block: ConvBlock;
  density: ToolDensity;
  showResults: boolean;
}) {
  const [open, setOpen] = useState(density === "full");
  const input = parseInput(block.tool_input);
  const summary = toolSummary(input);
  const output = showResults ? (block.tool_output ?? "") : "";
  const name = block.tool_name ?? "tool";
  const stat = toolStat(name, input);
  // Collapsed by default = a single short header line; click (or density "full")
  // expands to the diff / code / output.
  const expanded = density === "full" || open;

  return (
    <div className="modern-tool">
      <div
        className="modern-tool-head"
        onClick={() => setOpen((v) => !v)}
        title="Déplier / replier"
      >
        <span className="ico">⌗</span>
        <span className="name">{name}</span>
        <span className="arg">{summary}</span>
        {stat && <span className="stat">{stat}</span>}
        <span className="chev">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="modern-tool-body">
          <ToolInputView name={name} input={input} />
          {output.length > 0 && (
            <div
              className="modern-tool-out"
              style={{ marginTop: 8, paddingTop: 6 }}
            >
              <span className="lbl">résultat</span>
              <pre>{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
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

/** Hover-revealed button that copies a message's markdown to the clipboard. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="modern-copy"
      title="Copier le message"
      aria-label="Copier le message"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

interface ModernConversationViewProps {
  paneId: string | null;
  filters: ConvFilters;
  onFiltersChange: (next: ConvFilters) => void;
  density: ToolDensity;
  palette: TerminalPalette;
  /** Live agent state for this pane — drives the "Claude travaille…" indicator. */
  agentState?: AgentStateValue;
  /** Only the active pane's view captures Ctrl+F to open search. */
  isActive: boolean;
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
        agentState,
        isActive,
      },
      ref,
    ) {
      const { blocks } = useConversationBlocks(paneId);
      const scrollRef = useRef<HTMLDivElement>(null);
      const atBottomRef = useRef(true);
      // navkind elements, in DOM order, for the nav arrows.
      const navEls = useRef<{ kind: 1 | 2; el: HTMLDivElement }[]>([]);
      // Every visible block's element, by index, for search scroll/highlight.
      const msgEls = useRef<Map<number, HTMLDivElement>>(new Map());
      const [searchOpen, setSearchOpen] = useState(false);
      const [query, setQuery] = useState("");
      const [matchIdx, setMatchIdx] = useState(0);

      const visible = useMemo(
        () =>
          blocks.filter((b) => {
            if (b.kind === "user") return filters.user;
            if (b.kind === "assistant") return filters.assistant;
            if (b.kind === "thinking") return filters.thinking;
            if (b.kind === "tool") return filters.tools;
            return true;
          }),
        [blocks, filters],
      );

      // Indices into `visible` whose text matches the search query.
      const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [] as number[];
        const out: number[] = [];
        visible.forEach((b, i) => {
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
        const el = msgEls.current.get(visIdx);
        if (el) {
          atBottomRef.current = false;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, [searchOpen, matchIdx, matches]);

      useImperativeHandle(
        ref,
        () => ({
          navigate(kind, dir) {
            const el = scrollRef.current;
            if (!el) return;
            const targets = navEls.current.filter((n) => n.kind === kind);
            if (targets.length === 0) return;
            const tops = targets.map((t) => t.el.offsetTop);
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

      // Reset the per-render element lists; refs re-register below. Deliberate
      // render-time ref write (the lists mirror exactly what this render
      // mounts); the incremental rework of this view will replace the pattern.
      // eslint-disable-next-line react-hooks/refs
      navEls.current = [];
      // eslint-disable-next-line react-hooks/refs
      msgEls.current.clear();
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
      const workingLabel =
        agentState?.kind === "waiting"
          ? "En attente de ta réponse ↓"
          : agentState?.kind === "busy"
            ? agentState.tool
              ? `Claude travaille · ${agentState.tool}`
              : "Claude travaille…"
            : "";

      return (
        <div
          className={`reading-root flex h-full w-full flex-col ${
            hasConversation ? "" : "pointer-events-none"
          }`}
          style={{
            backgroundColor: hasConversation ? palette.bg : "transparent",
            color: palette.fg,
          }}
        >
          <style>
            {CONVERSATION_CSS}
            {MODERN_CSS}
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
              {visible.map((b, i) => {
                const matchCls = matchSet?.has(i)
                  ? i === currentVisIdx
                    ? " modern-match modern-match-current"
                    : " modern-match"
                  : "";
                if (b.kind === "tool") {
                  return (
                    <div
                      key={i}
                      className={`modern-block${matchCls}`}
                      ref={(el) => {
                        if (el) msgEls.current.set(i, el);
                      }}
                      style={{ marginBottom: 8, borderRadius: 9 }}
                    >
                      <ToolCard
                        block={b}
                        density={density}
                        showResults={filters.results}
                      />
                    </div>
                  );
                }
                const navKind: 1 | 2 | 0 =
                  b.kind === "user" ? 1 : b.kind === "assistant" ? 2 : 0;
                const tint = TINT[b.kind] ?? CLAUDE_TINT;
                return (
                  <div
                    key={i}
                    className={`modern-block modern-msg${matchCls}`}
                    ref={(el) => {
                      if (el) {
                        msgEls.current.set(i, el);
                        if (navKind) navEls.current.push({ kind: navKind, el });
                      }
                    }}
                    style={{
                      position: "relative",
                      marginBottom: 8,
                      padding: "8px 12px",
                      border: `1px solid ${hexToRgba(tint, 0.4)}`,
                      borderRadius: 9,
                      background: hexToRgba(tint, 0.04),
                    }}
                  >
                    <CopyButton text={b.text ?? ""} />
                    <div
                      className="reading-md"
                      style={
                        b.kind === "thinking"
                          ? { fontStyle: "italic", opacity: 0.85 }
                          : undefined
                      }
                    >
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={MD_COMPONENTS}
                      >
                        {b.text ?? ""}
                      </Markdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {hasConversation && working && (
            <div
              className={`modern-working${workingWaiting ? " waiting" : ""}`}
            >
              <span className="dot" />
              {workingLabel}
            </div>
          )}
        </div>
      );
    },
  ),
);
