import { describe, expect, it } from "vitest";
import { commandSections } from "@/lib/chat/promptButtonsContext";
import type { ActionButton, FolderButton } from "@/types";

const action = (
  label: string,
  order: number,
  more: Partial<ActionButton> = {},
): ActionButton => ({
  id: label,
  kind: "action",
  label,
  icon: "",
  command: `/${label}`,
  order,
  ...more,
});

const folder = (
  label: string,
  order: number,
  children: FolderButton["children"],
): FolderButton => ({
  id: label,
  kind: "folder",
  label,
  icon: "",
  order,
  children,
});

describe("the « Commandes » menu", () => {
  it("lists the root's buttons, then a section per folder, in their order", () => {
    const sections = commandSections([
      folder("Git", 2, [
        action("push", 1),
        folder("Plus", 0, [action("rebase", 0)]),
      ]),
      action("compact", 1),
      action("clear", 0),
      folder("Vide", 3, [action("raccourci", 0, { mode: "keys", keys: [27] })]),
      action("rien", 4, { command: " " }),
    ]);
    expect(
      sections.map((s) => [s.title, s.buttons.map((b) => b.label)]),
    ).toEqual([
      [null, ["clear", "compact"]],
      // A nested folder's buttons flattened in its place.
      ["Git", ["rebase", "push"]],
      // A keyboard shortcut means nothing to a chat: its folder goes empty, then away.
    ]);
  });
});
