import { describe, expect, it } from "vitest";
import {
  desktopTakesBack,
  phoneChatCommand,
  phoneDrives,
  phonePromptButton,
  phoneTarget,
} from "@/lib/chat/phoneChat";

describe("phoneChatCommand", () => {
  const to = phoneTarget(3);

  it("relays what the user does, for the chat of the pane", () => {
    expect(
      phoneChatCommand("c", { type: "send", text: "hi" }, to, "C:/p"),
    ).toEqual({
      type: "send",
      chatId: "c",
      text: "hi",
    });
    expect(phoneDrives("send")).toBe(true);
  });

  it("addresses a read's answer to the asking phone alone", () => {
    expect(
      phoneChatCommand(
        "c",
        { type: "visual_html", toolUseId: "t" },
        to,
        "C:/p",
      ),
    ).toEqual({ type: "visual_html", chatId: "c", toolUseId: "t", to });
    expect(phoneDrives("visual_html")).toBe(false);
  });

  it("refuses what only the desktop sends", () => {
    for (const command of [
      { type: "close" },
      { type: "phone_replay" },
      { type: "visual_report", checkId: "k", report: {} },
    ] as never[])
      expect(phoneChatCommand("c", command, to, "C:/p")).toBeNull();
  });
});

describe("desktopTakesBack", () => {
  it("hands a chat back to the PC on anything the user does there", () => {
    for (const type of [
      "send",
      "elicit_answer",
      "cancel_queued",
      "set_effort",
      "relaunch",
    ] as const)
      expect(desktopTakesBack(type)).toBe(true);
    // A look is no action: the phone keeps the tab.
    expect(desktopTakesBack("refresh_branch")).toBe(false);
  });
});

describe("phonePromptButton", () => {
  const button = (command: string, submit = true, mode?: "keys") => ({
    command,
    submit,
    mode,
  });

  it("runs a button as the desktop's « Commandes » does", () => {
    expect(phonePromptButton(button("!git status"))).toEqual({
      kind: "bash",
      command: "git status",
    });
    expect(phonePromptButton(button("Relis le diff"))).toEqual({
      kind: "send",
      text: "Relis le diff",
    });
    expect(phonePromptButton(button("Relis ", false))).toEqual({
      kind: "type",
      text: "Relis ",
    });
  });

  it("sends a terminal-only name Claude Code lists (a skill)", () => {
    expect(phonePromptButton(button("/status"), (n) => n === "status")).toEqual({
      kind: "send",
      text: "/status",
    });
  });

  it("refuses a keyboard shortcut and what only the PC opens", () => {
    for (const b of [
      button("\x1b", true, "keys"),
      button("/resume"),
      button("/memory"),
    ])
      expect(phonePromptButton(b).kind).toBe("refuse");
  });
});
