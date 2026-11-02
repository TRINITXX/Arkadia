import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { endsWithHourglass } from "@/lib/chat/chatHourglass";
import { copiedCodeMessage } from "@/lib/codeCopy";
import { LinkCardsContext, type LinkCards } from "~/messages/link-cards";
import { success } from "~/ui/haptics";
import { showFailure, showNotice } from "~/ui/notice";

type Block =
  | { kind: "code"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "item"; text: string; marker: string; depth: number }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; rows: string[][] }
  | { kind: "para"; text: string };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A table line's cells, without its outer pipes. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

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
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      flush();
      const rows = [cells(line)];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++)
        rows.push(cells(lines[i]));
      i--;
      out.push({ kind: "table", rows });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ kind: "heading", text: heading[2], level: heading[1].length });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push({ kind: "rule" });
    } else if (item) {
      flush();
      out.push({
        kind: "item",
        text: item[3],
        marker: /^[-*+]$/.test(item[2]) ? "•" : item[2],
        depth: Math.min(3, Math.floor(item[1].replace(/\t/g, "  ").length / 2)),
      });
    } else if (quote) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === "quote") last.text += `\n${quote[1]}`;
      else out.push({ kind: "quote", text: quote[1] });
    } else if (line.trim() === "") flush();
    else para.push(line.trim());
  }
  flush();
  return out;
}

/** The colours a text is drawn in: the app's (default) or the chat's. */
export interface MarkdownTone {
  ink: string;
  dim: string;
  link: string;
  codeBg: string;
  codeInk: string;
  line: string;
}

const APP_TONE: MarkdownTone = {
  ink: "#ffffff",
  dim: "#8e8e93",
  link: "#0a84ff",
  codeBg: "#141416",
  codeInk: "#e5e5ea",
  line: "rgba(255,255,255,0.12)",
};

// A bare web address last: it ends before closing punctuation, as GFM's.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<!\w)_[^_\s][^_]*_(?!\w)|https?:\/\/[^\s<>()[\]"'`]*[^\s<>()[\]"'`.,;:!?»])/g;

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/**
 * A part the view draws as a card (`LinkCardsContext`: the chat's artifact
 * links and pasted texts, the desktop's): a [link](…) or a bare address,
 * its label the address itself. Null: drawn inline.
 */
function cardOf(
  part: string,
  cards: LinkCards | null,
): { href: string; label: string } | null {
  if (!cards) return null;
  const link = LINK.exec(part);
  const href = link ? link[2] : /^https?:\/\//.test(part) ? part : null;
  return href && cards.match(href) ? { href, label: link?.[1] ?? part } : null;
}

/** A line cut at its cards: words (from part `at`), or a card. */
type Run =
  | { at: number; parts: string[] }
  | { at: number; href: string; label: string };

/** One inline part: `code`, **bold**, *italics*, a [link](…), or plain. */
function inlinePart(p: string, i: number, tone: MarkdownTone): ReactNode {
  if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
    return (
      <Text key={i} style={[styles.inlineCode, { backgroundColor: tone.codeBg }]}>
        {p.slice(1, -1)}
      </Text>
    );
  if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
    return (
      <Text key={i} style={styles.bold}>
        {p.slice(2, -2)}
      </Text>
    );
  const link = LINK.exec(p);
  if (link) {
    const url = link[2];
    const web = /^https?:\/\//i.test(url);
    return (
      <Text
        key={i}
        style={{ color: tone.link }}
        onPress={web ? () => void Linking.openURL(url) : undefined}
      >
        {link[1]}
      </Text>
    );
  }
  if (
    (p.startsWith("*") && p.endsWith("*") && p.length > 2) ||
    (p.startsWith("_") && p.endsWith("_") && p.length > 2)
  )
    return (
      <Text key={i} style={styles.italic}>
        {p.slice(1, -1)}
      </Text>
    );
  return p;
}

