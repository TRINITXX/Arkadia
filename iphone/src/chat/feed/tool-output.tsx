import { StyleSheet, Text, View } from "react-native";
import type { ToolItem } from "@/lib/chat/chatGroups";
import { C, MONO, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/** A tool's output is shown up to this, its tail cut: the rest is on the PC. */
const OUTPUT_CAP = 6000;
/** A tool's input, as sent, up to this. */
const INPUT_CAP = 1500;

const capped = (text: string, cap: number) =>
  text.length > cap ? `${text.slice(0, cap)}\n…` : text;

/**
 * What a call was given and got back, as the desktop's row unfolds it
 * (`chat-tool-row.tsx`, `chat-shell-output.tsx`): a command's line, else its
 * input; then its output, a command's errors apart, Claude Code's notes.
 */
export function ToolOutput({ tool }: { tool: ToolItem }) {
  const shell = tool.result?.detail?.shell;
  const text = tool.result?.text ?? "";
  const command =
    tool.name === "Bash" || tool.name === "PowerShell"
      ? String(tool.input.command ?? "")
      : "";
  const input = command
    ? `$ ${command}`
    : capped(JSON.stringify(tool.input, null, 2), INPUT_CAP);
  const empty = tool.result
    ? "(rien)"
    : tool.stale
      ? "(sans résultat)"
      : "En cours…";
  const streams =
    !!shell && (shell.stdout !== undefined || shell.stderr !== undefined);
  return (
    <View style={styles.out}>
      <Text style={styles.input} selectable>
        {input}
      </Text>
      {shell && streams ? (
        <>
          {shell.stdout ? (
            <Text style={styles.mono} selectable>
              {capped(shell.stdout, OUTPUT_CAP)}
            </Text>
          ) : !shell.stderr ? (
            <Text style={styles.mono}>
              {text ? capped(text, OUTPUT_CAP) : "(rien)"}
            </Text>
          ) : null}
          {shell.stderr ? (
            <View>
              <Text style={styles.label}>Erreurs</Text>
              <Text style={[styles.mono, styles.err]} selectable>
                {capped(shell.stderr, OUTPUT_CAP)}
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <Text
          style={[styles.mono, tool.result?.isError && styles.err]}
          selectable
        >
          {text ? capped(text, OUTPUT_CAP) : empty}
        </Text>
      )}
      {shell?.note ? <Text style={styles.note}>{shell.note}</Text> : null}
      {shell?.savedTo ? (
        <Text style={styles.note}>Sortie complète : {shell.savedTo}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  out: {
    marginLeft: 20,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    backgroundColor: C.card,
    padding: 10,
    gap: 8,
  },
  input: { color: F.head, fontFamily: MONO, fontSize: 11, lineHeight: 16 },
  mono: { color: C.dim, fontFamily: MONO, fontSize: 11, lineHeight: 16 },
  err: { color: F.bad },
  label: { color: F.bad, fontSize: T.tiny, fontWeight: "600", marginBottom: 2 },
  note: { color: C.mute, fontSize: T.tiny },
});
