import { useState, type ReactNode, type Ref } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from "react-native";
import { A } from "~/chat/asks/ask-colors";
import { AskMic } from "~/chat/asks/ask-mic";
import type { AskDictation } from "~/chat/asks/use-ask-dictation";
import { C, T } from "~/chat/chat-theme";

/** Where its mic writes: the panel's dictation, the field's id, its words. */
export interface FieldDictation {
  dictation: AskDictation;
  id: string;
  onText: (text: string) => void;
}

/**
 * A panel's own-words field (`.chat-ask-other`): sunk, brown-edged while it
 * has the keyboard, the mic on its left when it takes dictation, `trailing`
 * on its right (the sheet's send).
 */
export function AskField({
  mic,
  trailing,
  style,
  onFocus,
  onBlur,
  ref,
  ...input
}: TextInputProps & {
  mic?: FieldDictation;
  trailing?: ReactNode;
  ref?: Ref<TextInputInstance>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.row}>
      {mic && (
        <AskMic dictation={mic.dictation} id={mic.id} onText={mic.onText} />
      )}
      <TextInput
        ref={ref}
        placeholderTextColor="#6b6f76"
        selectionColor={C.accent}
        keyboardAppearance="dark"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, focused && styles.focused, style]}
        {...input}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: 10,
    backgroundColor: C.card,
    color: C.ink,
    fontSize: T.body,
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 9,
  },
  focused: { borderColor: A.askLine },
});
