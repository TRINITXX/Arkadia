import {
  activityTools,
  foldActivity,
  groupChatItems,
  messagesOnly as onlyMessages,
  stepReplyIds,
  type ChatUnit,
  type FoldedUnit,
  type ThinkingItem,
} from "@/lib/chat/chatGroups";
import { withDayBreaks, type DayRow } from "@/lib/chat/chatDays";
import { latestPlan, type ChatItem } from "@/lib/chat/chatState";
import { turnDoneLine } from "@/lib/chat/chatSteps";
import { thoughtBody } from "@/lib/chat/chatThoughts";
import { placeWork, type WorkPlaces } from "@/lib/chat/chatWorkPlaces";

/**
 * The iPhone's conversation feed: the desktop column's units
 * (`chat-timeline.tsx`: `groupChatItems`, `foldActivity`, « Messages seuls »,
 * day breaks, step replies, « Récit »), as the rows of an inverted list.
 * Pure.
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
  /** « Récit » (`placeWork`): the thoughts behind a reply's bulb. */
  thoughts: ThinkingItem[] | null;
  /** The tools behind a reply's wrench, once its exchange is past. */
  tools: FoldedUnit[] | null;
  /** A reply said before the exchange under way: a step reply dims. */
  past: boolean;
  /** A thinking or tools row behind an icon of its own, not in full. */
  alone: boolean;
}

export interface FeedOptions {
  /** « Messages seuls » (the ⋯ menu): what `messagesOnly` keeps. */
  messagesOnly?: boolean;
  /** The tool calls a request waits on: « Messages seuls » keeps their plan. */
  pending?: Set<string>;
  now?: number;
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
 * Whether the column draws a unit (`chat-timeline.tsx`): a long turn's
 * « Terminé en » only, a thinking with words in full while live or behind
 * its own bulb, tool lines while their exchange runs or behind their own
 * wrench. The others are behind a reply's icon, or nothing.
 */
function drawn(u: ChatUnit, places: WorkPlaces, turn: string | null): boolean {
  switch (u.kind) {
    case "turn":
      return turn !== null;
    // Gathered into `thoughts` by `foldActivity`.
    case "thinking":
      return false;
    case "thoughts":
      return (
        (places.live === u.id || places.alone.has(u.id)) &&
        lastThought(u.items) !== ""
      );
    case "activity":
      return places.current.has(u.id) || places.alone.has(u.id);
    default:
      return true;
  }
}

/**
 * The feed's rows, newest first (an inverted list's order). Rows the column
 * draws as nothing are left out. Steps are read on every unit, as the
 * desktop does: « Messages seuls » hides the work, not what a reply is.
 */
export function feedRows(
  items: ChatItem[],
  working: boolean,
  { messagesOnly = false, pending, now = Date.now() }: FeedOptions = {},
): FeedRow[] {
  const all = groupChatItems(items);
  const folded = foldActivity(all);
  const steps = stepReplyIds(folded, working);
  const shown = messagesOnly
    ? foldActivity(onlyMessages(all, pending))
    : folded;
  const places = placeWork(shown, working);
  const turnOf = (u: ChatUnit) =>
    u.kind === "turn"
      ? turnDoneLine(
          {
            durationMs: u.item.durationMs,
            endedAt: u.item.at ?? 0,
            tools: u.item.tools,
            files: u.item.files,
          },
          messagesOnly,
        )
      : null;
  const rows: FeedRow[] = [];
  for (const unit of withDayBreaks(shown, unitAt, now)) {
    const turn = unit.kind === "day" ? null : turnOf(unit);
    if (unit.kind !== "day" && !drawn(unit, places, turn)) continue;
    const reply = unit.kind === "text" ? unit.item.id : null;
    const current = reply !== null && places.current.has(reply);
    const thoughts = reply ? places.thoughts.get(reply) : undefined;
    rows.push({
      key: unitKey(unit),
      unit,
      step: reply !== null && steps.has(reply),
      plan: unit.kind === "plan" ? planUpTo(items, unit.item.id) : null,
      turn,
      thoughts: thoughts && lastThought(thoughts) ? thoughts : null,
      tools: (reply && !current && places.tools.get(reply)) || null,
      past: reply !== null && !current,
      alone:
        (unit.kind === "thoughts" && unit.id !== places.live) ||
        (unit.kind === "activity" && !places.current.has(unit.id)),
    });
  }
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

const sameList = (
  a: readonly unknown[] | null,
  b: readonly unknown[] | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.length === b.length &&
    a.every((x, i) => x === b[i]));

/**
 * Whether a row draws as it did: its units are built again on each change of
 * the chat, its items are kept when they didn't change (`reduceChat`). A row
 * re-renders only for its own items, never per streamed token of another.
 */
export function sameRow(a: FeedRow, b: FeedRow): boolean {
  if (a === b) return true;
  return (
    a.key === b.key &&
    a.unit.kind === b.unit.kind &&
    a.step === b.step &&
    a.plan === b.plan &&
    a.turn === b.turn &&
    a.past === b.past &&
    a.alone === b.alone &&
    sameList(unitParts(a.unit), unitParts(b.unit)) &&
    sameList(a.thoughts, b.thoughts) &&
    sameList(
      a.tools && activityTools(a.tools),
      b.tools && activityTools(b.tools),
    )
  );
}

/** The uuid the chat server sent a message under (`sent:<uuid>`). */
export function sentUuid(id: string): string | null {
  return id.startsWith("sent:") ? id.slice("sent:".length) : null;
}

/** A `!` command's server id (`bash:<id>`), what its stop names. */
export function bashServerId(id: string): string | null {
  return id.startsWith("bash:") ? id.slice("bash:".length) : null;
}
