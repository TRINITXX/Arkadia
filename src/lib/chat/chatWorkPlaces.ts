import type { ChatUnit, FoldedUnit, ThinkingItem } from "@/lib/chat/chatGroups";

type ThoughtsUnit = Extract<ChatUnit, { kind: "thoughts" }>;
type ActivityUnit = Extract<ChatUnit, { kind: "activity" }>;

/**
 * Where Claude's thinking and tools show in the column (« Récit », the
 * user's picks of 02/11/2026). While Claude works, his latest thought and
 * the tool line under way show in full; the rest goes behind small icons
 * on Claude's replies, the exchange under way's too (asked the same day:
 * « oui sauf le dernier en cours »): a bulb for the thinking, a wrench for
 * the tools.
 */
export interface WorkPlaces {
  /** The thoughts behind a reply's bulb: those that led to it. */
  thoughts: Map<string, ThinkingItem[]>;
  /** The tools behind a reply's wrench: the ones run after it, or before
   *  the first reply, that reply's; never the line under way. */
  tools: Map<string, FoldedUnit[]>;
  /** The `thoughts` unit drawn in full: the latest, while Claude works. */
  live: string | null;
  /** `thoughts` and `activity` units with no reply in their exchange: an
   *  icon of their own once the exchange is past. */
  alone: Set<string>;
  /** The replies of the exchange under way, in full ink, and the tool line
   *  under way (the column's last unit while Claude works), shown. */
  current: Set<string>;
}

/**
 * What opens a new exchange: the user's words once Claude takes them (one
 * still waiting, or never taken, doesn't cut what Claude is doing), their
 * commands, another session's message. A turn's end doesn't: its tools stay
 * until the next.
 */
const opensExchange = (unit: ChatUnit): boolean =>
  ((unit.kind === "user" || unit.kind === "command") &&
    !unit.item.queued &&
    !unit.item.dropped) ||
  unit.kind === "bash" ||
  unit.kind === "peer";

/**
 * A thought goes to the reply it led to: the next one in its exchange; the
 * latest no reply follows shows in full while Claude works (the ones before
 * it wait for the next reply, unseen), else it goes to the exchange's last
 * reply. Tools go to the reply that announced them: the last one before
 * them; before any reply, the first one after. With no reply at all: an
 * icon of their own.
 */
export function placeWork(
  units: readonly ChatUnit[],
  working: boolean,
): WorkPlaces {
  const thoughts = new Map<string, ThinkingItem[]>();
  const tools = new Map<string, FoldedUnit[]>();
  const alone = new Set<string>();
  let current = new Set<string>();
  let thinking: ThoughtsUnit[] = [];
  let work: ActivityUnit[] = [];
  let lastReply: string | null = null;
  // The tools Claude runs now: the column's last unit while he works, a
  // message still waiting or a notice (a hook's warning, a quota alert)
  // under it aside.
  let last: ChatUnit | undefined;
  for (let i = units.length - 1; i >= 0 && !last; i--) {
    const u = units[i];
    const aside =
      u.kind === "notice" ||
      ((u.kind === "user" || u.kind === "command") && !opensExchange(u));
    if (!aside) last = u;
  }
  const underWay = working && last?.kind === "activity" ? last.id : null;
  const give = <T>(to: Map<string, T[]>, id: string, items: T[]) => {
    if (items.length > 0) to.set(id, [...(to.get(id) ?? []), ...items]);
  };
  const settle = () => {
    for (const unit of thinking) {
      if (lastReply) give(thoughts, lastReply, unit.items);
      else alone.add(unit.id);
    }
    for (const unit of work) alone.add(unit.id);
    thinking = [];
    work = [];
  };
  for (const unit of units) {
    if (unit.kind === "thoughts") thinking.push(unit);
    else if (unit.kind === "activity") {
      if (unit.id === underWay) current.add(unit.id);
      else if (lastReply) give(tools, lastReply, unit.units);
      else work.push(unit);
    } else if (unit.kind === "text") {
      give(
        thoughts,
        unit.item.id,
        thinking.flatMap((t) => t.items),
      );
      give(
        tools,
        unit.item.id,
        work.flatMap((w) => w.units),
      );
      thinking = [];
      work = [];
      lastReply = unit.item.id;
      current.add(unit.item.id);
    } else if (opensExchange(unit)) {
      settle();
      lastReply = null;
      current = new Set();
    }
  }
  const latest = thinking[thinking.length - 1];
  const live = working && latest ? latest.id : null;
  if (live) thinking = [];
  // Tools before any reply, Claude still at work: they wait for his next
  // reply, unseen, as the thoughts do; never a wrench that comes and goes.
  if (working) work = [];
  settle();
  return { thoughts, tools, live, alone, current };
}
