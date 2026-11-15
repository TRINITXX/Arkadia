import { describe, expect, it } from "vitest";
import {
  answerOf,
  answersOf,
  recoOf,
  stepBy,
  type Question,
} from "@/lib/chat/chatQuestions";

const q = (question: string): Question => ({
  question,
  options: [{ label: "A" }, { label: "B" }],
});

describe("Claude's questions", () => {
  // Two questions: steps 0 and 1, no « Envoyer » step after them.
  it("moves with the arrows without leaving the questions", () => {
    expect(stepBy(0, -1, 2)).toBe(0);
    expect(stepBy(0, 1, 2)).toBe(1);
    expect(stepBy(1, 1, 2)).toBe(1);
    expect(stepBy(1, -1, 2)).toBe(0);
  });

  it("sends every answer, own words first, only once all are given", () => {
    const questions = [q("Format ?"), q("Où ?")];
    expect(answersOf(questions, [answerOf(["A"], ""), ""])).toBeNull();
    expect(
      answersOf(questions, [answerOf(["A"], ""), answerOf(["B"], " Ici ")]),
    ).toEqual({ "Format ?": "A", "Où ?": "Ici" });
  });

  it("reads Claude's « (recommandé) » as the Reco badge, the label alone shown", () => {
    expect(recoOf("Pop-up pour les questions (recommandé)")).toEqual({
      text: "Pop-up pour les questions",
      reco: true,
    });
    expect(recoOf("Garder (Recommended)")).toEqual({
      text: "Garder",
      reco: true,
    });
    expect(recoOf("Garder le son seul")).toEqual({
      text: "Garder le son seul",
      reco: false,
    });
    // A tag alone stays a label: nothing would be left to show.
    expect(recoOf("(recommandé)")).toEqual({
      text: "(recommandé)",
      reco: false,
    });
  });
});