/**
 * `code`, **bold**, *italics* and [links](…) inside a line. A link the view
 * draws as a card stands on its own line between the words around it: an
 * inline view in a phone's narrow line would wrap it badly. `box`: where the
 * line sits in its row (an item's text), for the words and cards alike.
 */
function Inline({
  text,
  style,
  box,
  tone,
  trailing,
}: {
  text: string;
  style: object;
  box?: object;
  tone: MarkdownTone;
  trailing?: ReactNode;
}) {
  const cards = useContext(LinkCardsContext);
  const parts = text.split(INLINE).filter(Boolean);
  if (!cards || !parts.some((p) => cardOf(p, cards)))
    return (
      <Text style={[style, box]}>
        {parts.map((p, i) => inlinePart(p, i, tone))}
        {trailing}
      </Text>
    );
  // Runs of words between the cards, their edges by a card trimmed.
  const runs: Run[] = [];
  parts.forEach((p, i) => {
    const card = cardOf(p, cards);
    const last = runs[runs.length - 1];
    if (card) runs.push({ at: i, ...card });
    else if (last && "parts" in last) last.parts.push(p);
    else runs.push({ at: i, parts: [p] });
  });
  const lastRun = runs[runs.length - 1];
  return (
    <View style={[box, styles.mixed]}>
      {runs.map((run, r) => {
        if (!("parts" in run))
          return <cards.Card key={run.at} href={run.href} label={run.label} />;
        const words = run.parts.map((p, k) => {
          let w = p;
          if (k === 0 && r > 0) w = w.trimStart();
          if (k === run.parts.length - 1 && r < runs.length - 1) w = w.trimEnd();
          return w;
        });
        const ends = run === lastRun;
        if (!words.join("") && !(ends && trailing)) return null;
        return (
          <Text key={run.at} style={style}>
            {words.map((w, k) => inlinePart(w, run.at + k, tone))}
            {ends && trailing}
          </Text>
        );
      })}
      {!("parts" in lastRun) && trailing ? (
        <Text style={style}>{trailing}</Text>
      ) : null}
    </View>
  );
}

/** How long a code block's copy button holds its ✓ (the desktop's). */
const COPIED_MS = 1200;

/**
 * A fenced code block, scrolled sideways, its copy button in its corner (the
 * desktop's): the success buzz of every copy and « Copié (n lignes) · … »
 * (`copiedCodeMessage`), the button a ✓ for a moment.
 */
function CodeBlock({ code, tone }: { code: string; tone: MarkdownTone }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    Clipboard.setStringAsync(code).then(
      () => {
        success();
        showNotice(copiedCodeMessage(code));
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      (e: unknown) => showFailure(`Copie impossible : ${String(e)}`),
    );
  };
  return (
    <View>
      <ScrollView
        horizontal
        style={[styles.codeBox, { backgroundColor: tone.codeBg }]}
        contentContainerStyle={[styles.codePad, styles.codeRoom]}
      >
        <Text style={[styles.code, { color: tone.codeInk }]} selectable>
          {code}
        </Text>
      </ScrollView>
      <Pressable
        onPress={copy}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Copier le code"
        style={({ pressed }) => [
          styles.copy,
          { backgroundColor: tone.codeBg },
          pressed && styles.copyPressed,
        ]}
      >
        <SymbolView
          name={copied ? "checkmark" : "doc.on.doc"}
          size={13}
          tintColor={copied ? "#30d158" : tone.dim}
        />
      </Pressable>
    </View>
  );
}

