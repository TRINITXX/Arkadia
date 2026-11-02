import type { ReactNode, Ref } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from "react-native";
import { C } from "~/chat/chat-theme";

/**
 * A panel inside the asks' card: its head and its buttons stay in view, what
 * lies between scrolls once the card reaches its height (`useAsksMaxHeight`).
 * A tap on a button lands with the keyboard open (`handled`).
 */
export function AskFrame({
  head,
  children,
  footer,
  ref,
}: {
  head?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  ref?: Ref<ScrollViewInstance>;
}) {
  return (
    <View style={styles.frame}>
      {head}
      <ScrollView
        ref={ref}
        style={styles.body}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.bodyPad}
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flexShrink: 1 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyPad: { gap: 8 },
  footer: {
    flexShrink: 0,
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
});
