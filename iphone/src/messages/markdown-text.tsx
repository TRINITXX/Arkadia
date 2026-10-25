import { ScrollView, StyleSheet, Text, View } from "react-native";

type Block =
  | { kind: "code"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string; marker: string }
  | { kind: "para"; text: string };

/** Claude's markdown, cut into the blocks a phone shows. */
export function parseBlocks(markdown: string): Block[] {
  const out: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (
        i++;
        i < lines.length && !lines[i].trimStart().startsWith("```");
        i++
      )
        code.push(lines[i]);
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ kind: "heading", text: heading[1] });
    } else if (item) {
      flush();
      out.push({
        kind: "item",
        text: item[2],
        marker: item[1] === "-" || item[1] === "*" ? "•" : item[1],
      });
    } else if (line.trim() === "") flush();
    else para.push(line.trim());
  }
  flush();
  return out;
}

/** `code` and **bold** inside a line. */
function Inline({ text, style }: { text: string; style: object }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <Text key={i} style={styles.inlineCode}>
            {p.slice(1, -1)}
          </Text>
        ) : p.startsWith("**") ? (
          <Text key={i} style={styles.bold}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

/** Claude's prose at full width, as in the Claude app (choice A). */
export function MarkdownText({ markdown }: { markdown: string }) {
  return (
    <View style={styles.wrap}>
      {parseBlocks(markdown).map((b, i) => {
        if (b.kind === "code")
          return (
            <ScrollView
              key={i}
              horizontal
              style={styles.codeBox}
              contentContainerStyle={styles.codePad}
            >
              <Text style={styles.code} selectable>
                {b.text}
              </Text>
            </ScrollView>
          );
        if (b.kind === "heading")
          return <Inline key={i} text={b.text} style={styles.heading} />;
        if (b.kind === "item")
          return (
            <View key={i} style={styles.item}>
              <Text style={styles.marker}>{b.marker}</Text>
              <Inline text={b.text} style={styles.itemText} />
            </View>
          );
        return <Inline key={i} text={b.text} style={styles.para} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  para: { color: "#ffffff", fontSize: 15.5, lineHeight: 22 },
  heading: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
  bold: { fontWeight: "700" },
  item: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  marker: { color: "#8e8e93", fontSize: 15.5, lineHeight: 22 },
  itemText: { flex: 1, color: "#ffffff", fontSize: 15.5, lineHeight: 22 },
  inlineCode: {
    fontFamily: "Menlo",
    fontSize: 13,
    backgroundColor: "#1c1c1e",
  },
  codeBox: { backgroundColor: "#141416", borderRadius: 12 },
  codePad: { padding: 12 },
  code: { fontFamily: "Menlo", fontSize: 12.5, color: "#e5e5ea" },
});