/** A table as aligned columns of a monospaced block, scrolled sideways. */
function Table({ rows, tone }: { rows: string[][]; tone: MarkdownTone }) {
  const plain = rows.map((r) => r.map((c) => c.replace(/\*\*|`/g, "")));
  const widths = plain[0].map((_, col) =>
    Math.max(...plain.map((r) => (r[col] ?? "").length)),
  );
  const lines = plain.map((r) =>
    widths.map((w, col) => (r[col] ?? "").padEnd(w)).join("  "),
  );
  return (
    <ScrollView
      horizontal
      style={[styles.codeBox, { backgroundColor: tone.codeBg }]}
      contentContainerStyle={styles.codePad}
    >
      <Text style={[styles.code, { color: tone.codeInk }]} selectable>
        <Text style={styles.bold}>{lines[0]}</Text>
        {`\n${widths.map((w) => "─".repeat(w)).join("  ")}\n`}
        {lines.slice(1).join("\n")}
      </Text>
    </ScrollView>
  );
}

/**
 * Claude's prose at full width, as in the Claude app (choice A). The chat
 * gives its own colours and size (`tone`, `size`); `lead`: the opening line a
 * little larger when more follows, a lone ⏳ at the end not counting (the
 * desktop's answer frame, `endsWithHourglass`); `caret`: a reply still being
 * written ends on the accent's bar; `italic`: Claude's thinking, as the
 * desktop's reading view sets it.
 */
export function MarkdownText({
  markdown,
  tone = APP_TONE,
  size = 15.5,
  lead = false,
  caret,
  italic = false,
}: {
  markdown: string;
  tone?: MarkdownTone;
  size?: number;
  lead?: boolean;
  /** The caret's colour; none when absent. */
  caret?: string;
  italic?: boolean;
}) {
  const blocks = parseBlocks(markdown);
  // A lone ⏳ paragraph at the end isn't more (the desktop's rule).
  const opens = lead && blocks.length > (endsWithHourglass(markdown) ? 2 : 1);
  const lineHeight = Math.round(size * 1.42);
  const body = {
    color: tone.ink,
    fontSize: size,
    lineHeight,
    ...(italic ? styles.italic : null),
  };
  const end = (i: number) =>
    caret && i === blocks.length - 1 ? (
      <Text style={{ color: caret }}> ▍</Text>
    ) : undefined;
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        if (b.kind === "code")
          return <CodeBlock key={i} code={b.text} tone={tone} />;
        if (b.kind === "table") return <Table key={i} rows={b.rows} tone={tone} />;
        if (b.kind === "rule")
          return (
            <View key={i} style={[styles.rule, { backgroundColor: tone.line }]} />
          );
        if (b.kind === "heading")
          return (
            <Inline
              key={i}
              text={b.text}
              tone={tone}
              trailing={end(i)}
              style={[
                body,
                styles.bold,
                b.level <= 2 && { fontSize: size + 1.5, lineHeight: lineHeight + 2 },
              ]}
            />
          );
        if (b.kind === "item")
          return (
            <View
              key={i}
              style={[styles.item, { paddingLeft: 4 + b.depth * 16 }]}
            >
              <Text style={[body, { color: tone.dim }]}>{b.marker}</Text>
              <Inline
                text={b.text}
                tone={tone}
                trailing={end(i)}
                style={body}
                box={styles.itemText}
              />
            </View>
          );
        if (b.kind === "quote")
          return (
            <View key={i} style={[styles.quote, { borderColor: tone.line }]}>
              <Inline
                text={b.text}
                tone={tone}
                trailing={end(i)}
                style={[body, { color: tone.dim }]}
              />
            </View>
          );
        const leading = opens && i === 0;
        return (
          <Inline
            key={i}
            text={b.text}
            tone={tone}
            trailing={end(i)}
            style={[
              body,
              leading && {
                fontSize: size + 1,
                fontWeight: "600",
                color: "#f4f4f5",
              },
            ]}
          />
        );
      })}
      {blocks.length === 0 && caret ? (
        <Text style={[body, { color: caret }]}>▍</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  item: { flexDirection: "row", gap: 8 },
  itemText: { flex: 1 },
  // A line with cards: its words and cards stacked, each its own width.
  mixed: { gap: 6, alignItems: "flex-start" },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  inlineCode: { fontFamily: "Menlo", fontSize: 13 },
  codeBox: { borderRadius: 12 },
  codePad: { padding: 12 },
  // The copy button's room at the end of the first line.
  codeRoom: { paddingRight: 44 },
  code: { fontFamily: "Menlo", fontSize: 12.5 },
  copy: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 30,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  copyPressed: { opacity: 0.6 },
});
