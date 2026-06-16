import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { arrayMove } from "@dnd-kit/sortable";
import { TabBar } from "@/components/TabBar";
import { Sidepanel } from "@/components/Sidepanel";
import { Toolbar } from "@/components/Toolbar";
import { PaneTreeView } from "@/components/PaneTreeView";
import { MessageNavRail } from "@/components/MessageNavRail";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { ProjectContextMenu } from "@/components/ProjectContextMenu";
import { PaneContextMenu } from "@/components/PaneContextMenu";
import { RenameDialog } from "@/components/RenameDialog";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { NotepadPanel } from "@/components/NotepadPanel";
import { ReadingPanel } from "@/components/ReadingPanel";
import { loadState, saveState, newProjectId, newWorkspaceId } from "@/store";
import { WorkspaceContextMenu } from "@/components/WorkspaceContextMenu";
import { WorkspaceDialog } from "@/components/WorkspaceDialog";
import {
  collectPaneIds,
  firstPaneId,
  removePaneFromTree,
  splitTreeAt,
  updateTreeRatio,
} from "@/lib/paneTree";
import { measureCellSize } from "@/lib/cellSize";
import { DEFAULT_CUSTOM_PALETTE, resolveActivePalette } from "@/lib/palettes";
import type { AgentEventPayload, AgentStateValue } from "@/lib/agentState";
import {
  DEFAULT_EDITOR_PROTOCOL,
  DEFAULT_PALETTE_ID,
  DEFAULT_TERMINAL_FONT,
  type ActionButton,
  type BellPayload,
  type ClosedPayload,
  type CustomPalette,
  type CwdPayload,
  type EditorProtocol,
  type PaletteId,
  type PaneState,
  type Project,
  type RenderPayload,
  type SplitDirection,
  type Tab,
  type TerminalFont,
  type ToolbarButton,
  type Workspace,
} from "@/types";

const COLS = 120;
const ROWS = 30;
const TOOLBAR_RUN_DELAY_MS = 600;

