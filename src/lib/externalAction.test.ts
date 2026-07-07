import { describe, it, expect } from "vitest";
import {
  dedupeProjectsByPath,
  findProjectByPath,
  findProjectsByPath,
  parentOf,
} from "./externalAction";
import type { Project } from "../types";

const p = (
  id: string,
  name: string,
  path: string,
  extra: Partial<Project> = {},
): Project => ({
  id,
  name,
  path,
  color: "#fff",
  order: 0,
  ...extra,
});

describe("findProjectByPath", () => {
  const projects = [
    p("a", "Main", "C:\\Users\\T\\VTC-Planner\\VTC-Planner-Mobile"),
  ];
  it("matches ignoring case and separators", () => {
    expect(
      findProjectByPath(projects, "c:/users/t/vtc-planner/vtc-planner-mobile")
        ?.id,
    ).toBe("a");
  });
  it("returns undefined when absent", () => {
    expect(findProjectByPath(projects, "C:\\other")).toBeUndefined();
  });
});

describe("findProjectsByPath", () => {
  const dup = [
    p("a", "side", "C:\\VTC\\vtc-mobile-side"),
    p("b", "side", "C:\\VTC\\vtc-mobile-side"),
    p("c", "other", "C:\\VTC\\vtc-mobile-prod"),
  ];
  it("returns every project sharing the path", () => {
    expect(
      findProjectsByPath(dup, "c:/vtc/vtc-mobile-side").map((p) => p.id),
    ).toEqual(["a", "b"]);
  });
  it("returns an empty array when none match", () => {
    expect(findProjectsByPath(dup, "C:\\VTC\\nope")).toEqual([]);
  });
});

describe("dedupeProjectsByPath", () => {
  it("collapses same-path duplicates down to the first (repeated /w regression)", () => {
    // The exact shape found in a corrupted store: three identical worktree
    // paths, distinct ids — deleting one left the twins, so it 'came back'.
    const dup = [
      p("keep", "vtc-mobile-side", "C:\\VTC\\vtc-mobile-side", { order: 11 }),
      p("dup1", "vtc-mobile-side", "C:\\VTC\\vtc-mobile-side", { order: 12 }),
      p("dup2", "vtc-mobile-side", "C:\\VTC\\vtc-mobile-side", { order: 13 }),
      p("other", "prod", "C:\\VTC\\vtc-mobile-prod", { order: 14 }),
    ];
    expect(dedupeProjectsByPath(dup).map((x) => x.id)).toEqual([
      "keep",
      "other",
    ]);
  });

  it("dedupes case/separator-insensitively", () => {
    const dup = [p("a", "x", "C:\\VTC\\Side"), p("b", "x", "c:/vtc/side/")];
    expect(dedupeProjectsByPath(dup).map((x) => x.id)).toEqual(["a"]);
  });

  it("keeps distinct paths untouched", () => {
    const projects = [p("a", "x", "C:\\VTC\\a"), p("b", "y", "C:\\VTC\\b")];
    expect(dedupeProjectsByPath(projects).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("never collapses empty-path projects", () => {
    const projects = [p("a", "x", ""), p("b", "y", "")];
    expect(dedupeProjectsByPath(projects).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("parentOf", () => {
  const main = p("m", "vtc-mobile-prod", "C:\\VTC\\vtc-mobile-prod", {
    color: "#ee9b00",
    workspaceId: "ws-1",
  });
  const projects = [main];
  it("finds the sibling repo sharing the parent dir", () => {
    const parent = parentOf(projects, "C:\\VTC\\vtc-mobile-side");
    expect(parent?.id).toBe("m");
  });
  it("returns undefined with no sibling", () => {
    expect(parentOf([], "C:\\VTC\\vtc-mobile-side")).toBeUndefined();
  });
});
