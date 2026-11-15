import { describe, expect, it } from "vitest";
import {
  answerOf,
  answersOf,
  recoOf,
  stepAfterPick,
  stepBy,
  type Question,
} from "@/lib/chat/chatQuestions";

const q = (question: string): Question => ({
  question,
  options: [{ label: "A" }, { label: "B" }],
});

describe("Claude's questions", () => {
  // The iPhone's tabs, two questions: steps 0 and 1, then « Envoyer » at 2.
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
    // The PC's two questions, no « Envoyer » step: the last one is 1.
    expect(stepBy(1, 1, 1)).toBe(1);
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
