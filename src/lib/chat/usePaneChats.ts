import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  stateFromTitle,
  WAITING_TITLE_CHAR,
  type AgentStateValue,
} from "@/lib/agentState";
import {
  chatActivity,
  chatEventsReady,
  closeChat,
  chatReplaying,
  subscribeChatActivity,
  type ChatActivity,
} from "@/lib/chat/chatEvents";
import { folderOf } from "@/lib/chat/chatLabels";
import {
  dropLiveChat,
  liveSessionId,
  subscribeLiveSessions,
} from "@/lib/chat/chatLive";
import { getFrame } from "@/lib/frameStore";
import { CLEAR_CHUNK_GAP_MS, clearPromptChunks } from "@/lib/promptClear";
import { isPromptField } from "@/lib/terminalChrome";
import type { PaneChat, PaneState, Tab } from "@/types";

/** Claude Code takes this long at most to quit after `/exit`. */
const EXIT_TIMEOUT_MS = 8000;
const EXIT_POLL_MS = 150;
/** Between keys typed into a Claude Code prompt (see "Rafale de touches"). */
const KEY_GAP_MS = 60;
/** Any leading symbol reads as busy (`stateFromTitle`). */
const BUSY_TITLE_CHAR = "·";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

/**
 * A toolbar command that starts Claude: the Lab opens it as a chat instead.
 * `ccd` (and `cc`, `claude`) starts a new session, `ccdr` / `--continue`
 * the folder's latest, `--resume <id>` that one.
 */
export function chatForCommand(command: string, cwd: string): PaneChat | null {
  const trimmed = command.trim();
  if (!/^(ccd|ccdr|cc|claude)(\s|$)/.test(trimmed)) return null;
  const resume = /--resume\s+([0-9a-f-]{36})/.exec(trimmed)?.[1];
  if (resume) return { cwd, resume };
  if (/^ccdr\b/.test(trimmed) || /\s(--continue|-c)(\s|$)/.test(trimmed)) {
    return { cwd, continue: true };
  }
  return { cwd };
}

/**
 * A chat pane's tab title: the status glyph the sidebar badge reads
 * (`stateFromTitle`). Busy through background subagents too, as a terminal
 * pane is (`withBackgroundTasks`); a background shell leaves it waiting.
 * Waiting as soon as Claude asks something.
 */
export function chatTitle(activity: ChatActivity, label: string): string {
  const waiting =
    activity.pending > 0 || (!activity.busy && activity.tasks.length === 0);
  return `${waiting ? WAITING_TITLE_CHAR : BUSY_TITLE_CHAR} ${label}`;
}

/** The label of a title `chatTitle` made, or null for any other title. */
export function chatLabelOf(title: string): string | null {
  const t = title.trimStart();
  const glyph = t.charAt(0);
  return glyph === WAITING_TITLE_CHAR || glyph === BUSY_TITLE_CHAR
    ? t.slice(1).trimStart()
    : null;
}

/**
 * Why a chat can't leave for the terminal now, or null: closing it stops its
 * Claude Code, and with it a turn, a request or anything running behind.
 */
export function chatBusyReason(
  activity: ChatActivity,
  replaying: boolean,
): string | null {
  if (replaying) return "Le chat se recharge : réessaie dans un instant";
  if (activity.pending > 0) return "Réponds d'abord à Claude, puis bascule";
  if (activity.busy) return "Claude travaille : bascule à la fin de son tour";
  if (activity.tasks.length > 0 || activity.shells.length > 0) {
    return "Des tâches tournent en fond : bascule quand elles ont fini";
  }
  return null;
}

/**
 * Why a terminal Claude can't leave for the chat now, or null: only one
 * resting at its plain input box quits cleanly. A menu on screen (a question,
 * a plan, a permission) would take `/exit`'s Enter as an answer, and a
 * background task or shell would die with it.
 */
export function terminalBusyReason(
  state: AgentStateValue | undefined,
  promptShown: boolean,
): string | null {
  if (state?.kind !== "waiting")
    return "Claude travaille : bascule à la fin de son tour";
  if (state.shellRunning)
    return "Une commande tourne en fond : bascule quand elle a fini";
  if (!promptShown)
    return "Réponds d'abord à Claude dans le terminal, puis bascule";
  return null;
}

function findPane(tabs: Tab[], paneId: string): PaneState | undefined {
  for (const tab of tabs) if (tab.panes[paneId]) return tab.panes[paneId];
  return undefined;
}

/**
 * Chat panes (Arkadia Lab): starting one, keeping its session and title, and
 * switching a pane between chat and terminal on the same conversation. Never
 * two Claude Code on one session: the side being left is closed first, and
 * only while Claude rests (a switch mid-turn would cut its work).
 */
