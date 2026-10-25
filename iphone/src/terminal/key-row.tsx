import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import type { RemoteButton } from "@/lib/remoteSnapshot";
import { sfIcon } from "~/ui/sf-icon";

/**
 * Visible keys (layout 3 chosen on 25/10/2026), then Dictation in blue
 * (choice C of the V1): the rest is in the + menu.
 */
const KEYS: { label: string; data: string }[] = [
  { label: "Échap", data: "\x1b" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "Entrée", data: "\r" },
];

/** In the + menu, after Claude's buttons. */
const MORE_KEYS: {
  id: string;
  label: string;
  icon: MenuAction["image"];
  data: string | "paste";
}[] = [
  { id: "key:tab", label: "Tab", icon: "arrow.right.to.line", data: "\t" },
  { id: "key:paste", label: "Coller", icon: "doc.on.clipboard", data: "paste" },
  { id: "key:ctrlc", label: "Ctrl+C", icon: "xmark.octagon", data: "\x03" },
];

function buttonActions(buttons: RemoteButton[]): MenuAction[] {
  return buttons.map((b) => ({
    id: `button:${b.id}`,
    title: b.label,
    image: sfIcon(b.icon),
    subactions:
      b.kind === "folder" ? buttonActions(b.children ?? []) : undefined,
  }));
}

const CLEAR_ID = "message:clear";
const FILES_ID = "message:files";
const CODE_ID = "message:code";

interface KeyRowProps {
  /** Claude's prompt buttons, null on a pane that does not run Claude. */
  promptButtons: RemoteButton[] | null;
  keyboardOpen: boolean;
  dictating: boolean;
  onKey: (data: string) => void;
  onPaste: () => void;
  onPromptButton: (buttonId: string) => void;
  onToggleKeyboard: () => void;
  onDictation: () => void;
  onClearPrompt: () => void;
  onPickFiles: () => void;
  onCopyCode: () => void;
}

/** Memoized: the screen around it re-renders with every desktop change. */
export const KeyRow = memo(function KeyRow({
  promptButtons,
  keyboardOpen,
  dictating,
  onKey,
  onPaste,
  onPromptButton,
  onToggleKeyboard,
  onDictation,
  onClearPrompt,
  onPickFiles,
  onCopyCode,
}: KeyRowProps) {
  const tap = (run: () => void) => () => {
    void Haptics.selectionAsync();
    run();
  };
  const actions = useMemo<MenuAction[]>(
    () => [
      ...(promptButtons
        ? [
            {
              id: "claude",
              title: "Claude",
              displayInline: true,
              subactions: buttonActions(promptButtons),
            },
          ]
        : []),
      {
        id: "message",
        title: "Message",
        displayInline: true,
        subactions: [
          {
            id: FILES_ID,
            title: "Photos et fichiers du PC",
            image: "photo.on.rectangle",
          },
          {
            id: CODE_ID,
            title: "Copier le dernier bloc de code",
            image: "doc.on.doc",
          },
          { id: CLEAR_ID, title: "Effacer le message", image: "eraser" },
        ],
      },
      {
        id: "keys",
        title: "Touches",
        displayInline: true,
        subactions: MORE_KEYS.map((k) => ({
          id: k.id,
          title: k.label,
          image: k.icon,
        })),
      },
    ],
    [promptButtons],
  );
  const onMenu = (id: string) => {
    void Haptics.selectionAsync();
    if (id.startsWith("button:"))
      return onPromptButton(id.slice("button:".length));
    if (id === CLEAR_ID) return onClearPrompt();
    if (id === FILES_ID) return onPickFiles();
    if (id === CODE_ID) return onCopyCode();
    const key = MORE_KEYS.find((k) => k.id === id);
    if (!key) return;
    if (key.data === "paste") onPaste();
    else onKey(key.data);
  };

  return (
    <View style={styles.row}>
      {KEYS.map((k) => (
        <Pressable
          key={k.label}
          onPress={tap(() => onKey(k.data))}
          style={({ pressed }) => [styles.key, pressed && styles.pressed]}
        >
          <Text style={styles.label}>{k.label}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel={dictating ? "Arrêter la dictée" : "Dictée"}
        onPress={tap(onDictation)}
        style={({ pressed }) => [
          styles.key,
          styles.icon,
          dictating ? styles.listening : styles.mic,
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={dictating ? "stop.fill" : "mic.fill"}
          size={18}
          tintColor="#ffffff"
        />
      </Pressable>
      <MenuView
        actions={actions}
        onPressAction={({ nativeEvent }) => onMenu(nativeEvent.event)}
      >
        {/* Drawn only: the touch goes through to the menu. */}
        <View pointerEvents="none" style={[styles.key, styles.icon]}>
          <SymbolView name="plus" size={18} tintColor="#ffffff" />
        </View>
      </MenuView>
      <Pressable
        accessibilityLabel={
          keyboardOpen ? "Fermer le clavier" : "Ouvrir le clavier"
        }
        onPress={tap(onToggleKeyboard)}
        style={({ pressed }) => [
          styles.key,
          styles.icon,
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={keyboardOpen ? "keyboard.chevron.compact.down" : "keyboard"}
          size={19}
          tintColor="#ffffff"
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, paddingHorizontal: 6, paddingTop: 8 },
  key: {
    flex: 1,
    height: 42,
    borderRadius: 9,
    backgroundColor: "#3a3a3c",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { flex: 0, width: 46 },
  mic: { backgroundColor: "#0a84ff" },
  listening: { backgroundColor: "#ff453a" },
  pressed: { backgroundColor: "#636366" },
  label: { color: "#ffffff", fontSize: 14, fontWeight: "500" },
});
