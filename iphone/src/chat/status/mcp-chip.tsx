import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import type { McpServerInfo } from "@/lib/chat/chatProtocol";
import { mcpFailed } from "@/lib/chat/chatSdkSettings";
import { C, T } from "~/chat/chat-theme";
import { tap } from "~/ui/haptics";

/**
 * « N MCP en échec » in red, as the desktop's chip (`chat-mcp-chip.tsx`),
 * only while servers failed: a tap opens the /mcp sheet (`onOpen`).
 */
export function McpChip({
  servers,
  onOpen,
}: {
  servers: McpServerInfo[];
  onOpen: () => void;
}) {
  const failed = mcpFailed(servers).length;
  if (failed === 0) return null;
  return (
    <Pressable
      style={styles.chip}
      onPress={() => {
        tap();
        onOpen();
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${failed} serveur${failed > 1 ? "s" : ""} MCP en échec`}
    >
      <SymbolView name="powerplug" size={11} tintColor={C.bad} />
      <Text style={styles.text}>{failed} MCP en échec</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,69,58,0.35)",
    backgroundColor: "rgba(255,69,58,0.1)",
    borderRadius: 8,
    paddingHorizontal: 7,
    height: 26,
  },
  text: { color: C.bad, fontSize: T.tiny, fontWeight: "600" },
});
