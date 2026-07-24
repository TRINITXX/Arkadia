import { memo } from "react";
import { MessageBubble } from "@/components/modern/MessageBubble";
import { ToolCard } from "@/components/modern/ToolCard";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import type { ConvBlock } from "@/components/ModernConversationView";
import type { ToolDensity } from "@/types";

/** 0 = not a match, 1 = a match, 2 = the current match. */
export type MatchState = 0 | 1 | 2;

/** Nav target kind: 1 = user block, 2 = assistant block, 0 = neither. */
export function navKindOf(kind: ConvBlock["kind"]): 0 | 1 | 2 {
  return kind === "user" ? 1 : kind === "assistant" ? 2 : 0;
}

interface BlockRowProps {
  block: ConvBlock;
  index: number;
  /** True when the previous visible block came from a different speaker. */
  speakerChange: boolean;
  density: ToolDensity;
  showResults: boolean;
  matchState: MatchState;
  /** Play the entrance animation (blocks appended live, never initial load). */
  animate: boolean;
  /** Registers/unregisters this row's element for search + nav (null = gone). */
  registerEl: (index: number, el: HTMLDivElement | null) => void;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}

/**
 * One conversation block, memoized: a delta that appends blocks re-renders
 * only the new rows (unchanged `ConvBlock` objects keep their identity across
 * `read_conversation_delta` refreshes).
 */
export const BlockRow = memo(function BlockRow({
  block,
  index,
  speakerChange,
  density,
  showResults,
  matchState,
  animate,
  registerEl,
  onOpen,
  onToast,
}: BlockRowProps) {
  const matchCls =
    matchState === 2
      ? " modern-match modern-match-current"
      : matchState === 1
        ? " modern-match"
        : "";
  return (
    <div
      className={`modern-block${animate ? " modern-enter" : ""}${matchCls}`}
      ref={(el) => registerEl(index, el)}
      style={{
        marginBottom: 6,
        marginTop: speakerChange ? 8 : 0,
        borderRadius: block.kind === "tool" ? 9 : 10,
      }}
    >
      {block.kind === "tool" ? (
        <ToolCard
          block={block}
          density={density}
          showResults={showResults}
          onOpen={onOpen}
          onToast={onToast}
        />
      ) : (
        <MessageBubble block={block} onOpen={onOpen} onToast={onToast} />
      )}
    </div>
  );
});
