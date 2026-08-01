/**
 * The natural-language side of the sessions search: types for what the Rust
 * `ai_search` module returns, and the rule deciding when it is worth calling.
 *
 * The pipeline runs in three steps, and the UI shows each as it lands rather
 * than waiting for the last: constraints (~7 s), then candidates (local, under
 * a second), then the written answer (~12 s).
 */

import { invoke } from "@tauri-apps/api/core";

/** What the first call extracted from the sentence. */
export interface SearchPlan {
  /** Synonyms of one idea — they match as alternatives, not all at once. */
  terms: string[];
  after: string | null;
  before: string | null;
}

/** A candidate session, as the AI section lists it. */
export interface CandidateRow {
  id: string;
  title: string;
  cwd: string;
  mtime: number;
  count: number;
}

export interface CandidateList {
  rows: CandidateRow[];
  /** Everything that matched, before the cap — the UI states the perimeter
   *  from this, because the model proved unwilling to state it itself. */
  total: number;
}

/** The reader's verdict. */
export interface SearchAnswer {
  answer: string;
  cited: string[];
  read: number;
  total: number;
}

/**
 * Words below which a query is a keyword search, not a sentence. Three is the
 * agreed threshold: "mot de passe" earns a call, "worktree" does not.
 */
const MIN_WORDS = 3;

/** True when the query reads as a sentence worth handing to the model. */
export function worthAsking(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length >= MIN_WORDS;
}

export function planSearch(query: string): Promise<SearchPlan> {
  return invoke<SearchPlan>("ai_search_plan", { query });
}

export function fetchCandidates(plan: SearchPlan): Promise<CandidateList> {
  return invoke<CandidateList>("ai_search_candidates", { plan });
}

export function readAnswer(
  query: string,
  total: number,
): Promise<SearchAnswer> {
  return invoke<SearchAnswer>("ai_search_answer", { query, total });
}

export function forgetCandidates(): Promise<void> {
  return invoke("ai_search_forget");
}

/** A human reading of the window the model derived, for the chip row. */
export function describeWindow(plan: SearchPlan): string | null {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const day = `${d.getDate()}`.padStart(2, "0");
    const month = `${d.getMonth() + 1}`.padStart(2, "0");
    const hh = `${d.getHours()}`.padStart(2, "0");
    const mm = `${d.getMinutes()}`.padStart(2, "0");
    return `${day}/${month} ${hh}h${mm}`;
  };
  if (plan.after && plan.before)
    return `${fmt(plan.after)} → ${fmt(plan.before)}`;
  if (plan.after) return `après ${fmt(plan.after)}`;
  if (plan.before) return `avant ${fmt(plan.before)}`;
  return null;
}
