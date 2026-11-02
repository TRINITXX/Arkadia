import type { ChatUnit, FoldedUnit, ThinkingItem } from "@/lib/chat/chatGroups";

type ThoughtsUnit = Extract<ChatUnit, { kind: "thoughts" }>;
type ActivityUnit = Extract<ChatUnit, { kind: "activity" }>;

/**
 * Where Claude's thinking and tools show in the column (« Récit », the
 * user's picks of 02/11/2026). The exchange under way shows its tool lines
 * and its latest thought in full; the rest goes behind small icons on
 * Claude's replies: a bulb for the thinking, a wrench for the tools.
 */
export interface WorkPlaces {
  /** The thoughts behind a reply's bulb: those that led to it. */
  thoughts: Map<string, ThinkingItem[]>;
  /** The tools behind a reply's wrench once its exchange is past: the ones
   *  run after it, or before the first reply, that reply's. */
  tools: Map<string, FoldedUnit[]>;
  /** The `thoughts` unit drawn in full: the latest, while Claude works. */
  live: string | null;
  /** `thoughts` and `activity` units with no reply in their exchange: an
   *  icon of their own once the exchange is past. */
  alone: Set<string>;
  /** The replies and tool lines of the exchange under way: replies in full
   *  ink, tool lines shown. */
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
      current.add(unit.id);
      if (lastReply) give(tools, lastReply, unit.units);
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
  settle();
  return { thoughts, tools, live, alone, current };
}
