import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { shellCommands } from "@/lib/chat/chatAgentView";
import type { ChatState } from "@/lib/chat/chatState";
import { runningShells } from "@/lib/chat/chatTasks";
import { ShellsSheet } from "~/chat/background/shells-sheet";
import { T } from "~/chat/chat-theme";
import type { ChatActions } from "~/chat/use-chat";
import { tap } from "~/ui/haptics";

/** The desktop's cyan (`.chat-chip.shells`). */
const CYAN = "#67e8f9";

/**
 * The background commands, a cyan « N shells » chip in the input's bottom
 * row, as the desktop's (the user's pick A of 02/11/2026): a tap opens
 * their sheet. Nothing while none runs.
 */
export function ShellsChip({
  chatId,
  state,
  actions,
}: {
  chatId: string;
  state: Pick<ChatState, "shells" | "items" | "agentMessages">;
  actions: ChatActions;
}) {
  const [open, setOpen] = useState(false);
  const shells = useMemo(() => runningShells(state.shells), [state.shells]);
  const commands = useMemo(
    () => shellCommands(shells, state.items, state.agentMessages),
    [shells, state.items, state.agentMessages],
  );
  // The last one ended: its sheet goes, as the desktop's list.
  useEffect(() => {
    if (shells.length === 0) setOpen(false);
  }, [shells.length]);

  if (shells.length === 0) return null;
  const n = shells.length;
  return (
    <>
      <Pressable
        style={styles.chip}
        onPress={() => {
          tap();
          setOpen(true);
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Commandes en arrière-plan"
      >
        <SymbolView name="apple.terminal" size={11} tintColor={CYAN} />
        <Text style={styles.text}>
          {n} shell{n > 1 ? "s" : ""}
        </Text>
      </Pressable>
      <ShellsSheet
        chatId={chatId}
        shells={shells}
        commands={commands}
        visible={open}
        onOutput={actions.taskOutput}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(103,232,249,0.3)",
    backgroundColor: "rgba(34,211,238,0.08)",
    borderRadius: 8,
    paddingHorizontal: 7,
    height: 26,
  },
  text: { color: CYAN, fontSize: T.tiny, fontWeight: "600" },
});
