import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { aggregate, isActive, type AgentStateValue } from "@/lib/agentState";
import { sortActiveProjects } from "@/lib/activeOrder";
import { stripStatusGlyph } from "@/lib/notifLabel";
import {
  nextSidebarSessionCount,
  recentSessionsByProject,
  toggleSidebarSessionProject,
  type ClaudeSession,
} from "@/lib/sessionsIndex";
import type { Project, Tab, Workspace } from "@/types";
import { AgentBadge } from "./AgentBadge";

interface SidepanelProps {
  projects: Project[];
  workspaces: Workspace[];
  activeProjectId: string | null;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onAddWorkspace: () => void;
  onProjectContextMenu: (project: Project, x: number, y: number) => void;
  /** Middle-click on a project row in the "Active" list closes all its tabs. */
  onCloseProjectTabs: (projectId: string) => void;
  /** Middle-click on a tab listed under an active project closes that tab. */
  onCloseTab: (tabId: string) => void;
  onWorkspaceContextMenu: (workspace: Workspace, x: number, y: number) => void;
  onMoveProject: (
    projectId: string,
    targetWorkspaceId: string | null,
    insertBeforeProjectId: string | null,
  ) => void;
  onPlaceProjectInRoot: (projectId: string, rootOrder: number) => void;
  onReorderWorkspaces: (oldIndex: number, newIndex: number) => void;
  onPlaceWorkspaceInRoot: (workspaceId: string, rootOrder: number) => void;
  onToggleWorkspaceCollapsed: (id: string) => void;
  /** Drag-reorder of the "Active" list: full list of active project ids in
   *  their new visual order (persisted as `Project.activeOrder`). */
  onReorderActive: (orderedIds: string[]) => void;
  /** Rebuild the previous session's tabs (null = nothing to restore). */
  onRestoreSession: (() => void) | null;
  /** Open the cross-project browser of past Claude sessions. */
  onOpenSessions: () => void;
  /** Preview this transcript in the main terminal area. */
  onOpenSession: (session: ClaudeSession) => void;
  /** Jump to a tab of any project from the "Active" list (activates both). */
  onActivateTab: (projectId: string, tabId: string) => void;
  tabs: Tab[];
  paneAgentStates: Record<string, AgentStateValue>;
  /** Current tab of each project — the one highlighted in its group. */
  activeTabIdByProject: Record<string, string>;
  /** Projects considered "active" (received input this session + still have a
   *  tab open). Shown flat under the "Active" tab, hidden from "Inactive". */
  activeProjectIds: ReadonlySet<string>;
}

const UNGROUPED_ID = "__ungrouped__";

// Drop target is decided by the pointer position, not by the drag preview's
// rectangle. Falls back to closestCenter for pointer-in-gutter situations.
const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args);
};

// Snap the drag preview so its center sits under the cursor, regardless of
// where the user grabbed the original element.
const snapCenterToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const ev = activatorEvent as PointerEvent | MouseEvent | TouchEvent;
  const clientX =
    "clientX" in ev
      ? ev.clientX
      : ((ev as TouchEvent).touches?.[0]?.clientX ?? 0);
  const clientY =
    "clientY" in ev
      ? ev.clientY
      : ((ev as TouchEvent).touches?.[0]?.clientY ?? 0);
  const offsetX = clientX - draggingNodeRect.left;
  const offsetY = clientY - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
};

interface ProjectDragData {
  type: "project";
  projectId: string;
  workspaceId: string | null;
}

interface WorkspaceDragData {
  type: "workspace";
  workspaceId: string;
}

interface WorkspaceDropData {
  type: "workspace-drop";
  workspaceId: string | null;
}

interface ProjectDropData {
  type: "project-drop";
  projectId: string;
  workspaceId: string | null;
}

interface ProjectGapDropData {
  type: "project-gap";
  workspaceId: string | null;
  insertBeforeProjectId: string | null;
}

interface WorkspaceGapDropData {
  type: "workspace-gap";
  insertBeforeWorkspaceId: string | null;
  /** Target rootOrder to assign when an item is dropped here. */
  targetOrder: number;
}

type DragData = ProjectDragData | WorkspaceDragData;
type DragKind = DragData["type"];
type DropData =
  | WorkspaceDropData
  | ProjectDropData
  | ProjectGapDropData
  | WorkspaceGapDropData
  | DragData;

