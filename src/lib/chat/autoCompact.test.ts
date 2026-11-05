import { describe, expect, it } from "vitest";
import {
  answeredTurn,
  endsOwnCompact,
  idleCompactAhead,
  idleCompactDue,
  turnCompactDue,
  type CompactFacts,
} from "../../../chat-server/autoCompact.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const facts = (extra: Partial<CompactFacts> = {}): CompactFacts => ({
  tokens: 600_000,
  at: 0,
  ttlMs: HOUR,
  busy: false,
  idleTried: null,
  ...extra,
});

describe("when the chat server compacts a session itself (chat-server/autoCompact.ts)", () => {
  it("compacts at a turn's end past 500 k, never while something runs", () => {
    expect(turnCompactDue(facts())).toBe(true);
    expect(turnCompactDue(facts({ tokens: 499_000 }))).toBe(false);
    expect(turnCompactDue(facts({ busy: true }))).toBe(false);
  });

  it("follows only a turn the model answered to its end", () => {
    expect(answeredTurn({ subtype: "success", num_turns: 3, terminal_reason: "completed" })).toBe(true);
    // A local command (/usage, /compact itself), Esc, an error.
    expect(answeredTurn({ subtype: "success", num_turns: 0 })).toBe(false);
    expect(answeredTurn({ subtype: "success", num_turns: 2, terminal_reason: "aborted_streaming" })).toBe(false);
    expect(answeredTurn({ subtype: "success", num_turns: 2, is_error: true })).toBe(false);
    expect(answeredTurn({ subtype: "error_during_execution", num_turns: 2 })).toBe(false);
  });

  it("compacts a chat left alone past 400 k at 54 min of its 1 h cache", () => {
    expect(idleCompactDue(facts({ tokens: 400_000 }), 53 * MIN)).toBe(false);
    expect(idleCompactDue(facts({ tokens: 400_000 }), 54 * MIN)).toBe(true);
    expect(idleCompactDue(facts({ tokens: 399_000 }), 54 * MIN)).toBe(false);
    expect(idleCompactDue(facts({ busy: true }), 54 * MIN)).toBe(false);
  });

  it("keeps the chat awake for that compaction, once per request, never past its cache", () => {
    expect(idleCompactAhead(facts(), 30 * MIN)).toBe(true);
    // Tried after that request already (it failed): the chat may sleep.
    expect(idleCompactAhead(facts({ idleTried: 0 }), 30 * MIN)).toBe(false);
    expect(idleCompactDue(facts({ idleTried: 0 }), 54 * MIN)).toBe(false);
    // The PC slept through it: too late, the next message's handoff takes over.
    expect(idleCompactAhead(facts(), 59 * MIN)).toBe(false);
    expect(idleCompactDue(facts(), 2 * HOUR)).toBe(false);
    // A 5-min cache: none, the handoff takes it.
    expect(idleCompactDue(facts({ ttlMs: 5 * MIN }), 4.5 * MIN)).toBe(false);
  });

  it("knows its own /compact's end by its message, never the next result whoever's", () => {
    const result = (uuids: string[]) => ({ type: "result", user_message_uuids: uuids });
    // A turn already taken ends first: not its.
    expect(endsOwnCompact({ uuid: "c", running: false }, result(["u1"]))).toBe(false);
    expect(endsOwnCompact({ uuid: "c", running: true }, result([]))).toBe(true);
    // Its « started » frame never came: its message named, it still ends.
    expect(endsOwnCompact({ uuid: "c", running: false }, result(["c"]))).toBe(true);
    expect(endsOwnCompact(null, result(["c"]))).toBe(false);
  });
});
