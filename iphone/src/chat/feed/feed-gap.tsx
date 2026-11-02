import { StyleSheet, View } from "react-native";

/** The room between two rows of the feed (the column's 14 px). */
export function FeedGap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({ gap: { height: 14 } });