export function usePaneChats({
  setTabs,
  tabsRef,
  projectPathOf,
  paneState,
  onToast,
}: {
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  tabsRef: React.RefObject<Tab[]>;
  /** The project folder of the pane's tab, when the pane never reported one. */
  projectPathOf: (paneId: string) => string | null;
  /** A terminal pane's Claude state, as its badge shows it. */
  paneState: (paneId: string) => AgentStateValue | undefined;
  onToast: (level: "info" | "error", message: string) => void;
}) {
  const [switching, setSwitching] = useState<ReadonlySet<string>>(new Set());
  const switchingRef = useRef(new Set<string>());
  /** Each chat pane's title text, without its glyph (`ChatPane` sets it). */
  const labelsRef = useRef(new Map<string, string>());

  const patchPane = useCallback(
    (paneId: string, patch: (pane: PaneState) => PaneState) =>
      setTabs((prev) => {
        let changed = false;
        const next = prev.map((tab) => {
          const pane = tab.panes[paneId];
          if (!pane) return tab;
          const patched = patch(pane);
          if (patched === pane) return tab;
          changed = true;
          return { ...tab, panes: { ...tab.panes, [paneId]: patched } };
        });
        return changed ? next : prev;
      }),
    [setTabs],
  );

  const retitle = useCallback(
    (paneId: string) =>
      patchPane(paneId, (pane) => {
        if (!pane.chat) return pane;
        // Before its pane reports a label (not mounted since a reload), the
        // title keeps its own text: the session's name, not the folder's.
        const label =
          labelsRef.current.get(paneId) ||
          chatLabelOf(pane.title) ||
          folderOf(pane.chat.cwd);
        const title = chatTitle(chatActivity(paneId), label);
        return pane.title === title ? pane : { ...pane, title };
      }),
    [patchPane],
  );

  // Every chat's activity, its pane shown or not (another project's tab is
  // not mounted): the badge follows it all the same.
  useEffect(() => {
    void chatEventsReady();
    return subscribeChatActivity((chatId) => retitle(chatId));
  }, [retitle]);

  const startChat = useCallback(
    (paneId: string, chat: PaneChat) =>
      patchPane(paneId, (pane) => ({
        ...pane,
        chat,
        title: chatTitle(chatActivity(paneId), folderOf(chat.cwd)),
      })),
    [patchPane],
  );

  const onSession = useCallback(
    (paneId: string, sessionId: string) =>
      patchPane(paneId, (pane) =>
        pane.chat && pane.chat.resume !== sessionId
          ? {
              ...pane,
              chat: { ...pane.chat, resume: sessionId, continue: undefined },
            }
          : pane,
      ),
    [patchPane],
  );

  // Its session into the pane as soon as the chat knows it, mounted or not;
  // none after /clear, so a relaunch (account, restore) starts fresh.
  useEffect(
    () =>
      subscribeLiveSessions((paneId, sessionId) => {
        if (sessionId) onSession(paneId, sessionId);
        else
          patchPane(paneId, (pane) =>
            pane.chat && (pane.chat.resume || pane.chat.continue)
              ? { ...pane, chat: { cwd: pane.chat.cwd } }
              : pane,
          );
      }),
    [onSession, patchPane],
  );

  const onLabel = useCallback(
    (paneId: string, label: string) => {
      labelsRef.current.set(paneId, label);
      retitle(paneId);
    },
    [retitle],
  );

  const mark = (paneId: string, on: boolean) => {
    if (on) switchingRef.current.add(paneId);
    else switchingRef.current.delete(paneId);
    setSwitching(new Set(switchingRef.current));
  };

  /** Chat → terminal: the chat ends, the pane's shell resumes its session. */
  const toTerminal = useCallback(
    async (pane: PaneState, chat: PaneChat) => {
      const busy = chatBusyReason(
        chatActivity(pane.id),
        chatReplaying(pane.id),
      );
      if (busy) {
        onToast("info", busy);
        return;
      }
      await closeChat(pane.accountId, pane.id);
      labelsRef.current.delete(pane.id);
      // The full path, as a shell titles itself: a folder named `.claude`
      // would read as a busy Claude's glyph (`stateFromTitle`).
      patchPane(pane.id, (p) => ({ ...p, chat: undefined, title: chat.cwd }));
      // Its column is over: a later switch back starts a new one.
      dropLiveChat(pane.id);
      // `ccd` is the user's pwsh alias for Claude; it forwards --resume.
      const launch = chat.resume ? `ccd --resume ${chat.resume}` : "ccd";
      await invoke("send_input", {
        sessionId: pane.id,
        bytes: bytes(`${launch}\r`),
      });
    },
    [patchPane, onToast],
  );

  /**
   * Terminal → chat: a Claude Code resting at its prompt quits (`/exit`, the
   * prompt emptied first so no draft is sent), and the chat resumes its
   * session; a bare shell gets a new chat.
   */
  const toChat = useCallback(
    async (pane: PaneState) => {
      const cwd = pane.cwd ?? projectPathOf(pane.id);
      if (!cwd) {
        onToast("error", "Dossier du volet inconnu");
        return;
      }
      if (!stateFromTitle(pane.title)) {
        startChat(pane.id, { cwd });
        return;
      }
      const busy = terminalBusyReason(
        paneState(pane.id),
        isPromptField(getFrame(pane.id)),
      );
      if (busy) {
        onToast("info", busy);
        return;
      }
      const sessionId = await invoke<string | null>("pane_session_id", {
        paneId: pane.id,
      }).catch(() => null);
      for (const chunk of clearPromptChunks()) {
        await invoke("send_input", { sessionId: pane.id, bytes: chunk });
        await sleep(CLEAR_CHUNK_GAP_MS);
      }
      await invoke("send_input", { sessionId: pane.id, bytes: bytes("/exit") });
      await sleep(KEY_GAP_MS);
      await invoke("send_input", { sessionId: pane.id, bytes: [0x0d] });
      const deadline = Date.now() + EXIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(EXIT_POLL_MS);
        const now = findPane(tabsRef.current ?? [], pane.id);
        if (!now || !stateFromTitle(now.title)) break;
      }
      const still = findPane(tabsRef.current ?? [], pane.id);
      if (still && stateFromTitle(still.title)) {
        onToast("error", "Claude n'a pas quitté le terminal : bascule annulée");
        return;
      }
      startChat(pane.id, sessionId ? { cwd, resume: sessionId } : { cwd });
    },
    [projectPathOf, paneState, onToast, startChat, tabsRef],
  );

  const onToggle = useCallback(
    (paneId: string) => {
      if (switchingRef.current.has(paneId)) return;
      const pane = findPane(tabsRef.current ?? [], paneId);
      if (!pane) return;
      mark(paneId, true);
      const run = pane.chat ? toTerminal(pane, pane.chat) : toChat(pane);
      void run
        .catch((e: unknown) => onToast("error", String(e)))
        .finally(() => mark(paneId, false));
    },
    [tabsRef, toTerminal, toChat, onToast],
  );

  /**
   * The sessions a Claude Code runs in now, in every pane but `exceptPaneId`:
   * a chat's own, a terminal's from the pane map while Claude is up in it (a
   * bare shell's entry is a session long gone). /resume leaves them alone.
   */
  const liveSessions = useCallback(
    async (exceptPaneId: string): Promise<Set<string>> => {
      const panes = (tabsRef.current ?? [])
        .flatMap((t) => Object.values(t.panes))
        .filter((p) => p.id !== exceptPaneId);
      const ids = await Promise.all(
        panes.map((p) => {
          if (p.chat) return liveSessionId(p.id) ?? p.chat.resume ?? null;
          if (!stateFromTitle(p.title)) return null;
          return invoke<string | null>("pane_session_id", {
            paneId: p.id,
          }).catch(() => null);
        }),
      );
      return new Set(ids.filter((id): id is string => !!id));
    },
    [tabsRef],
  );

  /**
   * The pane where a Claude Code runs `sessionId` now, if any: a chat on it,
   * or a terminal with Claude up whose pane map names it. Resuming it a
   * second time would put two Claude Code on one transcript.
   */
  const paneHolding = useCallback(
    async (sessionId: string): Promise<string | null> => {
      const panes = (tabsRef.current ?? []).flatMap((t) =>
        Object.values(t.panes),
      );
      const chat = panes.find(
        (p) =>
          p.chat &&
          (liveSessionId(p.id) ?? p.chat.resume) === sessionId,
      );
      if (chat) return chat.id;
      const terminals = panes.filter(
        (p) => !p.chat && stateFromTitle(p.title),
      );
      const ids = await Promise.all(
        terminals.map((p) =>
          invoke<string | null>("pane_session_id", { paneId: p.id }).catch(
            () => null,
          ),
        ),
      );
      return terminals[ids.indexOf(sessionId)]?.id ?? null;
    },
    [tabsRef],
  );

  const handlers = useMemo(
    () => ({ switching, onToggle, onSession, onLabel, liveSessions }),
    [switching, onToggle, onSession, onLabel, liveSessions],
  );
  return { handlers, startChat, paneHolding };
}
