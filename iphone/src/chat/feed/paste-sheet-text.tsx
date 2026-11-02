import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { copiedCodeMessage } from "@/lib/codeCopy";
import { C, T } from "~/chat/chat-theme";
import { success } from "~/ui/haptics";
import { showFailure, showNotice } from "~/ui/notice";

/** Shown past this, its head (as a `!` command's sheet); « Copier » takes it all. */
const SHOWN_CAP = 30_000;
/** How long the copy button holds its ✓ (a code block's). */
const COPIED_MS = 1200;

/**
 * A pasted text whole in its sheet, the desktop's hover (`chat-paste-chip`):
 * selectable, and « Copier le texte » as the app's other copies: the
 * success buzz, « Copié (n lignes) · … » (`copiedCodeMessage`), a ✓ for a
 * moment.
 */
export function PasteSheetText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    Clipboard.setStringAsync(text).then(
      () => {
        success();
        showNotice(copiedCodeMessage(text));
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      (e: unknown) => showFailure(`Copie impossible : ${String(e)}`),
    );
  };
  const cut = text.length > SHOWN_CAP;
  return (
    <View style={styles.stack}>
      <Pressable
        onPress={copy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
      >
        <SymbolView
          name={copied ? "checkmark" : "doc.on.doc"}
          size={13}
          tintColor={copied ? C.ok : C.accent}
        />
        <Text style={styles.copyText}>
          {copied ? "Copié" : "Copier le texte"}
        </Text>
      </Pressable>
      <Text style={styles.text} selectable>
        {cut ? `${text.slice(0, SHOWN_CAP)}…` : text}
      </Text>
      {cut && (
        <Text style={styles.note}>
          Coupé ici : « Copier le texte » prend tout.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  copy: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.raised,
  },
  pressed: { opacity: 0.6 },
  copyText: { color: C.ink, fontSize: T.small, fontWeight: "500" },
  // The desktop's hover: plain, its lines kept.
  text: { color: C.ink, fontSize: 14, lineHeight: 21 },
  note: { color: C.mute, fontSize: T.small },
});
