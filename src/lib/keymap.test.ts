import { describe, it, expect } from "vitest";
import type React from "react";
import { describeKeyEvent, keyEventToBytes } from "@/lib/keymap";

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

describe("keyEventToBytes", () => {
  it("sends Ctrl+Enter as CSI u so it differs from a bare Enter", () => {
    const decode = (b: Uint8Array | null) => new TextDecoder().decode(b!);
    expect(decode(keyEventToBytes(ev({ ctrlKey: true, key: "Enter" })))).toBe(
      "\x1b[13;5u",
    );
    expect(decode(keyEventToBytes(ev({ key: "Enter" })))).toBe("\r");
  });

  it("keeps Ctrl+Shift+Enter as the Shift+Enter newline", () => {
    const decode = (b: Uint8Array | null) => new TextDecoder().decode(b!);
    expect(
      decode(
        keyEventToBytes(ev({ ctrlKey: true, shiftKey: true, key: "Enter" })),
      ),
    ).toBe("\x1b\r");
  });
});
