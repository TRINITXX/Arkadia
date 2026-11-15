import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * Claude's AskUserQuestion, one question at a time in the look of the
 * questions sheet, on the PC and the iPhone (the user's pick of 15/11/2026):
 * a segment per question, steps numbered 0 to `questions.length - 1`, the
 * answers sent from the field's button once every question has one.
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

/** The PC's arrows: never before the first question nor past the last one. */
export function stepBy(step: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, step + delta));
}

const RECO_TAG = /\s*\((?:recommandée?|conseillée?|recommended)\)\s*$/i;

/**
 * The label shown and whether Claude recommends it: the « (recommandé) » it
 * writes at the end becomes the sheet's « Reco » badge. Display only: the
 * answer sent keeps the label whole, as the tool expects it.
 */
export function recoOf(label: string): { text: string; reco: boolean } {
  const text = label.replace(RECO_TAG, "");
  return text === label || !text
    ? { text: label, reco: false }
    : { text, reco: true };
}

/** The tool's `answers` (question → answer), or null while one is missing. */
export function answersOf(
  questions: Question[],
  answers: string[],
): Record<string, string> | null {
  if (questions.some((_, i) => !answers[i])) return null;
  return Object.fromEntries(questions.map((q, i) => [q.question, answers[i]]));
}
