import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { SlashEntry } from "@/lib/chat/chatSlash";
import type { PhoneSlashRow } from "@/lib/chat/phoneSlash";
import { C, T } from "~/chat/chat-theme";

/**
 * The `/` menu above the composer (`chat-slash-menu.tsx`): the desktop's
 * list by section, the page's /resume, /rewind and /mcp included, filtered
 * as the name grows; or, in its place, a notice (a terminal-only command).
 */
export function SlashMenu({
  rows,
  hint,
  onPick,
}: {
  rows: PhoneSlashRow[];
  hint: string | null;
  onPick: (entry: SlashEntry) => void;
}) {
  if (hint)
    return (
      <View style={styles.box}>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    );
  if (rows.length === 0) return null;
  return (
    <FlatList
      style={styles.box}
      data={rows}
      // Claude Code's rows can share a name (a built-in and a skill).
      keyExtractor={(r, i) => `${r.entry.group}:${r.entry.command.name}:${i}`}
      keyboardShouldPersistTaps="always"
      initialNumToRender={8}
      indicatorStyle="white"
      renderItem={({ item: { entry, head } }) => (
        <View>
          {head ? <Text style={styles.head}>{head}</Text> : null}
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => onPick(entry)}
          >
            <Text style={styles.name} numberOfLines={1}>
              /{entry.command.name}
              {entry.command.argumentHint ? (
                <Text style={styles.args}> {entry.command.argumentHint}</Text>
              ) : null}
            </Text>
            {entry.command.description ? (
              <Text style={styles.desc} numberOfLines={1}>
                {entry.command.description}
              </Text>
            ) : null}
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  box: {
    maxHeight: 240,
    backgroundColor: C.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
  },
  head: {
    color: C.mute,
    fontSize: T.tiny,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  pressed: { backgroundColor: C.card },
  name: { color: C.ink, fontSize: T.small, fontWeight: "600" },
  args: { color: C.mute, fontWeight: "400" },
  desc: { color: C.mute, fontSize: T.tiny, marginTop: 1 },
  hint: {
    color: C.dim,
    fontSize: T.small,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
