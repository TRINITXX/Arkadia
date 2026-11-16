import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Users } from "lucide-react";
import "@/styles/app.css";
import { RemindersButton } from "@/components/RemindersButton";
import { RemindersDot } from "@/components/RemindersDot";
import { Sidepanel } from "@/components/Sidepanel";
import { Toolbar } from "@/components/Toolbar";
import type { AgentStateValue } from "@/lib/agentState";
import { publishChatProgress } from "@/lib/chat/chatProgressStore";
import { EMPTY_CHAT, type ChatItem } from "@/lib/chat/chatState";
import { publishReminders } from "@/lib/reminderStore";
import type { Reminder } from "@/lib/reminders";
import type { Project, Tab, ToolbarButton } from "@/types";

/**
 * Dev-only page (not in the build): the real sidebar fed with made-up chats
 * and reminders through its real stores (`chatProgressStore`,
 * `reminderStore`), for screenshots without the app.
 * `?v=progress`: each tab's progress line. `?v=reminders`: the « Rappels »
 * button, its list open. `?v=folded`: the sidebar folded, the due
 * reminders' dot on the toolbar's button that unfolds it.
 */
const variant = new URLSearchParams(window.location.search).get("v");
const withReminders = variant === "reminders";
const folded = variant === "folded";

const projects: Project[] = [
  {
    id: "ark",
    name: "Arkadia",
    path: "C:\\Arkadia",
    color: "#a1a1aa",
    order: 0,
    activeOrder: 0,
  },
  {
    id: "vtc",
    name: "VTC-Planner-Mobile",
    path: "C:\\VTC",
    color: "#f59e0b",
    order: 1,
    activeOrder: 1,
  },
  {
    id: "assets",
    name: "Assets IA",
    path: "C:\\Assets IA",
    color: "#c084fc",
    order: 2,
    activeOrder: 2,
  },
  // Not active: where a reminder for an unknown conversation goes.
  {
    id: "cd",
    name: "Claude Desktop",
    path: "C:\\Claude Desktop",
    color: "#60a5fa",
    order: 3,
  },
];

function tab(id: string, projectId: string, title: string, chat = true): Tab {
  const paneId = `${id}-p`;
  return {
    id,
    projectId,
    tree: { kind: "leaf", paneId },
    activePaneId: paneId,
    panes: {
      [paneId]: {
        id: paneId,
        title,
        cwd: null,
        ...(chat ? { chat: { cwd: "C:\\" } } : {}),
      },
    },
  };
}

const tabs: Tab[] = [
  tab("t1", "ark", "Crash de Chrome au lancement"),
  tab("t2", "ark", "Note vocale envoyée en double"),
  tab("t3", "ark", "Habitudes d'utilisation d'Arkadia"),
  // A terminal pane: no line under it.
  tab("t6", "ark", "pwsh", false),
  tab("t4", "vtc", "Paywall et code promo"),
  tab("t5", "assets", "Catalogue de packs Superhéros"),
];

const busy: AgentStateValue = { kind: "busy" };
const states: Record<string, AgentStateValue> = {
  "t1-p": busy,
  "t2-p": { kind: "waiting", session_id: "s2", questionPending: true },
  "t3-p": busy,
  "t6-p": busy,
  "t4-p": { kind: "waiting", session_id: "s4" },
  "t5-p": busy,
};

const now = Date.now();
const ago = (min: number) => now - min * 60_000;
let seq = 0;
const user = (text: string, at: number): ChatItem => ({
  kind: "user",
  id: `u${seq++}`,
  text,
  images: 0,
  at,
});
const said = (text: string, at: number): ChatItem => ({
  kind: "text",
  id: `x${seq++}`,
  text,
  streaming: false,
  at,
});
const ended = (at: number): ChatItem => ({
  kind: "turn",
  id: `turn${seq++}`,
  durationMs: 60_000,
  tools: 3,
  files: 1,
  at,
});

/** In a turn since `min` minutes, Claude's words so far. */
function working(paneId: string, min: number, items: ChatItem[]): void {
  publishChatProgress(paneId, {
    ...EMPTY_CHAT,
    working: true,
    turnStartedAt: ago(min),
    items: [user("Vas-y", ago(min)), ...items],
  });
}

/** At rest since `min` minutes, after this reply. */
function resting(paneId: string, min: number, reply: string): void {
  publishChatProgress(paneId, {
    ...EMPTY_CHAT,
    items: [
      user("Vas-y", ago(min + 4)),
      said(reply, ago(min)),
      ended(ago(min)),
    ],
  });
}

