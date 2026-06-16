import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CLAUDE_TINT, USER_TINT, hexToRgba } from "@/lib/messageTint";

/** One conversation turn, as returned by the `read_conversation` command. */
export interface ConvMessage {
  role: "user" | "assistant";
  text: string;
}

// Scoped, readable markdown styling — a proportional body for prose, monospace
// only for code. Tuned for comfortable reading rather than terminal fidelity.
// Shared by the reading panel and the notification popup; both wrap their root
// in `.reading-root` and each message body in `.reading-md`.
export const CONVERSATION_CSS = `
.reading-root { font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.reading-md { font-size: 13.5px; line-height: 1.66; color: #d7d7de; word-break: break-word; }
.reading-md > *:first-child { margin-top: 0; }
.reading-md > *:last-child { margin-bottom: 0; }
.reading-md p { margin: 0 0 10px; }
.reading-md h1, .reading-md h2, .reading-md h3, .reading-md h4 { margin: 16px 0 8px; line-height: 1.25; font-weight: 650; color: #f1f1f4; letter-spacing: -0.01em; }
.reading-md h1 { font-size: 1.32em; } .reading-md h2 { font-size: 1.18em; } .reading-md h3 { font-size: 1.06em; } .reading-md h4 { font-size: 1em; }
.reading-md ul, .reading-md ol { margin: 0 0 10px; padding-left: 1.35em; }
.reading-md li { margin: 3px 0; }
.reading-md li::marker { color: #6f6f78; }
.reading-md code { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 0.88em; background: rgba(255,255,255,0.08); padding: 1.5px 5px; border-radius: 5px; }
.reading-md pre { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 11px 13px; overflow-x: auto; margin: 0 0 10px; }
.reading-md pre code { background: none; padding: 0; font-size: 0.85em; line-height: 1.55; }
.reading-md a { color: #8ab4ff; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.reading-md blockquote { margin: 0 0 10px; padding: 2px 0 2px 12px; border-left: 3px solid rgba(255,255,255,0.16); color: #a6a6ae; }
.reading-md strong { color: #f1f1f4; font-weight: 650; }
.reading-md hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 14px 0; }
.reading-md table { border-collapse: collapse; margin: 0 0 10px; font-size: 0.9em; display: block; overflow-x: auto; }
.reading-md th, .reading-md td { border: 1px solid rgba(255,255,255,0.12); padding: 5px 9px; text-align: left; }
.reading-md th { background: rgba(255,255,255,0.04); font-weight: 600; }
`;

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
};

/**
 * Reads the conversation for `paneId` from its transcript and keeps it live:
 * re-reads on every `agent-state-changed` event (fires each turn). Returns the
 * messages, the last error (e.g. transcript not yet mapped), and a manual
 * `refresh`. Shared by the reading panel and the popup.
 *
 * `bump` is an optional nonce: whenever it changes the conversation is re-read
 * (plus a short follow-up read to catch the transcript line still being flushed
 * to disk). The popup passes the per-signal hook timestamp so a popup that's
 * already open for a pane picks up what Claude just wrote — e.g. the plan from a
 * fresh `ExitPlanMode` call — instead of showing a stale earlier turn.
 */
export function useConversation(paneId: string | null, bump?: number) {
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!paneId) {
      setMessages([]);
      setError(null);
      return;
    }
    void invoke<ConvMessage[]>("read_conversation", { paneId })
      .then((msgs) => {
        setMessages(msgs);
        setError(null);
      })
      .catch((e) => {
        setMessages([]);
        setError(String(e));
      });
  }, [paneId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fresh signal (popup re-appearing / new turn): re-read now, then once more
  // shortly after in case the transcript line hadn't hit disk on the first read.
  useEffect(() => {
    if (bump === undefined) return;
    refresh();
    const t = setTimeout(refresh, 400);
    return () => clearTimeout(t);
  }, [bump, refresh]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;
    void listen("agent-state-changed", () => {
      if (active) refresh();
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh]);

  return { messages, error, refresh };
}

/**
 * The memoised list of rendered conversation messages — a left accent bar +
 * role chip per turn, markdown body. The caller wraps it in a scroller and must
 * include `<style>{CONVERSATION_CSS}</style>` and a `.reading-root` ancestor.
 * `anchorRef` is attached to the message at `anchorIndex` so the caller can
 * scroll its top into view (e.g. the start of Claude's reply).
 */
export function ConversationMessages({
  messages,
  anchorIndex,
  anchorRef,
}: {
  messages: ConvMessage[];
  anchorIndex?: number;
  anchorRef?: (el: HTMLDivElement | null) => void;
}) {
  return useMemo(
    () => (
      <>
        {messages.map((m, i) => {
          const tint = m.role === "user" ? USER_TINT : CLAUDE_TINT;
          return (
            <div
              key={i}
              ref={i === anchorIndex ? anchorRef : undefined}
              style={{
                marginBottom: 10,
                padding: "10px 14px",
                borderLeft: `2px solid ${tint}`,
                borderRadius: "0 10px 10px 0",
                background: hexToRgba(tint, 0.04),
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: tint,
                  }}
                />
                <span
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: tint,
                  }}
                >
                  {m.role === "user" ? "Toi" : "Claude"}
                </span>
              </div>
              <div className="reading-md">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={MD_COMPONENTS}
                >
                  {m.text}
                </Markdown>
              </div>
            </div>
          );
        })}
      </>
    ),
    [messages, anchorIndex, anchorRef],
  );
}
