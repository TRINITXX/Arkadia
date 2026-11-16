import { sinceLabel, type ChatProgress } from "@/lib/chat/chatProgress";
import {
  useChatProgress,
  useProgressClock,
} from "@/lib/chat/chatProgressStore";

interface TabProgressLineProps {
  /** The tab's chat pane, null for none. */
  paneId: string | null;
  solo?: boolean;
  /** Clicks on the line act as on its tab's row (activate, middle-click). */
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}

/**
 * Under a tab's row of the sidebar's « Active » list: how long Claude has
 * worked (or waited), and his latest sentence (`chatProgress`). Chat panes
 * only; nothing for a terminal or a chat that said nothing yet. `solo`: the
 * project's only tab, whose row has no badge column to line up with.
 */
export function TabProgressLine({ paneId, ...line }: TabProgressLineProps) {
  const progress = useChatProgress(paneId);
  // The clock ticks only for a line on screen (`ProgressText`).
  return progress ? <ProgressText progress={progress} {...line} /> : null;
}

function ProgressText({
  progress,
  solo = false,
  onClick,
  onMouseDown,
}: Omit<TabProgressLineProps, "paneId"> & { progress: ChatProgress }) {
  const now = useProgressClock();
  const time =
    progress.since === null ? null : sinceLabel(now - progress.since);
  return (
    <div
      className={`line-clamp-2 pb-1 pr-1.5 text-[11px] leading-snug text-zinc-500 ${
        solo ? "pl-4" : "pl-[22px]"
      } ${onClick ? "cursor-pointer" : ""}`}
      title={progress.text}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      {time !== null && (
        <span className="tabular-nums text-zinc-600">{time} · </span>
      )}
      {progress.text}
    </div>
  );
}
