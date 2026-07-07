import { describe, it, expect } from "vitest";
import type React from "react";
import { describeKeyEvent } from "@/lib/keymap";

const ev = (o: Partial<React.KeyboardEvent>) => o as React.KeyboardEvent;

describe("describeKeyEvent", () => {
  it("labels Shift+Tab", () => {
    expect(describeKeyEvent(ev({ shiftKey: true, key: "Tab" }))).toBe(
      "Shift+Tab",
    );
  });

  it("uppercases a Ctrl+letter combo", () => {
    expect(describeKeyEvent(ev({ ctrlKey: true, key: "c" }))).toBe("Ctrl+C");
  });

  it("names bare special keys with symbols", () => {
    expect(describeKeyEvent(ev({ key: "Escape" }))).toBe("Esc");
    expect(describeKeyEvent(ev({ key: "ArrowUp" }))).toBe("↑");
  });

  it("orders modifiers Ctrl, Alt, Shift, Meta", () => {
    expect(
      describeKeyEvent(
        ev({ ctrlKey: true, altKey: true, shiftKey: true, key: "k" }),
      ),
    ).toBe("Ctrl+Alt+Shift+K");
  });
});
