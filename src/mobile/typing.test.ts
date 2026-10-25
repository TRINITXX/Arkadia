import { afterEach, describe, expect, it, vi } from "vitest";
import { pasteData, typingDelta } from "./typing";

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

  it("pastes line breaks as Enter, inside markers when the app wants them", () => {
    expect(pasteData("a\r\nb\nc", false)).toBe("a\rb\rc");
    expect(pasteData("a\nb", true)).toBe("\x1b[200~a\rb\x1b[201~");
  });

  it("counts an emoji as one character to erase", () => {
    expect(typingDelta("ok 👍🏽", "ok ")).toBe(DEL);
  });
});

// The iPhone app's engine may lack Intl.Segmenter: the fallback must erase
// what iOS erases in one stroke.
describe("typingDelta without Intl.Segmenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function fallbackDelta(): Promise<typeof typingDelta> {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    vi.resetModules();
    return (await import("./typing")).typingDelta;
  }

  it.each([
    ["skin tone", "👍🏽"],
    ["variation selector", "❤️"],
    ["joined family", "👨‍👩‍👧"],
    ["flag", "🇫🇷"],
    ["keycap", "1️⃣"],
    ["accent typed as a combining mark", "é"],
  ])("erases a %s as one character", async (_, glyph) => {
    const delta = await fallbackDelta();
    expect(delta(`ok ${glyph}`, "ok ")).toBe(DEL);
  });

  it("keeps two flags apart", async () => {
    const delta = await fallbackDelta();
    expect(delta("🇫🇷🇮🇹", "🇫🇷")).toBe(DEL);
  });
});
