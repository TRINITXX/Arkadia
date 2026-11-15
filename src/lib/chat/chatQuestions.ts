import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * Claude's AskUserQuestion, one question at a time. On the PC, in the look of
 * the questions sheet (the user's pick of 15/11/2026): a segment per
 * question, the answers sent from the field's button once all have one. On
 * the iPhone, as the terminal asks them (`← ☐ Format ☐ Où ✔ Submit →`): a
 * step per question, then a last one, « Envoyer », that sends them all,
 * steps numbered 0 to `questions.length`. A single question has no tabs and
 * no such step.
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

/**
 * Arrows and tab clicks: never before the first step nor past `last` (the
 * iPhone's « Envoyer » step, `questions.length`; the PC's last question).
 */
export function stepBy(step: number, delta: number, last: number): number {
  return Math.max(0, Math.min(last, step + delta));
}

/**
 * Where a pick leads on the iPhone: a single choice goes on to the next
 * question (the last one to « Envoyer »), a multiple choice stays for more.
 */
export function stepAfterPick(
  step: number,
  count: number,
  multiSelect: boolean | undefined,
): number {
  return multiSelect ? step : stepBy(step, 1, count);
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
