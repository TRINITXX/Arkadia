import { useState } from "react";
import { Plus } from "lucide-react";
import { AccountDot } from "@/components/AccountDot";
import { ButtonSheet } from "@/mobile/ButtonSheet";
import { RemoteBadgeDot } from "@/mobile/RemoteBadgeDot";
import type { RemoteAction } from "@/lib/remoteActions";
import type {
  RemoteProject,
  RemoteSnapshot,
  RemoteTab,
} from "@/lib/remoteSnapshot";

interface ProjectListProps {
  snapshot: RemoteSnapshot;
  /** The tab shown beside the list on a wide screen. */
  openTabId: string | null;
  onOpenTab: (tabId: string) => void;
  run: (action: RemoteAction) => Promise<boolean>;
}

/**
 * Every project, in the desktop sidebar's order, with its tabs and badges.
 * "+" opens a new tab; tapping a project offers the toolbar's buttons too.
 */
export function ProjectList({
  snapshot,
  openTabId,
  onOpenTab,
  run,
}: ProjectListProps) {
  const [sheetFor, setSheetFor] = useState<RemoteProject | null>(null);
  const block = (p: RemoteProject) => (
    <ProjectBlock
      key={p.id}
      project={p}
      openTabId={openTabId}
      onOpenTab={onOpenTab}
      onNewTab={() => void run({ kind: "newTab", projectId: p.id })}
      onMore={() => setSheetFor(p)}
    />
  );
  return (
    <div className="pb-4">
      {snapshot.active.length > 0 && (
        <Section title="Actifs">{snapshot.active.map(block)}</Section>
      )}
      {snapshot.groups.map((g, i) => (
        <Section key={`${g.name ?? ""}-${i}`} title={g.name}>
          {g.projects.map(block)}
        </Section>
      ))}
      {sheetFor && (
        <ButtonSheet
          title={sheetFor.name}
          buttons={snapshot.toolbar}
          onClose={() => setSheetFor(null)}
          onNewTab={() => {
            setSheetFor(null);
            void run({ kind: "newTab", projectId: sheetFor.id });
          }}
          onPick={(buttonId) => {
            setSheetFor(null);
            void run({
              kind: "runButton",
              projectId: sheetFor.id,
              paneId: null,
              buttonId,
            });
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-3">
      {title && (
        <h2 className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function ProjectBlock({
  project,
  openTabId,
  onOpenTab,
  onNewTab,
  onMore,
}: {
  project: RemoteProject;
  openTabId: string | null;
  onOpenTab: (tabId: string) => void;
  onNewTab: () => void;
  onMore: () => void;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center pr-2">
        <button
          type="button"
          onClick={onMore}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-4 text-left active:bg-zinc-900"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <span
            className={`truncate text-[15px] ${
              project.tabs.length > 0 ? "text-zinc-100" : "text-zinc-500"
            }`}
          >
            {project.name}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Nouvel onglet dans ${project.name}`}
          onClick={onNewTab}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 active:bg-zinc-800 active:text-zinc-100"
        >
          <Plus size={17} />
        </button>
      </div>
      {project.tabs.map((t) => (
        <TabRow
          key={t.id}
          tab={t}
          selected={t.id === openTabId}
          onOpen={() => onOpenTab(t.id)}
        />
      ))}
    </div>
  );
}

function TabRow({
  tab,
  selected,
  onOpen,
}: {
  tab: RemoteTab;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-2.5 py-2 pr-4 pl-9 text-left active:bg-zinc-900 ${
        selected ? "bg-zinc-900" : ""
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
        {tab.title}
      </span>
      {tab.account && (
        <AccountDot
          color={tab.account.color}
          label={tab.account.label}
          title={`Compte : ${tab.account.label}`}
        />
      )}
      {tab.panes.length > 1 && (
        <span className="text-[11px] text-zinc-500">{tab.panes.length}</span>
      )}
      <RemoteBadgeDot badge={tab.badge} />
    </button>
  );
}
