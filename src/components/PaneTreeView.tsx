import type {
  EditorProtocol,
  PaneState,
  PaneTree,
  SplitDirection,
  TerminalFont,
  TerminalPalette,
  ToolDensity,
} from "@/types";
import { footerRowCount } from "@/lib/terminalChrome";
import { measureCellSize } from "@/lib/cellSize";
import { usePaneFrameSelector } from "@/lib/frameStore";
import { Terminal } from "./Terminal";
import { TerminalWebGPU } from "./TerminalWebGPU";
import {
  ModernConversationView,
  type ConvFilters,
  type ModernNavHandle,
} from "./ModernConversationView";
import type { AgentStateValue } from "@/lib/agentState";

/** Pixel height of the real-terminal footer left uncovered by the modern view. */
// One row of headroom so the top border of the input box is never clipped
// (cell-height measured here can differ slightly from the renderer's).
const FOOTER_HEADROOM_ROWS = 1;

function footerPx(
  rows: number,
  font: TerminalFont,
  useWebGPU: boolean,
): number {
  const { height } = measureCellSize(font.family, font.size);
  // Mirror the terminal's own bottom padding (TerminalWebGPU = 20, Terminal = 12).
  const pad = useWebGPU ? 20 : 12;
  return Math.round((rows + FOOTER_HEADROOM_ROWS) * height + pad);
}

/** The modern-view overlay, positioned above the live terminal footer. Reads
 *  the footer row count through a frame-store selector: re-renders only when
 *  that number changes, not on every terminal frame. */
function ModernOverlay({
  paneId,
  font,
  useWebGPU,
  children,
}: {
  paneId: string;
  font: TerminalFont;
  useWebGPU: boolean;
  children: React.ReactNode;
}) {
  const footerRows = usePaneFrameSelector(paneId, footerRowCount);
  return (
    <div
      className="absolute inset-x-0 top-0 z-20"
      style={{ bottom: footerPx(footerRows, font, useWebGPU) }}
    >
      {children}
    </div>
  );
}

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
  /** Render every pane as the structured modern view over the terminal footer. */
  modernViewEnabled: boolean;
  toolDensity: ToolDensity;
  convFilters: ConvFilters;
  onConvFiltersChange: (next: ConvFilters) => void;
  /** Attached to the active pane's modern view so the nav arrows can drive it. */
  modernNavRef?: React.Ref<ModernNavHandle>;
  /** Per-pane agent state, so the modern view can show a live "working" indicator. */
  paneAgentStates: Record<string, AgentStateValue>;
  onActivate: (paneId: string) => void;
  /** Fired when the user produces real input (keystroke/paste) in a pane. */
  onUserInput?: () => void;
  onContextMenu: (paneId: string, x: number, y: number) => void;
  onSetRatio: (path: number[], ratio: number) => void;
  path?: number[];
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
  modernViewEnabled,
  toolDensity,
  convFilters,
  onConvFiltersChange,
  modernNavRef,
  paneAgentStates,
  onActivate,
  onUserInput,
  onContextMenu,
  onSetRatio,
  path = [],
}: PaneTreeViewProps) {
  if (tree.kind === "leaf") {
    const pane = panes[tree.paneId];
    if (!pane) return null;
    const isActive = pane.id === activePaneId;
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
        {modernViewEnabled && (
          <ModernOverlay paneId={pane.id} font={font} useWebGPU={useWebGPU}>
            <ModernConversationView
              ref={isActive ? modernNavRef : undefined}
              paneId={pane.id}
              filters={convFilters}
              onFiltersChange={onConvFiltersChange}
              density={toolDensity}
              palette={palette}
              agentState={paneAgentStates[pane.id]}
              isActive={isActive}
            />
          </ModernOverlay>
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
          modernViewEnabled={modernViewEnabled}
          toolDensity={toolDensity}
          convFilters={convFilters}
          onConvFiltersChange={onConvFiltersChange}
          modernNavRef={modernNavRef}
          paneAgentStates={paneAgentStates}
          onActivate={onActivate}
          onUserInput={onUserInput}
          onContextMenu={onContextMenu}
          onSetRatio={onSetRatio}
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
          modernViewEnabled={modernViewEnabled}
          toolDensity={toolDensity}
          convFilters={convFilters}
          onConvFiltersChange={onConvFiltersChange}
          modernNavRef={modernNavRef}
          paneAgentStates={paneAgentStates}
          onActivate={onActivate}
          onUserInput={onUserInput}
          onContextMenu={onContextMenu}
          onSetRatio={onSetRatio}
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