// One entry per tab, in tab-bar order (`tabs` array order — drag-reordering
// the tabs reorders them too). A tab's state is the aggregate of its panes
// (splits); only tabs with an active Claude session (busy/waiting) show up —
// idle tabs are left out entirely.
interface TabAgentState {
  tabId: string;
  /** Title of the tab's active pane, minus the status glyph Claude Code stamps
   *  in — the badge next to it already says waiting vs. busy. */
  title: string;
  state: AgentStateValue;
}

function projectAgentStates(
  projectId: string,
  tabs: Tab[],
  paneAgentStates: Record<string, AgentStateValue>,
): TabAgentState[] {
  const states: TabAgentState[] = [];
  for (const tab of tabs) {
    if (tab.projectId !== projectId) continue;
    const tabState = aggregate(
      Object.keys(tab.panes).map(
        (paneId) => paneAgentStates[paneId] ?? { kind: "none" },
      ),
    );
    if (!isActive(tabState)) continue;
    states.push({
      tabId: tab.id,
      title:
        stripStatusGlyph(tab.panes[tab.activePaneId]?.title ?? "") || "pwsh",
      state: tabState,
    });
  }
  return states;
}

function workspaceAgentState(
  workspaceId: string | null,
  projects: Project[],
  tabs: Tab[],
  paneAgentStates: Record<string, AgentStateValue>,
): AgentStateValue {
  const states: AgentStateValue[] = [];
  for (const p of projects) {
    const pws = p.workspaceId ?? null;
    if (pws !== workspaceId) continue;
    for (const tab of tabs) {
      if (tab.projectId !== p.id) continue;
      for (const paneId of Object.keys(tab.panes)) {
        states.push(paneAgentStates[paneId] ?? { kind: "none" });
      }
    }
  }
  return aggregate(states);
}

type RootEntry =
  | { kind: "workspace"; id: string; order: number; workspace: Workspace }
  | { kind: "loose-project"; id: string; order: number; project: Project };

