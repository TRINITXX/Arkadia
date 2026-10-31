import { describe, expect, it } from "vitest";
import {
  answerOf,
  answersOf,
  stepAfterPick,
  stepBy,
  type Question,
} from "@/lib/chat/chatQuestions";

const q = (question: string): Question => ({
  question,
  options: [{ label: "A" }, { label: "B" }],
});

describe("the question tabs", () => {
  // Two questions: steps 0 and 1, then « Envoyer » at 2.
  it("goes on after a single pick, the last one to « Envoyer », and stays on a multiple choice", () => {
    expect(stepAfterPick(0, 2, false)).toBe(1);
    expect(stepAfterPick(1, 2, undefined)).toBe(2);
    expect(stepAfterPick(0, 2, true)).toBe(0);
  });

  it("moves with the arrows without leaving the steps", () => {
    expect(stepBy(0, -1, 2)).toBe(0);
    expect(stepBy(1, 1, 2)).toBe(2);
    expect(stepBy(2, 1, 2)).toBe(2);
    expect(stepBy(2, -1, 2)).toBe(1);
  });

  it("sends every answer, own words first, only once all are given", () => {
    const questions = [q("Format ?"), q("Où ?")];
    expect(answersOf(questions, [answerOf(["A"], ""), ""])).toBeNull();
    expect(
      answersOf(questions, [answerOf(["A"], ""), answerOf(["B"], " Ici ")]),
    ).toEqual({ "Format ?": "A", "Où ?": "Ici" });
  });
});
