import type { PagePanel } from "@/lib/chat/chatSlash";
import type { ChatState } from "@/lib/chat/chatState";
import { McpSheet } from "~/chat/slash/mcp-sheet";
import { ResumeSheet } from "~/chat/slash/resume-sheet";
import { RewindSheet } from "~/chat/slash/rewind-sheet";
import type { ChatActions } from "~/chat/use-chat";

/** The page command whose sheet shows; `open` false: it slides out. */
export interface OpenPanel {
  panel: PagePanel;
  /** Its filter, the words typed after the command. */
  query: string;
  open: boolean;
}

/**
 * The page's own commands, /resume, /rewind and /mcp, each its sheet. All
 * three stay mounted, one shown: a sheet slides out with its rows, and
 * /mcp's sign-ins under way outlive it.
 */
export function SlashPanels({
  sheet,
  state,
  actions,
  onQuery,
  onClose,
  onText,
  onRewinding,
}: {
  sheet: OpenPanel | null;
  state: ChatState;
  actions: ChatActions;
  onQuery: (query: string) => void;
  onClose: () => void;
  /** Text for the composer: the message a rewind went back before. */
  onText: (text: string) => void;
  /** A conversation rewind about to go: the round it brings back opens folded. */
  onRewinding: () => void;
}) {
  const props = (panel: PagePanel) => ({
    visible: !!sheet?.open && sheet.panel === panel,
    query: sheet?.panel === panel ? sheet.query : "",
    onQuery,
    actions,
    onClose,
  });
  return (
    <>
      <ResumeSheet {...props("resume")} sessionId={state.sessionId} />
      <RewindSheet
        {...props("rewind")}
        onRewinding={onRewinding}
        onRewound={onText}
      />
      <McpSheet {...props("mcp")} servers={state.sdk.mcpServers} />
    </>
  );
}
