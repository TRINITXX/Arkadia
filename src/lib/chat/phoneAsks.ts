import { editDiff, type DiffRow } from "@/lib/chat/chatDiff";
import { toolSummary } from "@/lib/chat/chatGroups";
import {
  lastReplyRound,
  roundShowsNow,
  type RoundAnswer,
} from "@/lib/chat/chatQuestionRound";
import type { PendingElicitation } from "@/lib/chat/chatSdkSettings";
import type { ChatState, PendingRequest } from "@/lib/chat/chatState";

/**
 * What waits for the user's answer on the iPhone, above the composer: the
 * one the desktop's input card shows (`chat-view.tsx`), one at a time.
 */

export type PhoneAsk =
  | { kind: "question"; request: PendingRequest }
  | { kind: "plan"; request: PendingRequest }
  | { kind: "permission"; request: PendingRequest }
  | { kind: "elicitation"; request: PendingElicitation }
  /** Claude's ❓ round in his last reply (`lastReplyRound`). */
  | { kind: "round"; round: NonNullable<ReturnType<typeof lastReplyRound>> };

/**
 * The desktop's order: Claude Code's request first (AskUserQuestion, a plan,
 * any other tool), then an MCP server's, then the round of questions Claude
 * wrote. A closed chat waits for nothing. The round up at rest stays while
 * Claude works again (the user's choice of 02/11/2026: a subagent's report
 * woke Claude and the sheet vanished under his finger), an answer sent
 * meanwhile queued like any message; a round born mid-turn waits for its
 * end, never covering an input in use (`restRound`, noted when the turn
 * started).
 */
export function phoneAsk(
  state: Pick<
    ChatState,
    "closed" | "requests" | "sdk" | "working" | "items" | "restRound"
  >,
): PhoneAsk | null {
  if (state.closed) return null;
  const request = state.requests[0];
  if (request) {
    if (request.toolName === "AskUserQuestion")
      return { kind: "question", request };
    if (request.toolName === "ExitPlanMode") return { kind: "plan", request };
    return { kind: "permission", request };
  }
  const elicitation = state.sdk.elicitations[0];
  if (elicitation) return { kind: "elicitation", request: elicitation };
  const round = lastReplyRound(state.items);
  if (!round || !roundShowsNow(state.working, round.id, state.restRound))
    return null;
  return { kind: "round", round };
}

/** Rows past this are left out of a permission's diff, counted. */
export const PERMISSION_DIFF_ROWS = 150;

const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * A permission's tool input, readable on a phone: the command it would run,
 * the change it would make to a file (its input's lines, unnumbered: no
 * result yet), else the desktop's one line (`toolSummary`) or the raw input.
 */
export type PermissionView =
  | { kind: "command"; text: string }
  | {
      kind: "diff";
      /** The file's path as Claude Code gave it. */
      file: string;
      rows: DiffRow[];
      added: number;
      removed: number;
      /** Rows left out past `PERMISSION_DIFF_ROWS`. */
      hidden: number;
    }
  | { kind: "text"; text: string };

export function permissionView(
  request: Pick<PendingRequest, "toolName" | "toolUseId" | "input">,
): PermissionView {
  const { input, toolName } = request;
  if (typeof input.command === "string")
    return { kind: "command", text: input.command };
  if (FILE_TOOLS.has(toolName)) {
    const diff = editDiff(toolName, input, undefined);
    if (diff.rows.length > 0) {
      const path = input.file_path ?? input.notebook_path;
      return {
        kind: "diff",
        file: typeof path === "string" ? path : "",
        rows: diff.rows.slice(0, PERMISSION_DIFF_ROWS),
        added: diff.added,
        removed: diff.removed,
        hidden: Math.max(0, diff.rows.length - PERMISSION_DIFF_ROWS),
      };
    }
  }
  const tool = {
    kind: "tool" as const,
    id: request.toolUseId,
    name: toolName,
    input,
  };
  return {
    kind: "text",
    text: toolSummary(tool) || JSON.stringify(input, null, 2),
  };
}

/**
 * The question sheet of one chat (the desktop's `SheetAnswers`): its answers
 * by question `key`, closed (×: answered in the composer) or folded to its
 * head. It belongs to one round: a new one starts empty.
 */
export interface RoundSheet {
  replyId: string;
  answers: Record<string, RoundAnswer>;
  closed: boolean;
  folded: boolean;
}

/** The sheet kept for `replyId`, or a new one when the round changed. */
export function roundSheetFor(
  kept: RoundSheet | undefined,
  replyId: string,
): RoundSheet {
  return kept?.replyId === replyId
    ? kept
    : { replyId, answers: {}, closed: false, folded: false };
}

/** A pencil's rewind brings its round back within this, if it does. */
export const BORN_FOLDED_MS = 30_000;

/**
 * A round to open folded (`foldNextRound`): the one a rewind brings back,
 * never `except`, the round shown when it was asked (it keeps its sheet).
 */
export interface BornFolded {
  at: number;
  except: string | null;
}

/**
 * The sheet `replyId`'s round shows: the one kept for it, else a new one,
 * folded when a rewind just asked so. `consumed`: that ask is spent. The
 * round shown at the ask, read again before the rewind lands, neither
 * takes nor spends it.
 */
export function roundSheetBorn(
  kept: RoundSheet | undefined,
  born: BornFolded | undefined,
  replyId: string,
  now: number,
): { sheet: RoundSheet; consumed: boolean } {
  if (kept?.replyId === replyId) return { sheet: kept, consumed: false };
  const fresh = roundSheetFor(undefined, replyId);
  if (!born || born.except === replyId)
    return { sheet: fresh, consumed: false };
  const folded = now - born.at < BORN_FOLDED_MS;
  return { sheet: folded ? { ...fresh, folded } : fresh, consumed: true };
}

/** A question's answer changed: an option, the reco, its own words. */
export function withRoundAnswer(
  sheet: RoundSheet,
  key: string,
  patch: RoundAnswer,
): RoundSheet {
  return {
    ...sheet,
    answers: { ...sheet.answers, [key]: { ...sheet.answers[key], ...patch } },
  };
}

/** Dictated words, after what the question's field holds. */
export function withDictatedText(
  sheet: RoundSheet,
  key: string,
  text: string,
): RoundSheet {
  const prev = sheet.answers[key]?.text?.trimEnd() ?? "";
  return withRoundAnswer(sheet, key, {
    text: prev ? `${prev} ${text}` : text,
  });
}
