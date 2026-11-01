import { describe, expect, it } from "vitest";
import {
  activityCounts,
  foldActivity,
  groupChatItems,
  messagesOnly,
  questionAnswers,
  toolLabel,
  workSummary,
  type ToolItem,
} from "@/lib/chat/chatGroups";
import type { ChatItem } from "@/lib/chat/chatState";

const tool = (
  name: string,
  input: Record<string, unknown> = {},
  id = name,
): ToolItem => ({
  kind: "tool",
  id,
  name,
  input,
});
const text = (t: string, id = t): ChatItem => ({
  kind: "text",
  id,
  text: t,
  streaming: false,
});

describe("groupChatItems", () => {
  it("folds a run of tool calls into one line and gives file changes a card", () => {
    const units = groupChatItems([
      text("Je regarde."),
      tool("Bash", { command: "ls" }, "b1"),
      { kind: "thinking", id: "th", text: "", streaming: false },
      tool("Read", { file_path: "C:/a.ts" }, "r1"),
      tool("Bash", { command: "git status" }, "b2"),
      tool("Edit", { file_path: "C:/a.ts" }, "e1"),
      tool("Grep", { pattern: "x" }, "g1"),
    ]);
    expect(units.map((u) => u.kind)).toEqual(["text", "work", "edit", "work"]);
    const work = units[1];
    expect(work.kind === "work" && workSummary(work.tools)).toBe(
      "2 commandes, 1 fichier lu",
    );
  });

  it("keeps the task list and the plan file out of the column", () => {
    const units = groupChatItems([
      tool("TaskCreate", { subject: "x" }),
      tool("Write", {
        file_path: "C:/Users/a/.claude/plans/p.md",
        content: "# Plan",
      }),
      tool("ExitPlanMode"),
      tool("AskUserQuestion"),
      tool("Agent", { description: "d" }),
    ]);
    expect(units.map((u) => u.kind)).toEqual(["plan", "question", "agent"]);
  });
});

describe("messagesOnly", () => {
  it("keeps the user, Claude's replies and the errors, nothing else", () => {
    const units = messagesOnly(
      groupChatItems([
        { kind: "user", id: "u", text: "Corrige le test", images: 0 },
        { kind: "thinking", id: "th", text: "Je cherche", streaming: false },
        tool("Bash", { command: "ls" }, "b1"),
        tool("Edit", { file_path: "C:/a.ts" }, "e1"),
        tool("Agent", { description: "d" }, "a1"),
        tool("AskUserQuestion", {}, "q1"),
        tool("ExitPlanMode", {}, "p1"),
        { kind: "notice", id: "n1", text: "Compacté", tone: "info" },
        { kind: "notice", id: "n2", text: "Erreur API", tone: "error" },
        text("C'est corrigé."),
        // « Terminé en » hides with the tools.
        { kind: "turn", id: "t1", durationMs: 900_000, tools: 3, files: 1 },
      ]),
    );
    expect(units.map((u) => ("item" in u ? u.item.id : u.id))).toEqual([
      "u",
      "n2",
      "C'est corrigé.",
    ]);
  });

  it("keeps what answers the user: their commands and the plan they must approve", () => {
    const units = messagesOnly(
      groupChatItems([
        { kind: "command", id: "c1", name: "context", args: "", absorbed: [] },
        {
          kind: "notice",
          id: "c2",
          text: "/doctor n'existe que dans le terminal",
          tone: "info",
          command: true,
        },
        tool("ExitPlanMode", {}, "old"),
        tool("ExitPlanMode", {}, "p1"),
      ]),
      new Set(["p1"]),
    );
    expect(units.map((u) => ("item" in u ? u.item.id : u.id))).toEqual([
      "c1",
      "c2",
      "p1",
    ]);
  });
});

describe("tool wording", () => {
  it("names MCP tools by their own name", () => {
    expect(toolLabel("mcp__playwright__browser_click")).toBe(
      "browser_click (playwright)",
    );
    expect(toolLabel("Bash")).toBe("Bash");
  });

  it("reads the answers back from AskUserQuestion's result", () => {
    const asked = {
      ...tool("AskUserQuestion"),
      result: {
        text: 'Your questions have been answered: "Couleur ?"="Bleu". You can now continue.',
        isError: false,
      },
    };
    expect(questionAnswers(asked)).toEqual([["Couleur ?", "Bleu"]]);
  });
});

describe("foldActivity", () => {
  it("folds Claude's work between two messages into one line, its thinking whole above", () => {
    const thinking = (id: string, t: string): ChatItem => ({
      kind: "thinking",
      id,
      text: t,
      streaming: false,
    });
    const units = foldActivity(
      groupChatItems([
        text("Je regarde."),
        tool("Bash", { command: "ls" }, "b1"),
        thinking("th1", "Hmm"),
        tool("Edit", { file_path: "C:\\a.ts" }, "e1"),
        tool("Read", { file_path: "C:/b.ts" }, "r1"),
        thinking("th2", "Puis"),
        tool("Edit", { file_path: "C:/A.ts" }, "e2"),
        tool("Agent", { description: "d" }, "a1"),
        tool("Bash", { command: "git status" }, "b2"),
        text("Fini."),
      ]),
    );
    expect(units.map((u) => u.kind)).toEqual([
      "text",
      "thoughts",
      "activity",
      "text",
    ]);
    const [, thoughts, line] = units;
    if (thoughts.kind !== "thoughts" || line.kind !== "activity")
      throw new Error("no thoughts or activity line");
    // All the thinking between the two messages, gathered: the work stays one line.
    expect(thoughts.items.map((i) => i.text)).toEqual(["Hmm", "Puis"]);
    expect(line.id).toBe("activity:b1");
    // Always the same order; one file changed twice counts once.
    expect(activityCounts(line.units).map((c) => c.label)).toEqual([
      "2 commandes",
      "1 fichier lu",
      "1 fichier modifié",
      "1 sous-agent",
    ]);
  });
});
