import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type {
  ElicitField as Field,
  ElicitValues,
} from "@/lib/chat/chatElicitation";
import { A } from "~/chat/asks/ask-colors";
import { AskField } from "~/chat/asks/ask-field";
import { C, T } from "~/chat/chat-theme";
import { tick } from "~/ui/haptics";

/**
 * One field of an MCP server's form, as its schema says (the desktop's
 * `chat-elicit-field.tsx`): a switch, chips to pick, or a text field whose
 * keyboard fits (numbers, an e-mail, an address, a date typed out).
 */
export function ElicitField({
  field,
  value,
  onChange,
  onFocus,
  onSubmit,
  onLayout,
}: {
  field: Field;
  value: ElicitValues[string] | undefined;
  onChange: (value: ElicitValues[string]) => void;
  /** Its text field took the keyboard: the form brings it into view. */
  onFocus: () => void;
  /** Return in a text field sends, as Enter does on the desktop. */
  onSubmit: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const label = (
    <Text style={styles.label}>
      {field.label}
      {field.required && <Text style={styles.required}> *</Text>}
    </Text>
  );
  const hint = field.description ? (
    <Text style={styles.hint}>{field.description}</Text>
  ) : null;

  if (field.kind === "boolean")
    return (
      <View onLayout={onLayout} style={styles.field}>
        <View style={styles.check}>
          <View style={styles.checkText}>{label}</View>
          <Switch
            value={value === true}
            onValueChange={onChange}
            trackColor={{ true: C.accent, false: C.lineStrong }}
            ios_backgroundColor={C.lineStrong}
            accessibilityLabel={field.label}
          />
        </View>
        {hint}
      </View>
    );

  if (field.kind === "choice" || field.kind === "multi") {
    const picked = Array.isArray(value)
      ? value
      : typeof value === "string" && value
        ? [value]
        : [];
    return (
      <View onLayout={onLayout} style={styles.field}>
        {label}
        {hint}
        <View style={styles.chips}>
          {field.options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <Pressable
                key={o.value}
                accessibilityRole={
                  field.kind === "multi" ? "checkbox" : "radio"
                }
                accessibilityState={{ checked: on }}
                hitSlop={{ top: 4, bottom: 4 }}
                onPress={() => {
                  // The switch above gets none: iOS plays its own.
                  tick();
                  onChange(
                    field.kind === "multi"
                      ? on
                        ? picked.filter((v) => v !== o.value)
                        : [...picked, o.value]
                      : on
                        ? ""
                        : o.value,
                  );
                }}
                style={({ pressed }) => [
                  styles.chip,
                  on && styles.chipOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  const email = field.kind === "text" && field.format === "email";
  const uri = field.kind === "text" && field.format === "uri";
  const date = field.kind === "text" && field.format === "date";
  return (
    <View onLayout={onLayout} style={styles.field}>
      {label}
      {hint}
      <AskField
        value={typeof value === "string" ? value : ""}
        onChangeText={onChange}
        onFocus={onFocus}
        onSubmitEditing={onSubmit}
        returnKeyType="send"
        accessibilityLabel={field.label}
        keyboardType={
          field.kind === "number"
            ? "decimal-pad"
            : email
              ? "email-address"
              : uri
                ? "url"
                : date
                  ? "numbers-and-punctuation"
                  : "default"
        }
        autoCapitalize={email || uri ? "none" : "sentences"}
        autoCorrect={!(email || uri)}
        placeholder={date ? "AAAA-MM-JJ" : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { color: A.option, fontSize: T.small + 1 },
  required: { color: C.accent },
  hint: { color: C.mute, fontSize: T.small - 1 },
  check: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkText: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.raised,
  },
  chipOn: { backgroundColor: A.picked, borderColor: A.askLine },
  pressed: { opacity: 0.6 },
  chipText: { color: A.option, fontSize: T.small + 1 },
  chipTextOn: { color: A.strong },
});
