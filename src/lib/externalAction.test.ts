import { describe, it, expect } from "vitest";
import {
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
