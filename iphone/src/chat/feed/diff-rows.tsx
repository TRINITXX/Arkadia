import { StyleSheet, Text, View } from "react-native";
import type { EditDiff } from "@/lib/chat/chatDiff";
import { C, MONO } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/** Rows past this are left out, counted at the end. */
const SHOWN_LINES = 400;
/** A digit's width in the diff's monospaced size. */
const DIGIT_PX = 7;

const SIGNS = { add: "+", del: "-", ctx: " " } as const;
const INK = { add: F.add, del: F.del, ctx: C.dim } as const;
const BG = { add: F.addBg, del: F.delBg, ctx: "transparent" } as const;

/**
 * A file change's lines (`chat-diff-rows.tsx`): with the file's line numbers
 * before and after when the real diff is known, the unchanged lines between
 * two hunks folded into one row. Long lines wrap: no sideways scroll.
 */
export function DiffRows({ diff, error }: { diff: EditDiff; error?: string }) {
  const shown = diff.rows.slice(0, SHOWN_LINES);
  const widest = shown.reduce(
    (n, row) =>
      row.kind === "gap" ? n : Math.max(n, row.old ?? 0, row.new ?? 0),
    0,
  );
  const no = { width: String(widest).length * DIGIT_PX + 8 };
  return (
    <View style={styles.diff}>
      {shown.map((row, i) =>
        row.kind === "gap" ? (
          <Text key={i} style={styles.gap}>
            {row.lines > 1
              ? `⋯ ${row.lines} lignes inchangées`
              : "⋯ 1 ligne inchangée"}
          </Text>
        ) : (
          <View key={i} style={[styles.row, { backgroundColor: BG[row.kind] }]}>
            {diff.numbered && (
              <>
                <Text style={[styles.no, no]}>{row.old ?? ""}</Text>
                <Text style={[styles.no, styles.noAfter, no]}>
                  {row.new ?? ""}
                </Text>
              </>
            )}
            <Text style={[styles.sign, { color: INK[row.kind] }]}>
              {SIGNS[row.kind]}
            </Text>
            <Text style={[styles.text, { color: INK[row.kind] }]}>
              {row.text}
            </Text>
          </View>
        ),
      )}
      {diff.rows.length > SHOWN_LINES && (
        <Text style={styles.more}>
          … {diff.rows.length - SHOWN_LINES} lignes de plus
        </Text>
      )}
      {diff.note && <Text style={styles.more}>{diff.note}</Text>}
      {error ? <Text style={[styles.more, styles.error]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  diff: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: F.sep,
    paddingVertical: 6,
  },
  row: { flexDirection: "row", paddingRight: 10 },
  no: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
    color: F.lineNo,
    textAlign: "right",
    paddingRight: 4,
  },
  noAfter: { borderRightWidth: 1, borderRightColor: F.sep },
  sign: {
    width: 16,
    textAlign: "center",
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
  },
  text: { flex: 1, fontFamily: MONO, fontSize: 11, lineHeight: 17 },
  gap: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
    fontStyle: "italic",
    color: C.mute,
    backgroundColor: F.gapBg,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginVertical: 2,
  },
  more: {
    color: C.mute,
    fontStyle: "italic",
    fontSize: 11.5,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  error: { color: F.del, fontStyle: "normal" },
});
