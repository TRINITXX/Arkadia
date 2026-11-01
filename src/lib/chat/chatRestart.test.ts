import { describe, expect, it } from "vitest";
import {
  AUTO_RESUME_WINDOW_MS,
  AUTO_RESUMES,
  mayAutoResume,
  restartStart,
} from "@/lib/chat/chatRestart";
import { EMPTY_CHAT, type ChatState } from "@/lib/chat/chatState";

const start = { cwd: "C:/projet", resume: "first" };

describe("a chat resumed after its server stopped (chatRestart)", () => {
  it("starts again on its session, model, mode and effort, its column kept", () => {
    const state: ChatState = {
      ...EMPTY_CHAT,
      sessionId: "s1",
      model: "claude-haiku-5-5",
      mode: "plan",
      historyLoaded: true,
      sdk: { ...EMPTY_CHAT.sdk, effort: "high" },
    };
    expect(restartStart(state, start)).toEqual({
      cwd: "C:/projet",
      resume: "s1",
      permissionMode: "plan",
      model: "claude-haiku-5-5",
      effort: "high",
      keep: true,
      cut: undefined,
      asleep: undefined,
    });
  });

  it("resumes at a /rewind's cut nothing was sent after, never past it", () => {
    const rewound = {
      ...EMPTY_CHAT,
      sessionId: "s1",
      historyLoaded: true,
      rewind: { before: "u7", at: "a6" },
    };
    expect(restartStart(rewound, start)).toMatchObject({
      resume: "s1",
      historyBefore: "u7",
      resumeSessionAt: "a6",
    });
  });

  it("says a turn was cut, never for a chat asleep", () => {
    const working = { ...EMPTY_CHAT, sessionId: "s1", working: true };
    expect(restartStart(working, start).cut).toBe(true);
    const asleep = { ...EMPTY_CHAT, sessionId: "s1", asleep: true };
    expect(restartStart(asleep, start)).toMatchObject({
      asleep: true,
      cut: undefined,
    });
  });

  it("starts fresh after /clear, and as at first when nothing loaded yet", () => {
    const cleared = { ...EMPTY_CHAT, historyLoaded: true, sessionId: null };
    expect(restartStart(cleared, start).resume).toBeUndefined();
    expect(
      restartStart(EMPTY_CHAT, { cwd: "C:/p", continue: true }),
    ).toMatchObject({
      continue: true,
      keep: undefined,
    });
  });

  it("gives up after a few resumes in a row: the server keeps dying", () => {
    let times: number[] = [];
    for (let i = 0; i < AUTO_RESUMES; i++) {
      const verdict = mayAutoResume(times, 1_000 * i);
      expect(verdict.ok).toBe(true);
      times = verdict.times;
    }
    expect(mayAutoResume(times, 5_000).ok).toBe(false);
    expect(mayAutoResume(times, AUTO_RESUME_WINDOW_MS + 10_000).ok).toBe(true);
  });
});
