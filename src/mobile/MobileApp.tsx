import { useCallback, useEffect, useRef, useState } from "react";
import { History, LayoutList, Users } from "lucide-react";
import { AccountsScreen } from "@/mobile/AccountsScreen";
import { ProjectList } from "@/mobile/ProjectList";
import { SessionsScreen } from "@/mobile/SessionsScreen";
import { TerminalScreen } from "@/mobile/TerminalScreen";
import { WakeScreen } from "@/mobile/WakeScreen";
import { useNotice } from "@/mobile/notice";
import {
  openArkadia,
  reconnectNow,
  useRemoteView,
  wakePc,
  type Reach,
  type Status,
} from "@/mobile/remote";
import { useRemoteAction } from "@/mobile/useRemoteAction";
import { useVisualViewport } from "@/mobile/useVisualViewport";
import { useWideScreen } from "@/mobile/useWideScreen";
import type { RemoteAction } from "@/lib/remoteActions";
import type {
  RemoteProject,
  RemoteSnapshot,
  RemoteTab,
} from "@/lib/remoteSnapshot";

type ListView = "projects" | "sessions" | "accounts";

/** A tab just created on the desktop reaches the phone's snapshot a beat later. */
const OPENING_GRACE_MS = 5000;

function findTab(
  snapshot: RemoteSnapshot,
  tabId: string,
): { project: RemoteProject; tab: RemoteTab } | null {
  const projects = [
    ...snapshot.active,
    ...snapshot.groups.flatMap((g) => g.projects),
  ];
  for (const project of projects) {
    const tab = project.tabs.find((t) => t.id === tabId);
    if (tab) return { project, tab };
  }
  return null;
}

/**
 * The phone companion: projects, past sessions and accounts, and one tab's
 * terminal. On a phone the terminal takes the whole screen; on a wide screen
 * (the old PC) the list stays on its left.
 */
