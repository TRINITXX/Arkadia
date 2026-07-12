import { describe, expect, it } from "vitest";
import type { Project } from "@/types";
import { applyActiveReorder, sortActiveProjects } from "./activeOrder";

function proj(id: string, name: string, activeOrder?: number): Project {
  return {
    id,
    name,
    path: `C:\\dev\\${name}`,
    color: "#a8a8a8",
    order: 0,
    workspaceId: null,
    activeOrder,
  };
}

describe("sortActiveProjects", () => {
  it("sorts by manual position, unordered projects after, by name", () => {
    const sorted = sortActiveProjects([
      proj("a", "Zeta"), // never reordered
      proj("b", "Beta", 1),
      proj("c", "Alpha"), // never reordered
      proj("d", "Delta", 0),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("keeps a re-activated project at its persisted place", () => {
    // "b" was reordered to the front in a past session; today it becomes
    // active again amongst others — it must come back first.
    const sorted = sortActiveProjects([
      proj("a", "Alpha", 1),
      proj("b", "Beta", 0),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("puts a freshly activated project at the end", () => {
    const sorted = sortActiveProjects([
      proj("new", "Aaa-new"),
      proj("a", "Zeta", 0),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(["a", "new"]);
  });

  it("does not mutate its input", () => {
    const input = [proj("a", "B", 1), proj("b", "A", 0)];
    sortActiveProjects(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("applyActiveReorder", () => {
  it("renumbers listed projects by their new index", () => {
    const next = applyActiveReorder(
      [proj("a", "A", 0), proj("b", "B"), proj("c", "C", 5)],
      ["c", "a", "b"],
    );
    expect(next.find((p) => p.id === "c")?.activeOrder).toBe(0);
    expect(next.find((p) => p.id === "a")?.activeOrder).toBe(1);
    expect(next.find((p) => p.id === "b")?.activeOrder).toBe(2);
  });

  it("leaves projects outside the reorder untouched", () => {
    const inactive = proj("x", "X", 7);
    const next = applyActiveReorder([inactive, proj("a", "A")], ["a"]);
    expect(next.find((p) => p.id === "x")).toBe(inactive);
    expect(next.find((p) => p.id === "a")?.activeOrder).toBe(0);
  });

  it("round-trips with sortActiveProjects", () => {
    const projects = [proj("a", "A"), proj("b", "B"), proj("c", "C")];
    const next = applyActiveReorder(projects, ["b", "c", "a"]);
    expect(sortActiveProjects(next).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });
});
