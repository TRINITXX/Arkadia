import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { readText as readClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { resolveColor } from "@/lib/palettes";
import { keyEventToBytes } from "@/lib/keymap";
import {
  isBoxRow,
  isChromeRow,
  isInputRow,
  isOptionRow,
} from "@/lib/terminalChrome";
import {
  CONVERSATION_CSS,
  ConversationMessages,
  useConversation,
} from "@/components/ConversationView";
import type {
  CellRun,
  RenderPayload,
  TerminalFont,
  TerminalPalette,
} from "@/types";

interface Props {
  /** Arkadia pane UUID = PTY session id = `send_input` target. */
  paneId: string;
  /** Per-signal nonce (hook ts). Changes when the popup re-appears for the same
   * pane → re-runs the open-time scroll to the start of Claude's reply. */
  resetSignal?: number;
  /** "question" = AskUserQuestion / ExitPlanMode — the prompt has a header above
   *  its options, so the footer is allowed to walk one blank line further up. */
  kind?: string;
  font: TerminalFont;
  palette: TerminalPalette;
  /** Called when the user submits the reply (plain Enter). */
  onSubmit?: () => void;
}

const MAX_SCREEN_FRACTION = 0.9;
const MIN_WINDOW_CSS = 220;
// Max rows to walk up from the input prompt when capturing the interactive area
// (a tall AskUserQuestion / ExitPlanMode selector); a safety cap in case there's
// no blank line separating the prompt area from the conversation.
const FOOTER_LOOKBACK = 40;

function runStyle(run: CellRun, palette: TerminalPalette): React.CSSProperties {
  let fg = resolveColor(run.fg, palette, "fg");
  let bg = resolveColor(run.bg, palette, "bg");
  if (run.inverse) [fg, bg] = [bg, fg];
  const deco: string[] = [];
  if (run.underline_style) deco.push("underline");
  if (run.strikethrough) deco.push("line-through");
  return {
    color: fg,
    backgroundColor: bg !== palette.bg ? bg : undefined,
    fontWeight: run.bold ? 600 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    opacity: run.dim ? 0.55 : undefined,
    textDecoration: deco.length ? deco.join(" ") : undefined,
  };
}

function rowIsBlank(runs: CellRun[]): boolean {
  return runs.every((r) => r.text.trim().length === 0);
}

/** One mirrored terminal row (fixed width, no wrap), with the block cursor
 * painted when it sits on this row. */
function MirrorRow({
  runs,
  palette,
  cursorCol,
  cursorRef,
}: {
  runs: CellRun[];
  palette: TerminalPalette;
  cursorCol: number | null;
  cursorRef?: (el: HTMLSpanElement | null) => void;
}) {
  if (cursorCol === null) {
    return (
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {runs.map((r, i) => (
          <span key={i} style={runStyle(r, palette)}>
            {r.text}
          </span>
        ))}
      </div>
    );
  }
  // Cursor row: split the run holding the cursor and invert that cell.
  const out: React.ReactNode[] = [];
  let col = 0;
  let placed = false;
  runs.forEach((r, i) => {
    const chars = [...r.text];
    const len = chars.length;
    if (!placed && cursorCol >= col && cursorCol < col + len) {
      const idx = cursorCol - col;
      const before = chars.slice(0, idx).join("");
      const at = chars[idx] ?? " ";
      const after = chars.slice(idx + 1).join("");
      if (before)
        out.push(
          <span key={`${i}-b`} style={runStyle(r, palette)}>
            {before}
          </span>,
        );
      out.push(
        <span
          key={`${i}-c`}
          ref={cursorRef}
          style={runStyle({ ...r, inverse: !r.inverse }, palette)}
        >
          {at}
        </span>,
      );
      if (after)
        out.push(
          <span key={`${i}-a`} style={runStyle(r, palette)}>
            {after}
          </span>,
        );
      placed = true;
    } else {
      out.push(
        <span key={i} style={runStyle(r, palette)}>
          {r.text}
        </span>,
      );
    }
    col += len;
  });
  if (!placed) {
    const gap = cursorCol - col;
    if (gap > 0) out.push(<span key="cursor-gap">{" ".repeat(gap)}</span>);
    out.push(
      <span
        key="cursor-end"
        ref={cursorRef}
        style={{ backgroundColor: palette.fg, color: palette.bg }}
      >
        {" "}
      </span>,
    );
  }
  return (
    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {out}
    </div>
  );
}

/**
 * Notification-popup body: the same clean markdown conversation view as the
 * "Lecture" panel on top (read from the transcript, live-refreshed each turn),
 * plus a LIVE MIRROR of Claude Code's input box (and any AskUserQuestion /
 * ExitPlanMode selector above it) pinned at the bottom. Keystrokes are forwarded
 * straight to the pane's PTY — so the reply field behaves exactly like Arkadia's
 * terminal: Alt+V pastes a screenshot, the question/plan selectors are navigable
 * with the arrows, word-motions/Delete work, etc. On open it scrolls to the
 * start of Claude's first reply after the user's last message and grows the
 * window height (same width) to try to fit every reply since then.
 */
export function PopupReading({
  paneId,
  resetSignal,
  kind,
  font,
  palette,
  onSubmit,
}: Props) {
  const { messages } = useConversation(paneId, resetSignal);
  const [screen, setScreen] = useState<RenderPayload | null>(null);
  const screenRef = useRef<RenderPayload | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement | null>(null);

  // Keep the reading view scrolled to the anchor (the start of Claude's reply) on
  // every refresh — so when the reply is still flushing to the transcript and the
  // first read lands on an earlier turn, we re-anchor onto it once it arrives —
  // UNTIL the user scrolls, after which we leave their position alone. Re-armed on
  // each fresh signal (a new prompt for this pane).
  const autoAnchorRef = useRef(true);
  const atBottomRef = useRef(true);
  const anchorElRef = useRef<HTMLDivElement | null>(null);

  // ─── Live screen (for the mirrored input/selector footer) ───────
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;
    void listen<RenderPayload>("terminal-render", (event) => {
      if (!active || event.payload.session_id !== paneId) return;
      screenRef.current = event.payload;
      setScreen(event.payload);
    }).then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
      void invoke("request_render", { sessionId: paneId }).catch(() => {});
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [paneId]);

  // Anchor = where the reading view opens scrolled to: the first assistant turn
  // after the user's last message — the start of "everything Claude said since my
  // reply". While the latest reply is still being flushed to the transcript there
  // may be no assistant turn after the last user yet — anchor on that last user
  // message (not an old reply) so we sit at the bottom, then re-anchor onto the
  // reply once it lands (see the auto-anchor scroll below). The ExitPlanMode plan
  // has its own path (the live-screen `planRows`), so it needs no anchor here.
  const anchorIndex = useMemo(() => {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    for (let i = lastUser + 1; i < messages.length; i++) {
      if (messages[i].role === "assistant") return i;
    }
    return lastUser;
  }, [messages]);

  // ─── Mirrored prompt: the reply field (footer) + the ExitPlanMode plan ───────
  // Both are read from the LIVE terminal screen, not the transcript: Claude Code
  // doesn't persist the ExitPlanMode assistant message (the plan) to the JSONL
  // until the user answers, so the transcript can't supply it while the popup is
  // up — but the terminal is rendering it right now.
  //
  // `rows` is the interactive footer, anchored on the `❯` input prompt or, when
  // there's no text field (ExitPlanMode's Yes/No box), the last numbered option;
  // it walks up to include the question/header and down for multi-line input,
  // stopping at the plan boundary. `plan` is the plan body above that boundary,
  // from the `Here is Claude's plan:` header down — shown alone in the reading
  // area (no preceding conversation) for an ExitPlanMode prompt.
  const { rows: footer, plan: planRows } = useMemo(() => {
    const empty = {
      rows: [] as { runs: CellRun[]; realRow: number }[],
      plan: [] as { runs: CellRun[]; realRow: number }[],
    };
    const s = screen;
    if (!s) return empty;
    const lines = s.lines;
    const cols = s.cols;
    // Anchor on the bottom-most interactive row: the `❯` input prompt, or — when
    // there's no text field (ExitPlanMode's Yes/No approval box) — the last
    // numbered selector option.
    let inputIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (isChromeRow(lines[i], cols)) continue;
      if (isInputRow(lines[i]) || isOptionRow(lines[i])) {
        inputIdx = i;
        break;
      }
    }
    if (inputIdx < 0) return empty;
    // A "pure rule" is a separator made only of horizontal box-drawing dashes
    // (solid or dashed), no `❯`. Claude Code frames its prompts/questions with
    // these; we drop them from the output entirely (the `─── ❯ ───` input line
    // keeps its `❯`, so it's not a pure rule).
    const isPureRule = (runs: CellRun[]) => {
      const t = runs
        .map((r) => r.text)
        .join("")
        .replace(/\s/g, "");
      return t.length > 0 && /^[─━┄┅┈┉╌╍]+$/.test(t);
    };
    // Down: multi-line input continuations (until a chrome-only tail or blank).
    let bot = inputIdx;
    for (let i = inputIdx + 1; i < lines.length; i++) {
      if (isChromeRow(lines[i], cols)) continue;
      if (rowIsBlank(lines[i])) break;
      bot = i;
    }
    // Up: ONLY for a question/plan do we show rows above the input — an
    // AskUserQuestion / ExitPlanMode prompt stacks (header chip · blank ·
    // question · blank · options), so we cross up to TWO blank lines to capture
    // the header + question.
    //
    // The hard part is excluding the framed plan ExitPlanMode prints ABOVE its
    // "Would you like to proceed?" question (it's already in the reading view).
    // We stop at:
    //   - a box-drawing row that isn't an option (a `│`-framed plan), and
    //   - a rule (`────`) once we're past the options block — but NOT a rule that
    //     sits inside the options (AskUserQuestion draws one before its trailing
    //     "Chat about this" option). `seenPrompt` flips true on the first prose
    //     line above the options (the question), so an options-internal rule is
    //     crossed while a rule above the question is the boundary.
    // A finished reply (done) shows just the input field — no walk-up.
    let top = inputIdx;
    if (kind === "question") {
      let blanks = 0;
      let seenPrompt = false;
      for (
        let i = inputIdx - 1;
        i >= 0 && inputIdx - i <= FOOTER_LOOKBACK;
        i--
      ) {
        if (isChromeRow(lines[i], cols)) continue;
        if (isBoxRow(lines[i]) && !isOptionRow(lines[i])) break;
        if (isPureRule(lines[i])) {
          if (seenPrompt) break;
          continue;
        }
        if (rowIsBlank(lines[i])) {
          blanks++;
          if (blanks > 2) break;
          continue;
        }
        if (!isOptionRow(lines[i])) seenPrompt = true;
        top = i;
      }
    }
    const out: { runs: CellRun[]; realRow: number }[] = [];
    for (let i = top; i <= bot; i++) {
      if (isChromeRow(lines[i], cols)) continue;
      if (isPureRule(lines[i])) continue;
      out.push({ runs: lines[i], realRow: i });
    }

    // The ExitPlanMode plan body: from the `Here is Claude's plan:` header (just
    // above the prompt region) down to where the question region starts (`top`).
    // Found only for a plan prompt; AskUserQuestion has no such header → no plan.
    const plan: { runs: CellRun[]; realRow: number }[] = [];
    let planHeader = -1;
    for (let i = top - 1; i >= 0; i--) {
      const t = lines[i]
        .map((r) => r.text)
        .join("")
        .trim();
      if (/^Here is Claude'?s plan:/i.test(t)) {
        planHeader = i;
        break;
      }
    }
    if (planHeader >= 0) {
      for (let i = planHeader; i < top; i++) {
        if (isChromeRow(lines[i], cols)) continue;
        if (isPureRule(lines[i])) continue;
        plan.push({ runs: lines[i], realRow: i });
      }
      // Trim trailing blank rows left by the separator before the question.
      while (plan.length && rowIsBlank(plan[plan.length - 1].runs)) plan.pop();
    }
    return { rows: out, plan };
  }, [screen, kind]);

  // A fresh signal (popup re-appearing for this pane) re-arms auto-anchoring.
  useEffect(() => {
    autoAnchorRef.current = true;
  }, [resetSignal]);

  // Focus the footer when the popup appears so keystrokes reach the reply box.
  useEffect(() => {
    footerRef.current?.focus();
  }, [paneId, resetSignal]);

  // Keep the input box (cursor) in view as the footer content changes.
  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [screen]);

  const scrollToAnchor = () => {
    const el = scrollRef.current;
    if (!el) return;
    // The plan view has no message anchor — open it at the top (its header).
    const anchor = planRows.length > 0 ? null : anchorElRef.current;
    if (anchor) {
      const top =
        anchor.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop;
      el.scrollTop = Math.max(0, top - 8);
    } else {
      el.scrollTop = 0;
    }
  };

  const applyScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoAnchorRef.current) scrollToAnchor();
    else if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  };

  // Grow (or shrink) the popup window height to fit the conversation from the
  // anchor to the end — keeping its width, and anchoring its bottom edge so it
  // expands upward and never runs off the bottom of the screen.
  const fitHeight = async () => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = planRows.length > 0 ? null : anchorElRef.current;
    const anchorTop = anchor
      ? anchor.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop
      : 0;
    const contentBelowAnchor = el.scrollHeight - anchorTop;
    // Everything in the window that isn't the reading scroller's visible area
    // (header + mirrored footer + borders) — invariant to its height since it
    // flexes, so it's safe to read from the current layout.
    const chrome = window.innerHeight - el.clientHeight;
    const maxCss = Math.floor(window.screen.availHeight * MAX_SCREEN_FRACTION);
    const desiredCss = Math.max(
      MIN_WINDOW_CSS,
      Math.min(maxCss, chrome + contentBelowAnchor + 8),
    );
    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const size = await win.outerSize();
      const pos = await win.outerPosition();
      const desiredPhys = Math.round(desiredCss * scale);
      if (Math.abs(desiredPhys - size.height) < Math.ceil(4 * scale)) return;
      const bottom = pos.y + size.height;
      const newY = Math.max(0, bottom - desiredPhys);
      await win.setSize(new PhysicalSize(size.width, desiredPhys));
      await win.setPosition(new PhysicalPosition(pos.x, newY));
    } catch (err) {
      console.error("[arkadia popup] resize failed:", err);
    }
  };

  useLayoutEffect(() => {
    applyScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, planRows.length]);

  useEffect(() => {
    if (!scrollRef.current || !autoAnchorRef.current) return;
    let cancelled = false;
    void (async () => {
      await fitHeight();
      if (cancelled) return;
      scrollToAnchor();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, planRows.length]);

  // Re-fit the window whenever the prompt area changes height (a question/plan
  // selector appears, the reply gains lines, the plan mirror loads) — with no
  // footer cap, the window must grow so the whole field/selector stays visible
  // (capped at the screen).
  useEffect(() => {
    if (scrollRef.current) void fitHeight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footer.length, planRows.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ─── Reply: forward keystrokes to the PTY, like the main terminal ──
  const onFooterKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+C with a selection → let the browser copy it (don't send SIGINT).
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "c") {
      const sel = window.getSelection()?.toString() ?? "";
      if (sel.length > 0) return;
    }
    // Ctrl+V → paste clipboard text into the PTY (bracketed when enabled).
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "v") {
      e.preventDefault();
      try {
        const text = await readClipboard();
        if (text && text.length > 0) {
          const useBracketed = screenRef.current?.bracketed_paste ?? false;
          const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
          const payload = useBracketed
            ? `\x1b[200~${normalized}\x1b[201~`
            : normalized;
          await invoke("send_input", {
            sessionId: paneId,
            bytes: Array.from(new TextEncoder().encode(payload)),
          });
        }
      } catch (err) {
        console.error("[arkadia popup] paste failed:", err);
      }
      return;
    }
    const isPlainEnter =
      e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    const bytes = keyEventToBytes(e);
    if (bytes) {
      e.preventDefault();
      try {
        await invoke("send_input", {
          sessionId: paneId,
          bytes: Array.from(bytes),
        });
      } catch (err) {
        console.error("[arkadia popup] reply failed:", err);
      }
      // Plain Enter submits the prompt / picks the option → dismiss the popup.
      if (isPlainEnter) onSubmit?.();
    }
  };

  const cursorRow = screen?.cursor_visible ? screen.cursor_row : -1;

  return (
    <div
      className="reading-root flex h-full w-full flex-col"
      style={{ backgroundColor: palette.bg, color: palette.fg }}
    >
      <style>{CONVERSATION_CSS}</style>

      {planRows.length > 0 ? (
        // ExitPlanMode: show ONLY the plan (mirrored from the live screen), not
        // the preceding conversation — the user wants to read the proposed plan.
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={() => {
            autoAnchorRef.current = false;
          }}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
          style={{
            fontFamily: font.family,
            fontSize: `${font.size}px`,
            lineHeight: 1.35,
          }}
        >
          {planRows.map((pr) => (
            <MirrorRow
              key={pr.realRow}
              runs={pr.runs}
              palette={palette}
              cursorCol={null}
            />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-zinc-600">
          {"aucun message pour l'instant"}
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={() => {
            autoAnchorRef.current = false;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          <ConversationMessages
            messages={messages}
            anchorIndex={anchorIndex}
            anchorRef={(el) => {
              anchorElRef.current = el;
            }}
          />
        </div>
      )}

      {footer.length > 0 && (
        <div
          ref={footerRef}
          tabIndex={0}
          onKeyDown={onFooterKeyDown}
          // Bottom-anchored (shrink-0), no height cap: the field/selector grows
          // to show its whole content (question header + all options), and the
          // reading view above shrinks. The window itself is re-fitted to keep it
          // all visible (see the footer effect below).
          className="shrink-0 overflow-x-hidden border-t px-3 py-2 outline-none"
          style={{
            borderColor: `${palette.fg}22`,
            backgroundColor: palette.bg,
            color: palette.fg,
            fontFamily: font.family,
            fontSize: `${font.size}px`,
            lineHeight: 1.3,
          }}
        >
          {footer.map((fr) => (
            <MirrorRow
              key={fr.realRow}
              runs={fr.runs}
              palette={palette}
              cursorCol={
                fr.realRow === cursorRow ? (screen?.cursor_col ?? null) : null
              }
              cursorRef={(el) => {
                if (el) cursorRef.current = el;
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
