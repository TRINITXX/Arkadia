import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { workSummary, type ToolItem } from "@/lib/chat/chatGroups";
import { C, T } from "~/chat/chat-theme";
import { ToolDetailRow } from "~/chat/feed/tool-detail-row";

/**
 * A run of tool calls unfolded (`chat-work-group.tsx`): its counts, then one
 * line per call, each opening its input and output.
 */
export const WorkGroup = memo(function WorkGroup({
  tools,
}: {
  tools: ToolItem[];
}) {
  const failed = tools.filter((t) => t.result?.isError).length;
  return (
    <View style={styles.group}>
      <Text style={styles.summary}>
        <Text style={styles.bold}>{workSummary(tools)}</Text>
        {failed > 0 ? ` · ${failed} en erreur` : ""}
      </Text>
      <View style={styles.tools}>
        {tools.map((tool) => (
          <ToolDetailRow key={tool.id} tool={tool} />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  group: { gap: 4 },
  summary: { color: C.mute, fontSize: T.small },
  bold: { color: C.dim, fontWeight: "500" },
  tools: {
    marginLeft: 6,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: C.line,
  },
});
