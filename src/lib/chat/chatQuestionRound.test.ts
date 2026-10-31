import { describe, expect, it } from "vitest";
import {
  lastReplyRound,
  parseQuestionRound,
  roundReply,
} from "@/lib/chat/chatQuestionRound";
import type { ChatItem } from "@/lib/chat/chatState";

const GRILL = [
  "Deux décisions avant de coder.",
  "",
  "❓ **Q1** - **Où ranger le brouillon** : dans le store ou dans le navigateur ?",
  "",
  "a) Le store de l'app",
  "b) Le stockage du navigateur",
  "",
  "➡️ b) Le stockage du navigateur : synchrone au démarrage.",
  "",
  "---",
  "",
  "❓ **Q2** - **Combien d'images** : on garde toutes les images collées ?",
  "",
  "➡️ Quatre au plus par volet.",
].join("\n");

const SERIES = [
  "Question 2 sur 3.",
  "",
  "Le champ prix refuse la virgule.",
  "",
  "On accepte la virgule partout ?",
  "",
  "  a) Oui, partout",
  "  b) Seulement dans le prix",
  "",
  "Je pencherais pour (a) : c'est ce qu'on tape en France.",
].join("\n");

describe("question rounds in Claude's reply", () => {
  it("reads the grilling format: titles, options, recommendations", () => {
    const [q1, q2] = parseQuestionRound(GRILL);
    expect(q1).toMatchObject({
      id: "Q1",
      title: "Où ranger le brouillon",
      recommendedKey: "b",
      options: [
        { key: "a", label: "Le store de l'app" },
        { key: "b", label: "Le stockage du navigateur" },
      ],
    });
    expect(q1.body).toContain("dans le store ou dans le navigateur ?");
    expect(q2).toMatchObject({
      id: "Q2",
      options: [],
      recommendation: "Quatre au plus par volet.",
      recommendedKey: null,
    });
  });

  it("reads « Question n sur N » with its options and leaning", () => {
    expect(parseQuestionRound(SERIES)).toEqual([
      {
        id: "Q2",
        title: "On accepte la virgule partout ?",
        body: "Le champ prix refuse la virgule.",
        options: [
          { key: "a", label: "Oui, partout" },
          { key: "b", label: "Seulement dans le prix" },
        ],
        recommendation: "a) c'est ce qu'on tape en France.",
        recommendedKey: "a",
      },
    ]);
    expect(parseQuestionRound("Corrigé : le test passe.")).toEqual([]);
  });

  it("offers the sheet for the last finished reply only", () => {
    const text = (id: string, t: string, streaming = false): ChatItem => ({
      kind: "text",
      id,
      text: t,
      streaming,
    });
    const user: ChatItem = { kind: "user", id: "u", text: "ok", images: 0 };
    expect(lastReplyRound([text("a", GRILL)])?.id).toBe("a");
    expect(lastReplyRound([text("a", GRILL, true)])).toBeNull();
    expect(lastReplyRound([text("a", GRILL), user])).toBeNull();
  });

  it("answers one line per question answered", () => {
    const questions = parseQuestionRound(GRILL);
    expect(
      roundReply(questions, {
        Q1: { option: "a", text: "plus sûr" },
        Q2: { reco: true },
      }),
    ).toBe("Q1 : a) Le store de l'app, plus sûr\nQ2 : OK pour ta reco");
    expect(roundReply(questions, { Q2: { text: "  " } })).toBe("");
  });
});