export function MobileApp() {
  const { status, reach, snapshot, wake } = useRemoteView();
  const viewport = useVisualViewport();
  const wide = useWideScreen();
  const notice = useNotice();
  const [listView, setListView] = useState<ListView>("projects");
  const [openTabId, setOpenTabId] = useState<string | null>(null);
  // A tab the desktop just made reaches the snapshot a beat later.
  const [awaiting, setAwaiting] = useState(false);
  // On a phone the open tab sits on a history entry, so the back gesture
  // returns to the list; a tab opened on a wide screen has none.
  const pushed = useRef(false);

  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      setOpenTabId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openTab = useCallback(
    (tabId: string) => {
      if (!wide && !pushed.current) {
        window.history.pushState({ tabId }, "");
        pushed.current = true;
      }
      setOpenTabId(tabId);
      setAwaiting(true);
    },
    [wide],
  );
  const closeTab = useCallback(() => {
    if (pushed.current) window.history.back();
    else setOpenTabId(null);
  }, []);
  const { run } = useRemoteAction(openTab);

  const found = snapshot && openTabId ? findTab(snapshot, openTabId) : null;
  const opening = awaiting && !found;
  useEffect(() => {
    if (!awaiting) return;
    if (found) return setAwaiting(false);
    const timer = setTimeout(() => setAwaiting(false), OPENING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [awaiting, found]);
  // The open tab was closed (here or on the desktop): back to the list.
  useEffect(() => {
    if (openTabId && snapshot && !found && !awaiting) closeTab();
  }, [openTabId, snapshot, found, awaiting, closeTab]);

  const down = status !== "open" && (reach !== "unknown" || wake !== null);
  let body: React.ReactNode;
  if (down && wake) body = <WakeScreen wake={wake} reach={reach} />;
  else if (down) body = <ReachScreen reach={reach} />;
  else if (!snapshot) body = <Centered>En attente d’Arkadia…</Centered>;
  else {
    const list = (
      <ListShell
        snapshot={snapshot}
        status={status}
        view={listView}
        onView={setListView}
        openTabId={found?.tab.id ?? null}
        onOpenTab={openTab}
        run={run}
      />
    );
    const terminal = found ? (
      <TerminalScreen
        key={found.tab.id}
        snapshot={snapshot}
        project={found.project}
        tab={found.tab}
        status={status}
        keyboardOpen={viewport.keyboardOpen}
        onBack={wide ? null : closeTab}
        fontSize={wide ? 14 : 12}
        run={run}
      />
    ) : opening ? (
      <Centered>Ouverture de l’onglet…</Centered>
    ) : null;
    body = wide ? (
      <div className="flex h-full">
        <aside className="w-[340px] shrink-0 border-r border-zinc-800">
          {list}
        </aside>
        <main className="min-w-0 flex-1">
          {terminal ?? <Centered>Choisis un onglet à gauche.</Centered>}
        </main>
      </div>
    ) : (
      (terminal ?? list)
    );
  }

  return (
    <div
      className="fixed inset-x-0 flex flex-col overflow-hidden bg-[#0a0a0a]"
      style={{ top: viewport.top, height: viewport.height }}
    >
      {status !== "open" && !down && (
        <div
          className="shrink-0 bg-amber-900/60 px-4 py-1.5 text-center text-xs text-amber-100"
          // Clear of the iPhone's status bar, which the page extends under.
          style={{ paddingTop: "max(6px, env(safe-area-inset-top))" }}
        >
          {status === "connecting"
            ? "Connexion à Arkadia…"
            : "Connexion perdue, nouvelle tentative…"}
        </div>
      )}
      <div className="min-h-0 flex-1">{body}</div>
      {notice && (
        <div className="pointer-events-none absolute inset-x-4 bottom-24 z-50 rounded-lg bg-red-900/90 px-4 py-2 text-center text-sm text-red-50">
          {notice}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}

/**
 * PC unreachable, or off (with a button to wake it), or Arkadia closed (with
 * a button to start it), or starting.
 */
function ReachScreen({ reach }: { reach: Reach }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      {reach === "off" && (
        <>
          <p className="text-lg text-zinc-100">PC éteint</p>
          <p className="text-sm text-zinc-500">
            Le PC ne répond pas sur le réseau.
          </p>
          <button
            type="button"
            onClick={() => void wakePc()}
            className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 active:bg-zinc-300"
          >
            Allumer le PC
          </button>
        </>
      )}
      {reach === "offline" && (
        <>
          <p className="text-lg text-zinc-100">PC hors ligne</p>
          <p className="text-sm text-zinc-500">
            Le PC est éteint, en veille, ou Tailscale est coupé sur ce
            téléphone.
          </p>
          <button
            type="button"
            onClick={reconnectNow}
            className="rounded-lg bg-zinc-800 px-5 py-2.5 text-sm text-zinc-100 active:bg-zinc-700"
          >
            Réessayer
          </button>
        </>
      )}
      {reach === "closed" && (
        <>
          <p className="text-lg text-zinc-100">Arkadia est fermé</p>
          <p className="text-sm text-zinc-500">Le PC est allumé.</p>
          <button
            type="button"
            onClick={() => void openArkadia()}
            className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 active:bg-zinc-300"
          >
            Ouvrir Arkadia
          </button>
        </>
      )}
      {reach === "starting" && (
        <p className="text-sm text-zinc-400">Ouverture d’Arkadia…</p>
      )}
    </div>
  );
}

interface ListShellProps {
  snapshot: RemoteSnapshot;
  status: Status;
  view: ListView;
  onView: (view: ListView) => void;
  openTabId: string | null;
  onOpenTab: (tabId: string) => void;
  run: (action: RemoteAction) => Promise<boolean>;
}

const VIEWS: { id: ListView; label: string; Icon: typeof Users }[] = [
  { id: "projects", label: "Projets", Icon: LayoutList },
  { id: "sessions", label: "Sessions", Icon: History },
  { id: "accounts", label: "Comptes", Icon: Users },
];

/** Header, the chosen list and the bar switching between the three lists. */
function ListShell({
  snapshot,
  status,
  view,
  onView,
  openTabId,
  onOpenTab,
  run,
}: ListShellProps) {
  return (
    <div className="flex h-full flex-col">
      <header
        className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <h1 className="py-3 text-base font-semibold text-zinc-100">
          {VIEWS.find((v) => v.id === view)?.label}
        </h1>
        <span
          className={`h-2 w-2 rounded-full ${
            status === "open" ? "bg-emerald-500" : "bg-zinc-600"
          }`}
          aria-label={status === "open" ? "Connecté" : "Déconnecté"}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "projects" && (
          <ProjectList
            snapshot={snapshot}
            openTabId={openTabId}
            onOpenTab={onOpenTab}
            run={run}
          />
        )}
        {view === "sessions" && <SessionsScreen status={status} run={run} />}
        {view === "accounts" && (
          <AccountsScreen snapshot={snapshot} run={run} />
        )}
      </div>
      <nav
        className="flex shrink-0 border-t border-zinc-800 bg-zinc-950"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onView(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              view === id ? "text-zinc-100" : "text-zinc-500"
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
