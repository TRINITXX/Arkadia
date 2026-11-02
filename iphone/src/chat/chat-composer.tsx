import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { bashCommand } from "@/lib/chat/chatBash";
import {
  MODE_CYCLE,
  modeLabel,
  modelLabel,
} from "@/lib/chat/chatLabels";
import type { PermissionMode } from "@/lib/chat/chatProtocol";
import {
  currentChoice,
  effortChoices,
  effortLabel,
  latestModels,
} from "@/lib/chat/chatSdkSettings";
import type { ChatState } from "@/lib/chat/chatState";
import { withChoice } from "@/lib/chat/chatVisual";
import { lastCodeBlock } from "@/lib/chat/phoneCode";
import type { RemoteButton } from "@/lib/remoteSnapshot";
import { C, T } from "~/chat/chat-theme";
import { onComposerInsert } from "~/chat/composer-inbox";
import type { ChatActions } from "~/chat/use-chat";
import { DictationBubble } from "~/dictation/dictation-bubble";
import { useDictation } from "~/dictation/use-dictation";
import { act } from "~/remote/connection";
import { showNotice } from "~/ui/notice";

/** How many slash commands the suggestions show at once. */
const SLASH_ROWS = 6;

/**
 * The chat's input, as the desktop's (`chat-composer.tsx`): the field, then
 * one row with the model, the effort, the context, and the buttons (+,
 * dictation, send, stop). « !commande » runs in the tab's folder, « / » lists
 * Claude Code's commands. A message sent while Claude works waits its turn;
 * a long press on send sends it now.
 */
