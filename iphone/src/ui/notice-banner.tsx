import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNotice } from "~/ui/notice";

/** The notice of `showNotice`, under the Dynamic Island. */
export function NoticeBanner() {
  const notice = useNotice();
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <Text style={styles.text}>{notice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    zIndex: 200,
    alignSelf: "center",
    maxWidth: "90%",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(44,44,46,0.96)",
  },
  text: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
});
