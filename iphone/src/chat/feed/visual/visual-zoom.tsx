import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, T } from "~/chat/chat-theme";
import { VisualPage } from "~/chat/feed/visual/visual-page";

interface VisualZoomProps {
  visible: boolean;
  html: string;
  title: string;
  onClose: () => void;
  onChoose: (text: string) => void;
}

/**
 * « Agrandir »: the visual over the whole screen, its page as written,
 * scrolling and pinch-zooming in place. A choice closes it (the desktop's
 * does): the user sees it land in the input. The page exists only while
 * open.
 */
export function VisualZoom({
  visible,
  html,
  title,
  onClose,
  onChoose,
}: VisualZoomProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.root,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.head}>
          <SymbolView name="square.on.circle" size={15} tintColor={C.accent} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          >
            <SymbolView name="xmark" size={12} tintColor={C.dim} />
            <Text style={styles.btnText}>Fermer</Text>
          </Pressable>
        </View>
        <VisualPage
          html={html}
          fill
          onChoose={(text) => {
            onChoose(text);
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
    paddingLeft: 14,
    paddingRight: 8,
    backgroundColor: C.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.lineStrong,
  },
  title: { flex: 1, color: C.ink, fontSize: T.body, fontWeight: "600" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  pressed: { backgroundColor: C.raised },
  btnText: { color: C.dim, fontSize: T.small },
});
