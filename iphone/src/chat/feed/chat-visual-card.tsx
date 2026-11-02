import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import type { ToolItem } from "@/lib/chat/chatGroups";
import type { ChatState } from "@/lib/chat/chatState";
import {
  visualHtml,
  visualInput,
  visualPhase,
  visualProblem,
  visualVerified,
} from "@/lib/chat/chatVisual";
import { C, T } from "~/chat/chat-theme";
import { VisualPage } from "~/chat/feed/visual/visual-page";
import { VisualZoom } from "~/chat/feed/visual/visual-zoom";
import type { ChatActions } from "~/chat/use-chat";
import { tap, tick } from "~/ui/haptics";

export interface ChatVisualCardProps {
  chatId: string;
  tool: ToolItem;
  state: ChatState;
  actions: ChatActions;
  /** The page's choice (`arkadia.choose`): into the composer, never sent. */
  onChoose: (text: string) => void;
}

/**
 * A past visual's page is asked of the PC (`visual_html`) once: the feed's
 * list unmounts a card scrolled away, and one mounted again this soon
 * doesn't ask again. Later it does, in case the answer was lost.
 */
const ASK_AGAIN_MS = 20_000;
const asked = new Map<string, number>();

function askHtml(chatId: string, toolUseId: string, actions: ChatActions) {
  const key = `${chatId}\n${toolUseId}`;
  const at = asked.get(key);
  if (at !== undefined && Date.now() - at < ASK_AGAIN_MS) return;
  asked.set(key, Date.now());
  void actions.visualHtml(toolUseId);
}

/**
 * Claude's visual (`show_visual`) where it was called, as the desktop's card
 * (`chat-visual-card.tsx`): a band (title, « Agrandir ») over the page. It
 * shows once the PC checked it; one found broken stays folded to a line
 * (Claude sends a fixed one), « Voir quand même » opens it. `wide` changes
 * nothing here: the phone's column is the screen's width already.
 */
export function ChatVisualCard({
  chatId,
  tool,
  state,
  actions,
  onChoose,
}: ChatVisualCardProps) {
  const { title } = visualInput(tool);
  const phase = visualPhase(tool);
  const html = visualHtml(tool, state.visuals[tool.id]);
  const [anyway, setAnyway] = useState(false);
  const [why, setWhy] = useState(false);
  const [zoom, setZoom] = useState(false);
  // A past call: its page with the images in is the PC's to say.
  const needs = html === undefined && phase !== "checking";
  useEffect(() => {
    if (needs) askHtml(chatId, tool.id, actions);
  }, [needs, chatId, tool.id, actions]);

  if (phase === "broken" && !anyway) {
    return (
      <View style={styles.broken}>
        <SymbolView
          name="exclamationmark.triangle"
          size={14}
          tintColor={C.warn}
        />
        {/* The whole of the PC's verdict on a tap: the desktop's tooltip. */}
        <Text
          style={styles.brokenText}
          numberOfLines={why ? undefined : 1}
          onPress={() => {
            tick();
            setWhy(!why);
          }}
        >
          <Text style={styles.brokenTitle}>Visuel « {title} » écarté</Text>
          {` · ${why ? (tool.result?.text ?? "") : visualProblem(tool)}`}
        </Text>
        {html ? (
          <Pressable
            onPress={() => {
              tap();
              setAnyway(true);
            }}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          >
            <Text style={styles.btnText}>Voir quand même</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const page = phase === "checking" || !html ? undefined : html;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SymbolView name="square.on.circle" size={15} tintColor={C.accent} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {page === undefined ? (
          <ActivityIndicator size="small" color={C.mute} />
        ) : (
          <Pressable
            onPress={() => {
              tap();
              setZoom(true);
            }}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          >
            <SymbolView
              name="arrow.up.left.and.arrow.down.right"
              size={12}
              tintColor={C.dim}
            />
            <Text style={styles.btnText}>Agrandir</Text>
          </Pressable>
        )}
      </View>
      {page === undefined ? (
        <View style={styles.wait}>
          <Text style={styles.waitText}>
            {phase === "checking"
              ? "Arkadia vérifie le visuel…"
              : "Chargement du visuel…"}
          </Text>
        </View>
      ) : (
        <>
          {/* A new page, a new WebView: never the old page's state. */}
          <VisualPage
            key={page}
            html={page}
            verified={visualVerified(tool)}
            onChoose={onChoose}
          />
          <VisualZoom
            visible={zoom}
            html={page}
            title={title}
            onClose={() => setZoom(false)}
            onChoose={onChoose}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    borderRadius: 12,
    backgroundColor: C.bg,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
    paddingLeft: 12,
    paddingRight: 6,
    backgroundColor: C.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  title: { flex: 1, color: C.ink, fontSize: T.small, fontWeight: "500" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  pressed: { backgroundColor: C.raised },
  btnText: { color: C.dim, fontSize: T.small },
  wait: { height: 120, justifyContent: "center", paddingHorizontal: 16 },
  waitText: { color: C.mute, fontSize: T.small },
  broken: { flexDirection: "row", alignItems: "center", gap: 8 },
  brokenText: { flexShrink: 1, color: C.mute, fontSize: T.small },
  brokenTitle: { color: C.dim, fontWeight: "500" },
});
