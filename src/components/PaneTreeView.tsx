import type {
  EditorProtocol,
  PaneState,
  PaneTree,
  SplitDirection,
  TerminalFont,
  TerminalPalette,
} from "@/types";
import { Terminal } from "./Terminal";
import { TerminalWebGPU } from "./TerminalWebGPU";
import { PaneInputRail } from "./PaneInputRail";
import { ChatModeToggle } from "./chat/chat-mode-toggle";
import { ChatPane } from "./chat/chat-pane";

interface PaneTreeViewProps {
  tree: PaneTree;
  panes: Record<string, PaneState>;
  activePaneId: string;
  font: TerminalFont;
  palette: TerminalPalette;
  useWebGPU: boolean;
  editorProtocol: EditorProtocol;
  /** Draw the green/purple conversation frames (WebGPU renderer only). */
  showMessageFrames: boolean;
  /** Surfaces pane errors (input rail, chat…) in the app's toaster. */
  onToast?: (level: "info" | "error", message: string) => void;
  /** Show the Enter / dictation buttons beside the active pane's input box. */
  inputRailEnabled: boolean;
  onActivate: (paneId: string) => void;
  /** Fired when the user produces real input (keystroke/paste) in a pane. */
  onUserInput?: () => void;
  onContextMenu: (paneId: string, x: number, y: number) => void;
  onSetRatio: (path: number[], ratio: number) => void;
  /** Chat panes (Arkadia Lab): see `ChatPane`. */
  chat: PaneChatHandlers;
  path?: number[];
}

export interface PaneChatHandlers {
  /** Panes whose chat / terminal switch is under way. */
  switching: ReadonlySet<string>;
  onToggle: (paneId: string) => void;
  onSession: (paneId: string, sessionId: string) => void;
  onLabel: (paneId: string, label: string) => void;
  /** Sessions running in the other panes (`usePaneChats`), for /resume. */
  liveSessions: (exceptPaneId: string) => Promise<Set<string>>;
}

export function PaneTreeView({
  tree,
  panes,
  activePaneId,
  font,
  palette,
  useWebGPU,
  editorProtocol,
  showMessageFrames,
  onToast,
  inputRailEnabled,
  onActivate,
  onUserInput,
  onContextMenu,
  onSetRatio,
  chat,
  path = [],
}: PaneTreeViewProps) {
  if (tree.kind === "leaf") {
    const pane = panes[tree.paneId];
    if (!pane) return null;
    const isActive = pane.id === activePaneId;
    if (pane.chat) {
      return (
        // Found by its id like a terminal (files dropped from Explorer).
        <div className="relative h-full w-full" data-pane-id={pane.id}>
          <ChatPane
            key={pane.id}
            pane={pane}
            chat={pane.chat}
            isActive={isActive}
            switching={chat.switching.has(pane.id)}
            onActivate={() => onActivate(pane.id)}
            onSession={chat.onSession}
            onLabel={chat.onLabel}
            liveSessions={chat.liveSessions}
            onSwitchToTerminal={chat.onToggle}
            onToast={onToast}
          />
        </div>
      );
    }
    const terminal = useWebGPU ? (
      <TerminalWebGPU
        pane={pane}
        isActive={isActive}
        font={font}
        palette={palette}
        editorProtocol={editorProtocol}
        showMessageFrames={showMessageFrames}
        onActivate={() => onActivate(pane.id)}
        onUserInput={onUserInput}
        onContextMenu={(x, y) => onContextMenu(pane.id, x, y)}
      />
    ) : (
      <Terminal
        pane={pane}
        isActive={isActive}
        font={font}
        palette={palette}
        onActivate={() => onActivate(pane.id)}
        onUserInput={onUserInput}
        onContextMenu={(x, y) => onContextMenu(pane.id, x, y)}
      />
    );
    return (
      <div className="relative h-full w-full">
        {terminal}
        {__ARKADIA_LAB__ && (
          <ChatModeToggle
            mode="terminal"
            busy={chat.switching.has(pane.id)}
            onSwitch={() => chat.onToggle(pane.id)}
          />
        )}
        {isActive && inputRailEnabled && (
          // Keyed: a pane swapped in place gets a fresh rail, not the previous
          // pane's pending send.
          <PaneInputRail
            key={pane.id}
            paneId={pane.id}
            font={font}
            useWebGPU={useWebGPU}
            onToast={onToast}
          />
        )}
      </div>
    );
  }

  const isHorizontal = tree.direction === "horizontal";
  const containerClass = isHorizontal
    ? "flex flex-row h-full w-full min-h-0 min-w-0"
    : "flex flex-col h-full w-full min-h-0 min-w-0";
  const firstFlex = `${(tree.ratio * 100).toFixed(2)}%`;
  const secondFlex = `${((1 - tree.ratio) * 100).toFixed(2)}%`;

  return (
    <div className={containerClass}>
      <div
        style={{ flexBasis: firstFlex }}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <PaneTreeView
          tree={tree.first}
          panes={panes}
          activePaneId={activePaneId}
          font={font}
          palette={palette}
          useWebGPU={useWebGPU}
          editorProtocol={editorProtocol}
          showMessageFrames={showMessageFrames}
          onToast={onToast}
          inputRailEnabled={inputRailEnabled}
          onActivate={onActivate}
          onUserInput={onUserInput}
          onContextMenu={onContextMenu}
          onSetRatio={onSetRatio}
          chat={chat}
          path={[...path, 0]}
        />
      </div>
      <ResizeHandle
        direction={tree.direction}
        onSetRatio={(ratio) => onSetRatio(path, ratio)}
      />
      <div
        style={{ flexBasis: secondFlex }}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <PaneTreeView
          tree={tree.second}
          panes={panes}
          activePaneId={activePaneId}
          font={font}
          palette={palette}
          useWebGPU={useWebGPU}
          editorProtocol={editorProtocol}
          showMessageFrames={showMessageFrames}
          onToast={onToast}
          inputRailEnabled={inputRailEnabled}
          onActivate={onActivate}
          onUserInput={onUserInput}
          onContextMenu={onContextMenu}
          onSetRatio={onSetRatio}
          chat={chat}
          path={[...path, 1]}
        />
      </div>
    </div>
  );
}

interface ResizeHandleProps {
  direction: SplitDirection;
  onSetRatio: (ratio: number) => void;
}

function ResizeHandle({ direction, onSetRatio }: ResizeHandleProps) {
  const isHorizontal = direction === "horizontal";

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const parent = e.currentTarget.parentElement;
    if (!parent) return;

    const onMove = (ev: MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const pos = isHorizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      const clamped = Math.min(0.95, Math.max(0.05, pos));
      onSetRatio(clamped);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      className={
        isHorizontal
          ? "w-1 shrink-0 cursor-col-resize bg-zinc-900 transition-colors hover:bg-zinc-700"
          : "h-1 shrink-0 cursor-row-resize bg-zinc-900 transition-colors hover:bg-zinc-700"
      }
    />
  );
}
