import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { C, T } from "~/chat/chat-theme";
import { tap } from "~/ui/haptics";

/**
 * A page command's panel (/resume, /rewind, /mcp: the desktop's panel above
 * the input) as an iOS page sheet: its title, a field that filters its list
 * (the desktop's text typed after the command), the list. A swipe down or
 * « Fermer » closes it. `notice`: a line in the list's place (loading,
 * empty, why it failed).
 */
export function SlashSheet({
  visible,
  title,
  icon,
  query,
  onQuery,
  onClose,
  notice,
  children,
}: {
  visible: boolean;
  title: string;
  icon: SFSymbol;
  query: string;
  onQuery: (query: string) => void;
  onClose: () => void;
  notice: { text: string; error?: boolean } | null;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.head}>
          <SymbolView name={icon} size={15} tintColor={C.dim} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={() => {
              tap();
              onClose();
            }}
            hitSlop={10}
            accessibilityRole="button"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Fermer</Text>
          </Pressable>
        </View>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={14} tintColor={C.mute} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Taper pour filtrer"
            placeholderTextColor={C.mute}
            style={styles.field}
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            selectionColor={C.accent}
          />
        </View>
        {notice ? (
          <Text style={[styles.notice, notice.error && styles.error]}>
            {notice.text}
          </Text>
        ) : (
          <View style={styles.body}>{children}</View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: { flex: 1, color: C.ink, fontSize: 16, fontWeight: "600" },
  close: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  pressed: { opacity: 0.5 },
  closeText: { color: C.accent, fontSize: T.body, fontWeight: "500" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.raised,
  },
  field: { flex: 1, color: C.ink, fontSize: T.body, paddingVertical: 8 },
  notice: {
    color: C.mute,
    fontSize: T.small,
    textAlign: "center",
    padding: 24,
  },
  error: { color: C.bad },
  body: { flex: 1 },
});
