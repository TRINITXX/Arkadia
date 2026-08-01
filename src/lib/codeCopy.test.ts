import { describe, it, expect } from "vitest";
import { copiedCodeMessage } from "./codeCopy";

describe("copiedCodeMessage", () => {
  it("shows the line count and the first line", () => {
    expect(copiedCodeMessage("npm run dev")).toBe(
      "Copié (1 ligne) · npm run dev",
    );
    expect(copiedCodeMessage("const a = 1;\nconst b = 2;")).toBe(
      "Copié (2 lignes) · const a = 1;",
    );
  });

  it("skips leading blank lines to find the first real one", () => {
    expect(copiedCodeMessage("\n\n  cargo test\nautre")).toBe(
      "Copié (4 lignes) · cargo test",
    );
  });

  it("cuts a long first line short", () => {
    const long = "x".repeat(120);
    const msg = copiedCodeMessage(long);
    expect(msg).toBe(`Copié (1 ligne) · ${"x".repeat(60)}…`);
    expect(msg.length).toBeLessThan(90);
  });

  it("keeps a line of exactly the cutoff length whole", () => {
    const exact = "y".repeat(60);
    expect(copiedCodeMessage(exact)).toBe(`Copié (1 ligne) · ${exact}`);
  });

  it("falls back to the count alone when there is nothing to preview", () => {
    expect(copiedCodeMessage("   \n\t")).toBe("Copié (2 lignes)");
  });
});