export function Sidepanel({
  projects,
  workspaces,
  activeProjectId,
  onActivate,
  onAdd,
  onAddWorkspace,
  onProjectContextMenu,
  onCloseProjectTabs,
  onCloseTab,
  onWorkspaceContextMenu,
  onMoveProject,
  onPlaceProjectInRoot,
  onReorderWorkspaces,
  onPlaceWorkspaceInRoot,
  onToggleWorkspaceCollapsed,
  onReorderActive,
  onRestoreSession,
  onOpenSessions,
  onOpenSession,
  onActivateTab,
  tabs,
  paneAgentStates,
  activeTabIdByProject,
  activeProjectIds,
}: SidepanelProps) {
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [view, setView] = useState<"active" | "inactive">("inactive");
  const [indexedSessions, setIndexedSessions] = useState<ClaudeSession[]>([]);
  const [openSessionProjectId, setOpenSessionProjectId] = useState<
    string | null
  >(null);
  const [loadingSessionProjectId, setLoadingSessionProjectId] = useState<
    string | null
  >(null);
  const sessionLoadSeq = useRef(0);
  const [shownByProject, setShownByProject] = useState<Record<string, number>>(
    {},
  );

  // Keep Inactive cheap: the session index is not touched until a project row
  // is explicitly opened. A second click closes it; opening another project
  // replaces it, so the default list always stays compact.
  const activateInactiveProject = (projectId: string) => {
    const nextOpenId = toggleSidebarSessionProject(
      openSessionProjectId,
      projectId,
    );
    setOpenSessionProjectId(nextOpenId);
    onActivate(projectId);

    const seq = ++sessionLoadSeq.current;
    if (!nextOpenId) {
      setLoadingSessionProjectId(null);
      return;
    }

    setShownByProject((prev) => ({ ...prev, [projectId]: 2 }));
    setLoadingSessionProjectId(projectId);
    void invoke<ClaudeSession[]>("list_claude_sessions")
      .then((sessions) => {
        if (seq === sessionLoadSeq.current) setIndexedSessions(sessions);
      })
      .catch(() => {})
      .finally(() => {
        if (seq === sessionLoadSeq.current) setLoadingSessionProjectId(null);
      });
  };

  const sessionsByProject = useMemo(
    () => recentSessionsByProject(indexedSessions, projects),
    [indexedSessions, projects],
  );

  const showMoreProjectSessions = (projectId: string, total: number) => {
    setShownByProject((prev) => ({
      ...prev,
      [projectId]: nextSidebarSessionCount(prev[projectId] ?? 2, total),
    }));
  };

  const showLessProjectSessions = (projectId: string) => {
    setShownByProject((prev) => ({ ...prev, [projectId]: 2 }));
  };

  // Auto-switch to the Active tab when a project transitions inactive→active
  // (the user typed in one of its terminals). Never switches back the other way.
  const prevActiveIdsRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const prev = prevActiveIdsRef.current;
    prevActiveIdsRef.current = activeProjectIds;
    if (!prev) return; // initial render — keep the default view
    for (const id of activeProjectIds) {
      if (!prev.has(id)) {
        setView("active");
        return;
      }
    }
  }, [activeProjectIds]);

  // "Active" tab: flat list of active projects — manual drag order first
  // (persisted `activeOrder`), never-reordered ones after, by name.
  const activeProjects = useMemo(
    () =>
      sortActiveProjects(projects.filter((p) => activeProjectIds.has(p.id))),
    [projects, activeProjectIds],
  );
  // "Inactive" tab shows the usual tree minus active projects (workspaces kept).
  const inactiveProjects = useMemo(
    () => projects.filter((p) => !activeProjectIds.has(p.id)),
    [projects, activeProjectIds],
  );

  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => a.order - b.order),
    [workspaces],
  );

  // Group projects by workspaceId (null = ungrouped). Each group is sorted by order.
  const projectsByWorkspace = useMemo(() => {
    const map = new Map<string | null, Project[]>();
    for (const p of inactiveProjects) {
      const ws = p.workspaceId ?? null;
      if (!map.has(ws)) map.set(ws, []);
      map.get(ws)!.push(p);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
    return map;
  }, [inactiveProjects]);

  // Merged root list: workspaces and standalone (loose) ungrouped projects,
  // sorted by their shared order axis. Ungrouped projects without a rootOrder
  // stay in the legacy bottom group instead.
  const rootEntries = useMemo<RootEntry[]>(() => {
    const entries: RootEntry[] = [];
    for (const w of workspaces) {
      entries.push({
        kind: "workspace",
        id: w.id,
        order: w.order,
        workspace: w,
      });
    }
    for (const p of inactiveProjects) {
      if ((p.workspaceId ?? null) !== null) continue;
      if (typeof p.rootOrder !== "number") continue;
      entries.push({
        kind: "loose-project",
        id: p.id,
        order: p.rootOrder,
        project: p,
      });
    }
    entries.sort((a, b) => a.order - b.order);
    return entries;
  }, [workspaces, inactiveProjects]);

  const fallbackUngroupedProjects = useMemo(
    () =>
      inactiveProjects.filter(
        (p) =>
          (p.workspaceId ?? null) === null && typeof p.rootOrder !== "number",
      ),
    [inactiveProjects],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data) setActiveDrag(data);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as DragData | undefined;
    const overData = over.data.current as DropData | undefined;
    if (!activeData || !overData) return;

    if (activeData.type === "workspace") {
      if (overData.type === "workspace-gap") {
        // Drop the workspace at an absolute root position. Works whether the
        // gap is between two workspaces, between a workspace and a loose
        // project, or at the start/end of the root list.
        onPlaceWorkspaceInRoot(activeData.workspaceId, overData.targetOrder);
        return;
      }
      if (overData.type === "workspace") {
        const oldIndex = sortedWorkspaces.findIndex(
          (w) => w.id === activeData.workspaceId,
        );
        const newIndex = sortedWorkspaces.findIndex(
          (w) => w.id === overData.workspaceId,
        );
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
        onReorderWorkspaces(oldIndex, newIndex);
        return;
      }
    }

    if (activeData.type === "project") {
      if (overData.type === "project-gap") {
        onMoveProject(
          activeData.projectId,
          overData.workspaceId,
          overData.insertBeforeProjectId,
        );
        return;
      }
      if (overData.type === "project-drop") {
        // Drop before this project (within its workspace).
        onMoveProject(
          activeData.projectId,
          overData.workspaceId,
          overData.projectId,
        );
        return;
      }
      if (overData.type === "workspace-drop") {
        // Drop into the workspace area (or header) → append to the end.
        onMoveProject(activeData.projectId, overData.workspaceId, null);
        return;
      }
      if (overData.type === "workspace-gap") {
        // Drop the project as a standalone item between root entries.
        onPlaceProjectInRoot(activeData.projectId, overData.targetOrder);
        return;
      }
    }
  };

  const activeDragKind: DragKind | null = activeDrag?.type ?? null;

  const renderGroup = (
    workspaceId: string | null,
    workspace: Workspace | null,
  ) => {
    const projectsInGroup =
      workspaceId === null
        ? fallbackUngroupedProjects
        : (projectsByWorkspace.get(workspaceId) ?? []);
    const isCollapsed = workspace?.collapsed ?? false;
    const groupAgent = workspaceAgentState(
      workspaceId,
      projects,
      tabs,
      paneAgentStates,
    );
    return (
      <WorkspaceSection
        key={workspaceId ?? UNGROUPED_ID}
        workspace={workspace}
        workspaceId={workspaceId}
        projects={projectsInGroup}
        collapsed={isCollapsed}
        agentState={groupAgent}
        activeDragKind={activeDragKind}
        onToggleCollapsed={
          workspace ? () => onToggleWorkspaceCollapsed(workspace.id) : undefined
        }
        onWorkspaceContextMenu={onWorkspaceContextMenu}
        onProjectContextMenu={onProjectContextMenu}
        onActivate={activateInactiveProject}
        activeProjectId={activeProjectId}
        tabs={tabs}
        paneAgentStates={paneAgentStates}
        sessionsByProject={sessionsByProject}
        shownByProject={shownByProject}
        onShowMoreProjectSessions={showMoreProjectSessions}
        onShowLessProjectSessions={showLessProjectSessions}
        onOpenSession={onOpenSession}
        openSessionProjectId={openSessionProjectId}
        loadingSessionProjectId={loadingSessionProjectId}
      />
    );
  };

  const renderLooseProject = (project: Project) => (
    <div className="mb-2">
      <DraggableProjectRow
        project={project}
        active={project.id === activeProjectId}
        onActivate={activateInactiveProject}
        onContextMenu={onProjectContextMenu}
        agentStates={projectAgentStates(project.id, tabs, paneAgentStates)}
        sessions={sessionsByProject[project.id] ?? []}
        shown={shownByProject[project.id] ?? 2}
        onShowMore={() =>
          showMoreProjectSessions(
            project.id,
            sessionsByProject[project.id]?.length ?? 0,
          )
        }
        onShowLess={() => showLessProjectSessions(project.id)}
        onOpenSession={onOpenSession}
        sessionsVisible={openSessionProjectId === project.id}
        sessionsLoading={loadingSessionProjectId === project.id}
      />
    </div>
  );

  const ungroupedHasProjects = fallbackUngroupedProjects.length > 0;

  // Compute target rootOrder for each gap: midpoint between neighbors.
  const gapTargetOrder = (i: number): number => {
    const prev = i > 0 ? rootEntries[i - 1].order : null;
    const next = i < rootEntries.length ? rootEntries[i].order : null;
    if (prev === null && next === null) return 0;
    if (prev === null) return (next as number) - 1;
    if (next === null) return prev + 1;
    return (prev + next) / 2;
  };

  return (
    <aside className="chrome-surface flex h-full w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setView("active")}
          className={`flex-1 px-2 py-2 text-xs ${
            view === "active"
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-900"
          }`}
        >
          Active{activeProjects.length > 0 ? ` · ${activeProjects.length}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setView("inactive")}
          className={`flex-1 border-l border-zinc-800 px-2 py-2 text-xs ${
            view === "inactive"
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-900"
          }`}
        >
          Inactive
        </button>
      </div>
      {view === "active" ? (
        <div className="scrollbar-none flex-1 overflow-y-auto py-2">
          {activeProjects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">
              no active project — type in a terminal to mark it active
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => {
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                const ids = activeProjects.map((p) => p.id);
                const from = ids.indexOf(String(active.id));
                const to = ids.indexOf(String(over.id));
                if (from < 0 || to < 0) return;
                onReorderActive(arrayMove(ids, from, to));
              }}
            >
              <SortableContext
                items={activeProjects.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                {activeProjects.map((project) => (
                  <ActiveProjectGroup
                    key={project.id}
                    project={project}
                    active={project.id === activeProjectId}
                    onActivate={onActivate}
                    onContextMenu={onProjectContextMenu}
                    onCloseTabs={onCloseProjectTabs}
                    onCloseTab={onCloseTab}
                    onActivateTab={onActivateTab}
                    currentTabId={activeTabIdByProject[project.id] ?? null}
                    agentStates={projectAgentStates(
                      project.id,
                      tabs,
                      paneAgentStates,
                    )}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      ) : (
        <div className="scrollbar-none flex-1 overflow-y-auto py-2">
          {projects.length === 0 && workspaces.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">
              no project yet — click + to add one
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              modifiers={[snapCenterToCursor]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveDrag(null)}
            >
              {rootEntries.map((entry, i) => (
                <Fragment key={entry.id}>
                  <RootGap
                    insertBeforeId={entry.id}
                    targetOrder={gapTargetOrder(i)}
                    activeDragKind={activeDragKind}
                  />
                  {entry.kind === "workspace"
                    ? renderGroup(entry.workspace.id, entry.workspace)
                    : renderLooseProject(entry.project)}
                </Fragment>
              ))}
              {rootEntries.length > 0 && (
                <RootGap
                  insertBeforeId={null}
                  targetOrder={gapTargetOrder(rootEntries.length)}
                  activeDragKind={activeDragKind}
                />
              )}
              {(ungroupedHasProjects ||
                rootEntries.length === 0 ||
                activeDragKind === "project") &&
                renderGroup(null, null)}
              <DragOverlay>
                {activeDrag?.type === "project" ? (
                  <DragProjectPreview
                    project={projects.find(
                      (p) => p.id === activeDrag.projectId,
                    )}
                  />
                ) : activeDrag?.type === "workspace" ? (
                  <DragWorkspacePreview
                    workspace={workspaces.find(
                      (w) => w.id === activeDrag.workspaceId,
                    )}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1 p-2">
        <button
          onClick={onOpenSessions}
          title="Retrouver n'importe quelle session Claude, tous dossiers confondus : lecture, recherche, reprise"
          className="flex items-center justify-center gap-1.5 rounded border border-zinc-800/60 bg-transparent px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <History size={13} className="shrink-0" />
          Sessions récentes
        </button>
        {onRestoreSession && (
          <button
            onClick={onRestoreSession}
            title="Rouvre les onglets de la session précédente ; les panes Claude reprennent leur conversation (claude --resume)"
            className="rounded border border-zinc-800/60 bg-transparent px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            ⟳ Restaurer la session précédente
          </button>
        )}
        <button
          onClick={onAdd}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          + New project
        </button>
        <button
          onClick={onAddWorkspace}
          className="rounded border border-zinc-800/60 bg-transparent px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          + New workspace
        </button>
      </div>
    </aside>
  );
}

interface WorkspaceSectionProps {
  workspace: Workspace | null;
  workspaceId: string | null;
  projects: Project[];
  collapsed: boolean;
  agentState: AgentStateValue;
  activeDragKind: DragKind | null;
  onToggleCollapsed?: () => void;
  onWorkspaceContextMenu: (workspace: Workspace, x: number, y: number) => void;
  onProjectContextMenu: (project: Project, x: number, y: number) => void;
  onActivate: (id: string) => void;
  activeProjectId: string | null;
  tabs: Tab[];
  paneAgentStates: Record<string, AgentStateValue>;
  sessionsByProject: Record<string, ClaudeSession[]>;
  shownByProject: Record<string, number>;
  onShowMoreProjectSessions: (projectId: string, total: number) => void;
  onShowLessProjectSessions: (projectId: string) => void;
  onOpenSession: (session: ClaudeSession) => void;
  openSessionProjectId: string | null;
  loadingSessionProjectId: string | null;
}

function WorkspaceSection({
  workspace,
  workspaceId,
  projects,
  collapsed,
  agentState,
  activeDragKind,
  onToggleCollapsed,
  onWorkspaceContextMenu,
  onProjectContextMenu,
  onActivate,
  activeProjectId,
  tabs,
  paneAgentStates,
  sessionsByProject,
  shownByProject,
  onShowMoreProjectSessions,
  onShowLessProjectSessions,
  onOpenSession,
  openSessionProjectId,
  loadingSessionProjectId,
}: WorkspaceSectionProps) {
  const isGrouped = !!workspace;
  return (
    <div className="mb-2">
      {workspace && (
        <DraggableWorkspaceHeader
          workspace={workspace}
          collapsed={collapsed}
          agentState={agentState}
          onToggle={onToggleCollapsed}
          onContextMenu={onWorkspaceContextMenu}
        />
      )}
      {!collapsed && (
        <DroppableGroup
          workspaceId={workspaceId}
          hasProjects={projects.length > 0}
          bordered={isGrouped}
        >
          {projects.map((p) => (
            <Fragment key={p.id}>
              <ProjectGap
                workspaceId={workspaceId}
                insertBeforeProjectId={p.id}
                activeDragKind={activeDragKind}
              />
              <DraggableProjectRow
                project={p}
                active={p.id === activeProjectId}
                onActivate={onActivate}
                onContextMenu={onProjectContextMenu}
                agentStates={projectAgentStates(p.id, tabs, paneAgentStates)}
                sessions={sessionsByProject[p.id] ?? []}
                shown={shownByProject[p.id] ?? 2}
                onShowMore={() =>
                  onShowMoreProjectSessions(
                    p.id,
                    sessionsByProject[p.id]?.length ?? 0,
                  )
                }
                onShowLess={() => onShowLessProjectSessions(p.id)}
                onOpenSession={onOpenSession}
                sessionsVisible={openSessionProjectId === p.id}
                sessionsLoading={loadingSessionProjectId === p.id}
              />
            </Fragment>
          ))}
          <ProjectGap
            workspaceId={workspaceId}
            insertBeforeProjectId={null}
            activeDragKind={activeDragKind}
          />
        </DroppableGroup>
      )}
    </div>
  );
}

interface DraggableWorkspaceHeaderProps {
  workspace: Workspace;
  collapsed: boolean;
  agentState: AgentStateValue;
  onToggle?: () => void;
  onContextMenu: (workspace: Workspace, x: number, y: number) => void;
}

function DraggableWorkspaceHeader({
  workspace,
  collapsed,
  agentState,
  onToggle,
  onContextMenu,
}: DraggableWorkspaceHeaderProps) {
  // Headers are both a drag source (reorder workspaces) and a drop target
  // (catch projects when collapsed/empty).
  const dragData: WorkspaceDragData = {
    type: "workspace",
    workspaceId: workspace.id,
  };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `ws-drag:${workspace.id}`, data: dragData });
  const dropData: WorkspaceDropData = {
    type: "workspace-drop",
    workspaceId: workspace.id,
  };
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `ws-drop:${workspace.id}`,
    data: dropData,
  });

  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setRef}
      {...attributes}
      {...listeners}
      onClick={() => onToggle?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(workspace, e.clientX, e.clientY);
      }}
      className={`mx-1.5 flex cursor-pointer select-none items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-2 text-xs uppercase tracking-wider text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100 ${
        isOver ? "ring-1 ring-zinc-600 bg-zinc-800/80" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        collapsed ? "" : "rounded-b-none border-b-0"
      }`}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-400"
        aria-hidden="true"
      >
        {collapsed ? (
          <ChevronRight size={14} strokeWidth={2} />
        ) : (
          <ChevronDown size={14} strokeWidth={2} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {workspace.name}
      </span>
      <AgentBadge state={agentState} size={7} inline />
    </div>
  );
}

interface DroppableGroupProps {
  workspaceId: string | null;
  hasProjects: boolean;
  bordered: boolean;
  children: React.ReactNode;
}

function DroppableGroup({
  workspaceId,
  hasProjects,
  bordered,
  children,
}: DroppableGroupProps) {
  const dropData: WorkspaceDropData = {
    type: "workspace-drop",
    workspaceId,
  };
  const { setNodeRef, isOver } = useDroppable({
    id: `ws-area:${workspaceId ?? UNGROUPED_ID}`,
    data: dropData,
  });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[6px] ${
        bordered
          ? "mx-1.5 rounded-b border border-t-0 border-zinc-800 bg-zinc-950/50 pt-1 pb-1.5"
          : ""
      } ${
        isOver && !hasProjects
          ? "bg-zinc-900/60 outline-dashed outline-1 outline-zinc-700"
          : ""
      }`}
    >
      {children}
      {!hasProjects && (
        <div
          className={`my-0.5 px-2 py-1 text-[10px] italic text-zinc-600 ${
            bordered ? "mx-1.5" : "mx-1.5"
          } ${isOver ? "text-zinc-400" : ""}`}
        >
          (drop a project here)
        </div>
      )}
    </div>
  );
}

