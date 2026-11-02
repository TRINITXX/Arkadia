import { StyleSheet, Text, View } from "react-native";
import type { PermissionView } from "@/lib/chat/phoneAsks";
import { A } from "~/chat/asks/ask-colors";
import { C, MONO, T } from "~/chat/chat-theme";

const SIGNS = { add: "+", del: "-", ctx: " " } as const;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * What the tool would do (`.chat-perm-input`): the command whole, a file
 * change as its lines (the desktop shows those in the column's card, above
 * its panel), else its one line or its raw input.
 */
export function PermissionInput({ view }: { view: PermissionView }) {
  if (view.kind !== "diff")
    return (
      <View style={styles.box}>
        <Text style={styles.mono} selectable>
          {view.text}
        </Text>
      </View>
    );
  return (
    <View style={[styles.box, styles.diffBox]}>
      <View style={styles.diffHead}>
        <Text style={styles.file} numberOfLines={1} ellipsizeMode="middle">
          {fileName(view.file) || view.file}
        </Text>
        {view.added > 0 && <Text style={styles.added}>+{view.added}</Text>}
        {view.removed > 0 && (
          <Text style={styles.removed}>−{view.removed}</Text>
        )}
      </View>
      {view.rows.map((row, i) =>
        row.kind === "gap" ? (
          <Text key={i} style={[styles.row, styles.gap]}>
            {row.lines > 1
              ? `⋯ ${row.lines} lignes inchangées`
              : "⋯ 1 ligne inchangée"}
          </Text>
        ) : (
          <Text
            key={i}
            selectable
            style={[
              styles.row,
              styles.mono,
              row.kind === "add" && styles.add,
              row.kind === "del" && styles.del,
            ]}
          >
            {SIGNS[row.kind]} {row.text}
          </Text>
        ),
      )}
      {view.hidden > 0 && (
        <Text style={[styles.row, styles.more]}>
          … {view.hidden} lignes de plus
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    backgroundColor: C.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  diffBox: { paddingHorizontal: 0, paddingTop: 0 },
  diffHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  file: { flex: 1, color: A.strong, fontSize: T.small, fontWeight: "600" },
  added: { color: A.addInk, fontSize: T.small, fontFamily: MONO },
  removed: { color: A.delInk, fontSize: T.small, fontFamily: MONO },
  mono: {
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 18,
    color: C.dim,
  },
  row: { paddingHorizontal: 10 },
  add: { color: A.addInk, backgroundColor: A.addBg },
  del: { color: A.delInk, backgroundColor: A.delBg },
  gap: {
    color: C.mute,
    fontStyle: "italic",
    fontSize: 12,
    backgroundColor: A.gapBg,
    paddingVertical: 2,
  },
  more: { color: C.mute, fontStyle: "italic", fontSize: 12, marginTop: 2 },
});
