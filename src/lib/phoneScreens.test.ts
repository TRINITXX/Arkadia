import { describe, expect, it } from "vitest";
import { topStreams, type PhoneScreen } from "@/lib/phoneScreens";

const chat = (pane: string): PhoneScreen => ({ kind: "chat", pane });
const term = (pane: string): PhoneScreen => ({ kind: "frames", pane });

describe("topStreams", () => {
  it("streams the topmost screen alone", () => {
    expect(topStreams([chat("A"), term("T")], "A", false)).toEqual({
      frames: "T",
      chat: null,
      catchUp: null,
    });
  });

  it("catches up a chat back on top, never one just opened", () => {
    // A notification stacked chat B over chat A, then B left.
    expect(topStreams([chat("A")], "B", true).catchUp).toBe("A");
    // A terminal over chat A left: A missed its events too.
    expect(topStreams([chat("A")], null, true).catchUp).toBe("A");
    // Opened: it asks for its own replay.
    expect(topStreams([chat("A")], null, false).catchUp).toBeNull();
    // The same chat stacked twice: the one below never stopped.
    expect(topStreams([chat("A")], "A", true).catchUp).toBeNull();
  });
});