interface DraggableProjectRowProps {
  project: Project;
  active: boolean;
  onActivate: (id: string) => void;
  onContextMenu: (project: Project, x: number, y: number) => void;
  /** Middle-click closes all of the project's tabs. Only wired in the Active list. */
  onCloseTabs?: (projectId: string) => void;
  agentStates: TabAgentState[];
  sessions?: ClaudeSession[];
  shown?: number;
  onShowMore?: () => void;
  onShowLess?: () => void;
  onOpenSession?: (session: ClaudeSession) => void;
  sessionsVisible?: boolean;
  sessionsLoading?: boolean;
}

function DraggableProjectRow({
  project,
  active,
  onActivate,
  onContextMenu,
  agentStates,
  sessions = [],
  shown = 2,
  onShowMore,
  onShowLess,
  onOpenSession,
  sessionsVisible = false,
  sessionsLoading = false,
}: DraggableProjectRowProps) {
  const dragData: ProjectDragData = {
    type: "project",
    projectId: project.id,
    workspaceId: project.workspaceId ?? null,
  };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `proj-drag:${project.id}`, data: dragData });
  const dropData: ProjectDropData = {
    type: "project-drop",
    projectId: project.id,
    workspaceId: project.workspaceId ?? null,
  };
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `proj-drop:${project.id}`,
    data: dropData,
  });

  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setRef}
      {...attributes}
      {...listeners}
      style={{ borderLeftColor: project.color }}
      onClick={() => onActivate(project.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(project, e.clientX, e.clientY);
      }}
      className={`group mx-1.5 mb-0.5 cursor-pointer rounded border-l-[3px] py-1.5 pl-2 pr-2 ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900"
      } ${isDragging ? "opacity-40" : ""} ${
        isOver ? "ring-1 ring-zinc-600" : ""
      }`}
      title={project.path}
    >
      <ProjectRowContent project={project} agentStates={agentStates} />
      {sessionsVisible && (
        <div className="mt-1 flex flex-col gap-0.5 pb-0.5 pl-1">
          {sessionsLoading ? (
            <div className="px-1.5 py-1 text-[10px] text-zinc-600">
              Chargement…
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-1.5 py-1 text-[10px] text-zinc-600">
              Aucune discussion
            </div>
          ) : (
            sessions.slice(0, shown).map((session) => (
              <button
                key={session.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSession?.(session);
                }}
                title={session.title}
                className="truncate rounded px-1.5 py-1 text-left text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                {session.title}
              </button>
            ))
          )}
          {!sessionsLoading && sessions.length > 2 && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (shown < sessions.length) onShowMore?.();
                else onShowLess?.();
              }}
              className="self-start rounded px-1.5 py-0.5 text-[10px] text-sky-500 hover:bg-zinc-800 hover:text-sky-300"
            >
              {shown < sessions.length ? "Voir plus" : "Voir moins"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Project header used by the draggable Inactive rows. */
function ProjectRowContent({
  project,
  agentStates,
}: {
  project: Project;
  agentStates: TabAgentState[];
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{project.name}</div>
      </div>
      {agentStates.length > 0 && (
        <span className="mt-1 flex max-w-[84px] shrink-0 flex-wrap items-center justify-end gap-1">
          {agentStates.map(({ tabId, state }) => (
            <AgentBadge key={tabId} state={state} size={8} inline />
          ))}
        </span>
      )}
    </div>
  );
}

interface ActiveProjectGroupProps extends DraggableProjectRowProps {
  onActivateTab: (projectId: string, tabId: string) => void;
  /** Middle-click on one of the listed tabs closes just that tab. */
  onCloseTab: (tabId: string) => void;
  /** Tab currently shown for this project, highlighted in the list. */
  currentTabId: string | null;
}

/** Entry of the flat "Active" list: the project name as a quiet header, its
 *  tabs with a live Claude session listed underneath as clickable children.
 *  The project's color bar runs along the whole group. Drag the header to
 *  reorder (persisted as `activeOrder`), middle-click it to close all tabs —
 *  or middle-click a single child to close just that tab. A project down to
 *  one tab merges header and child into a single click target. */
function ActiveProjectGroup({
  project,
  active,
  onActivate,
  onContextMenu,
  onCloseTabs,
  onCloseTab,
  onActivateTab,
  currentTabId,
  agentStates,
}: ActiveProjectGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  // A project with a single tab gets one hit area covering both its name and
  // that tab: two zones one line apart are a needlessly precise target when
  // they do the same thing. From two tabs on, each child needs its own zone.
  const solo = agentStates.length === 1 ? agentStates[0] : null;
  const soloCurrent = solo !== null && active && solo.tabId === currentTabId;

  const closeAllOnMiddleClick = (e: React.MouseEvent) => {
    // The drag sensor only activates on the primary button, so this never
    // starts a drag.
    if (e.button === 1) {
      e.preventDefault();
      onCloseTabs?.(project.id);
    }
  };
  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(project, e.clientX, e.clientY);
  };

  if (solo) {
    return (
      <div
        ref={setNodeRef}
        style={{
          borderLeftColor: project.color,
          transform: CSS.Transform.toString(transform),
          transition,
        }}
        className={`mx-1.5 mb-2 rounded-r border-l-[3px] pl-1.5 pr-1 ${
          isDragging ? "z-10 opacity-70" : ""
        }`}
      >
        <div
          {...attributes}
          {...listeners}
          onClick={() => onActivateTab(project.id, solo.tabId)}
          onMouseDown={closeAllOnMiddleClick}
          onContextMenu={openContextMenu}
          className={`cursor-pointer rounded px-1.5 py-1 ${
            soloCurrent
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
          title={`${solo.title}\n${project.path}`}
        >
          <div className="truncate text-[13px]">{project.name}</div>
          <div className="mt-[1px] flex items-center gap-2 text-xs">
            <AgentBadge state={solo.state} size={8} inline />
            <span className="min-w-0 flex-1 truncate">{solo.title}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        borderLeftColor: project.color,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`group mx-1.5 mb-2 rounded-r border-l-[3px] pl-1.5 pr-1 ${
        isDragging ? "z-10 opacity-70" : ""
      }`}
    >
      {/* Header — the drag handle, so clicking a child tab never starts a drag. */}
      <div
        {...attributes}
        {...listeners}
        onClick={() => onActivate(project.id)}
        onMouseDown={closeAllOnMiddleClick}
        onContextMenu={openContextMenu}
        className={`flex cursor-pointer items-center rounded px-1.5 py-1 text-[13px] ${
          active
            ? "text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
        title={project.path}
      >
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
      </div>
      {agentStates.length > 0 && (
        <div className="flex flex-col pb-0.5">
          {agentStates.map(({ tabId, title, state }) => (
            <button
              key={tabId}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onActivateTab(project.id, tabId);
              }}
              onMouseDown={(e) => {
                // Middle-click closes just this tab (same gesture as the tab
                // bar). Stopped here so it never reaches the group header,
                // which would close the whole project.
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseTab(tabId);
                }
              }}
              className={`flex items-center gap-2 rounded px-1.5 py-[3px] text-left text-xs ${
                // Only the visible project highlights its current tab — doing it
                // in every group would light up half the panel.
                active && tabId === currentTabId
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
              title={title}
            >
              <AgentBadge state={state} size={8} inline />
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ProjectGapProps {
  workspaceId: string | null;
  insertBeforeProjectId: string | null;
  activeDragKind: DragKind | null;
}

function ProjectGap({
  workspaceId,
  insertBeforeProjectId,
  activeDragKind,
}: ProjectGapProps) {
  const dropData: ProjectGapDropData = {
    type: "project-gap",
    workspaceId,
    insertBeforeProjectId,
  };
  const id = `proj-gap:${workspaceId ?? "_"}:${insertBeforeProjectId ?? "_end"}`;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: dropData,
    disabled: activeDragKind !== "project",
  });
  const armed = activeDragKind === "project";
  return (
    <div
      ref={setNodeRef}
      className={`mx-1.5 transition-colors ${
        armed ? "h-1.5" : "h-0"
      } ${isOver ? "rounded bg-blue-500/70" : ""}`}
    />
  );
}

interface RootGapProps {
  insertBeforeId: string | null;
  targetOrder: number;
  activeDragKind: DragKind | null;
}

function RootGap({
  insertBeforeId,
  targetOrder,
  activeDragKind,
}: RootGapProps) {
  const dropData: WorkspaceGapDropData = {
    type: "workspace-gap",
    insertBeforeWorkspaceId: insertBeforeId,
    targetOrder,
  };
  const id = `root-gap:${insertBeforeId ?? "_end"}`;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: dropData,
    disabled: activeDragKind === null,
  });
  const armed = activeDragKind !== null;
  return (
    <div
      ref={setNodeRef}
      className={`mx-1.5 transition-colors ${
        armed ? "h-2" : "h-0"
      } ${isOver ? "rounded bg-blue-500/70" : ""}`}
    />
  );
}

function DragProjectPreview({ project }: { project: Project | undefined }) {
  if (!project) return null;
  return (
    <div
      style={{ borderLeftColor: project.color }}
      className="flex w-52 items-center gap-2 rounded border-l-[3px] border-y border-r border-zinc-700 bg-zinc-900 py-1.5 pl-2 pr-2 text-sm text-zinc-100 shadow-xl"
    >
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
    </div>
  );
}

function DragWorkspacePreview({
  workspace,
}: {
  workspace: Workspace | undefined;
}) {
  if (!workspace) return null;
  return (
    <div className="flex w-52 items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] uppercase tracking-wider text-zinc-300 shadow-xl">
      {workspace.name}
    </div>
  );
}
