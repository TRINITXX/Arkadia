import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ContextDetail } from "@/lib/chat/chatProtocol";
import {
  compactTokens,
  contextBreakdown,
  type ContextRow,
} from "@/lib/chat/chatSdkSettings";
import type { StatusRing } from "@/lib/chat/chatStatus";
import { C, T } from "~/chat/chat-theme";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { contextDetail } from "~/chat/status/context-detail";
import { HOT_INK, UsageRing } from "~/chat/status/usage-ring";
import { useChatReadable } from "~/chat/use-chat";

/** Memory files named under their row, the biggest first (desktop's). */
const MEMORY_SHOWN = 4;

/** The desktop's bars (`.chat-ctx-pop .bar`): used in accent, the rest grey. */
const BAR_TRACK = "#2f3238";
const BAR: Record<ContextRow["kind"], string> = {
  used: C.accent,
  buffer: "#6b6f76",
  free: "#3f444b",
};

/** « .claude/CLAUDE.md »: several memory files share a name. */
const shortPath = (p: string) => p.split(/[\\/]/).slice(-2).join("/");
const pct = (share: number) =>
  share > 0 && share < 0.01 ? "< 1 %" : `${Math.round(share * 100)} %`;

type Detail = {
  rows: ContextRow[];
  total: number;
  max: number;
  memory: ContextDetail["memoryFiles"];
};

/**
 * What fills the context window, as the desktop's ring shows on hover
 * (`chat-context-gauge.tsx`): tools, memory files, messages, the compaction
 * reserve, the free space. Asked when the sheet opens (the count costs a
 * second or two), kept 30 s. A chat asleep, ended or whose server stopped
 * asks nothing (`useChatReadable`): counting would wake it, or start its
 * server again.
 */
export function ContextSheet({
  chatId,
  visible,
  ring,
  asleep,
  closed,
  onClose,
}: {
  chatId: string;
  visible: boolean;
  ring: StatusRing;
  asleep: boolean;
  closed: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const quiet = closed
    ? "Conversation terminée : détail indisponible"
    : asleep
      ? "Claude en veille : détail indisponible"
      : null;
  // Its server stopped too: asked once it runs again.
  const readable = useChatReadable(chatId);
  useEffect(() => {
    if (!visible || !readable) return;
    // An answer for a sheet closed meanwhile, or another chat's, is dropped.
    let live = true;
    contextDetail(chatId).then(
      (d) => {
        if (!live) return;
        setError(null);
        setDetail({
          rows: contextBreakdown(d),
          total: d.totalTokens,
          max: d.rawMaxTokens,
          memory: [...d.memoryFiles]
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, MEMORY_SHOWN),
        });
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [visible, readable, chatId]);

  // A later count that failed keeps the last one in sight, as the desktop.
  const note = quiet
    ? { text: quiet, error: false }
    : detail
      ? null
      : error
        ? { text: `Détail indisponible : ${error}`, error: true }
        : { text: "Calcul…", error: false };
  return (
    <FeedSheet
      visible={visible}
      title="Contexte"
      icon="square.stack.3d.up"
      onClose={onClose}
    >
      <View style={styles.head}>
        <UsageRing percent={ring.percent} hot={ring.hot} backdrop={C.bg} />
        <Text style={[styles.used, ring.hot && styles.hot]}>
          {Math.round(ring.percent)} % utilisé
        </Text>
        {detail && (
          <Text style={styles.total}>
            {compactTokens(detail.total)} / {compactTokens(detail.max)} tokens
          </Text>
        )}
      </View>
      {note && (
        <Text style={[styles.note, note.error && styles.error]}>
          {note.text}
        </Text>
      )}
      {!quiet &&
        detail?.rows.map((row) => (
          <View key={row.label} style={styles.group}>
            <View style={styles.row}>
              <Text
                style={[styles.label, row.kind !== "used" && styles.aside]}
                numberOfLines={1}
              >
                {row.label}
              </Text>
              <View style={styles.bar}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.min(100, row.share * 100)}%`,
                      backgroundColor: BAR[row.kind],
                    },
                  ]}
                />
              </View>
              <Text style={styles.figure}>{compactTokens(row.tokens)}</Text>
              <Text style={styles.share}>{pct(row.share)}</Text>
            </View>
            {row.label === "Fichiers mémoire" &&
              detail.memory.map((f) => (
                <View key={f.path} style={styles.sub}>
                  <Text style={styles.subPath} numberOfLines={1}>
                    {shortPath(f.path)}
                  </Text>
                  <Text style={styles.subFigure}>
                    {compactTokens(f.tokens)}
                  </Text>
                </View>
              ))}
          </View>
        ))}
    </FeedSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  used: { flex: 1, color: C.ink, fontSize: T.body, fontWeight: "600" },
  hot: { color: HOT_INK },
  total: { color: C.mute, fontSize: T.small, fontVariant: ["tabular-nums"] },
  note: { color: C.mute, fontSize: T.small },
  error: { color: C.bad },
  group: { gap: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { flex: 1, color: C.ink, fontSize: T.small },
  aside: { color: C.mute },
  bar: {
    width: 64,
    height: 5,
    borderRadius: 3,
    backgroundColor: BAR_TRACK,
    overflow: "hidden",
  },
  barFill: { height: "100%", minWidth: 2, borderRadius: 3 },
  figure: {
    width: 52,
    textAlign: "right",
    color: C.dim,
    fontSize: T.small,
    fontVariant: ["tabular-nums"],
  },
  share: {
    width: 40,
    textAlign: "right",
    color: C.dim,
    fontSize: T.small,
    fontVariant: ["tabular-nums"],
  },
  sub: { flexDirection: "row", gap: 8, paddingLeft: 12 },
  subPath: { flex: 1, color: C.mute, fontSize: T.small - 1 },
  subFigure: {
    color: C.mute,
    fontSize: T.small - 1,
    fontVariant: ["tabular-nums"],
  },
});
