import { describe, expect, it } from "vitest";
import type { PaneState } from "@/types";
import { paneTabTitle } from "./paneTitle";

function pane(extra: Partial<PaneState>): PaneState {
  return {
    id: "p",
    title: "C:\\WINDOWS\\system32\\cmd.exe",
    cwd: null,
    ...extra,
  };
}

describe("paneTabTitle", () => {
  it("shows the terminal's title when the pane has no label", () => {
    expect(paneTabTitle(pane({}))).toBe("C:\\WINDOWS\\system32\\cmd.exe");
    expect(paneTabTitle(undefined)).toBe("");
  });

  it("shows the opener's label instead of the terminal's title", () => {
    expect(paneTabTitle(pane({ label: "Serveur dev" }))).toBe("Serveur dev");
  });

  it("keeps Claude's status glyph in front of the label", () => {
    const working = pane({ title: "⠂ Review the diff", label: "Revue" });
    expect(paneTabTitle(working)).toBe("⠂ Revue");
    const waiting = pane({ title: "✳ Review the diff", label: "Revue" });
    expect(paneTabTitle(waiting)).toBe("✳ Revue");
  });

  it("shows a chat's own title, whatever label the pane was opened with", () => {
    const chat = pane({
      title: "Bilan du ménage",
      label: "Serveur dev",
      chat: { cwd: "C:\\p" },
    });
    expect(paneTabTitle(chat)).toBe("Bilan du ménage");
  });
});
