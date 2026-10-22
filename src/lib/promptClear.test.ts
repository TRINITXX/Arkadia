import { describe, it, expect } from "vitest";
import { clearPromptChunks } from "./promptClear";

describe("clearPromptChunks", () => {
  it("keeps every write small enough not to be read as a paste", () => {
    for (const chunk of clearPromptChunks()) {
      expect(chunk.length).toBeLessThanOrEqual(16);
    }
  });

  it("goes to the line end, kills what follows, then what precedes", () => {
    const keys = clearPromptChunks().flat();
    expect(keys[0]).toBe(0x05);
    const lastK = keys.lastIndexOf(0x0b);
    const firstU = keys.indexOf(0x15);
    expect(lastK).toBeGreaterThan(0);
    expect(firstU).toBeGreaterThan(lastK);
  });

  it("never sends a key that interrupts Claude or submits", () => {
    const keys = clearPromptChunks().flat();
    // Esc and Ctrl+C stop a running turn, Enter / Ctrl+J would send or add a line.
    for (const k of [0x1b, 0x03, 0x0d, 0x0a]) expect(keys).not.toContain(k);
  });
});
