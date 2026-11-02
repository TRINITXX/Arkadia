import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { toolRunning, toolSummary, type ToolItem } from "@/lib/chat/chatGroups";
import type { Subagent } from "@/lib/chat/chatState";
import { C, T } from "~/chat/chat-theme";

const STATUS: Record<Subagent["status"], string> = {
  running: "en cours",
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
  // Still running when its session's Claude Code stopped.
  interrupted: "interrompu",
};

/**
 * A subagent Claude started (`chat-agent-row.tsx`): one line, its
 * conversation a tap away. One not known (an older page, before its
 * `task_started`) has no conversation to open: its line takes no tap.
 */
export function AgentRow({
  tool,
  agent,
  onOpen,
}: {
  tool: ToolItem;
  agent: Subagent | undefined;
  onOpen?: (agent: Subagent) => void;
}) {
  const running = agent ? agent.status === "running" : toolRunning(tool);
  const status = agent ? STATUS[agent.status] : running ? "en cours" : "fini";
  const open = agent && onOpen ? () => onOpen(agent) : undefined;
  return (
    <Pressable
      onPress={open}
      disabled={!open}
      accessibilityRole={open ? "button" : undefined}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
    >
      <SymbolView name="person.2" size={13} tintColor={C.dim} />
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.bold}>Sous-agent</Text>
        {` · ${toolSummary(tool)} · ${status}`}
        {agent && agent.toolUses > 0 ? ` · ${agent.toolUses} outils` : ""}
      </Text>
      {open && <SymbolView name="chevron.right" size={11} tintColor={C.mute} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  pressed: { backgroundColor: C.raised },
  text: { flex: 1, color: C.mute, fontSize: T.small },
  bold: { color: C.dim, fontWeight: "500" },
});
