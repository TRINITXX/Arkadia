import { describe, expect, it } from "vitest";
import { describeWindow, worthAsking, type SearchPlan } from "@/lib/aiSearch";

const plan = (over: Partial<SearchPlan> = {}): SearchPlan => ({
  terms: [],
  after: null,
  before: null,
  ...over,
});

describe("worthAsking", () => {
  it("takes a sentence but leaves keyword searches alone", () => {
    expect(worthAsking("les identifiants créés hier soir")).toBe(true);
    expect(worthAsking("mot de passe")).toBe(true);
    expect(worthAsking("overlay sessions")).toBe(false);
    expect(worthAsking("worktree")).toBe(false);
    expect(worthAsking("   ")).toBe(false);
  });
});

describe("describeWindow", () => {
  it("reads a two-sided window", () => {
    const d = describeWindow(
      plan({
        after: new Date(2026, 6, 30, 18, 0).toISOString(),
        before: new Date(2026, 6, 31, 6, 0).toISOString(),
      }),
    );
    expect(d).toBe("30/07 18h00 → 31/07 06h00");
  });

  it("reads a one-sided window", () => {
    expect(
      describeWindow(plan({ after: new Date(2026, 6, 20).toISOString() })),
    ).toBe("après 20/07 00h00");
  });

  it("says nothing when the sentence carried no time at all", () => {
    expect(describeWindow(plan())).toBeNull();
  });
});
