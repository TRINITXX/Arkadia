import { describe, expect, it } from "vitest";
import { typingDelta } from "./typing";

const DEL = "\x7f";

describe("typingDelta", () => {
  it("types only what was added", () => {
    expect(typingDelta("bonj", "bonjour")).toBe("our");
    expect(typingDelta("", "a")).toBe("a");
  });

  it("replays an autocorrection as backspaces then the fixed word", () => {
    expect(typingDelta("je sius ", "je suis ")).toBe(`${DEL.repeat(4)}uis `);
  });

  it("erases what was deleted", () => {
    expect(typingDelta("abc", "a")).toBe(DEL.repeat(2));
  });

  it("counts an emoji as one character to erase", () => {
    expect(typingDelta("ok 👍🏽", "ok ")).toBe(DEL);
  });
});
