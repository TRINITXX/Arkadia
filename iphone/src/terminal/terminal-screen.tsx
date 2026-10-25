import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
  type HostInstance,
} from "react-native";
import { SegmentedControl } from "@expo/ui/community/segmented-control";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RemoteAction } from "@/lib/remoteActions";
import type {
  RemoteButton,
  RemoteProject,
  RemoteSnapshot,
  RemoteTab,
} from "@/lib/remoteSnapshot";
import { pasteData } from "@/mobile/typing";
import {
  act,
  latestFrame,
  acquireWatch,
  readCodeBlock,
  send,
  sendInputs,
  type Status,
} from "~/remote/connection";
import { DictationBubble } from "~/dictation/dictation-bubble";
import { useDictation } from "~/dictation/use-dictation";
import { ConversationView } from "~/messages/conversation-view";
import { clearPrompt } from "~/terminal/clear-prompt";
import { KeyRow } from "~/terminal/key-row";
import { LiveTerminal } from "~/terminal/live-terminal";
import { measureEcho } from "~/terminal/stats";
import { usePaneFit } from "~/terminal/use-pane-fit";
import { useTerminalGestures } from "~/terminal/use-terminal-gestures";
import { useTypingInput } from "~/terminal/use-typing-input";
import { sfIcon } from "~/ui/sf-icon";
import { showNotice } from "~/ui/notice";
import { AccountChip, BadgeDot } from "~/ui/status-dots";

/** Between a dictation and its Enter, on the PC: two writes, never one paste. */
const DICTATION_ENTER_GAP_MS = 80;

type PaneView = "terminal" | "messages";
const VIEWS: { id: PaneView; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "messages", label: "Messages" },
];

interface TerminalScreenProps {
  snapshot: RemoteSnapshot;
  project: RemoteProject;
  tab: RemoteTab;
  status: Status;
}

