import type { ShellOutput } from "@/lib/chat/chatToolResult";

/** Each stream is shown up to this, its tail cut. */
const STREAM_CAP = 6000;

const capped = (text: string) =>
  text.length > STREAM_CAP ? `${text.slice(0, STREAM_CAP)}\n…` : text;

/**
 * A command's output opened under its row: what it printed, then its errors
 * apart (stderr), then Claude Code's notes. With neither stream (sent to the
 * background), Claude Code's own words about it.
 */
export function ChatShellOutput({
  command,
  shell,
  text,
}: {
  command: string;
  shell: ShellOutput;
  /** The result as Claude got it. */
  text: string;
}) {
  const stdout = shell.stdout ?? "";
  const stderr = shell.stderr ?? "";
  return (
    <div className="out">
      {command && `$ ${command}\n\n`}
      {stdout ? capped(stdout) : !stderr && (text ? capped(text) : "(rien)")}
      {stderr && (
        <div className="chat-stderr">
          <span className="lbl">Erreurs</span>
          {capped(stderr)}
        </div>
      )}
      {shell.note && <div className="chat-out-note">{shell.note}</div>}
      {shell.savedTo && (
        <div className="chat-out-note">Sortie complète : {shell.savedTo}</div>
      )}
    </div>
  );
}
