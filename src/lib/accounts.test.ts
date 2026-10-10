import { describe, it, expect } from "vitest";
import {
  claudePanesToSwitch,
  formatCountdown,
  formatPct,
  planAutoSwitch,
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

describe("planAutoSwitch", () => {
  const NOW = 1_000_000_000_000;
  const withFive = (a: Account, pct: number, resetsAt?: number): Account => ({
    ...a,
    usage: { fiveHour: { pct, resetsAt }, updatedAt: NOW, source: "poll" },
  });
  const perso = withFive(account("main", "#a78bfa", "Perso"), 40);
  const team = withFive(account("b2", "#f472b6", "Team"), 10);
  const third = withFive(account("b3", "#22d3ee", "Trois"), 70);

  it("picks the most 5-hour headroom among unblocked accounts", () => {
    expect(
      planAutoSwitch([perso, team, third], { b2: NOW + 1000 }, NOW),
    ).toEqual({ kind: "switch", accountId: "main" });
  });

  it("skips an account whose usage reads full before its reset", () => {
    const full = withFive(team, 100, NOW / 1000 + 60);
    expect(planAutoSwitch([full, third], {}, NOW)).toEqual({
      kind: "switch",
      accountId: "b3",
    });
  });

  it("skips an account full for the week, whatever its 5-hour figure", () => {
    const weekFull: Account = {
      ...team,
      usage: {
        fiveHour: { pct: 10 },
        sevenDay: { pct: 100, resetsAt: NOW / 1000 + 3600 },
        updatedAt: NOW,
        source: "poll",
      },
    };
    expect(planAutoSwitch([weekFull, third], {}, NOW)).toEqual({
      kind: "switch",
      accountId: "b3",
    });
  });

  it("waits for the earliest reset when every account is blocked", () => {
    expect(
      planAutoSwitch([perso, team], { main: NOW + 5000, b2: NOW + 2000 }, NOW),
    ).toEqual({ kind: "wait", accountId: "b2", at: NOW + 2000 });
  });
});

describe("formatPct", () => {
  it("rounds and shows -- when unknown", () => {
    expect(formatPct({ pct: 61.6 })).toBe("62 %");
    expect(formatPct(null)).toBe("--");
  });
});

describe("formatCountdown", () => {
  it("shows h:mm left, rounded up, and nothing once past", () => {
    const now = 1_000_000_000_000;
    const at = (ms: number) => (now + ms) / 1000;
    expect(formatCountdown(at(90 * 60_000), now)).toBe("1:30");
    expect(formatCountdown(at(9 * 60_000 + 1), now)).toBe("0:10");
    expect(formatCountdown(at(-1000), now)).toBeNull();
    expect(formatCountdown(null, now)).toBeNull();
  });
});
