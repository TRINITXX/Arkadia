import { describe, it, expect } from "vitest";
import {
  baseName,
  filterByMeta,
  formatWhen,
  groupByProject,
  groupByRecency,
  mergeSearchResults,
  resolveProjectTarget,
  type ClaudeSession,
} from "./sessionsIndex";
import type { Project } from "../types";

const s = (
  id: string,
  title: string,
  cwd: string,
  mtime: number,
  extra: Partial<ClaudeSession> = {},
): ClaudeSession => ({
  id,
  path: `C:\\Users\\T\\.claude\\projects\\enc\\${id}.jsonl`,
  cwd,
  title,
  from_prompt: false,
  mtime,
  ...extra,
});

const p = (id: string, name: string, path: string): Project => ({
  id,
  name,
  path,
  color: "#fff",
  order: 0,
});

// 2026-07-28 14:30 local — every relative date below is anchored on it.
const NOW = new Date(2026, 6, 28, 14, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("filterByMeta", () => {
  const sessions = [
    s("a", "fix sidebar worktree flow", "C:\\Users\\T\\Desktop\\Arkadia", NOW),
    s("b", "Audit complet par Codex", "C:\\Users\\T\\Desktop\\FidelyPass", NOW),
  ];

  it("returns everything for an empty query", () => {
    expect(filterByMeta(sessions, "  ")).toHaveLength(2);
  });

  it("matches the title, ignoring case", () => {
    expect(filterByMeta(sessions, "WORKTREE").map((x) => x.id)).toEqual(["a"]);
  });

  it("matches the folder path", () => {
    expect(filterByMeta(sessions, "fidelypass").map((x) => x.id)).toEqual([
      "b",
    ]);
  });

  it("requires every term, across title and path", () => {
    expect(filterByMeta(sessions, "arkadia worktree").map((x) => x.id)).toEqual(
      ["a"],
    );
    expect(filterByMeta(sessions, "arkadia codex")).toHaveLength(0);
  });
});

describe("mergeSearchResults", () => {
  const all = [
    s("a", "fix sidebar worktree flow", "C:\\p\\Arkadia", NOW),
    s("b", "Audit Codex", "C:\\p\\FidelyPass", NOW - DAY),
    s("c", "Migration Supabase", "C:\\p\\Kalor", NOW - 2 * DAY),
  ];

  it("keeps metadata matches first, then content-only ones with their excerpt", () => {
    const merged = mergeSearchResults(
      all,
      [all[0]],
      [
        { id: "a", excerpt: "…worktree…", count: 3 },
        { id: "c", excerpt: "…le worktree est nettoyé…", count: 7 },
      ],
    );
    expect(merged.map((x) => x.id)).toEqual(["a", "c"]);
    // The title match keeps no excerpt (it is already visible in the title).
    expect(merged[0].excerpt).toBeUndefined();
    expect(merged[1].excerpt).toBe("…le worktree est nettoyé…");
  });

  it("gives a title match its badge when the content scan found occurrences too", () => {
    const merged = mergeSearchResults(
      all,
      [all[0]],
      [{ id: "a", excerpt: "…worktree…", count: 12 }],
    );
    expect(merged[0].count).toBe(12);
  });

  it("leaves the badge off a title match the content scan never saw", () => {
    const merged = mergeSearchResults(all, [all[1]], []);
    expect(merged[0].count).toBeUndefined();
  });

  it("preserves recency order among content matches", () => {
    const merged = mergeSearchResults(
      all,
      [],
      [
        { id: "c", excerpt: "x", count: 1 },
        { id: "b", excerpt: "y", count: 1 },
      ],
    );
    expect(merged.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("ignores hits for sessions absent from the listing", () => {
    const merged = mergeSearchResults(
      all,
      [],
      [{ id: "ghost", excerpt: "x", count: 4 }],
    );
    expect(merged).toHaveLength(0);
  });
});

describe("groupByRecency", () => {
  it("buckets by day boundary, not by elapsed hours", () => {
    // 00:30 today is 14 h ago, but it is still "Aujourd'hui".
    const early = new Date(2026, 6, 28, 0, 30).getTime();
    const groups = groupByRecency([{ ...s("a", "t", "C:\\p", early) }], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Aujourd'hui"]);
  });

  it("splits into the expected buckets and drops empty ones", () => {
    const sessions = [
      s("today", "t", "C:\\p", NOW - 60_000),
      s("yesterday", "t", "C:\\p", NOW - DAY),
      s("week", "t", "C:\\p", NOW - 4 * DAY),
      s("old", "t", "C:\\p", NOW - 200 * DAY),
    ];
    const groups = groupByRecency(sessions, NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "Aujourd'hui",
      "Hier",
      "7 derniers jours",
      "Plus ancien",
    ]);
    expect(groups[2].sessions.map((x) => x.id)).toEqual(["week"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByRecency([], NOW)).toEqual([]);
  });
});

describe("formatWhen", () => {
  it("shows the time for today", () => {
    expect(formatWhen(new Date(2026, 6, 28, 9, 5).getTime(), NOW)).toBe(
      "09:05",
    );
  });

  it("shows day and month for an earlier date this year", () => {
    expect(formatWhen(new Date(2026, 6, 24, 9, 5).getTime(), NOW)).toBe(
      "24 juil.",
    );
  });

  it("adds the year for another year", () => {
    expect(formatWhen(new Date(2025, 11, 3, 9, 5).getTime(), NOW)).toBe(
      "3 déc. 2025",
    );
  });
});

describe("resolveProjectTarget", () => {
  const projects = [
    p("ark", "Arkadia", "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia"),
    p(
      "old",
      "Arkadia-old",
      "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia-old",
    ),
    p("desk", "Desktop", "C:\\Users\\T\\Desktop"),
  ];

  it("matches an identical path regardless of case and separators", () => {
    expect(
      resolveProjectTarget(
        projects,
        "c:/users/t/desktop/claude desktop/arkadia",
      ),
    ).toEqual({ kind: "existing", projectId: "ark" });
  });

  it("adopts a subfolder into the longest matching parent", () => {
    expect(
      resolveProjectTarget(
        projects,
        "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia\\src-tauri",
      ),
    ).toEqual({ kind: "existing", projectId: "ark" });
  });

  it("never treats a same-prefix sibling as a parent", () => {
    // …\Arkadia must not adopt …\Arkadia-old (which has its own project).
    expect(
      resolveProjectTarget(
        projects,
        "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia-old",
      ),
    ).toEqual({ kind: "existing", projectId: "old" });
  });

  it("creates a project named after the folder when nothing matches", () => {
    expect(resolveProjectTarget([], "C:\\Users\\T\\Desktop\\Qwitt")).toEqual({
      kind: "create",
      name: "Qwitt",
      path: "C:\\Users\\T\\Desktop\\Qwitt",
    });
  });

  it("ignores projects with an empty path", () => {
    expect(resolveProjectTarget([p("x", "Vide", "")], "C:\\a\\b")).toEqual({
      kind: "create",
      name: "b",
      path: "C:\\a\\b",
    });
  });
});

describe("groupByProject", () => {
  const ark: Project = {
    ...p("ark", "Arkadia", "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia"),
    color: "#38bdf8",
  };
  const vtc = p("vtc", "VTC-Planner", "C:\\Users\\T\\Desktop\\VTC-Planner");
  const projects = [ark, vtc];

  it("pulls subfolders and worktrees under their parent project", () => {
    const groups = groupByProject(
      [
        s("a", "root", "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia", NOW),
        s(
          "b",
          "rust side",
          "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia\\src-tauri",
          NOW - 1000,
        ),
        s(
          "c",
          "worktree",
          "C:\\Users\\T\\Desktop\\VTC-Planner\\.claude-worktrees\\dynamic-riding-marble",
          NOW - 2000,
        ),
      ],
      projects,
    );
    expect(groups.map((g) => [g.key, g.sessions.map((x) => x.id)])).toEqual([
      ["ark", ["a", "b"]],
      ["vtc", ["c"]],
    ]);
  });

  it("takes the name and colour from the sidepanel project", () => {
    const [group] = groupByProject(
      [s("a", "t", "C:\\Users\\T\\Desktop\\Claude Desktop\\Arkadia", NOW)],
      projects,
    );
    expect(group.name).toBe("Arkadia");
    expect(group.color).toBe("#38bdf8");
    expect(group.path).toBe(ark.path);
  });

  it("gives a folder with no project its own colourless section", () => {
    const [group] = groupByProject(
      [s("a", "t", "C:\\Users\\T\\Desktop\\Qwitt", NOW)],
      projects,
    );
    expect(group.name).toBe("Qwitt");
    expect(group.color).toBeNull();
    expect(group.path).toBe("C:\\Users\\T\\Desktop\\Qwitt");
  });

  it("folds one folder's sessions together whatever the path's casing", () => {
    const groups = groupByProject(
      [
        s("a", "t", "C:\\Users\\T\\Desktop\\Qwitt", NOW),
        s("b", "t", "c:\\users\\t\\desktop\\qwitt", NOW - 1000),
        s("c", "t", "C:\\Users\\T\\Desktop\\Autre", NOW - 2000),
      ],
      projects,
    );
    expect(groups.map((g) => g.sessions.length)).toEqual([2, 1]);
  });

  it("orders sections, and sessions inside them, newest first", () => {
    // Input order deliberately scrambled: the search merge floats title
    // matches above older content matches, and grouping must not inherit that.
    const groups = groupByProject(
      [
        s("old-ark", "t", ark.path, NOW - 5 * DAY),
        s("fresh-vtc", "t", vtc.path, NOW),
        s("fresh-ark", "t", ark.path, NOW - 1000),
      ],
      projects,
    );
    expect(groups.map((g) => g.key)).toEqual(["vtc", "ark"]);
    expect(groups[1].sessions.map((x) => x.id)).toEqual([
      "fresh-ark",
      "old-ark",
    ]);
    expect(groups[1].mtime).toBe(NOW - 1000);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByProject([], projects)).toEqual([]);
  });
});

describe("baseName", () => {
  it("keeps the original casing of the folder", () => {
    expect(baseName("C:\\Users\\T\\Desktop\\VTC-Planner")).toBe("VTC-Planner");
  });

  it("tolerates a trailing separator", () => {
    expect(baseName("C:\\Users\\T\\Desktop\\Qwitt\\")).toBe("Qwitt");
  });
});
