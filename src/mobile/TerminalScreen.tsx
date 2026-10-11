import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, LayoutList, X, Zap } from "lucide-react";
import {
  DEFAULT_CONV_FILTERS,
  ModernConversationView,
  type ConvFilters,
} from "@/components/ModernConversationView";
import { AccountDot } from "@/components/AccountDot";
import { TerminalRow } from "@/components/TerminalRow";
import { getIcon } from "@/icons";
import { ButtonSheet } from "@/mobile/ButtonSheet";
import { KeyRow } from "@/mobile/KeyRow";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { RemoteBadgeDot, agentStateOf } from "@/mobile/RemoteBadgeDot";
import { showNotice } from "@/mobile/notice";
import { useModernPreference } from "@/mobile/useModernPreference";
import { footerRowCount } from "@/lib/terminalChrome";
import { pasteData } from "@/mobile/typing";
import { DEFAULT_TOOL_DENSITY } from "@/types";
import { Sheet, SheetRow } from "@/mobile/Sheet";
import { send, useWatchedFrame, watchPane, type Status } from "@/mobile/remote";
import {
  LINE_HEIGHT,
  PAD_X,
  TERMINAL_FONT_FAMILY,
  usePaneFit,
} from "@/mobile/usePaneFit";
import { useScrollGestures } from "@/mobile/useScrollGestures";
import { useTypingField } from "@/mobile/useTypingField";
import type { RemoteAction } from "@/lib/remoteActions";
import type {
  RemoteButton,
  RemoteProject,
  RemoteSnapshot,
  RemoteTab,
} from "@/lib/remoteSnapshot";

interface TerminalScreenProps {
  snapshot: RemoteSnapshot;
  project: RemoteProject;
  tab: RemoteTab;
  status: Status;
  keyboardOpen: boolean;
  /** Null on a wide screen, where the list stays beside the terminal. */
  onBack: (() => void) | null;
  fontSize: number;
  run: (action: RemoteAction) => Promise<boolean>;
}

type OpenSheet =
  | { kind: "commands" }
  | { kind: "close" }
  | { kind: "folder"; folder: RemoteButton };

/**
 * One tab, live: the real terminal at the screen's width. Typing goes
 * straight into Claude's prompt, which stays visible above the keyboard; a
 * question from Claude replaces it there, as on the desktop. The header runs
 * the toolbar's buttons and closes the tab; a Claude pane also gets the
 * prompt bar's buttons above the keys.
 */
