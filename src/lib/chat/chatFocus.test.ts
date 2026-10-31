import { describe, expect, it } from "vitest";
import { focusIsFree, type FocusInfo } from "@/lib/chat/chatFocus";

const at = (info: Partial<FocusInfo>): FocusInfo => ({
  tag: "button",
  editable: false,
  inChat: true,
  inMenu: false,
  ...info,
});

describe("focusIsFree", () => {
  it("takes the keyboard from nowhere or a button of its own chat", () => {
    expect(focusIsFree(null)).toBe(true);
    expect(focusIsFree(at({}))).toBe(true);
  });

  it("never from what accepts typing: the Ctrl+F box, a field, an editable block", () => {
    // The search box's input: an Enter for « next match » would answer.
    expect(focusIsFree(at({ tag: "input", inMenu: true }))).toBe(false);
    expect(focusIsFree(at({ tag: "textarea" }))).toBe(false);
    expect(focusIsFree(at({ tag: "div", editable: true }))).toBe(false);
    // A visual's frame: its page may have a field the user types in.
    expect(focusIsFree(at({ tag: "iframe" }))).toBe(false);
  });

  it("never from an open menu, nor from outside the chat", () => {
    expect(focusIsFree(at({ inMenu: true }))).toBe(false);
    expect(focusIsFree(at({ inChat: false }))).toBe(false);
  });
});
