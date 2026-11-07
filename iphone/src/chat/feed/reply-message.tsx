import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { withoutQuestions } from "@/lib/chat/chatQuestionRound";
import { splitTechDetail } from "@/lib/chat/chatTechDetail";
import type { FoldedUnit } from "@/lib/chat/chatGroups";
import { workImagePaths } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";
import { itemImagePaths } from "@/lib/chat/phoneImages";
import { imagePathKey } from "@/lib/imagePaths";
import { C, T } from "~/chat/chat-theme";
import { CHAT_TONE, DIM_TONE, F } from "~/chat/feed/feed-style";
import { ImageStrip, ReadThumbs } from "~/chat/feed/image-thumb";
import { MessageFrame } from "~/chat/feed/message-frame";
import { MarkdownText } from "~/messages/markdown-text";

type TextItem = Extract<ChatItem, { kind: "text" }>;

const NO_IMAGES: readonly string[] = [];

/**
 * Claude's reply. The one that answers sits in its violet frame, its opening
 * line a little larger, its icons and time in its corner; one that only
 * says what Claude does next (`step`) is a sentence of the story after a
 * violet dot (`chat-step-reply.tsx`): in full ink while its exchange runs,
 * dim once past, its icons after it. Written as it comes, the accent's bar
 * at its end. The images its words name: thumbnails under them.
 */
export function ReplyMessage({
  item,
  step,
  past,
  bare,
  peeks,
  tools,
  cwd,
}: {
  item: TextItem;
  step: boolean;
  /** Said before the exchange under way (`placeWork`). */
  past: boolean;
  /** The question sheet shows its questions: they leave the message
   *  meanwhile, Claude's other words in place (`withoutQuestions`). */
  bare: boolean;
  /** « Récit »: the bulb of its thinking, the wrench of its tools. */
  peeks: ReactNode;
  /** The tools behind its wrench (`placeWork`). */
  tools: FoldedUnit[] | null;
  /** The chat's working folder: a screenshot's relative name is its. */
  cwd: string | null;
}) {
  const caret = item.streaming ? C.accent : undefined;
  const text = useMemo(
    () => (bare ? withoutQuestions(item.text) : item.text),
    [bare, item.text],
  );
  // « Détail technique » after the last rule: dim, apart (03/11/2026).
  const parts = useMemo(() => splitTechDetail(text), [text]);
  const images = itemImagePaths(item);
  // The images its tools look at or make, but those its words name
  // (`chat-timeline.tsx`): after its icons on a step's line, in its strip
  // on a whole reply (the user's ask of 07/11/2026).
  const shots = useMemo(() => {
    if (!tools) return NO_IMAGES;
    const held = new Set(images.map(imagePathKey));
    const paths = workImagePaths(tools, cwd).filter(
      (p) => !held.has(imagePathKey(p)),
    );
    return paths.length > 0 ? paths : NO_IMAGES;
  }, [tools, cwd, images]);
  const strip = useMemo(
    () => (shots.length > 0 ? [...images, ...shots] : images),
    [images, shots],
  );
  const note = bare && (
    <View style={styles.bare}>
      <SymbolView name="questionmark.circle" size={12} tintColor={C.mute} />
      <Text style={styles.bareText}>
        Ses questions sont dans la fiche, sous la conversation
      </Text>
    </View>
  );
  if (step)
    return (
      <View style={styles.step}>
        <View style={[styles.dot, !past && styles.dotLive]} />
        <View style={styles.stepText}>
          {text ? (
            <MarkdownText
              markdown={text}
              tone={past ? DIM_TONE : CHAT_TONE}
              size={14}
              caret={caret}
            />
          ) : null}
          {note}
          <ImageStrip paths={images} />
        </View>
        {peeks ? (
          <View style={styles.peeks}>
            {peeks}
            <ReadThumbs paths={shots} quiet />
          </View>
        ) : null}
      </View>
    );
  return (
    <MessageFrame
      role="claude"
      text={item.text}
      error={item.error}
      cut={item.aborted}
      at={item.at}
      peeks={peeks}
      writing={item.streaming}
    >
      {!bare || text ? (
        <MarkdownText
          markdown={parts ? parts.main : text}
          tone={CHAT_TONE}
          size={T.body}
          lead
          caret={parts ? undefined : caret}
        />
      ) : null}
      {parts ? (
        <View style={styles.tech}>
          <MarkdownText
            markdown={parts.tech}
            tone={DIM_TONE}
            size={T.small}
            caret={caret}
          />
        </View>
      ) : null}
      {note}
      <ImageStrip paths={strip} />
    </MessageFrame>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", gap: 10, paddingHorizontal: 4 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: F.stepDot,
  },
  dotLive: { backgroundColor: F.stepDotLive },
  stepText: { flex: 1, minWidth: 0, gap: 6 },
  peeks: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    marginLeft: -6,
    marginRight: -4,
  },
  bare: { flexDirection: "row", alignItems: "center", gap: 6 },
  tech: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  bareText: { flex: 1, color: C.mute, fontSize: T.small },
});
