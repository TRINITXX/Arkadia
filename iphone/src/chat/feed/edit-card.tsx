import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { editDiff } from "@/lib/chat/chatDiff";
import type { ToolItem } from "@/lib/chat/chatGroups";
import { shortPath } from "@/lib/chat/chatSteps";
import { C, MONO } from "~/chat/chat-theme";
import { DiffRows } from "~/chat/feed/diff-rows";
import { F } from "~/chat/feed/feed-style";

/**
 * A file change (`chat-edit-card.tsx`): its path and +/- counts, its lines a
 * tap away. The real diff once the result is in (line numbers, context),
 * else what its input states.
 */
export const EditCard = memo(function EditCard({ tool }: { tool: ToolItem }) {
  const patch = tool.result?.detail?.patch;
  const diff = useMemo(
    () => editDiff(tool.name, tool.input, patch),
    [tool.name, tool.input, patch],
  );
  const [open, setOpen] = useState(false);
  // A Write over an existing file is a change, not a new file.
  const created = tool.name === "Write" && patch?.write !== "update";
  const path = String(tool.input.file_path ?? tool.input.notebook_path ?? "");
  const failed = tool.result?.isError;
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <SymbolView
          name={created ? "doc.badge.plus" : "square.and.pencil"}
          size={13}
          tintColor={F.head}
        />
        <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
          {shortPath(path, null)}
        </Text>
        {diff.added > 0 && <Text style={styles.add}>+{diff.added}</Text>}
        {diff.removed > 0 && <Text style={styles.del}>−{diff.removed}</Text>}
        {failed && (
          <SymbolView
            name="exclamationmark.circle"
            size={13}
            tintColor={F.delCount}
          />
        )}
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={11}
          tintColor={C.mute}
        />
      </Pressable>
      {open && (
        <DiffRows diff={diff} error={failed ? tool.result?.text : undefined} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.card,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  pressed: { backgroundColor: C.raised },
  path: { flex: 1, color: F.head, fontFamily: MONO, fontSize: 12 },
  add: { color: F.addCount, fontSize: 12.5 },
  del: { color: F.delCount, fontSize: 12.5 },
});
