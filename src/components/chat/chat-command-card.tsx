import { useMemo, useState } from "react";
import { SquareSlash } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import { ChatQueuedMark } from "@/components/chat/chat-queued-mark";
import { ChatUsageBody } from "@/components/chat/chat-usage-card";
import type { CommandItem } from "@/lib/chat/chatCommands";
import { parseUsageReport, USAGE_COMMANDS } from "@/lib/chat/chatUsage";

/**
 * A slash command in the column: its name and arguments, then what Claude
 * Code answered without the model (/context, /usage, /model…), dimmed so it
 * doesn't read as Claude's words. A command the model runs (a skill) keeps
 * the header alone, Claude's reply follows as usual. Sent while Claude
 * works, it waits like a message (`ChatQueuedMark`).
 */
export function ChatCommandCard({
  item,
  cwd,
  onOpen,
  onToast,
  onSendNow,
  onRemove,
}: {
  item: CommandItem;
  cwd: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
  /** Stops the turn so Claude takes the queued messages now. */
  onSendNow?: () => void;
  /** Withdraws it while it still waits. */
  onRemove?: () => void;
}) {
  // /usage's plain text as bars and tabs: its reset times read as of the
  // card's first showing (« aujourd'hui à 8 h 10 »).
  const [shownAt] = useState(() => Date.now());
  const usage = useMemo(
    () =>
      item.output && USAGE_COMMANDS.has(item.name)
        ? parseUsageReport(item.output, shownAt)
        : null,
    [item.output, item.name, shownAt],
  );
  return (
    <div className={`chat-unit chat-cmd${item.queued ? " queued" : ""}`}>
      <div className="head">
        <SquareSlash />
        <span className="name">/{item.name}</span>
        {item.args && <span className="args">{item.args}</span>}
        {usage?.plan && <span className="plan">{usage.plan}</span>}
        {(item.queued || item.dropped) && (
          <ChatQueuedMark
            dropped={item.dropped}
            onSendNow={onSendNow}
            onRemove={onRemove}
          />
        )}
      </div>
      {usage ? (
        <ChatUsageBody report={usage} />
      ) : (
        item.output && (
          <div className="body reading-md">
            <MarkdownContent
              text={item.output}
              baseDir={cwd}
              onOpen={onOpen}
              onToast={onToast}
            />
          </div>
        )
      )}
    </div>
  );
}
