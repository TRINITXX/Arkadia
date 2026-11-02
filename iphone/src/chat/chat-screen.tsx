import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Subagent } from "@/lib/chat/chatState";
import type { RemoteAction } from "@/lib/remoteActions";
import type {
  RemoteButton,
  RemotePane,
  RemoteProject,
  RemoteSnapshot,
  RemoteTab,
} from "@/lib/remoteSnapshot";
import { useAsksCoverComposer } from "~/chat/asks/use-asks-cover";
import { ChatAsks } from "~/chat/chat-asks";
import { ChatComposer } from "~/chat/chat-composer";
import { ChatFeed } from "~/chat/chat-feed";
import { ChatLiveLine } from "~/chat/chat-live-line";
import { C } from "~/chat/chat-theme";
import { putInComposer } from "~/chat/composer-inbox";
import { AgentSheet } from "~/chat/feed/agent-sheet";
import { useChat, useChatLive } from "~/chat/use-chat";
import { useMessageEdit } from "~/chat/use-message-edit";
import { act, type Status } from "~/remote/connection";
import { headerBadge } from "~/remote/snapshot";
import { failure, tap, tick } from "~/ui/haptics";
import { sfIcon } from "~/ui/sf-icon";
import { AccountChip, BadgeDot } from "~/ui/status-dots";

interface ChatScreenProps {
  snapshot: RemoteSnapshot;
  project: RemoteProject;
  tab: RemoteTab;
  pane: RemotePane;
  status: Status;
}

/** The chats shown « Messages seuls », by pane, while the app runs. */
const MESSAGES_ONLY = new Set<string>();

async function run(action: RemoteAction) {
  try {
    return await act(action);
  } catch (e) {
    failure();
    Alert.alert(
      "Action impossible",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * A chat pane, live: the desktop column on the phone (mockup A of
 * 02/11/2026). The conversation, what waits for an answer, the line that
 * says Claude works, then the input. The header's menu holds what the
 * terminal screen's does, and the switch to the terminal.
 */
export function ChatScreen({ snapshot, project, tab, pane }: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const chatId = pane.id;
  const actions = useChat(chatId);
  const live = useChatLive(chatId);
  const { state } = live;
  // Files named from the chat's folder, as the desktop's (`shortPath`);
  // an older desktop doesn't send it: from the home folder then.
  const cwd = pane.cwd ?? null;
  // A request, or the ❓ round unfolded, takes the input's place (desktop).
  const covered = useAsksCoverComposer(chatId, state);
  // The pencil on the user's messages: back before one, its text to edit.
  const edit = useMessageEdit(chatId, state, actions);
  // A running subagent's pill opened: its conversation in a sheet.
  const [agent, setAgent] = useState<Subagent | null>(null);
  // « Messages seuls », per chat, as the desktop pane's (kept while the app runs).
  const [messagesOnly, setMessagesOnly] = useState(() =>
    MESSAGES_ONLY.has(chatId),
  );
  const toggleMessagesOnly = () => {
    tick();
    const next = !messagesOnly;
    if (next) MESSAGES_ONLY.add(chatId);
    else MESSAGES_ONLY.delete(chatId);
    setMessagesOnly(next);
  };
  // An action answered after this screen left must not navigate from it.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // A visual's button picks a text for the input: a pick, as a menu's.
  const onChoose = useCallback(
    (text: string) => {
      tick();
      putInComposer(chatId, text, "choice");
    },
    [chatId],
  );
  // A running subagent's pill opens its sheet.
  const openAgent = useCallback((a: Subagent) => {
    tap();
    setAgent(a);
  }, []);
  // A menu's item ticks as it's picked; what it sets off says how it went.
  const runToolbarButton = (buttonId: string) => {
    tick();
    void run({
      kind: "runButton",
      projectId: project.id,
      paneId: null,
      buttonId,
      chat: true,
    });
  };
  // A chat asleep, as from the project list (`openNewTab`).
  const newTab = async () => {
    tick();
    const result = await run({
      kind: "newTab",
      projectId: project.id,
      chat: true,
    });
    if (result?.tabId && mounted.current)
      router.replace({ pathname: "/tab/[id]", params: { id: result.tabId } });
  };
  const closeTab = () => {
    tick();
    Alert.alert("Fermer cet onglet ?", "Ce qui y tourne s’arrête.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Fermer l’onglet",
        style: "destructive",
        onPress: () => {
          tap();
          void run({ kind: "closeTab", tabId: tab.id });
          router.back();
        },
      },
    ]);
  };
  const toTerminal = () => {
    tick();
    void actions.toggle().catch((e: unknown) => {
      failure();
      Alert.alert(
        "Bascule impossible",
        e instanceof Error ? e.message : String(e),
      );
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: C.bg },
          headerTitle: () => (
            <View style={styles.title}>
              <Text style={styles.titleText} numberOfLines={1}>
                {state.title ?? tab.title}
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
                <BadgeDot {...headerBadge(tab, pane)} />
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
                  isOn={p.id === pane.id}
                  onPress={() => {
                    tick();
                    if (p.id !== pane.id)
                      router.setParams({ id: tab.id, pane: p.id });
                  }}
                >
                  {`${i + 1}. ${p.title}`}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          )}
          <Stack.Toolbar.MenuAction
            icon="text.bubble"
            isOn={messagesOnly}
            onPress={toggleMessagesOnly}
          >
            Messages seuls
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="terminal" onPress={toTerminal}>
            Passer en terminal
          </Stack.Toolbar.MenuAction>
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

      <KeyboardAvoidingView
        style={styles.screen}
        behavior="padding"
        keyboardVerticalOffset={insets.top + 44}
      >
        <ChatFeed
          chatId={chatId}
          live={live}
          cwd={cwd}
          actions={actions}
          onChoose={onChoose}
          messagesOnly={messagesOnly}
          onEdit={edit.onEdit}
          editBlocked={edit.blocked !== null}
        />
        <ChatLiveLine state={state} cwd={cwd} onOpenAgent={openAgent} />
        <ChatAsks chatId={chatId} state={state} actions={actions} />
        {/* Hidden, not unmounted, under an ask: its draft stays. */}
        <View style={covered ? styles.hidden : null}>
          <ChatComposer
            chatId={chatId}
            state={state}
            actions={actions}
            promptButtons={snapshot.promptButtons}
            bottomInset={insets.bottom}
            covered={covered}
          />
        </View>
        {covered && <View style={{ height: insets.bottom }} />}
      </KeyboardAvoidingView>
      <AgentSheet
        agent={agent}
        visible={agent !== null}
        chatId={chatId}
        live={live}
        cwd={cwd}
        actions={actions}
        onChoose={onChoose}
        onClose={() => setAgent(null)}
      />
    </>
  );
}

/** The desktop toolbar, folders as submenus (as the terminal screen's). */
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
  screen: { flex: 1, backgroundColor: C.bg },
  /**
   * Hidden under an ask, kept mounted: Fabric unmounts a `display: none`
   * subtree, and with it the composer's /resume, /rewind, /mcp sheets.
   */
  hidden: { height: 0, overflow: "hidden" },
  title: { alignItems: "center", maxWidth: 230 },
  titleText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  subtitle: { flexDirection: "row", alignItems: "center", gap: 5 },
  subtitleText: { color: "#8e8e93", fontSize: 12 },
  projectDot: { width: 8, height: 8, borderRadius: 4 },
});