export function ChatComposer({
  chatId,
  state,
  actions,
  promptButtons,
  bottomInset,
  covered,
}: {
  chatId: string;
  state: ChatState;
  actions: ChatActions;
  promptButtons: RemoteButton[] | null;
  bottomInset: number;
  /** An ask takes its place (hidden, its draft kept): its microphone stops. */
  covered: boolean;
}) {
  const [text, setText] = useState("");
  const dictation = useDictation();
  const { phase, finish, cancel, error, clearError } = dictation;
  useEffect(() => {
    if (!error) return;
    showNotice(error);
    clearError();
  }, [error, clearError]);
  // Hidden, its dictation bubble goes with it: the mic would run with no
  // button to stop it (REVIEW.md « Micro du chat »).
  useEffect(() => {
    if (covered && phase !== "idle") cancel();
  }, [covered, phase, cancel]);

  // A photo picked, a visual's choice: into the field, never sent. A second
  // choice replaces the first, as on the desktop (`withChoice`).
  const lastChoice = useRef<string | null>(null);
  useEffect(
    () =>
      onComposerInsert(chatId, ({ text: insert, kind }) => {
        if (kind === "choice") {
          const previous = lastChoice.current;
          lastChoice.current = insert;
          setText((t) => withChoice(t, insert, previous));
          return;
        }
        setText((t) => (t && !/\s$/.test(t) ? `${t} ${insert}` : t + insert));
      }),
    [chatId],
  );

  const onChange = (next: string) => {
    // A chat asleep wakes at the first key, as on the desktop.
    if (state.asleep && !text && next) void actions.wake();
    setText(next);
  };

  const submit = useCallback(
    (now: boolean) => {
      const message = text.trim();
      if (!message) return;
      const command = bashCommand(message);
      if (command) void actions.bash(command);
      else void actions.send(message, now && state.working);
      setText("");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [text, actions, state.working],
  );

  const writeDictation = useCallback(async () => {
    const said = await finish();
    if (said) setText((t) => (t ? `${t} ${said}` : said));
  }, [finish]);
  const onMic = () => {
    if (phase === "listening") void writeDictation();
    else if (phase === "idle") void dictation.start();
  };

  const slash = useMemo(() => slashRows(text, state), [text, state]);

  const model = currentChoice(state.sdk.models, state.model);
  const efforts = effortChoices({
    models: state.sdk.models,
    model: state.model,
    effort: state.sdk.effort,
  });
  const pickModel = () => {
    const rows = latestModels(state.sdk.models);
    if (rows.length === 0) return showNotice("Modèles pas encore connus.");
    sheet(
      "Modèle",
      rows.map((m) => m.label),
      (i) => void actions.setModel(rows[i].value),
    );
  };
  const pickEffort = () =>
    sheet(
      "Effort",
      efforts.map(effortLabel),
      (i) => void actions.setEffort(efforts[i]),
    );
  const pickMode = () =>
    sheet(
      "Mode",
      MODE_CYCLE.map((m) => modeLabel(m)),
      (i) => void actions.setMode(MODE_CYCLE[i] as PermissionMode),
    );
  const showFigures = () => {
    const lines = [
      state.context && `Contexte : ${Math.round(state.context.percentage)} %`,
      windowLine("Session (5 h)", state.limits.fiveHour),
      windowLine("Semaine", state.limits.sevenDay),
    ].filter(Boolean);
    Alert.alert("Utilisation", lines.join("\n") || "Pas encore connue.");
  };
  const copyCode = async () => {
    const code = lastCodeBlock(state.items);
    if (!code) return showNotice("Aucun bloc de code dans cette conversation.");
    await Clipboard.setStringAsync(code);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showNotice(`Copié : ${code.split(/\r?\n/)[0].slice(0, 60)}`);
  };
  const runPromptButton = async (button: RemoteButton) => {
    try {
      const result = await act({
        kind: "promptButton",
        paneId: chatId,
        buttonId: button.id,
      });
      // Typed, not sent: the button's text comes back for the field.
      if (result.text) setText((t) => (t ? `${t} ${result.text}` : result.text!));
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const openPlus = () => {
    const buttons = flatButtons(promptButtons);
    const entries: { label: string; run: () => void }[] = [
      {
        label: "Photos et téléchargements du PC",
        run: () =>
          router.push({ pathname: "/pick", params: { pane: chatId, chat: "1" } }),
      },
      { label: "Copier le dernier bloc de code", run: () => void copyCode() },
      { label: `Mode : ${modeLabel(state.mode)}`, run: pickMode },
      ...(state.working
        ? [{ label: "Tâches en arrière-plan (Ctrl+B)", run: () => void actions.background() }]
        : []),
      ...buttons.map((b) => ({
        label: b.label,
        run: () => void runPromptButton(b),
      })),
    ];
    sheet(
      null,
      entries.map((e) => e.label),
      (i) => entries[i].run(),
    );
  };

  const placeholder = state.closed
    ? "Conversation terminée"
    : state.asleep
      ? "Claude en veille : écris pour le réveiller"
      : state.working
        ? "Claude travaille… ton message attendra son tour"
        : "Écrire à Claude…";
  const hasText = text.trim().length > 0;
  const percent = state.context ? Math.round(state.context.percentage) : null;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(8, bottomInset) }]}>
      {phase !== "idle" && (
        <DictationBubble
          transcript={dictation.transcript}
          level={dictation.level}
          stopping={phase === "stopping"}
          onCancel={dictation.cancel}
          onWrite={() => void writeDictation()}
        />
      )}
      {slash.length > 0 && (
        <ScrollView style={styles.slash} keyboardShouldPersistTaps="always">
          {slash.map((c) => (
            <Pressable
              key={c.name}
              style={styles.slashRow}
              onPress={() => setText(`/${c.name} `)}
            >
              <Text style={styles.slashName}>/{c.name}</Text>
              <Text style={styles.slashDesc} numberOfLines={1}>
                {c.description}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={styles.card}>
        <TextInput
          value={text}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.mute}
          style={styles.field}
          multiline
          editable={!state.closed}
          keyboardAppearance="dark"
          autoCapitalize="sentences"
          autoCorrect
          selectionColor={C.accent}
        />
        <View style={styles.bar}>
          <Pressable style={styles.chip} onPress={pickModel} hitSlop={6}>
            <Text style={styles.chipText}>{modelLabel(model?.model ?? state.model)}</Text>
            <SymbolView name="chevron.up" size={10} tintColor={C.mute} />
          </Pressable>
          {efforts.length > 0 && state.sdk.effort && (
            <Pressable style={styles.chip} onPress={pickEffort} hitSlop={6}>
              <Text style={styles.chipText}>{effortLabel(state.sdk.effort)}</Text>
            </Pressable>
          )}
          {state.mode && state.mode !== "default" && (
            <Pressable style={styles.chip} onPress={pickMode} hitSlop={6}>
              <Text style={[styles.chipText, styles.mode]}>{modeLabel(state.mode)}</Text>
            </Pressable>
          )}
          {percent !== null && (
            <Pressable style={styles.ring} onPress={showFigures} hitSlop={6}>
              <Text style={styles.ringText}>{percent}</Text>
            </Pressable>
          )}
          <View style={styles.spacer} />
          <IconButton name="plus" onPress={openPlus} />
          <IconButton
            name={phase === "listening" ? "waveform" : "mic"}
            onPress={onMic}
            on={phase === "listening"}
          />
          {state.working && (
            <IconButton name="stop.fill" onPress={() => void actions.interrupt()} />
          )}
          {(hasText || !state.working) && (
            <Pressable
              style={[styles.send, !hasText && styles.sendOff]}
              onPress={() => submit(false)}
              onLongPress={() => submit(true)}
              disabled={!hasText}
              hitSlop={6}
            >
              <SymbolView name="arrow.up" size={16} tintColor={C.accentInk} weight="bold" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function IconButton({
  name,
  onPress,
  on = false,
}: {
  name: string;
  onPress: () => void;
  on?: boolean;
}) {
  return (
    <Pressable
      style={[styles.icon, on && styles.iconOn]}
      onPress={onPress}
      hitSlop={6}
    >
      <SymbolView
        name={name as never}
        size={17}
        tintColor={on ? C.accent : C.ink}
      />
    </Pressable>
  );
}

/** An iOS action sheet; `title` null: none. */
function sheet(
  title: string | null,
  options: string[],
  onPick: (index: number) => void,
) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: title ?? undefined,
      options: [...options, "Annuler"],
      cancelButtonIndex: options.length,
      userInterfaceStyle: "dark",
    },
    (i) => {
      if (i < options.length) onPick(i);
    },
  );
}

function windowLine(
  label: string,
  window: { utilization: number; resetsAt?: number } | undefined,
): string | null {
  if (!window) return null;
  const pct = Math.round(window.utilization * 100);
  if (!window.resetsAt) return `${label} : ${pct} %`;
  const at = new Date(window.resetsAt * 1000).toLocaleString("fr-FR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${label} : ${pct} % (jusqu’à ${at})`;
}

/**
 * The prompt bar's buttons, folders opened: the + menu lists them, but a
 * keyboard shortcut, a terminal's keys (the desktop chat's « Commandes »).
 */
function flatButtons(buttons: RemoteButton[] | null): RemoteButton[] {
  return (buttons ?? []).flatMap((b) =>
    b.kind === "folder" ? flatButtons(b.children ?? []) : b.keys ? [] : [b],
  );
}

/** « /co » → Claude Code's commands starting so, until a space is typed. */
function slashRows(text: string, state: ChatState) {
  const m = /^\/(\S*)$/.exec(text);
  if (!m) return [];
  const typed = m[1].toLowerCase();
  return state.commands
    .filter(
      (c) =>
        c.name.toLowerCase().startsWith(typed) ||
        c.aliases?.some((a) => a.toLowerCase().startsWith(typed)),
    )
    .slice(0, SLASH_ROWS);
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 4, gap: 6 },
  slash: {
    maxHeight: 220,
    backgroundColor: C.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
  },
  slashRow: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  slashName: { color: C.ink, fontSize: T.small, fontWeight: "600" },
  slashDesc: { color: C.mute, fontSize: T.tiny, marginTop: 1 },
  card: {
    backgroundColor: C.raised,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  field: {
    color: C.ink,
    fontSize: T.body,
    minHeight: 36,
    maxHeight: 160,
    paddingTop: 4,
    paddingBottom: 6,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    paddingTop: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    borderRadius: 8,
    paddingHorizontal: 7,
    height: 26,
  },
  chipText: { color: C.dim, fontSize: T.tiny, fontWeight: "600" },
  mode: { color: C.accent },
  ring: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: C.lineStrong,
    borderTopColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: { color: C.dim, fontSize: 9, fontWeight: "700" },
  spacer: { flex: 1 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
  },
  iconOn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.accent },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
  },
  sendOff: { opacity: 0.35 },
});
