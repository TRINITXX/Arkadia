import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { C, T } from "~/chat/chat-theme";
import { tap } from "~/ui/haptics";

/**
 * A row's whole content over the feed, as an iOS page sheet: a swipe down or
 * « Fermer » closes it. A sheet opened from inside another is rendered in
 * its content: iOS stacks it, never two sheets from the same screen.
 */
export function FeedSheet({
  visible,
  title,
  icon,
  onClose,
  scroll = true,
  children,
}: {
  visible: boolean;
  title: string;
  icon?: SFSymbol;
  onClose: () => void;
  /** Off: the content scrolls itself (a conversation's list). */
  scroll?: boolean;
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
          {icon && <SymbolView name={icon} size={15} tintColor={C.dim} />}
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
        {scroll ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.pad}
            indicatorStyle="white"
          >
            {children}
          </ScrollView>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  title: { flex: 1, color: C.ink, fontSize: 16, fontWeight: "600" },
  close: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  pressed: { opacity: 0.5 },
  closeText: { color: C.accent, fontSize: T.body, fontWeight: "500" },
  body: { flex: 1 },
  pad: { padding: 16, paddingBottom: 48, gap: 12 },
});