let tabCounter = 0;
function newTabId() {
  tabCounter += 1;
  return `tab-${tabCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ProjectMenuState {
  project: Project;
  x: number;
  y: number;
}

interface WorkspaceMenuState {
  workspace: Workspace;
  x: number;
  y: number;
}

interface PaneMenuState {
  tabId: string;
  paneId: string;
  x: number;
  y: number;
}

export function App() {
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [toolbarButtons, setToolbarButtons] = useState<ToolbarButton[]>([]);
  const [font, setFont] = useState<TerminalFont>(DEFAULT_TERMINAL_FONT);
  const [paletteId, setPaletteId] = useState<PaletteId>(DEFAULT_PALETTE_ID);
  const [useWebGPU, setUseWebGPU] = useState<boolean>(false);
  const [customPalette, setCustomPalette] = useState<CustomPalette>(
    DEFAULT_CUSTOM_PALETTE,
  );
  const [editorProtocol, setEditorProtocol] = useState<EditorProtocol>(
    DEFAULT_EDITOR_PROTOCOL,
  );
  const [popupEnabled, setPopupEnabled] = useState(true);
  const [navRailEnabled, setNavRailEnabled] = useState(true);
  const [messageFramesEnabled, setMessageFramesEnabled] = useState(true);
  const [autoScrollReplyEnabled, setAutoScrollReplyEnabled] = useState(true);
  // Session-only focus mode (mask everything but framed messages); not persisted.
  const [focusMessages, setFocusMessages] = useState(false);
  const palette = useMemo(
    () => resolveActivePalette(paletteId, customPalette),
    [paletteId, customPalette],
  );

  const [tabs, setTabs] = useState<Tab[]>([]);
  // Mirror of `tabs` for the (set-up-once) agent-state listener, so it can read
  // the current panes synchronously without a stale closure — `setTabs(fn)` runs
  // its updater asynchronously, so reading an outer var right after it is racy.
  const tabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const [activeTabIdByProject, setActiveTabIdByProject] = useState<
    Record<string, string>
  >({});
  /** tabIds that have a pending bell. Cleared when the tab is activated. */
  const [bellTabs, setBellTabs] = useState<Record<string, true>>({});
  /** paneId → current agent state, mirrored from the backend watcher via cwd.
   *  Consumed by T8 (Sidepanel badge) and T9 (TabBar badge). */
  const [paneAgentStates, setPaneAgentStates] = useState<
    Record<string, AgentStateValue>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(
    null,
  );
  const [paneMenu, setPaneMenu] = useState<PaneMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [colorTarget, setColorTarget] = useState<Project | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<
    { mode: "create" } | { mode: "rename"; workspace: Workspace } | null
  >(null);
  /** projectIds that have received real keyboard/paste input this app session.
   *  In-memory only (resets each launch). Drives the sidebar "Active" tab.
   *  Cleared for a project when its last tab closes (see closeTab). */
  const [activeInputProjectIds, setActiveInputProjectIds] = useState<
    Set<string>
  >(() => new Set());

  // paneId (= backend session_id) → tabId for fast routing of render/closed events.
  const paneToTab = useRef<Map<string, string>>(new Map());

  // Wrapper around the visible PaneTreeView. We measure it before spawning a
  // PTY so PowerShell starts at the right size — otherwise it boots at 120×30
  // and the first render lands on the wrong grid (visible only after the
  // ResizeObserver fires ~50ms later).
  const paneHostRef = useRef<HTMLDivElement>(null);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  // Mark a project as having received real user input this session. Called from
  // the terminal keydown/paste handlers via PaneTreeView's onUserInput.
  const markProjectInput = useCallback((projectId: string) => {
    setActiveInputProjectIds((prev) => {
      if (prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
  }, []);

  // Projects shown under the sidebar "Active" tab: received input this session
  // AND still have at least one open tab.
  const activeProjectIds = useMemo(
    () =>
      new Set(
        projects
          .filter(
            (p) =>
              activeInputProjectIds.has(p.id) &&
              tabs.some((t) => t.projectId === p.id),
          )
          .map((p) => p.id),
      ),
    [projects, activeInputProjectIds, tabs],
  );

  const visibleTabs = useMemo(
    () =>
      activeProjectId
        ? tabs.filter((t) => t.projectId === activeProjectId)
        : [],
    [tabs, activeProjectId],
  );
  const activeTabId = activeProjectId
    ? (activeTabIdByProject[activeProjectId] ?? null)
    : null;
  const activePaneIdOfActiveTab = useMemo(() => {
    if (!activeTabId) return null;
    return tabs.find((t) => t.id === activeTabId)?.activePaneId ?? null;
  }, [tabs, activeTabId]);

  // Focus the active pane when tabs/panes switch so the user can type
  // immediately. The Terminal/TerminalWebGPU components only focus on their
  // own `isActive` change, which doesn't fire on tab switches (panes in the
  // newly-revealed tab kept their `isActive` flag from before).
  // requestAnimationFrame defers the focus until after the visibility
  // transition (display:hidden → visible) settles.
  useEffect(() => {
    if (!activePaneIdOfActiveTab) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-pane-id="${activePaneIdOfActiveTab}"]`,
      );
      el?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTabId, activePaneIdOfActiveTab]);

  // Hand the keyboard back to the terminal (e.g. after validating a notepad
  // prompt). rAF defers until the layout settles after the panel unmounts.
  const focusActivePane = useCallback(() => {
    if (!activePaneIdOfActiveTab) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-pane-id="${activePaneIdOfActiveTab}"]`,
      );
      el?.focus();
    });
  }, [activePaneIdOfActiveTab]);

  // Refocus the active pane when the OS window regains focus (alt-tab,
  // taskbar click), so the user can type into Claude Code (or whatever is
  // running in the terminal) without having to click the pane first.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.tagName !== "HTML") {
          if (active.hasAttribute("data-pane-id")) return;
          if (active.closest('[role="dialog"], [data-radix-portal]')) return;
        }
        requestAnimationFrame(() => {
          if (!activePaneIdOfActiveTab) return;
          const el = document.querySelector<HTMLElement>(
            `[data-pane-id="${activePaneIdOfActiveTab}"]`,
          );
          el?.focus();
        });
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activePaneIdOfActiveTab]);

  // ─── Persistence ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    loadState()
      .then((state) => {
        if (cancelled) return;
        setProjects(state.projects);
        setWorkspaces(state.workspaces);
        setActiveProjectId(state.activeProjectId);
        setToolbarButtons(state.toolbarButtons);
        setFont(state.font);
        setPaletteId(state.paletteId);
        setUseWebGPU(state.useWebGPU);
        setCustomPalette(state.customPalette);
        setEditorProtocol(state.editorProtocol);
        setPopupEnabled(state.popupEnabled);
        setNavRailEnabled(state.navRailEnabled);
        setMessageFramesEnabled(state.messageFramesEnabled);
        setAutoScrollReplyEnabled(state.autoScrollReplyEnabled);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`failed to load store: ${String(e)}`);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      void saveState({
        projects,
        workspaces,
        activeProjectId,
        toolbarButtons,
        font,
        paletteId,
        useWebGPU,
        customPalette,
        editorProtocol,
        popupEnabled,
        navRailEnabled,
        messageFramesEnabled,
        autoScrollReplyEnabled,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [
    loaded,
    projects,
    workspaces,
    activeProjectId,
    toolbarButtons,
    font,
    paletteId,
    useWebGPU,
    customPalette,
    editorProtocol,
    popupEnabled,
    navRailEnabled,
    messageFramesEnabled,
    autoScrollReplyEnabled,
  ]);

  // The popup is triggered by the Rust backend, so mirror its on/off setting there.
  useEffect(() => {
    if (!loaded) return;
    void invoke("popup_set_enabled", { enabled: popupEnabled }).catch(() => {});
  }, [loaded, popupEnabled]);

  // The terminal auto-scroll is also driven by the backend (off the hook), so
  // mirror its on/off setting there too.
  useEffect(() => {
    if (!loaded) return;
    void invoke("popup_set_auto_scroll", {
      enabled: autoScrollReplyEnabled,
    }).catch(() => {});
  }, [loaded, autoScrollReplyEnabled]);

  // ─── Pane / tab spawning ────────────────────────────────────────

  // Measures the wrapper that will host the new pane, so the PTY boots at the
  // real grid size. Falls back to COLS/ROWS when no host is laid out yet (e.g.
  // a tab is spawned before any project pane host is mounted).
  const measureSpawnSize = useCallback((): { cols: number; rows: number } => {
    const el = paneHostRef.current;
    if (!el) return { cols: COLS, rows: ROWS };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { cols: COLS, rows: ROWS };
    const cell = measureCellSize(font.family, font.size);
    const PADDING_TOTAL = 24; // mirrors Terminal/TerminalWebGPU p-3
    const cols = Math.max(
      20,
      Math.floor((rect.width - PADDING_TOTAL) / cell.width),
    );
    const rows = Math.max(
      5,
      Math.floor((rect.height - PADDING_TOTAL) / cell.height),
    );
    return { cols, rows };
  }, [font.family, font.size]);

  const spawnPane = useCallback(
    async (cwd: string): Promise<string | null> => {
      const { cols, rows } = measureSpawnSize();
      try {
        const sessionId = await invoke<string>("spawn_terminal", {
          cwd,
          cols,
          rows,
        });
        return sessionId;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [measureSpawnSize],
  );

  const spawnTabFor = useCallback(
    async (
      project: Project,
    ): Promise<{ tabId: string; paneId: string } | null> => {
      const paneId = await spawnPane(project.path);
      if (!paneId) return null;
      const tabId = newTabId();
      paneToTab.current.set(paneId, tabId);
      const pane: PaneState = {
        id: paneId,
        title: project.name,
        cwd: null,
        screen: null,
      };
      const tab: Tab = {
        id: tabId,
        projectId: project.id,
        tree: { kind: "leaf", paneId },
        activePaneId: paneId,
        panes: { [paneId]: pane },
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabIdByProject((prev) => ({ ...prev, [project.id]: tabId }));
      return { tabId, paneId };
    },
    [spawnPane],
  );

  // ─── Closing ───────────────────────────────────────────────────

  const closeTab = useCallback(
    async (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId);
      if (!target) return;
      const projId = target.projectId;

      const inProj = tabs.filter((t) => t.projectId === projId);
      const idxInProj = inProj.findIndex((t) => t.id === tabId);
      const remainingInProj = inProj.filter((t) => t.id !== tabId);
      const nextActiveForProj =
        remainingInProj.length > 0
          ? remainingInProj[Math.max(0, idxInProj - 1)].id
          : undefined;
      const wasActive = activeTabIdByProject[projId] === tabId;

      setTabs((prev) => prev.filter((t) => t.id !== tabId));

      if (wasActive) {
        setActiveTabIdByProject((prev) => {
          const copy = { ...prev };
          if (nextActiveForProj) copy[projId] = nextActiveForProj;
          else delete copy[projId];
          return copy;
        });
      }

      // Closing the project's last tab drops it from the "Active" set, so a
      // reopened-but-untouched project starts out Inactive again.
      if (remainingInProj.length === 0) {
        setActiveInputProjectIds((prev) => {
          if (!prev.has(projId)) return prev;
          const next = new Set(prev);
          next.delete(projId);
          return next;
        });
      }

      const paneIds = collectPaneIds(target.tree);
      for (const pid of paneIds) {
        paneToTab.current.delete(pid);
        try {
          await invoke("close_terminal", { sessionId: pid });
        } catch {
          /* ignore */
        }
      }
    },
    [tabs, activeTabIdByProject],
  );

  const closePane = useCallback(
    async (tabId: string, paneId: string) => {
      let shouldCloseTab = false;
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (!tab) return prev;
        const newTree = removePaneFromTree(tab.tree, paneId);
        if (newTree === null) {
          shouldCloseTab = true;
          return prev; // closeTab will handle the removal + PTY teardown
        }
        const newPanes = { ...tab.panes };
        delete newPanes[paneId];
        const newActive =
          tab.activePaneId === paneId ? firstPaneId(newTree) : tab.activePaneId;
        return prev.map((t) =>
          t.id === tabId
            ? { ...t, tree: newTree, panes: newPanes, activePaneId: newActive }
            : t,
        );
      });

      if (shouldCloseTab) {
        await closeTab(tabId);
        return;
      }

      paneToTab.current.delete(paneId);
      try {
        await invoke("close_terminal", { sessionId: paneId });
      } catch {
        /* ignore */
      }
    },
    [closeTab],
  );

  // ─── Pane operations ───────────────────────────────────────────

  const focusPane = useCallback((tabId: string, paneId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
    );
  }, []);

  const splitPane = useCallback(
    async (tabId: string, paneId: string, direction: SplitDirection) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const project = projects.find((p) => p.id === tab.projectId);
      if (!project) return;
      // Inherit the live cwd of the parent pane if known (OSC 7 reported); else fall back to project root.
      const parentCwd = tab.panes[paneId]?.cwd ?? project.path;
      const newPaneId = await spawnPane(parentCwd);
      if (!newPaneId) return;
      paneToTab.current.set(newPaneId, tabId);
      const newPane: PaneState = {
        id: newPaneId,
        title: project.name,
        cwd: null,
        screen: null,
      };
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                tree: splitTreeAt(t.tree, paneId, direction, newPaneId),
                activePaneId: newPaneId,
                panes: { ...t.panes, [newPaneId]: newPane },
              }
            : t,
        ),
      );
    },
    [tabs, projects, spawnPane],
  );

  const setPaneRatio = useCallback(
    (tabId: string, path: number[], ratio: number) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, tree: updateTreeRatio(t.tree, path, ratio) }
            : t,
        ),
      );
    },
    [],
  );

  // ─── Event listeners (render + closed) ─────────────────────────

  useEffect(() => {
    let unlistenRender: UnlistenFn | undefined;
    let unlistenClosed: UnlistenFn | undefined;
    let unlistenCwd: UnlistenFn | undefined;
    let unlistenBell: UnlistenFn | undefined;
    let unlistenAgent: UnlistenFn | undefined;
    let active = true;

    async function setup() {
      unlistenRender = await listen<RenderPayload>(
        "terminal-render",
        (event) => {
          if (!active) return;
          const paneId = event.payload.session_id;
          const tabId = paneToTab.current.get(paneId);
          if (!tabId) return;
          setTabs((prev) =>
            prev.map((t) => {
              if (t.id !== tabId) return t;
              const pane = t.panes[paneId];
              if (!pane) return t;
              return {
                ...t,
                panes: {
                  ...t.panes,
                  [paneId]: {
                    ...pane,
                    screen: event.payload,
                    title: event.payload.title || pane.title,
                  },
                },
              };
            }),
          );
        },
      );
      unlistenClosed = await listen<ClosedPayload>(
        "terminal-closed",
        (event) => {
          if (!active) return;
          const paneId = event.payload.session_id;
          const tabId = paneToTab.current.get(paneId);
          if (!tabId) return;
          void closePane(tabId, paneId);
        },
      );
      unlistenCwd = await listen<CwdPayload>("terminal-cwd", async (event) => {
        if (!active) return;
        const paneId = event.payload.session_id;
        const tabId = paneToTab.current.get(paneId);
        if (!tabId) return;
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t;
            const pane = t.panes[paneId];
            if (!pane || pane.cwd === event.payload.cwd) return t;
            return {
              ...t,
              panes: {
                ...t.panes,
                [paneId]: { ...pane, cwd: event.payload.cwd },
              },
            };
          }),
        );
        // Refresh agent state from the registry — the watcher may already have a
        // session at this cwd from before this pane reported its cwd.
        try {
          const fresh = await invoke<AgentStateValue>("agent_state_for_pane", {
            paneId,
          });
          if (!active) return;
          setPaneAgentStates((prev) => ({ ...prev, [paneId]: fresh }));
        } catch {
          /* ignore */
        }
      });
      unlistenBell = await listen<BellPayload>("terminal-bell", (event) => {
        if (!active) return;
        const paneId = event.payload.session_id;
        const tabId = paneToTab.current.get(paneId);
        if (!tabId) return;
        setBellTabs((prev) =>
          prev[tabId] ? prev : { ...prev, [tabId]: true },
        );
      });
      unlistenAgent = await listen<AgentEventPayload>(
        "agent-state-changed",
        (event) => {
          if (!active) return;
          const { cwd, state } = event.payload;
          // Panes whose live cwd matches this event's cwd, read synchronously
          // from the tabs ref (a `setTabs` updater would run too late to drive
          // the side effects below).
          const matchingPaneIds: string[] = [];
          for (const tab of tabsRef.current) {
            for (const paneId of Object.keys(tab.panes)) {
              if (tab.panes[paneId].cwd === cwd) matchingPaneIds.push(paneId);
            }
          }
          if (matchingPaneIds.length === 0) return;
          // Badge state only. The terminal auto-scroll is NOT driven from here:
          // the watcher coalesces fast transcript writes and can skip the
          // busy→waiting edge, so we trigger it off the Stop hook instead (see
          // the `pane-reply-finished` listener below).
          setPaneAgentStates((prev) => {
            const next = { ...prev };
            for (const id of matchingPaneIds) next[id] = state;
            return next;
          });
        },
      );
      // The terminal auto-scroll to the reply start is driven entirely in the
      // backend (off the Stop/PreToolUse hook, when Arkadia is foreground) — no
      // frontend listener needed. Its on/off setting is synced below.
    }
    void setup();

    return () => {
      active = false;
      unlistenRender?.();
      unlistenClosed?.();
      unlistenCwd?.();
      unlistenBell?.();
      unlistenAgent?.();
    };
  }, [closePane]);

  // ─── Focus a pane on request from the notification popup ────────
  // The "open in Arkadia" button emits `focus-pane` with the pane id; bring its
  // project + tab forward and focus the pane so the user lands on the
  // conversation they were notified about.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;
    void listen<string>("focus-pane", (event) => {
      if (!active) return;
      const paneId = event.payload;
      const tabId = paneToTab.current.get(paneId);
      if (!tabId) return;
      setTabs((cur) => {
        const tab = cur.find((t) => t.id === tabId);
        if (!tab) return cur;
        setActiveProjectId(tab.projectId);
        setActiveTabIdByProject((prev) => ({
          ...prev,
          [tab.projectId]: tabId,
        }));
        return cur.map((t) =>
          t.id === tabId ? { ...t, activePaneId: paneId } : t,
        );
      });
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-pane-id="${paneId}"]`,
        );
        el?.focus();
      });
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // ─── Auto-spawn first tab when activating an empty project ────

  useEffect(() => {
    if (!loaded) return;
    if (!activeProject) return;
    const hasTab = tabs.some((t) => t.projectId === activeProject.id);
    if (!hasTab) {
      void spawnTabFor(activeProject);
    } else if (!activeTabIdByProject[activeProject.id]) {
      const first = tabs.find((t) => t.projectId === activeProject.id);
      if (first) {
        setActiveTabIdByProject((prev) => ({
          ...prev,
          [activeProject.id]: first.id,
        }));
      }
    }
  }, [loaded, activeProject, tabs, activeTabIdByProject, spawnTabFor]);

  // Cleanup all sessions on unmount (HMR / app close)
  useEffect(() => {
    const map = paneToTab.current;
    return () => {
      map.forEach((_tabId, paneId) => {
        void invoke("close_terminal", { sessionId: paneId });
      });
      map.clear();
    };
  }, []);

  // OS file drag & drop: insert quoted paths into the pane under the cursor.
  useEffect(() => {
    let unlistenFn: UnlistenFn | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const { paths, position } = event.payload;
        if (!paths || paths.length === 0) return;
        // PhysicalPosition → CSS pixels for getBoundingClientRect comparison.
        const dpr = window.devicePixelRatio || 1;
        const x = position.x / dpr;
        const y = position.y / dpr;
        const targets =
          document.querySelectorAll<HTMLElement>("[data-pane-id]");
        let targetPaneId: string | null = null;
        for (const el of Array.from(targets)) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            targetPaneId = el.dataset.paneId ?? null;
            break;
          }
        }
        if (!targetPaneId) return;
        const quoted = paths.map((p) => `"${p}"`).join(" ");
        const bytes = Array.from(new TextEncoder().encode(quoted));
        void invoke("send_input", { sessionId: targetPaneId, bytes });
      })
      .then((fn) => {
        // StrictMode mounts the effect twice in dev: if cleanup ran before the
        // promise resolved, unlisten immediately to avoid a duplicate listener.
        if (cancelled) fn();
        else unlistenFn = fn;
      });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Ctrl+T new tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "t") {
        if (activeProject) {
          e.preventDefault();
          void spawnTabFor(activeProject);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeProject, spawnTabFor]);

  // ─── Project + tab handlers ────────────────────────────────────

  const onActivateTab = (id: string) => {
    if (!activeProjectId) return;
    setActiveTabIdByProject((prev) => ({ ...prev, [activeProjectId]: id }));
    setBellTabs((prev) => {
      if (!prev[id]) return prev;
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const onAddProject = (data: {
    name: string;
    path: string;
    color: string;
  }) => {
    const project: Project = {
      id: newProjectId(),
      name: data.name,
      path: data.path,
      color: data.color,
      order: projects.length,
    };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setAddOpen(false);
  };

  const onDeleteProject = (id: string) => {
    const tabsOfProj = tabs.filter((t) => t.projectId === id);
    tabsOfProj.forEach((t) => {
      const paneIds = collectPaneIds(t.tree);
      paneIds.forEach((pid) => {
        paneToTab.current.delete(pid);
        void invoke("close_terminal", { sessionId: pid });
      });
    });
    setTabs((prev) => prev.filter((t) => t.projectId !== id));
    setActiveTabIdByProject((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setProjects((prev) =>
      prev.filter((p) => p.id !== id).map((p, idx) => ({ ...p, order: idx })),
    );
    setActiveProjectId((cur) => {
      if (cur !== id) return cur;
      const remaining = projects.filter((p) => p.id !== id);
      return remaining.length > 0 ? remaining[0].id : null;
    });
  };

  const onRenameProject = (id: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const onChangeColor = (id: string, color: string) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
  };

  // ─── Workspace handlers ────────────────────────────────────────

  const onAddWorkspace = (name: string) => {
    const workspace: Workspace = {
      id: newWorkspaceId(),
      name,
      order: workspaces.length,
      collapsed: false,
    };
    setWorkspaces((prev) => [...prev, workspace]);
  };

  const onRenameWorkspace = (id: string, name: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, name } : w)),
    );
  };

  const onDeleteWorkspace = (id: string) => {
    setWorkspaces((prev) =>
      prev.filter((w) => w.id !== id).map((w, idx) => ({ ...w, order: idx })),
    );
    setProjects((prev) =>
      prev.map((p) => (p.workspaceId === id ? { ...p, workspaceId: null } : p)),
    );
  };

  const onReorderWorkspaces = (oldIndex: number, newIndex: number) => {
    setWorkspaces((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const reordered = arrayMove(sorted, oldIndex, newIndex);
      return reordered.map((w, idx) => ({ ...w, order: idx }));
    });
  };

  const onToggleWorkspaceCollapsed = (id: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, collapsed: !w.collapsed } : w)),
    );
  };

  const onMoveProject = (
    projectId: string,
    targetWorkspaceId: string | null,
    insertBeforeProjectId: string | null,
  ) => {
    setProjects((prev) => {
      const moving = prev.find((p) => p.id === projectId);
      if (!moving) return prev;
      // Remove from current group, recompute orders for the source group.
      const others = prev.filter((p) => p.id !== projectId);
      // Build the list of projects in the target workspace (without the moved one).
      const inTarget = others
        .filter((p) => (p.workspaceId ?? null) === targetWorkspaceId)
        .sort((a, b) => a.order - b.order);
      let insertIdx = inTarget.length;
      if (insertBeforeProjectId) {
        const idx = inTarget.findIndex((p) => p.id === insertBeforeProjectId);
        if (idx >= 0) insertIdx = idx;
      }
      const updatedMoving: Project = {
        ...moving,
        workspaceId: targetWorkspaceId,
        // When entering a workspace, drop any standalone root placement.
        rootOrder: undefined,
      };
      const newTarget = [
        ...inTarget.slice(0, insertIdx),
        updatedMoving,
        ...inTarget.slice(insertIdx),
      ].map((p, idx) => ({ ...p, order: idx }));
      // Reassign order in the source group too.
      const sourceWs = moving.workspaceId ?? null;
      const newSource =
        sourceWs === targetWorkspaceId
          ? [] // already handled in newTarget
          : others
              .filter((p) => (p.workspaceId ?? null) === sourceWs)
              .sort((a, b) => a.order - b.order)
              .map((p, idx) => ({ ...p, order: idx }));
      // Other groups remain untouched.
      const untouched = others.filter((p) => {
        const ws = p.workspaceId ?? null;
        return ws !== targetWorkspaceId && ws !== sourceWs;
      });
      return [...untouched, ...newSource, ...newTarget];
    });
  };

  // Place a project as a standalone item amongst the root-level workspaces.
  // It becomes ungrouped and its `rootOrder` decides where it sits in the merged
  // root list (compared against `Workspace.order`).
  const onPlaceProjectInRoot = (projectId: string, rootOrder: number) => {
    setProjects((prev) => {
      const moving = prev.find((p) => p.id === projectId);
      if (!moving) return prev;
      const sourceWs = moving.workspaceId ?? null;
      const others = prev.filter((p) => p.id !== projectId);
      const updatedMoving: Project = {
        ...moving,
        workspaceId: null,
        order: 0,
        rootOrder,
      };
      // Renormalize the source group's order if the project is leaving a workspace.
      const newSource =
        sourceWs === null
          ? []
          : others
              .filter((p) => (p.workspaceId ?? null) === sourceWs)
              .sort((a, b) => a.order - b.order)
              .map((p, idx) => ({ ...p, order: idx }));
      const untouched = others.filter((p) => {
        const ws = p.workspaceId ?? null;
        return ws !== sourceWs && ws !== null;
      });
      const ungrouped = others.filter((p) => (p.workspaceId ?? null) === null);
      return [...untouched, ...newSource, ...ungrouped, updatedMoving];
    });
  };

  // Move a workspace to an arbitrary position in the merged root list (used when
  // dropping a workspace into a root gap that's adjacent to a standalone project).
  const onPlaceWorkspaceInRoot = (workspaceId: string, rootOrder: number) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === workspaceId ? { ...w, order: rootOrder } : w)),
    );
  };

  const onReorderTabs = (oldIndex: number, newIndex: number) => {
    if (!activeProjectId) return;
    setTabs((prev) => {
      const inProject = prev.filter((t) => t.projectId === activeProjectId);
      const reordered = arrayMove(inProject, oldIndex, newIndex);
      let i = 0;
      return prev.map((t) =>
        t.projectId === activeProjectId ? reordered[i++] : t,
      );
    });
  };

  // Jump to the previous/next conversation message (kind 1 = user `❯`,
  // 2 = Claude white `●`) in the active pane. The backend owns the strategy:
  // direct scrollback jump on the main screen, wheel-event feedback loop on
  // the alt screen (Claude Code scrolls its own transcript).
  const navigateMessage = useCallback(
    async (kind: 1 | 2, dir: -1 | 1) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      const pane = tab ? tab.panes[tab.activePaneId] : undefined;
      if (!pane) return;
      try {
        await invoke<boolean>("navigate_message", {
          sessionId: pane.id,
          kind,
          dir,
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [tabs, activeTabId],
  );

  const runToolbarAction = useCallback(
    async (button: ActionButton) => {
      if (!activeProject) return;
      const spawned = await spawnTabFor(activeProject);
      if (!spawned) return;
      // Wait for pwsh + PSReadLine to be ready, then send the command.
      setTimeout(async () => {
        try {
          const text = button.command + "\r";
          const bytes = Array.from(new TextEncoder().encode(text));
          await invoke("send_input", {
            sessionId: spawned.paneId,
            bytes,
          });
        } catch (e) {
          setError(String(e));
        }
      }, TOOLBAR_RUN_DELAY_MS);
    },
    [activeProject, spawnTabFor],
  );

  if (!loaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-xs text-zinc-600">
        loading…
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen bg-zinc-950 text-zinc-100">
      <Sidepanel
        projects={projects}
        workspaces={workspaces}
        activeProjectId={activeProjectId}
        onActivate={setActiveProjectId}
        onAdd={() => setAddOpen(true)}
        onAddWorkspace={() => setWorkspaceDialog({ mode: "create" })}
        onProjectContextMenu={(project, x, y) =>
          setProjectMenu({ project, x, y })
        }
        onWorkspaceContextMenu={(workspace, x, y) =>
          setWorkspaceMenu({ workspace, x, y })
        }
        onMoveProject={onMoveProject}
        onPlaceProjectInRoot={onPlaceProjectInRoot}
        onReorderWorkspaces={onReorderWorkspaces}
        onPlaceWorkspaceInRoot={onPlaceWorkspaceInRoot}
        onToggleWorkspaceCollapsed={onToggleWorkspaceCollapsed}
        tabs={tabs}
        paneAgentStates={paneAgentStates}
        activeProjectIds={activeProjectIds}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TabBar
          tabs={visibleTabs}
          activeTabId={activeTabId}
          bellTabs={bellTabs}
          onActivate={onActivateTab}
          onClose={closeTab}
          onSpawn={() => activeProject && spawnTabFor(activeProject)}
          onReorder={onReorderTabs}
          disabled={!activeProject}
        />

        <Toolbar
          buttons={toolbarButtons}
          onRunAction={runToolbarAction}
          onOpenSettings={() => setSettingsOpen(true)}
          disabled={!activeProject}
          notepadOpen={notepadOpen}
          onToggleNotepad={() => {
            setNotepadOpen((v) => !v);
            setReadingOpen(false);
          }}
          readingOpen={readingOpen}
          onToggleReading={() => {
            setReadingOpen((v) => !v);
            setNotepadOpen(false);
          }}
        />

        {error && (
          <div className="mx-4 mt-2 flex items-start gap-3 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            <span className="flex-1 break-words">{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
              className="-mr-1 rounded px-1.5 py-0.5 text-red-400 transition-colors hover:bg-red-900/40 hover:text-red-200"
            >
              ×
            </button>
          </div>
        )}

        <div ref={paneHostRef} className="relative flex flex-1 overflow-hidden">
          {activeProject && navRailEnabled && (
            <MessageNavRail
              onNavigate={navigateMessage}
              disabled={!activePaneIdOfActiveTab}
              focusActive={focusMessages}
              onToggleFocus={() => setFocusMessages((v) => !v)}
            />
          )}
          {!activeProject && (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              {projects.length === 0
                ? "no project yet — add one in the sidepanel"
                : "select a project in the sidepanel"}
            </div>
          )}
          {activeProject &&
            visibleTabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex min-h-0 min-w-0 flex-1 ${
                  tab.id === activeTabId ? "" : "hidden"
                }`}
              >
                <PaneTreeView
                  tree={tab.tree}
                  panes={tab.panes}
                  activePaneId={tab.activePaneId}
                  font={font}
                  palette={palette}
                  useWebGPU={useWebGPU}
                  editorProtocol={editorProtocol}
                  showMessageFrames={messageFramesEnabled}
                  focusMessages={focusMessages}
                  onActivate={(paneId) => focusPane(tab.id, paneId)}
                  onUserInput={() => markProjectInput(tab.projectId)}
                  onContextMenu={(paneId, x, y) =>
                    setPaneMenu({ tabId: tab.id, paneId, x, y })
                  }
                  onSetRatio={(path, ratio) =>
                    setPaneRatio(tab.id, path, ratio)
                  }
                />
              </div>
            ))}
        </div>
      </div>

      {readingOpen && (
        <ReadingPanel
          paneId={activePaneIdOfActiveTab}
          projectName={activeProject?.name ?? null}
          palette={palette}
          onClose={() => setReadingOpen(false)}
        />
      )}

      {notepadOpen && (
        <NotepadPanel
          projectId={activeProject?.id ?? null}
          projectName={activeProject?.name ?? null}
          onClose={() => setNotepadOpen(false)}
          onValidated={() => {
            setNotepadOpen(false);
            focusActivePane();
          }}
        />
      )}

      <AddProjectDialog
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onSubmit={onAddProject}
      />

      {projectMenu && (
        <ProjectContextMenu
          x={projectMenu.x}
          y={projectMenu.y}
          workspaces={workspaces}
          currentWorkspaceId={projectMenu.project.workspaceId}
          onRename={() => setRenameTarget(projectMenu.project)}
          onChangeColor={() => setColorTarget(projectMenu.project)}
          onDelete={async () => {
            const proj = projectMenu.project;
            const ok = await ask(`Delete project "${proj.name}"?`, {
              title: "Delete project",
              kind: "warning",
            });
            if (ok) onDeleteProject(proj.id);
          }}
          onMoveToWorkspace={(workspaceId) =>
            onMoveProject(projectMenu.project.id, workspaceId, null)
          }
          onClose={() => setProjectMenu(null)}
        />
      )}

      {workspaceMenu && (
        <WorkspaceContextMenu
          x={workspaceMenu.x}
          y={workspaceMenu.y}
          onRename={() =>
            setWorkspaceDialog({
              mode: "rename",
              workspace: workspaceMenu.workspace,
            })
          }
          onDelete={async () => {
            const ws = workspaceMenu.workspace;
            const ok = await ask(
              `Delete workspace "${ws.name}"? Its projects will become ungrouped.`,
              { title: "Delete workspace", kind: "warning" },
            );
            if (ok) onDeleteWorkspace(ws.id);
          }}
          onClose={() => setWorkspaceMenu(null)}
        />
      )}

      <WorkspaceDialog
        open={!!workspaceDialog}
        title={
          workspaceDialog?.mode === "rename"
            ? "Rename workspace"
            : "New workspace"
        }
        initialValue={
          workspaceDialog?.mode === "rename"
            ? workspaceDialog.workspace.name
            : ""
        }
        onCancel={() => setWorkspaceDialog(null)}
        onSubmit={(name) => {
          if (!workspaceDialog) return;
          if (workspaceDialog.mode === "create") {
            onAddWorkspace(name);
          } else {
            onRenameWorkspace(workspaceDialog.workspace.id, name);
          }
          setWorkspaceDialog(null);
        }}
      />

      {paneMenu && (
        <PaneContextMenu
          x={paneMenu.x}
          y={paneMenu.y}
          canClose={true}
          onSplitHorizontal={() =>
            splitPane(paneMenu.tabId, paneMenu.paneId, "horizontal")
          }
          onSplitVertical={() =>
            splitPane(paneMenu.tabId, paneMenu.paneId, "vertical")
          }
          onClose={() => closePane(paneMenu.tabId, paneMenu.paneId)}
          onDismiss={() => setPaneMenu(null)}
        />
      )}

      <RenameDialog
        open={!!renameTarget}
        initialValue={renameTarget?.name ?? ""}
        onCancel={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (renameTarget) onRenameProject(renameTarget.id, name);
          setRenameTarget(null);
        }}
      />

      <ColorPickerDialog
        open={!!colorTarget}
        initialValue={colorTarget?.color ?? "#000000"}
        onCancel={() => setColorTarget(null)}
        onSubmit={(color) => {
          if (colorTarget) onChangeColor(colorTarget.id, color);
          setColorTarget(null);
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        buttons={toolbarButtons}
        onChangeButtons={setToolbarButtons}
        font={font}
        onChangeFont={setFont}
        paletteId={paletteId}
        onChangePaletteId={setPaletteId}
        useWebGPU={useWebGPU}
        onChangeUseWebGPU={setUseWebGPU}
        customPalette={customPalette}
        onChangeCustomPalette={setCustomPalette}
        editorProtocol={editorProtocol}
        onChangeEditorProtocol={setEditorProtocol}
        popupEnabled={popupEnabled}
        onChangePopupEnabled={setPopupEnabled}
        navRailEnabled={navRailEnabled}
        onChangeNavRailEnabled={setNavRailEnabled}
        messageFramesEnabled={messageFramesEnabled}
        onChangeMessageFramesEnabled={setMessageFramesEnabled}
        autoScrollReplyEnabled={autoScrollReplyEnabled}
        onChangeAutoScrollReplyEnabled={setAutoScrollReplyEnabled}
      />
    </div>
  );
}
