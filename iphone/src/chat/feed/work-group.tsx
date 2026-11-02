import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { workSummary, type ToolItem } from "@/lib/chat/chatGroups";
import { workTail } from "@/lib/chat/chatSteps";
import { readImages } from "@/lib/chat/phoneImages";
import { C, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";
import { ReadThumbs } from "~/chat/feed/image-thumb";
import { ToolDetailRow } from "~/chat/feed/tool-detail-row";
import { tick } from "~/ui/haptics";

/**
 * A run of tool calls folded into one quiet line (`chat-work-group.tsx`):
 * « 2 fichiers lus, 1 commande · lance pnpm test », how many calls failed,
 * the images read, small. While it runs, the counts alone: the live line
 * above the input says the step. A tap opens one line per call, each
 * opening its input and output.
 */
export const WorkGroup = memo(function WorkGroup({
  tools,
  cwd,
}: {
  tools: ToolItem[];
  /** The chat's folder: files named from it. */
  cwd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { last, failed } = useMemo(() => workTail(tools, cwd), [tools, cwd]);
  const reads = useMemo(() => readImages(tools), [tools]);
  return (
    <View>
      <Pressable
        onPress={() => {
          tick();
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.line, pressed && styles.pressed]}
      >
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={10}
          tintColor={C.mute}
        />
        {/* One text: a long line cuts its last step first. */}
        <Text style={styles.summary} numberOfLines={1}>
          <Text style={styles.bold}>{workSummary(tools)}</Text>
          {failed > 0 ? ` · ${failed} en erreur` : ""}
          {last ? <Text style={styles.step}>{` · ${last}`}</Text> : null}
        </Text>
        <ReadThumbs paths={reads} />
      </Pressable>
      {open && (
        <View style={styles.tools}>
          {tools.map((tool) => (
            <ToolDetailRow key={tool.id} tool={tool} cwd={cwd} />
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 8,
    paddingVertical: 3,
    paddingLeft: 2,
    paddingRight: 6,
  },
  pressed: { backgroundColor: C.raised },
  summary: { flexShrink: 1, color: C.mute, fontSize: T.small },
  bold: { color: C.dim, fontWeight: "500" },
  step: { color: F.stepInk },
  tools: {
    marginTop: 4,
    marginLeft: 6,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: C.line,
  },
});
