import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { elapsedLabel } from "@/lib/chat/chatLabels";
import { outputTail, type BackgroundShell } from "@/lib/chat/chatTasks";
import { useShellOutputs } from "~/chat/background/shell-outputs";
import { C, MONO, T } from "~/chat/chat-theme";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { useChatReadable } from "~/chat/use-chat";
import { useChatShown } from "~/chat/use-chat-shown";

/** While the sheet is open, each shell's output is asked again this often. */
const OUTPUT_POLL_MS = 1_000;

/**
 * The background commands, as the desktop's list (`chat-shells-chip.tsx`):
 * command, running time, what it is for, and the last lines it wrote, read
 * again every second while the sheet is open, the chat in sight and
 * running (`useChatReadable`). No stop button: Claude stops its own
 * commands.
 */
export function ShellsSheet({
  chatId,
  shells,
  commands,
  visible,
  onOutput,
  onClose,
}: {
  chatId: string;
  /** Running in the background (`runningShells`). */
  shells: BackgroundShell[];
  /** Each shell's command line, by task id, when its Bash call is known. */
  commands: Record<string, string>;
  visible: boolean;
  onOutput: (taskId: string) => void;
  onClose: () => void;
}) {
  const outputs = useShellOutputs(chatId);
  const [now, setNow] = useState(() => Date.now());
  const shown = useChatShown(chatId);
  // Never asked of a chat ended, asleep or whose server stopped: Rust would
  // start its server again for each ask.
  const readable = useChatReadable(chatId);
  const ids = shells.map((s) => s.taskId).join(" ");
  // Asked at once, then every second, with the clock; never closed or away.
  useEffect(() => {
    if (!visible || !shown || !ids) return;
    const ask = () => {
      setNow(Date.now());
      if (readable) for (const id of ids.split(" ")) onOutput(id);
    };
    ask();
    const timer = setInterval(ask, OUTPUT_POLL_MS);
    return () => clearInterval(timer);
  }, [visible, shown, readable, ids, onOutput]);

  const n = shells.length;
  return (
    <FeedSheet
      visible={visible}
      title={`${n} shell${n > 1 ? "s" : ""} en arrière-plan`}
      icon="apple.terminal"
      onClose={onClose}
    >
      {shells.map((s) => {
        const out = outputs[s.taskId];
        const tail = out ? outputTail(out.output) : "";
        const command = commands[s.taskId];
        return (
          <View key={s.taskId} style={styles.shell}>
            <View style={styles.head}>
              <Text style={styles.cmd} numberOfLines={3} selectable>
                {command ?? s.description}
              </Text>
              <Text style={styles.dur}>{elapsedLabel(now - s.startedAt)}</Text>
            </View>
            {command && s.description ? (
              <Text style={styles.what}>{s.description}</Text>
            ) : null}
            <Text
              style={[styles.out, !tail && styles.empty]}
              selectable={!!tail}
            >
              {out?.error
                ? "Sortie illisible"
                : !out
                  ? "Lecture de la sortie…"
                  : tail || "Rien d’écrit pour l’instant"}
            </Text>
          </View>
        );
      })}
    </FeedSheet>
  );
}

const styles = StyleSheet.create({
  shell: { gap: 5 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cmd: { flex: 1, color: "#a5f3fc", fontFamily: MONO, fontSize: 12.5 },
  dur: {
    color: C.mute,
    fontSize: T.small - 1,
    fontVariant: ["tabular-nums"],
  },
  what: { color: C.mute, fontSize: T.small - 1 },
  out: {
    color: C.dim,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontFamily: MONO,
    fontSize: 11.5,
    lineHeight: 17,
  },
  empty: { color: C.mute, fontStyle: "italic" },
});
