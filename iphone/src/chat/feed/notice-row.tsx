import { StyleSheet, Text, View } from "react-native";
import type { ChatItem } from "@/lib/chat/chatState";
import { C } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

type NoticeItem = Extract<ChatItem, { kind: "notice" }>;

const INK = { info: C.mute, warning: F.warn, error: F.bad } as const;
const LINE = { info: C.line, warning: F.warnLine, error: F.badLine } as const;

/**
 * A line of Claude Code's or the chat's own (`chat-notice-row.tsx`): a short
 * pill, or a quiet block when Claude Code's words come with it (a hook's
 * reason, why an action was refused, an error's text).
 */
export function NoticeRow({ item }: { item: NoticeItem }) {
  if (!item.detail)
    return (
      <View style={[styles.pill, { borderColor: LINE[item.tone] }]}>
        <Text style={[styles.pillText, { color: INK[item.tone] }]}>
          {item.text}
        </Text>
      </View>
    );
  return (
    <View style={[styles.block, { borderColor: LINE[item.tone] }]}>
      <Text
        style={[
          styles.text,
          item.tone !== "info" && { color: INK[item.tone] },
        ]}
      >
        {item.text}
      </Text>
      <Text style={styles.detail} numberOfLines={8} selectable>
        {item.detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "center",
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  pillText: { fontSize: 12, textAlign: "center" },
  block: {
    alignSelf: "center",
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: F.noticeBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 3,
  },
  text: { color: F.head, fontSize: 12 },
  detail: { color: C.mute, fontSize: 12 },
});