async function run(action: RemoteAction) {
  try {
    return await act(action);
  } catch (e) {
    Alert.alert(
      "Action impossible",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * One tab, live: the real terminal at the screen's width. Typing goes
 * straight into Claude's prompt, which stays visible above the keyboard.
 * The header's menu runs the toolbar's buttons and closes the tab; the keys
 * below carry Claude's prompt buttons in their + menu. Only `LiveTerminal`
 * follows the frames.
 */
export function TerminalScreen({
  snapshot,
  project,
  tab,
  status,
}: TerminalScreenProps) {
  const insets = useSafeAreaInsets();
  const [chosenPaneId, setChosenPaneId] = useState(tab.activePaneId);
  // A pane closed on the desktop: fall back to the tab's active one.
  const pane =
    tab.panes.find((p) => p.id === chosenPaneId) ??
    tab.panes.find((p) => p.id === tab.activePaneId) ??
    tab.panes[0];
  const paneId = pane?.id ?? null;

  useEffect(() => acquireWatch(paneId), [paneId]);
  // An action answered after this screen left must not navigate from it.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const busy = pane?.badge?.startsWith("busy") ?? false;
  useEffect(() => measureEcho(!busy), [busy]);

  const { cellWidth, onRulerLayout, onAreaLayout, reclaim } =
    usePaneFit(paneId);

  const sendInput = useCallback(
    (data: string) => {
      if (!paneId) return false;
      reclaim(latestFrame(paneId));
      return send({ t: "input", pane: paneId, data });
    },
    [paneId, reclaim],
  );
  const typing = useTypingInput(sendInput);
  const { reset, toggleKeyboard } = typing;
  // Back online: whatever the field held may not have reached the prompt.
  useEffect(() => {
    if (status === "open") reset();
  }, [status, reset]);

  const areaRef = useRef<HostInstance>(null);
  const gestures = useTerminalGestures(areaRef, paneId, cellWidth, reclaim);

  const dictation = useDictation();
  const { phase: dictationPhase, finish: finishDictation } = dictation;
  const dictating = dictationPhase !== "idle";
  useEffect(() => {
    if (!dictation.error) return;
    showNotice(dictation.error);
    dictation.clearError();
  }, [dictation]);
  /** Ends the dictation and writes it into the prompt; Entrée then sends. */
  const writeDictation = useCallback(
    async (thenEnter: boolean) => {
      const text = await finishDictation();
      if (text && thenEnter && paneId) {
        // Spaced on the PC: the text and the Enter in one write would read
        // as a paste, and the Enter would be lost.
        reclaim(latestFrame(paneId));
        sendInputs(paneId, [text, "\r"], DICTATION_ENTER_GAP_MS);
      } else if (text) sendInput(text);
      else if (thenEnter) sendInput("\r");
      reset();
    },
    [finishDictation, sendInput, reset, paneId, reclaim],
  );

  const onKey = useCallback(
    (data: string) => {
      // Entrée during a dictation writes it first, as the desktop's Send does.
      if (data === "\r" && dictationPhase === "listening") {
        void writeDictation(true);
        return;
      }
      sendInput(data);
      reset();
    },
    [sendInput, reset, dictationPhase, writeDictation],
  );
  const onDictation = useCallback(() => {
    if (dictationPhase === "listening") void writeDictation(false);
    else if (dictationPhase === "idle") void dictation.start();
  }, [dictationPhase, writeDictation, dictation]);
  const onClearPrompt = useCallback(() => {
    reset();
    if (paneId) reclaim(latestFrame(paneId));
    if (clearPrompt(paneId))
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else showNotice("L’invite de Claude n’est pas affichée.");
  }, [paneId, reset, reclaim]);
  const onPickFiles = useCallback(() => {
    if (paneId) router.push({ pathname: "/pick", params: { pane: paneId } });
  }, [paneId]);
  const onCopyCode = useCallback(() => {
    if (!paneId) return;
    readCodeBlock(paneId)
      .then(async (code) => {
        if (!code)
          return showNotice("Aucun bloc de code dans cette conversation.");
        await Clipboard.setStringAsync(code);
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        showNotice(`Copié : ${code.split(/\r?\n/)[0].slice(0, 60)}`);
      })
      .catch((e) => showNotice(e instanceof Error ? e.message : String(e)));
  }, [paneId]);
  const [view, setView] = useState<PaneView>("terminal");
  const onPaste = useCallback(() => {
    void Clipboard.getStringAsync().then((text) => {
      const bracketed = !!latestFrame(paneId)?.bracketed_paste;
      if (text) onKey(pasteData(text, bracketed));
    });
  }, [onKey, paneId]);
  const onPromptButton = useCallback(
    (buttonId: string) => {
      if (!paneId) return;
      reset();
      void run({ kind: "promptButton", paneId, buttonId });
    },
    [paneId, reset],
  );
  const onToggleKeyboard = useCallback(() => {
    reclaim(latestFrame(paneId));
    toggleKeyboard();
  }, [paneId, reclaim, toggleKeyboard]);
  const runToolbarButton = (buttonId: string) =>
    void run({ kind: "runButton", projectId: project.id, paneId, buttonId });
  const newTab = async () => {
    const result = await run({ kind: "newTab", projectId: project.id });
    if (result?.tabId && mounted.current)
      router.replace({ pathname: "/tab/[id]", params: { id: result.tabId } });
  };
  const closeTab = () =>
    Alert.alert("Fermer cet onglet ?", "Ce qui y tourne s’arrête.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Fermer l’onglet",
        style: "destructive",
        onPress: () => {
          void run({ kind: "closeTab", tabId: tab.id });
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.title}>
              <Text style={styles.titleText} numberOfLines={1}>
                {tab.title}
              </Text>
              <View style={styles.subtitle}>
                <View
                  style={[
                    styles.projectDot,
                    { backgroundColor: project.color },
                  ]}
                />
                <Text style={styles.subtitleText}>{project.name}</Text>
                <AccountChip account={tab.account} />
                <BadgeDot badge={pane?.badge ?? tab.badge} />
              </View>
            </View>
          ),
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis">
          {tab.panes.length > 1 && (
            <Stack.Toolbar.Menu inline title="Volets">
              {tab.panes.map((p, i) => (
                <Stack.Toolbar.MenuAction
                  key={p.id}
                  isOn={p.id === paneId}
                  onPress={() => setChosenPaneId(p.id)}
                >
                  {`${i + 1}. ${p.title}`}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          )}
          <Stack.Toolbar.Menu inline title={project.name}>
            <Stack.Toolbar.MenuAction icon="plus" onPress={() => void newTab()}>
              Nouvel onglet
            </Stack.Toolbar.MenuAction>
            {toolbarItems(snapshot.toolbar, runToolbarButton)}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="xmark" destructive onPress={closeTab}>
            Fermer l’onglet
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <View style={[styles.screen, { paddingBottom: typing.keyboardHeight }]}>
        <SegmentedControl
          values={VIEWS.map((v) => v.label)}
          selectedIndex={VIEWS.findIndex((v) => v.id === view)}
          onChange={(e) =>
            setView(VIEWS[e.nativeEvent.selectedSegmentIndex]?.id ?? "terminal")
          }
          appearance="dark"
          style={styles.segment}
        />
        <LiveTerminal
          paneId={paneId}
          status={status}
          palette={snapshot.palette}
          areaRef={areaRef}
          gestures={gestures.panHandlers}
          onAreaLayout={onAreaLayout}
          onRulerLayout={onRulerLayout}
          reclaim={reclaim}
          overlay={
            view === "messages" && paneId ? (
              <ConversationView paneId={paneId} />
            ) : null
          }
        />
        <View
          style={[
            styles.bar,
            {
              paddingBottom: typing.keyboardOpen
                ? 8
                : Math.max(8, insets.bottom),
            },
          ]}
        >
          {dictating && (
            <DictationBubble
              transcript={dictation.transcript}
              level={dictation.level}
              stopping={dictationPhase === "stopping"}
              onCancel={dictation.cancel}
              onWrite={() => void writeDictation(false)}
            />
          )}
          <KeyRow
            promptButtons={pane?.claude ? snapshot.promptButtons : null}
            keyboardOpen={typing.keyboardOpen}
            dictating={dictationPhase === "listening"}
            onKey={onKey}
            onPaste={onPaste}
            onPromptButton={onPromptButton}
            onToggleKeyboard={onToggleKeyboard}
            onDictation={onDictation}
            onClearPrompt={onClearPrompt}
            onPickFiles={onPickFiles}
            onCopyCode={onCopyCode}
          />
        </View>
        <TextInput
          ref={typing.ref}
          {...typing.fieldProps}
          style={styles.field}
          autoCapitalize="sentences"
          autoCorrect
          keyboardAppearance="dark"
          returnKeyType="send"
          submitBehavior="submit"
          caretHidden
        />
      </View>
    </>
  );
}

/** The desktop toolbar, folders as submenus. */
function toolbarItems(
  buttons: RemoteButton[],
  onPick: (id: string) => void,
): React.ReactNode[] {
  return buttons.map((b) =>
    b.kind === "folder" ? (
      <Stack.Toolbar.Menu key={b.id} title={b.label} icon={sfIcon(b.icon)}>
        {toolbarItems(b.children ?? [], onPick)}
      </Stack.Toolbar.Menu>
    ) : (
      <Stack.Toolbar.MenuAction
        key={b.id}
        icon={sfIcon(b.icon)}
        onPress={() => onPick(b.id)}
      >
        {b.label}
      </Stack.Toolbar.MenuAction>
    ),
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  segment: { marginHorizontal: 16, marginBottom: 8, height: 32 },
  bar: {
    backgroundColor: "#1c1c1e",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#38383a",
  },
  field: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  title: { alignItems: "center", maxWidth: 230 },
  titleText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  subtitle: { flexDirection: "row", alignItems: "center", gap: 5 },
  subtitleText: { color: "#8e8e93", fontSize: 12 },
  projectDot: { width: 8, height: 8, borderRadius: 4 },
});
