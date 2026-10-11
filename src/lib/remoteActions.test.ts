import { describe, expect, it } from "vitest";
import type { ToolbarButton } from "@/types";
import { actionButton } from "./remoteActions";

const tree: ToolbarButton[] = [
  {
    id: "git",
    kind: "folder",
    label: "Git",
    icon: "",
    order: 0,
    children: [
      {
        id: "push",
        kind: "action",
        label: "Push",
        icon: "",
        command: "git push",
        order: 0,
      },
    ],
  },
];

describe("actionButton", () => {
  it("finds a button inside a folder, never the folder itself", () => {
    expect(actionButton(tree, "push")?.command).toBe("git push");
    expect(actionButton(tree, "git")).toBeNull();
    expect(actionButton(tree, "gone")).toBeNull();
  });
});
