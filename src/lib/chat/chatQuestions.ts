import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * Claude's AskUserQuestion, one question at a time as the terminal asks them
 * (`← ☐ Format ☐ Où ✔ Submit →`): a step per question, then a last step that
 * sends every answer. Steps are numbered 0 to `questions.length`, the last one
 * being « Envoyer ». A single question has no tabs and no such step.
 */

export interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export function questionsOf(input: JsonObject): Question[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (q): q is Question =>
      !!q && typeof q.question === "string" && Array.isArray(q.options),
  );
}

/** Its own words win over the options picked. */
export function answerOf(picked: string[], other: string): string {
  return other.trim() || picked.join(", ");
}

/** Arrows and tab clicks: never before the first question nor past « Envoyer ». */
export function stepBy(step: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count, step + delta));
}

/**
 * Where a pick leads: a single choice goes on to the next question (the last
 * one to « Envoyer »), a multiple choice stays for more picks.
 */
export function stepAfterPick(
  step: number,
  count: number,
  multiSelect: boolean | undefined,
): number {
  return multiSelect ? step : stepBy(step, 1, count);
}

/** The tool's `answers` (question → answer), or null while one is missing. */
export function answersOf(
  questions: Question[],
  answers: string[],
): Record<string, string> | null {
  if (questions.some((_, i) => !answers[i])) return null;
  return Object.fromEntries(questions.map((q, i) => [q.question, answers[i]]));
}
