import { useEffect, useState } from "react";
import { History, Search } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import type { SessionChoice } from "@/lib/chat/chatProtocol";
import { sessionRows, type PickerRow } from "@/lib/chat/chatSlash";
import type { SlashActions } from "@/lib/chat/useSlashActions";

/** How many of the folder's sessions a new chat offers, or finds. */
const WELCOME_SESSIONS = 5;

/**
 * The folder's latest sessions, as /resume lists them (and with its guards:
 * one open in another pane can't be taken). A click resumes it in this chat.
 * Its search, top right, finds an older one at each letter typed (the
 * user's ask of 01/11/2026).
 */
export function ChatWelcome({
  actions,
  onToast,
}: {
  actions: SlashActions;
  onToast?: ToastFn;
}) {
  // The list, and when it came: « hier 14:32 » reads from then.
  const [loaded, setLoaded] = useState<{
    sessions: SessionChoice[];
    at: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [resuming, setResuming] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    actions.sessions().then(
      (sessions) => alive && setLoaded({ sessions, at: Date.now() }),
      // No list (a folder never used): the welcome stays empty.
      () => alive && setLoaded({ sessions: [], at: Date.now() }),
    );
    return () => {
      alive = false;
    };
  }, [actions]);

  if (!loaded || loaded.sessions.length === 0) return null;
  // No branch here: the user always works on main (01/11/2026).
  const rows = sessionRows(loaded.sessions, query, null, loaded.at, {
    branch: false,
  }).slice(0, WELCOME_SESSIONS);
  const resume = (row: PickerRow) => {
    if (row.disabled || resuming) return;
    setResuming(row.id);
    actions
      .resume(row.id)
      .then(
        (why) => {
          if (why) onToast?.("info", why);
        },
        (e: unknown) => onToast?.("error", String(e)),
      )
      .finally(() => setResuming(null));
  };
  return (
    <div className="chat-welcome">
      <div className="hd">
        <History /> Reprendre une conversation de ce dossier
        <label className="search">
          <Search />
          <input
            value={query}
            placeholder="Rechercher"
            aria-label="Rechercher une conversation"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc empties the search first, never Claude's turn.
              if (e.key === "Escape" && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
        </label>
      </div>
      {rows.length === 0 && (
        <div className="none">Aucune conversation ne correspond</div>
      )}
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="row"
          disabled={!!row.disabled || resuming !== null}
          title={row.disabled ? undefined : "Reprendre dans ce chat"}
          onClick={() => resume(row)}
        >
          <span className="t">{row.title}</span>
          <span className="m">
            {resuming === row.id ? "Reprise…" : (row.disabled ?? row.meta)}
          </span>
        </button>
      ))}
    </div>
  );
}