working("t1-p", 6, [
  said(
    "Je relance Chrome pour reproduire le crash. Ensuite je lis son journal.",
    ago(2),
  ),
]);
resting(
  "t2-p",
  12,
  [
    "Deux causes possibles pour le doublon.",
    "",
    "❓ Question 1 sur 1.",
    "",
    "La note part deux fois quand la dictée finit pendant l'envoi.",
    "",
    "On corrige d'abord la dictée ou l'envoi ?",
    "",
    "  a) La dictée",
    "  b) L'envoi",
    "",
    "Je pencherais pour (a) : c'est le cas le plus fréquent.",
  ].join("\n"),
);
working("t3-p", 18, [
  said(
    "**Je vérifie** 6 points avant de proposer :\n\n1. Les lectures",
    ago(1),
  ),
]);
resting(
  "t4-p",
  80,
  "✅ **Fini** : commit fait, rien poussé.\n\n| Quoi | État |\n|---|---|",
);
working("t5-p", 2, []);

/** `h` hours before now, on the hour (`days` days back first). */
function hoursAgo(h: number, days = 0): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - h, 0, 0, 0);
  return d.toISOString();
}

const reminders: Reminder[] = [
  {
    id: "r1",
    conversation: "Arkadia",
    subject: "Rappel : conso de tokens avant/après",
    prompt: "Compare la consommation de tokens.",
    at: hoursAgo(1),
  },
  {
    id: "r2",
    conversation: "GTA 6",
    subject: "Rappel : relancer les 3 artisans sans réponse",
    prompt: "Relance les artisans.",
    at: hoursAgo(0, 1),
  },
  {
    id: "r3",
    conversation: "assets ia",
    subject: "Rappel : finir la couche de Noël de Wrap Presents",
    prompt: "Finis la couche de Noël.",
    at: hoursAgo(2),
  },
  // Not due yet: left out of the list.
  {
    id: "r4",
    conversation: "Arkadia",
    subject: "Rappel : lire la sonde des gels du PC",
    prompt: "Lis la sonde.",
    at: new Date(now + 86_400_000).toISOString(),
  },
];
publishReminders(withReminders || folded ? reminders : []);

const toolbarButtons: ToolbarButton[] = [
  {
    id: "b1",
    kind: "action",
    label: "Claude",
    icon: "sparkles",
    command: "ccd",
    order: 0,
  },
  {
    id: "b2",
    kind: "action",
    label: "Terminal",
    icon: "terminal",
    command: "pwsh",
    order: 1,
  },
];

/** The toolbar over a folded sidebar: its first button unfolds it. */
function FoldedPreview() {
  const noop = () => {};
  return (
    <div id="preview" style={{ width: 420 }}>
      <Toolbar
        buttons={toolbarButtons}
        onRunAction={noop}
        onOpenSettings={noop}
        onToggleChrome={noop}
        chromeShown={false}
        sidepanelOpen={false}
        onToggleSidepanel={noop}
        sidepanelBadge={<RemindersDot />}
        accountChip={null}
      />
    </div>
  );
}

function Preview() {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  // The sidebar opens on « Inactive » and switches when a project turns active.
  useEffect(() => setActive(new Set(["ark", "vtc", "assets"])), []);
  // The list open, as clicked.
  useEffect(() => {
    if (!withReminders) return;
    const id = window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          'button[title="Rappels arrivés à échéance"]',
        )
        ?.click();
    }, 300);
    return () => window.clearTimeout(id);
  }, []);
  const noop = () => {};
  return (
    <div
      id="preview"
      className="relative"
      style={{ height: 600, width: withReminders ? 536 : 232 }}
    >
      <Sidepanel
        projects={projects}
        workspaces={[]}
        activeProjectId="ark"
        onActivate={noop}
        onAdd={noop}
        onAddWorkspace={noop}
        onProjectContextMenu={noop}
        onTabContextMenu={noop}
        onCloseProjectTabs={noop}
        onCloseTab={noop}
        onWorkspaceContextMenu={noop}
        onMoveProject={noop}
        onPlaceProjectInRoot={noop}
        onReorderWorkspaces={noop}
        onPlaceWorkspaceInRoot={noop}
        onToggleWorkspaceCollapsed={noop}
        onReorderActive={noop}
        onRestoreSession={null}
        onOpenSessions={noop}
        onActivateTab={noop}
        tabs={tabs}
        paneAgentStates={states}
        activeTabIdByProject={{ ark: "t3", vtc: "t4", assets: "t5" }}
        activeProjectIds={active}
        hiddenTabIds={new Set()}
        accountMarks={{}}
        remindersPanel={
          <RemindersButton projects={projects} onLaunch={async () => false} />
        }
        accountsPanel={
          <button className="flex items-center justify-center gap-1.5 rounded border border-zinc-800/60 bg-transparent px-2 py-1.5 text-xs text-zinc-400">
            <Users size={13} className="shrink-0" />
            Comptes
          </button>
        }
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  folded ? <FoldedPreview /> : <Preview />,
);
