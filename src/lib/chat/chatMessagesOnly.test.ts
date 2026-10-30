import { describe, expect, it } from "vitest";
import {
  dropMessagesOnly,
  isMessagesOnly,
  moveMessagesOnly,
  setMessagesOnly,
} from "@/lib/chat/chatMessagesOnly";

describe("chatMessagesOnly", () => {
  it("is per pane, follows a relaunched pane and goes with a closed one", () => {
    setMessagesOnly("p1", true);
    expect(isMessagesOnly("p1")).toBe(true);
    expect(isMessagesOnly("p2")).toBe(false);
    moveMessagesOnly("p1", "p3");
    expect(isMessagesOnly("p1")).toBe(false);
    expect(isMessagesOnly("p3")).toBe(true);
    dropMessagesOnly("p3");
    expect(isMessagesOnly("p3")).toBe(false);
  });
});
