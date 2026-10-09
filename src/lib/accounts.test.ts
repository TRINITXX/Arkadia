import { describe, it, expect } from "vitest";
import {
  claudePanesToSwitch,
  formatPct,
  tabAccountMarks,
  type Account,
  type AccountsState,
} from "@/lib/accounts";
import type { Tab } from "@/types";

function account(id: string, color: string, label: string): Account {
  return {
    id,
    label,
    customLabel: false,
    color,
    email: null,
    plan: null,
    loggedIn: true,
    usage: null,
    stale: true,
  };
}

function tab(id: string, accountId?: string): Tab {
  return {
    id,
    projectId: "p",
    tree: { kind: "leaf", paneId: `${id}-pane` },
    activePaneId: `${id}-pane`,
    panes: {
      [`${id}-pane`]: { id: `${id}-pane`, title: "", cwd: null, accountId },
    },
  };
}

describe("tabAccountMarks", () => {
  const two: AccountsState = {
    current: "main",
    max: 5,
    accounts: [
      account("main", "#a78bfa", "Max 5x"),
      account("b2", "#f472b6", "Team"),
    ],
  };

  it("marks nothing while there is a single account", () => {
    const one = { ...two, accounts: [two.accounts[0]] };
    expect(tabAccountMarks([tab("t1")], one)).toEqual({});
  });

  it("marks each tab with its pane's account, main when unset", () => {
    expect(tabAccountMarks([tab("t1"), tab("t2", "b2")], two)).toEqual({
      t1: { color: "#a78bfa", label: "Max 5x" },
      t2: { color: "#f472b6", label: "Team" },
    });
  });

  it("falls back to the main account for a removed account", () => {
    expect(tabAccountMarks([tab("t1", "gone")], two).t1?.label).toBe("Max 5x");
  });
});

describe("claudePanesToSwitch", () => {
  const split: Tab = {
    id: "t",
    projectId: "p",
    tree: {
      kind: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { kind: "leaf", paneId: "claude" },
      second: { kind: "leaf", paneId: "shell" },
    },
    activePaneId: "claude",
    panes: {
      claude: { id: "claude", title: "✳ Fix tests", cwd: null },
      shell: { id: "shell", title: "C:\repo", cwd: null },
    },
  };

  it("relaunches only the panes running Claude", () => {
    expect(claudePanesToSwitch(split, "b2")).toEqual(["claude"]);
  });

  it("skips panes already on the target account", () => {
    expect(claudePanesToSwitch(split, "main")).toEqual([]);
  });
});

describe("formatPct", () => {
  it("rounds and shows -- when unknown", () => {
    expect(formatPct({ pct: 61.6 })).toBe("62 %");
    expect(formatPct(null)).toBe("--");
  });
});