export function TerminalScreen({
  snapshot,
  project,
  tab,
  status,
  keyboardOpen,
  onBack,
  fontSize,
  run,
}: TerminalScreenProps) {
  const palette = snapshot.palette;
  const rowHeight = fontSize * LINE_HEIGHT;
  const [chosenPaneId, setChosenPaneId] = useState(tab.activePaneId);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [modern, setModern] = useModernPreference();
  const [filters, setFilters] = useState<ConvFilters>(DEFAULT_CONV_FILTERS);
  // A pane closed on the desktop: fall back to the tab's active one.
  const pane =
    tab.panes.find((p) => p.id === chosenPaneId) ??
    tab.panes.find((p) => p.id === tab.activePaneId) ??
    tab.panes[0];
  const paneId = pane?.id ?? null;
  // Stable props: this screen re-renders with every terminal frame, the
  // (memoized) conversation must not.
  const badge = pane?.badge ?? null;
  const agentState = useMemo(() => agentStateOf(badge), [badge]);
  const onToast = useCallback<ToastFn>((_, message) => showNotice(message), []);

  useEffect(() => watchPane(paneId), [paneId]);
  useEffect(() => () => watchPane(null), []);

  const frame = useWatchedFrame();
  const screen = frame?.session_id === paneId ? frame : null;
  const frameRef = useRef(screen);
  useEffect(() => {
    frameRef.current = screen;
  }, [screen]);

  const gridRef = useRef<HTMLDivElement>(null);
  const reclaim = usePaneFit(paneId, gridRef, fontSize);
  // The pane may carry another screen's size when it opens or after a
  // reconnect: the first frame tells, take it to this screen.
  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
  }, [paneId, status]);
  useEffect(() => {
    if (!screen || fitted.current) return;
    fitted.current = true;
    reclaim(screen);
  }, [screen, reclaim]);

  const sendInput = useCallback(
    (data: string) => {
      if (!paneId) return false;
      reclaim(frameRef.current);
      return send({ t: "input", pane: paneId, data });
    },
    [paneId, reclaim],
  );
  const {
    ref: fieldRef,
    onInput,
    onKeyDown,
    reset: resetField,
  } = useTypingField(sendInput);
  const scroll = useScrollGestures(paneId, frameRef, rowHeight);
  // Back online: whatever the field held may not have reached the prompt.
  useEffect(() => {
    if (status === "open") resetField();
  }, [status, resetField]);

  const onKey = (data: string) => {
    sendInput(data);
    resetField();
  };
  // A phone keyboard has no Ctrl+V, and the hidden field no paste menu.
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onKey(pasteData(text, !!frameRef.current?.bracketed_paste));
    } catch {
      showNotice("Presse-papiers inaccessible");
    }
  };
  const runPromptButton = (buttonId: string) => {
    if (!paneId) return;
    resetField();
    void run({ kind: "promptButton", paneId, buttonId });
  };
  const promptButtons =
    pane?.claude && snapshot.promptButtons?.length
      ? snapshot.promptButtons
      : null;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 pr-1"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {onBack ? (
          <button
            type="button"
            aria-label="Retour aux projets"
            onClick={onBack}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-300 active:text-white"
          >
            <ChevronLeft size={22} />
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-500">
            {project.name}
          </div>
          <div className="truncate text-sm text-zinc-100">{tab.title}</div>
        </div>
        {tab.account && (
          <AccountDot
            color={tab.account.color}
            label={tab.account.label}
            title={`Compte : ${tab.account.label}`}
          />
        )}
        <RemoteBadgeDot badge={tab.badge} />
        <button
          type="button"
          aria-label="Vue moderne"
          aria-pressed={modern}
          onClick={() => setModern(!modern)}
          className={`flex h-11 w-10 shrink-0 items-center justify-center ${
            modern ? "text-sky-400" : "text-zinc-300 active:text-white"
          }`}
        >
          <LayoutList size={18} />
        </button>
        <button
          type="button"
          aria-label="Commandes"
          onClick={() => setSheet({ kind: "commands" })}
          className="flex h-11 w-10 shrink-0 items-center justify-center text-zinc-300 active:text-white"
        >
          <Zap size={18} />
        </button>
        <button
          type="button"
          aria-label="Fermer l’onglet"
          onClick={() => setSheet({ kind: "close" })}
          className="flex h-11 w-10 shrink-0 items-center justify-center text-zinc-400 active:text-white"
        >
          <X size={18} />
        </button>
      </header>

      {tab.panes.length > 1 && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2 py-1.5">
          {tab.panes.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setChosenPaneId(p.id)}
              className={`flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
                p.id === paneId
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-900 text-zinc-400"
              }`}
            >
              <span className="font-semibold">{i + 1}</span>
              <span className="truncate">{p.title}</span>
              <RemoteBadgeDot badge={p.badge} />
            </button>
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={gridRef}
          className="absolute inset-0 touch-none overflow-hidden"
          style={{ backgroundColor: palette.bg }}
          onClick={() => {
            reclaim(frameRef.current);
            fieldRef.current?.focus();
          }}
          {...scroll}
        >
          <div
            className="[&>div]:overflow-hidden"
            style={{
              fontFamily: TERMINAL_FONT_FAMILY,
              fontSize: `${fontSize}px`,
              lineHeight: LINE_HEIGHT,
              color: palette.fg,
              padding: `0 ${PAD_X}px`,
              whiteSpace: "pre",
            }}
          >
            {screen ? (
              screen.lines.map((runs, row) => (
                <div key={row} style={{ height: rowHeight }}>
                  <TerminalRow
                    runs={runs}
                    cursorCol={
                      row === screen.cursor_row && screen.cursor_visible
                        ? screen.cursor_col
                        : null
                    }
                    focused
                    palette={palette}
                  />
                </div>
              ))
            ) : (
              <div className="pt-3 text-zinc-500">Chargement…</div>
            )}
          </div>
          <textarea
            ref={fieldRef}
            aria-label="Saisie"
            rows={1}
            autoCapitalize="sentences"
            autoCorrect="on"
            enterKeyHint="send"
            onInput={onInput}
            onKeyDown={onKeyDown}
            onFocus={resetField}
            // 16px: iOS zooms the page into any field with a smaller font.
            className="absolute bottom-0 left-0 h-px w-px resize-none opacity-0"
            style={{ fontSize: 16, caretColor: "transparent" }}
          />
        </div>
        {modern && paneId && (
          // The conversation above the terminal's own footer (prompt box,
          // Claude's questions), which stays live and typed into below it.
          // Sized from the top, like the terminal's rows, so it ends above
          // the footer even when the PTY has another screen's size.
          <div
            className="absolute inset-x-0 top-0 z-10"
            style={
              screen
                ? {
                    height:
                      Math.max(0, screen.rows - footerRowCount(screen) - 1) *
                      rowHeight,
                  }
                : { bottom: (footerRowCount(null) + 1) * rowHeight }
            }
          >
            <ModernConversationView
              paneId={paneId}
              filters={filters}
              onFiltersChange={setFilters}
              density={snapshot.toolDensity ?? DEFAULT_TOOL_DENSITY}
              palette={palette}
              agentState={agentState}
              isActive={false}
              onToast={onToast}
            />
          </div>
        )}
      </div>

      {promptButtons && (
        <PromptRow
          buttons={promptButtons}
          onPick={runPromptButton}
          onFolder={(folder) => setSheet({ kind: "folder", folder })}
        />
      )}
      <KeyRow
        onKey={onKey}
        onPaste={() => void paste()}
        keyboardOpen={keyboardOpen}
        onHideKeyboard={() => fieldRef.current?.blur()}
      />

      {sheet?.kind === "commands" && (
        <ButtonSheet
          title={project.name}
          buttons={snapshot.toolbar}
          onClose={() => setSheet(null)}
          onNewTab={() => {
            setSheet(null);
            void run({ kind: "newTab", projectId: project.id });
          }}
          onPick={(buttonId) => {
            setSheet(null);
            void run({
              kind: "runButton",
              projectId: project.id,
              paneId,
              buttonId,
            });
          }}
        />
      )}
      {sheet?.kind === "folder" && (
        <ButtonSheet
          title={sheet.folder.label}
          buttons={sheet.folder.children ?? []}
          onClose={() => setSheet(null)}
          onPick={(buttonId) => {
            setSheet(null);
            runPromptButton(buttonId);
          }}
        />
      )}
      {sheet?.kind === "close" && (
        <Sheet
          title="Fermer cet onglet ? Ce qui y tourne s’arrête."
          onClose={() => setSheet(null)}
        >
          <SheetRow
            danger
            onClick={() => {
              setSheet(null);
              void run({ kind: "closeTab", tabId: tab.id });
            }}
          >
            Fermer l’onglet
          </SheetRow>
          <SheetRow onClick={() => setSheet(null)}>Annuler</SheetRow>
        </Sheet>
      )}
    </div>
  );
}

/** The desktop prompt bar's buttons, for a pane that runs Claude. */
function PromptRow({
  buttons,
  onPick,
  onFolder,
}: {
  buttons: RemoteButton[];
  onPick: (buttonId: string) => void;
  onFolder: (folder: RemoteButton) => void;
}) {
  return (
    <div className="scrollbar-none flex shrink-0 gap-1.5 overflow-x-auto border-t border-zinc-800 bg-zinc-950 px-2 pt-1.5">
      {buttons.map((b) => {
        const Icon = getIcon(b.icon);
        return (
          <button
            key={b.id}
            type="button"
            // Keeps the keyboard open, like the key row.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => (b.kind === "folder" ? onFolder(b) : onPick(b.id))}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 text-xs whitespace-nowrap text-zinc-200 active:bg-zinc-700"
          >
            {Icon && <Icon size={13} />}
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
