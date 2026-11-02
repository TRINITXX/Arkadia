import {
  activityTools,
  foldActivity,
  groupChatItems,
  stepReplyIds,
  type ChatUnit,
  type ThinkingItem,
} from "@/lib/chat/chatGroups";
import { withDayBreaks, type DayRow } from "@/lib/chat/chatDays";
import { latestPlan, type ChatItem } from "@/lib/chat/chatState";
import { turnDoneLine } from "@/lib/chat/chatSteps";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/**
 * The iPhone's conversation feed: the desktop column's units
 * (`chat-timeline.tsx`: `groupChatItems`, `foldActivity`, day breaks, step
 * replies), as the rows of an inverted list. Pure.
 */

/** A row's content: a column unit, or a day's mark. */
export type FeedUnit = ChatUnit | DayRow;

export interface FeedRow {
  key: string;
  unit: FeedUnit;
  /** Claude's reply that only says what it does next (`stepReplyIds`). */
  step: boolean;
  /** A plan card's plan: the latest one written up to it (`latestPlan`). */
  plan: string | null;
  /** « ✻ Terminé en … » of a turn row (`turnDoneLine`). */
  turn: string | null;
}

/** A unit's time for the day breaks; a gathered one's, its first known. */
export function unitAt(u: ChatUnit): number | undefined {
  switch (u.kind) {
    case "activity":
      return u.units.map(unitAt).find((at) => at !== undefined);
    case "thoughts":
      return u.items.find((i) => i.at !== undefined)?.at;
    case "work":
      return u.tools.find((t) => t.at !== undefined)?.at;
    default:
      return u.item.at;
  }
}

export function unitKey(u: FeedUnit): string {
  switch (u.kind) {
    case "day":
    case "work":
    case "activity":
    case "thoughts":
      return u.id;
    default:
      return u.item.id;
  }
}

/** The latest thinking of a stretch that says something (`ChatThoughts`). */
export function lastThought(items: readonly ThinkingItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const body = thoughtBody(items[i].text);
    if (body) return body;
  }
  return "";
}

/**
 * The feed's rows, newest first (an inverted list's order). Rows the column
 * draws as nothing are left out: a short turn's « Terminé en », a thinking
 * with no words. Steps are read on every unit, as the desktop does.
 */
export function feedRows(
  items: ChatItem[],
  working: boolean,
  now: number = Date.now(),
): FeedRow[] {
  const folded = foldActivity(groupChatItems(items));
  const steps = stepReplyIds(folded, working);
  const turnOf = (u: ChatUnit) =>
    u.kind === "turn"
      ? turnDoneLine(
          {
            durationMs: u.item.durationMs,
            endedAt: u.item.at ?? 0,
            tools: u.item.tools,
            files: u.item.files,
          },
          false,
        )
      : null;
  const shown = folded.filter((u) =>
    u.kind === "turn"
      ? turnOf(u) !== null
      : u.kind === "thoughts"
        ? lastThought(u.items) !== ""
        : true,
  );
  const rows = withDayBreaks(shown, unitAt, now).map(
    (unit): FeedRow => ({
      key: unitKey(unit),
      unit,
      step: unit.kind === "text" && steps.has(unit.item.id),
      plan: unit.kind === "plan" ? planUpTo(items, unit.item.id) : null,
      turn: unit.kind === "day" ? null : turnOf(unit),
    }),
  );
  return rows.reverse();
}

/** The plan an ExitPlanMode call submitted: the latest written up to it. */
function planUpTo(items: ChatItem[], id: string): string | null {
  const at = items.findIndex((i) => i.id === id);
  return latestPlan(items.slice(0, at + 1));
}

/** The items a unit draws: a row whose items are the same draws the same. */
export function unitParts(u: FeedUnit): readonly unknown[] {
  switch (u.kind) {
    case "day":
      return [u.label];
    case "activity":
      return activityTools(u.units);
    case "work":
      return u.tools;
    case "thoughts":
      return u.items;
    default:
      return [u.item];
  }
}

/**
 * Whether a row draws as it did: its units are built again on each change of
 * the chat, its items are kept when they didn't change (`reduceChat`). A row
 * re-renders only for its own items, never per streamed token of another.
 */
export function sameRow(a: FeedRow, b: FeedRow): boolean {
  if (a === b) return true;
  if (
    a.key !== b.key ||
    a.unit.kind !== b.unit.kind ||
    a.step !== b.step ||
    a.plan !== b.plan ||
    a.turn !== b.turn
  )
    return false;
  const pa = unitParts(a.unit);
  const pb = unitParts(b.unit);
  return pa.length === pb.length && pa.every((p, i) => p === pb[i]);
}

/** The uuid the chat server sent a message under (`sent:<uuid>`). */
export function sentUuid(id: string): string | null {
  return id.startsWith("sent:") ? id.slice("sent:".length) : null;
}

/** A `!` command's server id (`bash:<id>`), what its stop names. */
export function bashServerId(id: string): string | null {
  return id.startsWith("bash:") ? id.slice("bash:".length) : null;
}
