import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { ConvBlock } from "@/lib/convStore";
import { parseToolInput, toolStat } from "@/lib/toolCard";
import type { ToolDensity } from "@/types";
import { ConvImages } from "~/messages/conv-images";
import { ToolInput } from "~/messages/tool-input";
import { toolIcon, toolSummary } from "~/messages/tool-summary";
import { tick } from "~/ui/haptics";

/** Shown of a tool's output once opened: the rest is on the PC. */
const OUTPUT_MAX = 4000;

/**
 * A tool call as the desktop's reading view draws it (`ToolCard`): one line
 * with what it worked on and an edit's +/- count; open, its input laid out
 * and, « Résultats » shown, its output. The desktop's density: « Déplié »
 * keeps every card open, « Compact » and « Aperçu » fold them to a tap.
 */
export const ToolRow = memo(function ToolRow({
  block,
  density,
  showResults,
}: {
  block: ConvBlock;
  density: ToolDensity;
  showResults: boolean;
}) {
  const full = density === "full";
  const [open, setOpen] = useState(full);
  const expanded = full || open;
  const name = block.tool_name ?? "tool";
  const input = useMemo(
    () => parseToolInput(block.tool_input),
    [block.tool_input],
  );
  const stat = toolStat(name, input);
  const output = showResults ? (block.tool_output ?? "") : "";
  const images = showResults ? block.tool_output_images : undefined;
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => {
          tick();
          setOpen(!open);
        }}
        disabled={full}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <SymbolView name={toolIcon(name)} size={13} tintColor="#84c452" />
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.summary} numberOfLines={1}>
          {toolSummary(block.tool_input)}
        </Text>
        {stat ? <Text style={styles.stat}>{stat}</Text> : null}
        {!full && (
          <SymbolView
            name={open ? "chevron.up" : "chevron.down"}
            size={11}
            tintColor="#5a5a5e"
          />
        )}
      </Pressable>
      {expanded && (
        <>
          <ToolInput name={name} input={input} />
          {output || images?.length ? (
            <View style={styles.output}>
              <Text style={styles.label}>résultat</Text>
              {output ? (
                <Text style={styles.mono} selectable>
                  {output.length > OUTPUT_MAX
                    ? `${output.slice(0, OUTPUT_MAX)}…`
                    : output}
                </Text>
              ) : null}
              <ConvImages images={images} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    backgroundColor: "#141416",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pressed: { backgroundColor: "#1c1c1e" },
  name: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  summary: { flex: 1, color: "#8e8e93", fontSize: 13 },
  stat: { color: "#8a9099", fontSize: 11 },
  output: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  label: { color: "#5a5a5e", fontSize: 11 },
  mono: { fontFamily: "Menlo", fontSize: 11.5, color: "#8e8e93" },
});
