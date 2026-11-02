import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { McpRow } from "@/lib/chat/chatSlash";
import type { McpRowView } from "@/lib/chat/phoneSlash";
import { C, T } from "~/chat/chat-theme";

/** The dot of a server's state, as the desktop's `chat-mcp-row`. */
const DOT: Record<string, string> = {
  connected: C.ok,
  failed: C.bad,
  "needs-auth": C.warn,
  pending: C.info,
  disabled: C.mute,
};

/**
 * A /mcp server (the user's pick A of 01/11/2026): its section's title on
 * its first row, a dot of its state, its name and where it is set;
 * « Se connecter » or « Reconnecter », a switch on a server connected or
 * cut off; while its action runs, a line says so, and why it failed below.
 */
export function McpServerRow({
  row,
  view,
  onAct,
  onToggle,
}: {
  row: McpRow;
  view: McpRowView;
  /** Its main action (the desktop's click, Enter). */
  onAct: () => void;
  /** Its switch (the desktop's Ctrl+Entrée). */
  onToggle: () => void;
}) {
  return (
    <View>
      {row.head ? <Text style={styles.head}>{row.head}</Text> : null}
      <Pressable
        onPress={onAct}
        disabled={!row.action}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: DOT[row.status] ?? C.mute },
            !!view.busy && styles.wait,
          ]}
        />
        <View style={styles.main}>
          <Text style={styles.title} numberOfLines={1}>
            {row.title}
          </Text>
          {row.source ? <Text style={styles.source}>{row.source}</Text> : null}
        </View>
        {view.busy ? (
          <Text style={styles.note}>{view.busy}</Text>
        ) : (
          <>
            {view.note ? <Text style={styles.note}>{view.note}</Text> : null}
            {view.button ? (
              <Pressable
                onPress={onAct}
                hitSlop={6}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonText}>{view.button}</Text>
              </Pressable>
            ) : null}
            {view.switchOn !== null ? (
              <Switch
                value={view.switchOn}
                onValueChange={onToggle}
                trackColor={{ true: C.accent, false: C.lineStrong }}
                ios_backgroundColor={C.lineStrong}
                accessibilityLabel={
                  view.switchOn ? "Couper ce serveur" : "Rallumer ce serveur"
                }
              />
            ) : null}
          </>
        )}
      </Pressable>
      {view.error ? <Text style={styles.error}>{view.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    color: C.mute,
    fontSize: T.tiny,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  pressed: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  wait: { opacity: 0.4 },
  main: { flex: 1, gap: 1 },
  title: { color: C.ink, fontSize: T.body },
  source: { color: C.mute, fontSize: T.tiny },
  note: { color: C.dim, fontSize: T.small },
  button: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: C.accent,
  },
  buttonText: { color: C.accentInk, fontSize: T.small, fontWeight: "600" },
  error: {
    color: C.bad,
    fontSize: T.tiny,
    paddingHorizontal: 34,
    paddingTop: 4,
    paddingBottom: 8,
  },
});
