import { describe, expect, it } from "vitest";
import {
  buttonLeadsTo,
  enterLeadsTo,
  lastReplyRound,
  parseQuestionRound,
  recoReason,
  roundReply,
  withoutQuestions,
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
        numbered: true,
        key: "#1",
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

  it("reads options written on the question's line, its reco there too", () => {
    // As Claude wrote them in the Lab (31/10/2026).
    const oneLine = [
      "❓ **Q1** - **Couleur du bouton** : quelle couleur ? a) Violet b) Vert c) Gris",
      "",
      "➡️ a) Violet : il reprend la couleur des cartes.",
      "",
      "❓ **Q2** - **Taille du texte** : quelle taille ? a) Petite b) Moyenne c) Grande ➡️ c) Grande : le titre ressort mieux.",
      "",
      "Je code dès tes réponses.",
    ].join("\n");
    const [q1, q2] = parseQuestionRound(oneLine);
    expect(q1).toMatchObject({
      body: "quelle couleur ?",
      options: [
        { key: "a", label: "Violet" },
        { key: "b", label: "Vert" },
        { key: "c", label: "Gris" },
      ],
      recommendedKey: "a",
    });
    expect(q2).toMatchObject({
      body: "quelle taille ?",
      options: [
        { key: "a", label: "Petite" },
        { key: "b", label: "Moyenne" },
        { key: "c", label: "Grande" },
      ],
      recommendation: "c) Grande : le titre ressort mieux.",
      recommendedKey: "c",
    });
    expect(withoutQuestions(oneLine)).toBe("Je code dès tes réponses.");
  });

  it("takes no letter in a sentence for options", () => {
    const [q] = parseQuestionRound(
      "❓ **Q1** - **Ordre** : on garde le cas a) seul, ou aussi le cas (c) ?",
    );
    expect(q.options).toEqual([]);
    const [mid] = parseQuestionRound(
      "❓ **Q1** - **Choix** : a) Violet, b) Vert ou c) Gris ?",
    );
    expect(mid.options.map((o) => o.label)).toEqual(["Violet", "Vert", "Gris"]);
  });

  it("keeps the reason of a recommendation, without the option it names", () => {
    const nine = { key: "a", label: "9 h" };
    expect(recoReason("a) 9 h : tu le lis en début de journée.", nine)).toBe(
      "tu le lis en début de journée.",
    );
    expect(recoReason("(a) tu le lis tôt", nine)).toBe("tu le lis tôt");
    expect(recoReason("a) 9 h", nine)).toBe("");
    expect(recoReason("Ajoute-le à 9 h", nine)).toBe("Ajoute-le à 9 h");
    expect(recoReason("a : 9 h, tu le lis tôt", nine)).toBe("tu le lis tôt");
  });

  it("names the option a reco points to as the option writes it", () => {
    const [upper] = parseQuestionRound(
      "❓ **Q1** - **Taille** : laquelle ?\nA) Petite\nB) Grande\n\n➡️ b) Grande, plus lisible",
    );
    expect(upper.recommendedKey).toBe("B");
    const leaning = (words: string) =>
      parseQuestionRound(
        `Question 1 sur 1.\nLaquelle ?\n  a) Garder\n  c) Couper\n\nJe pencherais pour ${words}`,
      )[0].recommendedKey;
    expect(leaning("celle qui garde tout : moins de risque.")).toBeNull();
    expect(leaning("c'est plus sûr : moins de risque.")).toBeNull();
    expect(leaning("(c) : plus court.")).toBe("c");
  });

  it("takes a ➡ in the question's words for no recommendation", () => {
    const flow = [
      "❓ **Q1** - **Parcours** : on garde ce parcours ?",
      "Aujourd'hui : clic ➡️ fiche.",
      "",
      "a) Garder",
      "b) Changer",
      "",
      "➡️ a) Garder.",
      "",
      "Je reprends ensuite.",
    ].join("\n");
    expect(parseQuestionRound(flow)[0]).toMatchObject({
      recommendation: "a) Garder.",
      recommendedKey: "a",
    });
    expect(parseQuestionRound(flow)[0].options).toHaveLength(2);
    expect(withoutQuestions(flow)).toBe("Je reprends ensuite.");
  });

  it("leaves the words after a « Question n sur N » in the message only", () => {
    const series = [
      "Question 1 sur 2.",
      "Quelle couleur ? a) Violet b) Vert",
      "",
      "Puis je relance a) le build et b) les tests.",
    ].join("\n");
    expect(parseQuestionRound(series)[0].body).toBe("");
    expect(withoutQuestions(series)).toBe(
      "Puis je relance a) le build et b) les tests.",
    );
  });

  it("reads every « Question n sur N » of one reply, bold with its dot inside", () => {
    // The Cockpit's reply of 02/11/2026: no sheet showed.
    const two = [
      "Une autre session avait des modifications en cours.",
      "",
      "**Question 1 sur 2.**",
      "",
      "Le lien Amazon mène à un autre robot.",
      "",
      "Faut-il prendre cette fiche ?",
      "",
      "  a) Non : le site le masque seul demain",
      "  b) Oui : je remplace la fiche",
      "",
      "Je pencherais pour (a) : plus cher, peu d'avis.",
      "",
      "**Question 2 sur 2.**",
      "",
      "Je corrige maintenant ?",
      "",
      "  a) Oui",
      "  b) Plus tard",
      "",
      "Je pencherais pour (a) : sinon la retouche reste en ligne.",
      "",
      "---",
      "Détail technique : `1b087d9`.",
    ].join("\n");
    const [q1, q2] = parseQuestionRound(two);
    expect(q1).toMatchObject({
      id: "Q1",
      title: "Faut-il prendre cette fiche ?",
      recommendedKey: "a",
    });
    expect(q1.options).toHaveLength(2);
    expect(q2).toMatchObject({
      id: "Q2",
      title: "Je corrige maintenant ?",
      options: [
        { key: "a", label: "Oui" },
        { key: "b", label: "Plus tard" },
      ],
      recommendedKey: "a",
    });
    expect(withoutQuestions(two)).toBe(
      "Une autre session avait des modifications en cours.\n\nDétail technique : `1b087d9`.",
    );
  });

  it("reads « Question n sur N » as a heading or with a colon", () => {
    const ask = (head: string) =>
      parseQuestionRound(
        [head, "", "On garde ?", "", "  a) Oui", "  b) Non"].join("\n"),
      );
    expect(ask("### Question 1 sur 2")).toHaveLength(1);
    expect(ask("**Question 1 sur 2 :**")).toHaveLength(1);
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

  it("keeps the round while Claude writes on, his new reply read once done", () => {
    // 02/11/2026: a subagent's report woke Claude, the sheet vanished.
    const text = (id: string, t: string, streaming = false): ChatItem => ({
      kind: "text",
      id,
      text: t,
      streaming,
    });
    const writing = text("b", "Le relecteur a fini, je corrige", true);
    expect(lastReplyRound([text("a", GRILL), writing])?.id).toBe("a");
    const more =
      "❓ **Q3** - **Être prévenu** : un email par vente ?\n\n➡️ Oui.";
    const half = text("b", more, true);
    expect(lastReplyRound([text("a", GRILL), half])?.questions).toHaveLength(2);
    const done = text("b", more);
    expect(lastReplyRound([text("a", GRILL), done])?.questions).toHaveLength(3);
  });

  it("gathers a round asked over several replies, a peer's between", () => {
    // The report of 01/11/2026: questions in one reply, a subagent's
    // report, one more question in another, « J'attends » last.
    const text = (id: string, t: string): ChatItem => ({
      kind: "text",
      id,
      text: t,
      streaming: false,
    });
    const more = [
      "❓ **Q3** - **Être prévenu** : un email par vente ?",
      "",
      "➡️ Oui.",
    ].join("\n");
    const peer: ChatItem = { kind: "peer", id: "p", from: "x", text: "Fini" };
    const round = lastReplyRound([
      text("a", GRILL),
      peer,
      text("b", more),
      text("c", "J'attends tes réponses aux questions 1 à 3."),
    ]);
    expect(round?.id).toBe("a");
    expect(round?.ids).toEqual(["a", "b"]);
    expect(round?.questions.map((q) => q.id)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("leaves Claude's other words in place once the questions go to the sheet", () => {
    const mixed = [
      "J'ai fini la migration, les tests passent.",
      "",
      GRILL,
      "",
      "Je lance la suite dès tes réponses.",
    ].join("\n");
    expect(withoutQuestions(mixed)).toBe(
      [
        "J'ai fini la migration, les tests passent.",
        "",
        "Deux décisions avant de coder.",
        "",
        "Je lance la suite dès tes réponses.",
      ].join("\n"),
    );
    // The closing words are no part of the last recommendation.
    expect(parseQuestionRound(mixed)[1].recommendation).toBe(
      "Quatre au plus par volet.",
    );
    expect(withoutQuestions(`Contexte.\n\n${SERIES}`)).toBe("Contexte.");
    expect(withoutQuestions("Corrigé : le test passe.")).toBe(
      "Corrigé : le test passe.",
    );
  });

  it("answers one line per question answered", () => {
    const [q1, q2] = parseQuestionRound(GRILL);
    expect(
      roundReply([q1, q2], {
        [q1.key]: { option: "a", text: "plus sûr" },
        [q2.key]: { reco: true },
      }),
    ).toBe("Q1 : a) Le store de l'app, plus sûr\nQ2 : OK pour ta reco");
    expect(roundReply([q1, q2], { [q2.key]: { text: "  " } })).toBe("");
  });

  it("goes on to the next question left on Enter, and sends only once all are answered", () => {
    // Words typed in Q1, Q2 and Q3 left: Q2, never the round sent.
    expect(enterLeadsTo([true, false, false], 0)).toBe(1);
    // An empty field skips its question.
    expect(enterLeadsTo([false, false], 0)).toBe(1);
    // After the last one, back to one left before it.
    expect(enterLeadsTo([false, true, true], 2)).toBe(0);
    expect(enterLeadsTo([true, true, true], 1)).toBe("send");
    // The only one left, still unanswered: nowhere to go, nothing sent.
    expect(enterLeadsTo([true, false], 1)).toBeNull();
  });

  it("steps forward on the field's button, and sends once no question is left after", () => {
    // Q3 of 5 answered, Q4 and Q5 left: Q4, never the round sent.
    expect(buttonLeadsTo([true, true, true, false, false], 2)).toBe(3);
    // An answered question after it is stepped over.
    expect(buttonLeadsTo([false, true, false], 0)).toBe(2);
    // None left after it: the answers go, a skipped one before included.
    expect(buttonLeadsTo([false, true, true], 2)).toBe("send");
  });

  it("keeps an unnumbered question its reply's own, and a question asked again unanswered", () => {
    const text = (id: string, t: string): ChatItem => ({
      kind: "text",
      id,
      text: t,
      streaming: false,
    });
    const a = text(
      "a",
      "❓ **Q1** - **Couleur** : laquelle ?\n\n❓ **Q2** - **Taille** : laquelle ?",
    );
    const b = text("b", "❓ **Prix** : combien ?");
    const round = lastReplyRound([a, b]);
    expect(round?.questions.map((q) => q.title)).toEqual([
      "Couleur",
      "Taille",
      "Prix",
    ]);
    const [color, , price] = round!.questions;
    // Claude names it by its title: « Q1 » would name « Couleur » too.
    expect(
      roundReply(round!.questions, {
        [color.key]: { text: "vert" },
        [price.key]: { text: "10 €" },
      }),
    ).toBe("Q1 : vert\nPrix : 10 €");
    // A new round numbered from Q1 again: its Q1 starts unanswered.
    const again = lastReplyRound([
      a,
      text("c", "❓ **Q1** - **Police** : laquelle ?"),
    ]);
    expect(again?.questions[0].title).toBe("Police");
    expect(
      roundReply(again!.questions, { [color.key]: { text: "vert" } }),
    ).toBe("");
  });
});
