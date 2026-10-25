import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { ConvBlock } from "@/lib/convStore";
import { ConvImages } from "~/messages/conv-images";
import { toolIcon, toolSummary } from "~/messages/tool-summary";

/** Shown of a tool's output once opened: the rest is on the PC. */
const OUTPUT_MAX = 4000;

/** A tool call, folded to one line; a tap opens its input and output. */
export function ToolRow({ block }: { block: ConvBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen(!open)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <SymbolView
          name={toolIcon(block.tool_name)}
          size={13}
          tintColor="#84c452"
        />
        <Text style={styles.name}>{block.tool_name}</Text>
        <Text style={styles.summary} numberOfLines={1}>
          {toolSummary(block.tool_input)}
        </Text>
        <SymbolView
          name={open ? "chevron.up" : "chevron.down"}
          size={11}
          tintColor="#5a5a5e"
        />
      </View>
      {open && (
        <View style={styles.body}>
          {block.tool_input ? (
            <ScrollView horizontal>
              <Text style={styles.mono} selectable>
                {block.tool_input}
              </Text>
            </ScrollView>
          ) : null}
          {block.tool_output ? (
            <Text style={[styles.mono, styles.output]} selectable>
              {block.tool_output.length > OUTPUT_MAX
                ? `${block.tool_output.slice(0, OUTPUT_MAX)}…`
                : block.tool_output}
            </Text>
          ) : null}
          <ConvImages images={block.tool_output_images} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    backgroundColor: "#141416",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pressed: { backgroundColor: "#1c1c1e" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  summary: { flex: 1, color: "#8e8e93", fontSize: 13 },
  body: { marginTop: 8, gap: 8 },
  mono: { fontFamily: "Menlo", fontSize: 11.5, color: "#c7c7cc" },
  output: { color: "#8e8e93" },
});
