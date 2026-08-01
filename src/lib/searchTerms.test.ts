import { describe, expect, it } from "vitest";
import {
  countTerms,
  matchesAllTerms,
  queryTerms,
  segmentByTerms,
} from "@/lib/searchTerms";

describe("queryTerms", () => {
  it("lowercases, splits and deduplicates", () => {
    expect(queryTerms("  Worktree   WORKTREE  merge ")).toEqual([
      "worktree",
      "merge",
    ]);
  });

  it("refuses a query too short to be worth scanning", () => {
    expect(queryTerms("a")).toEqual([]);
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("segmentByTerms", () => {
  it("marks each term occurrence and leaves the rest alone", () => {
    const segs = segmentByTerms("Les identifiants supabase", [
      "identifiant",
      "supabase",
    ]);
    expect(segs).toEqual([
      { text: "Les ", term: null },
      { text: "identifiant", term: "identifiant" },
      { text: "s ", term: null },
      { text: "supabase", term: "supabase" },
    ]);
  });

  it("matches inside a longer word, like the backend counts it", () => {
    expect(countTerms("identifiants et identifiant", ["identifiant"])).toBe(2);
  });

  it("keeps the original casing of the matched text", () => {
    const segs = segmentByTerms("le WORKTREE casse", ["worktree"]);
    expect(segs[1]).toEqual({ text: "WORKTREE", term: "worktree" });
  });

  it("prefers the longest term so overlaps never nest", () => {
    const segs = segmentByTerms("un mot de passe", ["passe", "mot de passe"]);
    expect(segs).toEqual([
      { text: "un ", term: null },
      { text: "mot de passe", term: "mot de passe" },
    ]);
  });

  it("returns the text untouched when there is nothing to search", () => {
    expect(segmentByTerms("rien", [])).toEqual([{ text: "rien", term: null }]);
  });
});

describe("matchesAllTerms", () => {
  it("requires every term in the same text", () => {
    expect(
      matchesAllTerms("identifiants supabase", ["identifiant", "supabase"]),
    ).toBe(true);
    expect(
      matchesAllTerms("juste les identifiants", ["identifiant", "supabase"]),
    ).toBe(false);
  });

  it("never matches without terms", () => {
    expect(matchesAllTerms("quoi que ce soit", [])).toBe(false);
  });
});
