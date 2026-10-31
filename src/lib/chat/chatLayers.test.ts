import { describe, expect, it } from "vitest";
import { createChatLayers } from "@/lib/chat/chatLayers";

describe("a chat pane's layers", () => {
  it("closes the latest one open, and says when none was", () => {
    const layers = createChatLayers();
    const closed: string[] = [];
    layers.open(() => closed.push("shells"));
    const forgetMenu = layers.open(() => closed.push("menu"));
    layers.open(() => closed.push("tasks"));
    expect(layers.closeTop()).toBe(true);
    // The menu closed on its own (a click): Esc goes past it.
    forgetMenu();
    expect(layers.closeTop()).toBe(true);
    // Nothing open: Esc is Claude's (an interrupt).
    expect(layers.closeTop()).toBe(false);
    expect(closed).toEqual(["tasks", "shells"]);
  });
});
