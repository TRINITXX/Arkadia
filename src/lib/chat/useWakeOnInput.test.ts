import { describe, expect, it } from "vitest";
import { typesCommand } from "@/lib/chat/useWakeOnInput";

describe("the first key in a chat asleep (useWakeOnInput)", () => {
  it("tells a slash command apart, so the server prepares no handoff for it", () => {
    expect(typesCommand("/")).toBe(true);
    expect(typesCommand({ text: "  /compact" })).toBe(true);
    expect(typesCommand("O")).toBe(false);
    expect(typesCommand({ text: "On attaque /export" })).toBe(false);
  });
});
