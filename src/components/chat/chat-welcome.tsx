import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { sessionRows, type PickerRow } from "@/lib/chat/chatSlash";
import type { SlashActions } from "@/lib/chat/useSlashActions";

/** How many of the folder's sessions a new chat offers. */
const WELCOME_SESSIONS = 5;

/**
 * The folder's latest sessions, as /resume lists them (and with its guards:
 * one open in another pane can't be taken). A click resumes it in this chat.
 */
export function ChatWelcome({
  actions,
  onToast,
}: {
  actions: SlashActions;
  onToast?: ToastFn;
}) {
  const [rows, setRows] = useState<PickerRow[] | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    actions.sessions().then(
      (sessions) => {
        if (!alive) return;
        setRows(
          sessionRows(sessions, "", null, Date.now()).slice(
            0,
            WELCOME_SESSIONS,
          ),
        );
      },
      // No list (a folder never used): the welcome stays empty.
      () => alive && setRows([]),
    );
    return () => {
      alive = false;
    };
  }, [actions]);

  if (!rows || rows.length === 0) return null;
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
      </div>
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
