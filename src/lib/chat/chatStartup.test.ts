import { describe, expect, it } from "vitest";
import { startupPhase } from "@/lib/chat/chatStartup";
import { EMPTY_CHAT } from "@/lib/chat/chatState";

describe("an empty chat column", () => {
  it("says Claude starts, then welcomes a new chat", () => {
    expect(startupPhase(EMPTY_CHAT, false)).toBe("starting");
    const booted = { ...EMPTY_CHAT, context: { percentage: 0 } };
    expect(startupPhase(booted, false)).toBe("welcome");
    expect(
      startupPhase(
        { ...booted, items: [{ kind: "user", id: "u", text: "a", images: 0 }] },
        false,
      ),
    ).toBeNull();
  });

  it("says a resumed conversation loads until its past is in", () => {
    expect(startupPhase(EMPTY_CHAT, true)).toBe("resuming");
    expect(startupPhase({ ...EMPTY_CHAT, historyLoaded: true }, true)).toBe(
      "starting",
    );
    expect(startupPhase({ ...EMPTY_CHAT, closed: {} }, true)).toBeNull();
    // `continue` with no session in the folder: an empty past, the welcome.
    expect(
      startupPhase(
        { ...EMPTY_CHAT, historyLoaded: true, context: { percentage: 0 } },
        true,
      ),
    ).toBe("welcome");
  });

  it("welcomes a chat opened asleep: no Claude Code, its sessions shown", () => {
    expect(startupPhase({ ...EMPTY_CHAT, asleep: true }, false)).toBe(
      "welcome",
    );
    // Woken by a letter, Claude Code booting: still its sessions, not
    // « Claude démarre… ».
    expect(startupPhase(EMPTY_CHAT, false, true)).toBe("welcome");
  });
});
