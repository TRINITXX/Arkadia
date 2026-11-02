import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { toolLabel, type ToolItem } from "@/lib/chat/chatGroups";
import { readImagePath } from "@/lib/chat/chatImages";
import { toolStep } from "@/lib/chat/chatSteps";
import { shellMarks } from "@/lib/chat/chatToolResult";
import { C, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";
import { ImageThumb } from "~/chat/feed/image-thumb";
import { ToolOutput } from "~/chat/feed/tool-output";
import { toolIcon } from "~/messages/tool-summary";

/**
 * One tool call of Claude's work (`chat-tool-row.tsx`): its name and what it
 * does in words, a command's marks (code, cut, in the background), a red
 * mark on an error; a tap opens what it was given and what it got back. An
 * image read: its thumbnail stands for its path (`ChatReadThumbs`).
 */
export const ToolDetailRow = memo(function ToolDetailRow({
  tool,
}: {
  tool: ToolItem;
}) {
  const [open, setOpen] = useState(false);
  const image = readImagePath(tool);
  const step = image ? "lit" : toolStep(tool.name, tool.input, null);
  const shell = tool.result?.detail?.shell;
  const marks = shell ? shellMarks(shell) : [];
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <SymbolView name={toolIcon(tool.name)} size={12} tintColor={C.mute} />
        <Text
          style={[styles.line, image !== null && styles.short]}
          numberOfLines={open ? undefined : 1}
        >
          <Text style={styles.name}>{toolLabel(tool.name)}</Text>
          {`  ${step}`}
          {marks.map((m) => (
            <Text key={m} style={styles.mark}>
              {`  ${m}`}
            </Text>
          ))}
        </Text>
        {image !== null && <ImageThumb path={image} small />}
        {tool.result?.isError && (
          <SymbolView
            name="exclamationmark.circle"
            size={12}
            tintColor={F.delCount}
          />
        )}
      </Pressable>
      {open && <ToolOutput tool={tool} />}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  pressed: { backgroundColor: C.raised },
  line: { flex: 1, color: C.mute, fontSize: T.small },
  // « lit » then its thumbnail, not pushed to the row's end.
  short: { flex: 0, flexShrink: 1 },
  name: { color: C.dim, fontWeight: "500" },
  mark: { color: F.warn, fontSize: T.tiny },
});
