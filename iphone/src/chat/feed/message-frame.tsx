import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { messageTime } from "@/lib/messageTime";
import { C, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";
import { success } from "~/ui/haptics";

/** How long « Copié » stays in the frame's corner. */
const COPIED_MS = 1200;

/**
 * A message in the column's frames (`chat-message-frame.tsx`): the user's
 * green bubble on the right, Claude's violet frame (red-edged on an error),
 * another session's blue one under its sender's name. A long press copies
 * the message as written: the desktop's « Copier le message » on hover.
 * What the desktop's foot shows on hover stays in the frame's corner, small:
 * Claude's icons (« Récit »), the user's pencil, the time it was said.
 */
export function MessageFrame({
  role,
  text,
  label,
  error = false,
  cut = false,
  at,
  peeks,
  onEdit,
  editBlocked = false,
  writing = false,
  children,
}: {
  role: "user" | "claude" | "peer";
  /** What a long press copies: the markdown as written. */
  text: string;
  /** A peer's head (« Message de … »). */
  label?: string;
  error?: boolean;
  /** Claude's reply cut by an interrupt before its end. */
  cut?: boolean;
  /** When it was said (ms); no time when unknown. */
  at?: number;
  /** Claude's reply: the bulb of its thinking, the wrench of its tools. */
  peeks?: ReactNode;
  /** The user's message brought back to the input; absent: no pencil. */
  onEdit?: () => void;
  /** The pencil can't act now: dim, inert. */
  editBlocked?: boolean;
  /** A reply still being written: no foot yet (the desktop hides it). */
  writing?: boolean;
  children: ReactNode;
}) {
  const time =
    at === undefined ? null : messageTime(new Date(at).toISOString());
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    if (!text) return;
    void Clipboard.setStringAsync(text).then(() => {
      success();
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  return (
    <Pressable
      onLongPress={copy}
      delayLongPress={400}
      style={[styles.frame, styles[role], error && styles.error]}
    >
      {role === "peer" && (
        <View style={styles.head}>
          <SymbolView
            name="bubble.left.and.bubble.right"
            size={13}
            tintColor={F.peerInk}
          />
          <Text style={styles.headText} numberOfLines={1}>
            {label ?? "Message d'une autre session"}
          </Text>
        </View>
      )}
      {children}
      {cut && (
        <View style={styles.cutRow}>
          <Text style={styles.cut}>coupé</Text>
        </View>
      )}
      {!writing && (time || peeks || onEdit) && (
        <View style={styles.foot}>
          {peeks}
          {onEdit && (
            // Dim when blocked, still tappable: the edit says why not now.
            <Pressable
              onPress={onEdit}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Modifier ce message"
              accessibilityHint="La conversation revient juste avant"
              accessibilityState={{ disabled: editBlocked }}
              style={({ pressed }) => [
                styles.tool,
                pressed && styles.toolOn,
                editBlocked && styles.blocked,
              ]}
            >
              <SymbolView name="pencil" size={13} tintColor={F.footInk} />
            </Pressable>
          )}
          {time && <Text style={styles.time}>{time}</Text>}
        </View>
      )}
      {copied && (
        <View style={styles.copied} pointerEvents="none">
          <Text style={styles.copiedText}>Copié</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 6,
  },
  user: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    borderWidth: 0,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    backgroundColor: F.userBg,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  claude: { borderColor: F.claudeBorder, backgroundColor: F.claudeBg },
  peer: { borderColor: F.peerBorder, backgroundColor: F.peerBg },
  error: { borderColor: F.errorBorder },
  head: { flexDirection: "row", alignItems: "center", gap: 7 },
  headText: {
    flex: 1,
    color: F.peerInk,
    fontSize: T.small,
    fontWeight: "600",
  },
  cutRow: { flexDirection: "row", justifyContent: "flex-end" },
  cut: {
    fontSize: T.tiny,
    color: F.warn,
    borderWidth: 1,
    borderColor: "#4a3f2c",
    borderRadius: 999,
    paddingHorizontal: 7,
    overflow: "hidden",
  },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    marginTop: -2,
    marginBottom: -3,
    marginRight: -4,
  },
  tool: {
    width: 26,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  toolOn: { backgroundColor: "rgba(255,255,255,0.08)" },
  blocked: { opacity: 0.45 },
  time: {
    color: C.mute,
    fontSize: T.tiny,
    fontVariant: ["tabular-nums"],
    marginLeft: 4,
  },
  copied: {
    position: "absolute",
    right: 6,
    top: 6,
    backgroundColor: C.raised,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  copiedText: { color: C.ok, fontSize: T.tiny, fontWeight: "600" },
});
