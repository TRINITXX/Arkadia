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
      options: [
        { key: "a", label: "Oui" },
        { key: "b", label: "Non" },
      ],
      recommendation: "Quatre au plus par volet.",
      recommendedKey: null,
    });
  });

  it("offers Oui / Non for a yes-or-no question written without choices", () => {
    const labels = (text: string) =>
      parseQuestionRound(text)[0].options.map((o) => o.label);
    const [asked] = parseQuestionRound(
      [
        "❓ Je poste ce complément tel quel ?",
        "",
        "Si oui, connectez-vous au forum dans Chrome.",
        "",
        "➡️ Non, j'ajoute d'abord la capture.",
      ].join("\n"),
    );
    expect(asked).toMatchObject({
      title: "Je poste ce complément tel quel ?",
      options: [
        { key: "a", label: "Oui" },
        { key: "b", label: "Non" },
      ],
      recommendedKey: "b",
    });
    expect(labels("❓ Je publie ou pas ?")).toEqual(["Oui", "Non"]);
    // An open question, or a choice between two: no Oui / Non.
    expect(labels("❓ Quel nom on garde ?")).toEqual([]);
    expect(labels("❓ On le range où ?")).toEqual([]);
    expect(labels("❓ Qui s'en charge ?")).toEqual([]);
    expect(labels("❓ Le violet ou le vert ?")).toEqual([]);
    expect(labels("❓ On publie quand ?")).toEqual([]);
    expect(labels("❓ C'est pour qui ?")).toEqual([]);
    // Choices written stay the only ones.
    expect(labels("❓ On part sur ? a) Violet b) Vert")).toEqual([
      "Violet",
      "Vert",
    ]);
  });

  it("offers one choice for an action Claude asks for, the word it asks back", () => {
    const labels = (text: string) =>
      parseQuestionRound(text)[0].options.map((o) => o.label);
    expect(
      labels(
        "❓ Connecte-toi à KDP dans cette fenêtre, puis réponds « fait » : je relance la tâche.",
      ),
    ).toEqual(["Fait"]);
    expect(labels("❓ Lance le script, puis dis « c'est bon ».")).toEqual([
      "C'est bon",
    ]);
    expect(labels("❓ Colle la clé dans le Bloc-notes et enregistre.")).toEqual(
      ["Fait"],
    );
    // A question stays one, whatever word it asks back.
    expect(labels("❓ Je publie ? Réponds « oui » ou « non ».")).toEqual([
      "Oui",
      "Non",
    ]);
    // Asked with a recommendation or a question word: no « Fait ».
    expect(
      labels("❓ **Q3** - **Budget** : le montant max par mois.\n➡️ 20 €"),
    ).toEqual([]);
    expect(labels("❓ Dis-moi quel nom tu préfères.")).toEqual([]);
  });

  it("reads a lone `a) Fait` Claude writes as the one choice, not as words", () => {
    const [action] = parseQuestionRound(
      "❓ Connecte-toi dans cette fenêtre, puis réponds « fait » : je vérifie la page.\n\n  a) Fait",
    );
    expect(action).toMatchObject({
      options: [{ key: "a", label: "Fait" }],
      body: "",
    });
    const [series] = parseQuestionRound(
      "❓ Question 1 sur 1.\n\nColle la clé dans le Bloc-notes.\n\n  a) Fait",
    );
    expect(series).toMatchObject({
      title: "Colle la clé dans le Bloc-notes.",
      options: [{ key: "a", label: "Fait" }],
    });
    // Its words on the header's line too.
    for (const head of [
      "❓ Question 1 sur 1 : connecte-toi, puis réponds « fait ».",
      "❓ Question 1 sur 1. Colle la clé dans le Bloc-notes.",
    ])
      expect(parseQuestionRound(`${head}\n\n  a) Fait`)[0].options).toEqual([
        { key: "a", label: "Fait" },
      ]);
    // Without its ❓, a lone `a)` stays a step of a report.
    expect(
      parseQuestionRound("Question 1 sur 2.\n\nÉtapes :\n\n  a) migrer"),
    ).toEqual([]);
    // Under a question with a « ? », a lone `a)` is a note: Oui / Non stay.
    for (const asked of [
      "**Q1.** On migre la base ce soir ?\n  a) la migration prend 10 min\nReco : oui.",
      "❓ **Q1** - **Cache** : on le vide ?\n(a) il pèse 2 Go\n➡️ Oui, il est périmé.",
    ])
      expect(parseQuestionRound(asked)[0]).toMatchObject({
        options: [{ label: "Oui" }, { label: "Non" }],
        recommendedKey: "a",
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

  it("reads « Question n sur N » with its context on the same line", () => {
    // The Cockpit's reply of 09/11/2026: no sheet showed.
    const two = [
      "Bilan.",
      "",
      "---",
      "",
      "**Question 1 sur 2.** Le filtre laisse passer un chiffre reformulé.",
      "",
      "Baisser le seuil à 50 % ?",
      "",
      "  a) Oui",
      "  b) Non, garder 60 %",
      "",
      "Je pencherais pour (a) : 9 doublons évités.",
      "",
      "Question 2 sur 2 : la barre d'achat ne fait aucun clic.",
      "",
      "Remplacer le produit ?",
      "",
      "  a) Oui",
      "  b) Non",
    ].join("\n");
    const [q1, q2] = parseQuestionRound(two);
    expect(q1).toMatchObject({
      id: "Q1",
      title: "Baisser le seuil à 50 % ?",
      body: "Le filtre laisse passer un chiffre reformulé.",
      recommendedKey: "a",
    });
    expect(q2).toMatchObject({
      id: "Q2",
      title: "Remplacer le produit ?",
      body: "la barre d'achat ne fait aucun clic.",
    });
    expect(withoutQuestions(two)).toBe("Bilan.");
  });

  it("reads a ❓ « Question n sur N » written without options", () => {
    const yesNo = [
      "❓ Question 1 sur 1.",
      "",
      "Le complément est prêt.",
      "",
      "Je poste ce complément tel quel ?",
      "",
      "Je pencherais pour oui : il répond à sa question.",
      "",
      "Autre chose après.",
    ].join("\n");
    expect(parseQuestionRound(yesNo)).toMatchObject([
      {
        id: "Q1",
        title: "Je poste ce complément tel quel ?",
        body: "Le complément est prêt.",
        options: [
          { key: "a", label: "Oui" },
          { key: "b", label: "Non" },
        ],
        recommendation: "oui : il répond à sa question.",
        recommendedKey: "a",
      },
    ]);
    expect(withoutQuestions(yesNo)).toBe("Autre chose après.");
    const labels = (text: string) =>
      parseQuestionRound(text).map((q) => q.options.map((o) => o.label));
    expect(
      labels(
        "❓ Question 1 sur 1.\n\nConnecte-toi à KDP, puis réponds « fait ».",
      ),
    ).toEqual([["Fait"]]);
    // An open question still shows, its field alone.
    expect(labels("❓ Question 1 sur 1.\n\nQuel nom on garde ?")).toEqual([[]]);
    // Without its ❓, or asking nothing: a report.
    expect(labels("Question 1 sur 1.\n\nJe poste ?")).toEqual([]);
    expect(labels("❓ Question 2 sur 2 : réglée.\n\nFin.")).toEqual([]);
  });

  it("keeps every line of a bare « Question n sur N » in view, code aside", () => {
    // A line between the question and the leaning shows in the sheet.
    const [between] = parseQuestionRound(
      [
        "❓ Question 1 sur 1.",
        "Je poste ce complément ?",
        "Il fait trois lignes.",
        "Je pencherais pour oui.",
      ].join("\n"),
    );
    expect(between).toMatchObject({
      title: "Je poste ce complément ?",
      body: "Il fait trois lignes.",
      recommendation: "oui",
      recommendedKey: "a",
    });
    // A « ? » in code is not the question.
    const code = [
      "❓ Question 1 sur 1.",
      "```ts",
      "const x = ok ?",
      "```",
      "Je corrige ?",
    ].join("\n");
    expect(parseQuestionRound(code)[0].title).toBe("Je corrige ?");
    // A leaning « oui » makes it yes or no, whatever its words.
    expect(
      parseQuestionRound(
        "❓ Question 1 sur 1.\nJe range le fichier où tu l'as mis ?\nJe pencherais pour oui : c'est plus simple.",
      )[0],
    ).toMatchObject({
      options: [{ label: "Oui" }, { label: "Non" }],
      recommendedKey: "a",
    });
    // Steps after a leaning « oui » are Claude's words, not options.
    const steps = [
      "❓ Question 1 sur 1.",
      "Je poste ce complément ?",
      "Je pencherais pour oui : il répond.",
      "Ensuite :",
      "a) je relance le serveur",
      "b) je lance les tests",
    ].join("\n");
    expect(parseQuestionRound(steps)[0]).toMatchObject({
      options: [{ label: "Oui" }, { label: "Non" }],
      recommendation: "oui : il répond.",
    });
    expect(withoutQuestions(steps)).toBe(
      "Ensuite :\na) je relance le serveur\nb) je lance les tests",
    );
  });

  it("leaves a « Question n sur N » report with words on its line as prose", () => {
    // No dot or colon after the number: a sentence.
    expect(
      parseQuestionRound("Question 1 sur 2 réglée.\n\n  a) Oui\n  b) Non"),
    ).toEqual([]);
    // A colon, but no « ? » before the letters: steps, not options.
    const report =
      "Question 2 sur 2 : réglée.\n\nÉtapes :\n\n  a. migrer\n  b. tester\n\nFin.";
    expect(parseQuestionRound(report)).toEqual([]);
    expect(withoutQuestions(report)).toBe(report);
  });

  it("reads a « Question n sur N » line full of blanks at once", () => {
    // Its blanks side by side took seconds for 400, hours for 5 000.
    const blanks = `Question 1 sur 3${" ".repeat(5000)}x\n\n  a) Oui\n  b) Non`;
    expect(parseQuestionRound(blanks)).toEqual([]);
  });

  it("reads `**Q1.**` questions and their « Reco : »", () => {
    // The affiliation sites' reply of 11/11/2026: no sheet showed.
    const four = [
      "- Page famille : la Philips 5500.",
      "",
      "**Quatre réponses attendues**",
      "",
      "**Q1.** Je mets en ligne la page Projets ? L'image montre le quiz.",
      "Reco : oui.",
      "",
      "**Q3.** Je corrige 4 erreurs du site café ?",
      "- « d'une touche » dans 19 pages ;",
      "- une machine à 610 € sur la page « 350 à 600 € ».",
      "",
      "Reco : oui.",
      "",
      "**Q4.** Les duels : ta sélection dans le visuel au-dessus.",
      "**Reco :** les 5 cochés par site.",
      "",
      "---",
      "Détail technique : rien.",
    ].join("\n");
    const [q1, q3, q4] = parseQuestionRound(four);
    expect(q1).toMatchObject({
      id: "Q1",
      numbered: true,
      title: "Je mets en ligne la page Projets ?",
      body: "L'image montre le quiz.",
      options: [
        { key: "a", label: "Oui" },
        { key: "b", label: "Non" },
      ],
      recommendation: "oui.",
      recommendedKey: "a",
    });
    expect(q3).toMatchObject({
      id: "Q3",
      title: "Je corrige 4 erreurs du site café ?",
      recommendation: "oui.",
    });
    expect(q3.body).toContain("610 €");
    expect(q4).toMatchObject({
      id: "Q4",
      title: "Les duels : ta sélection dans le visuel au-dessus.",
      options: [],
      recommendation: "les 5 cochés par site.",
    });
    expect(withoutQuestions(four)).toBe(
      "- Page famille : la Philips 5500.\n\n**Quatre réponses attendues**\n\nDétail technique : rien.",
    );
  });

  it("reads a `Q1.` question whose « Reco : » shares its line", () => {
    const [q] = parseQuestionRound("Q1. On publie ? Reco : oui, ce soir.");
    expect(q).toMatchObject({
      id: "Q1",
      title: "On publie ?",
      recommendation: "oui, ce soir.",
    });
  });

  it("leaves `**Q1.**` lines with no recommendation nor options as prose", () => {
    const recap =
      "**Q1.** Fait : la page est en ligne.\n**Q2.** Réglé.\n\nFin.";
    expect(parseQuestionRound(recap)).toEqual([]);
    expect(withoutQuestions(recap)).toBe(recap);
    expect(parseQuestionRound("Q1 2026 : Reco : rien.")).toEqual([]);
  });

  it("leaves a `**Q1.**` report followed by advice or steps as prose", () => {
    const reports = [
      "**Q1.** Fait : la page est en ligne.\n\n➡️ Il te reste à relancer le serveur.",
      "**Q1.** La page charge en 3 s.\n**Q2.** Le cache est vide.\n\nRecommandation : activer le cache.",
      "**Q1.** Validé : je publie.\n**Q2.** Validé : option b.\n\nJe lance :\na) la mise en ligne\nb) le correctif",
      "Q3-2026 : CA 12 k€.\nQ4-2026 : objectif 15 k€.\nReco : augmenter les prix.",
    ];
    for (const report of reports) {
      expect(parseQuestionRound(report)).toEqual([]);
      expect(withoutQuestions(report)).toBe(report);
    }
  });

  it("keeps a `Q1 :` inside another format's question as its words", () => {
    const grill =
      "❓ **Q2** - **Couleur** : on garde le vert ?\nQ1 : tu as dit oui, donc le vert suit.\n➡️ oui";
    expect(parseQuestionRound(grill)).toMatchObject([
      { id: "Q2", recommendation: "oui" },
    ]);
    const series = [
      "Question 2 sur 3.",
      "",
      "Q1 : tu as choisi le vert. Pour la police ?",
      "",
      "  a) Inter",
      "  b) Sora",
      "",
      "Je pencherais pour (b) : plus ronde.",
    ].join("\n");
    expect(parseQuestionRound(series)).toMatchObject([
      { id: "Q2", recommendedKey: "b" },
    ]);
  });

  it("titles a question with its last « ? » before words, not a quote's", () => {
    const ask = (head: string) => parseQuestionRound(`${head}\nReco : oui.`)[0];
    expect(
      ask("**Q1.** Je garde « Pourquoi ? » comme titre de la page ?"),
    ).toMatchObject({
      title: "Je garde « Pourquoi ? » comme titre de la page ?",
      body: "",
    });
    expect(ask("**Q1.** Tu préfères A ? Ou B ? Je pense A.")).toMatchObject({
      title: "Tu préfères A ? Ou B ?",
      body: "Je pense A.",
    });
    expect(
      parseQuestionRound("Q1. On baisse ? Ma reco : oui.\nReco : non.")[0],
    ).toMatchObject({ title: "On baisse ?", body: "Ma reco : oui." });
    // Indented, it keeps its number.
    expect(ask("  **Q3.** On publie ?")).toMatchObject({
      id: "Q3",
      numbered: true,
      title: "On publie ?",
    });
  });

  it("keeps every recommendation line of a question", () => {
    const [q] = parseQuestionRound(
      "❓ **Q1** - **Seuil** : on garde 3 s ? Reco : 2,5 s, comme Google.\n➡️ oui",
    );
    expect(q.recommendation).toBe("2,5 s, comme Google.\noui");
  });

  it("reads every format with a ❓ before its question", () => {
    // The user's instructions of 11/11/2026: a ❓ starts every question.
    const series = [
      "Bilan.",
      "",
      "❓ Question 1 sur 2.",
      "",
      "Le filtre laisse passer des doublons.",
      "",
      "Baisser le seuil ?",
      "",
      "  a) Oui",
      "  b) Non",
      "",
      "Je pencherais pour (a) : moins de doublons.",
      "",
      "❓ **Question 2 sur 2.** La barre ne fait aucun clic.",
      "",
      "Remplacer le produit ?",
      "",
      "  a) Oui",
      "  b) Non",
      "",
      "Je pencherais pour (b) : attendre une semaine.",
      "",
      "Je reprends ensuite.",
    ].join("\n");
    expect(parseQuestionRound(series)).toMatchObject([
      { id: "Q1", title: "Baisser le seuil ?", recommendedKey: "a" },
      {
        id: "Q2",
        title: "Remplacer le produit ?",
        body: "La barre ne fait aucun clic.",
        recommendedKey: "b",
      },
    ]);
    expect(withoutQuestions(series)).toBe("Bilan.\n\nJe reprends ensuite.");
    const numbered = "❓ **Q1.** On publie ? L'image est prête.\nReco : oui.";
    expect(parseQuestionRound(numbered)).toMatchObject([
      {
        id: "Q1",
        title: "On publie ?",
        body: "L'image est prête.",
        recommendation: "oui.",
      },
    ]);
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
