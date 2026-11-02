import { StyleSheet, Text, View } from "react-native";
import { multiEdits, trimmedEditDiff } from "@/lib/toolCard";
import { DiffRows } from "~/chat/feed/diff-rows";
import { MarkdownText } from "~/messages/markdown-text";

/** Shown of a written file, a command or a parameter: the rest is on the PC. */
const TEXT_MAX = 4000;

const capped = (text: string) =>
  text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === "string" ? v : "";
}

/**
 * A tool's input as the desktop's card unfolds it (`ToolInputView` of
 * `ToolCard.tsx`): an edit's changed lines, the content a Write puts down,
 * the command run, the plan, else its parameters one per line — never the
 * raw JSON. A file tool's path and pattern too, which the desktop leaves to
 * its header: the phone's header names only the file.
 */
export function ToolInput({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  switch (name) {
    case "Edit":
      return (
        <DiffRows
          diff={trimmedEditDiff(
            str(input, "old_string"),
            str(input, "new_string"),
          )}
        />
      );
    case "MultiEdit":
      return (
        <>
          {multiEdits(input).map((e, i) => (
            <DiffRows key={i} diff={trimmedEditDiff(e.oldText, e.newText)} />
          ))}
        </>
      );
    case "Write":
      return (
        <View style={styles.section}>
          <Text style={styles.code} selectable>
            {capped(str(input, "content"))}
          </Text>
        </View>
      );
    case "Bash":
      return (
        <View style={styles.section}>
          <Text style={styles.code} selectable>
            <Text style={styles.prompt}>$ </Text>
            {capped(str(input, "command"))}
          </Text>
        </View>
      );
    case "ExitPlanMode":
      return (
        <View style={styles.section}>
          <MarkdownText markdown={str(input, "plan")} size={14} />
        </View>
      );
    default: {
      const entries = Object.entries(input);
      if (entries.length === 0) return null;
      return (
        <View style={[styles.section, styles.params]}>
          {entries.map(([key, value]) => (
            <View key={key} style={styles.param}>
              <Text style={[styles.code, styles.key]}>{key}</Text>
              <Text style={[styles.code, styles.value]} selectable>
                {capped(
                  typeof value === "string" ? value : JSON.stringify(value),
                )}
              </Text>
            </View>
          ))}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  code: {
    fontFamily: "Menlo",
    fontSize: 11.5,
    lineHeight: 17,
    color: "#c7c7cc",
  },
  prompt: { color: "#8e8e93" },
  params: { gap: 4 },
  param: { flexDirection: "row", gap: 10 },
  key: { color: "#7dd3fc" },
  value: { flex: 1 },
});
