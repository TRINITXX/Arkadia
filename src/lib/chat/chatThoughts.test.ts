import { describe, expect, it } from "vitest";
import {
  fullThoughts,
  saidInFrench,
  thoughtBody,
  thoughtsInFull,
} from "@/lib/chat/chatThoughts";

// Real thoughts of 17 and 19/11/2026: an answer left in Claude's French
// words, and the API's English summaries around it.
const LOST_REPORT =
  "Aucune vraie panne : après le correctif du 05/11, la compaction de fin de tour n'a raté aucune occasion. Les 63 fins de tour sautées que j'annonçais étaient un mauvais décompte ; le bon chiffre est 145, sans changer la conclusion.";
const LOST_TUTORIAL =
  "Je crée l'app Reddit (script, redirect localhost:8080) et je colle les deux identifiants dans le Bloc-notes, puis je les poserai dans la veille sur VPS 2. Pour YouTube, il faut faire la validation vidéo sur les deux chaînes GTA6 FR et EN, sinon la ferme réessaiera chaque heure.";
const SUMMARY =
  'I\'m checking the "AVANT/APRES" pairs where the long avis30s get cut off at the end, so I only see their tails. Some of those tails look identical because the change happened earlier in the string.';
const SUMMARY_QUOTING_FRENCH =
  "I'm checking Google's quoted language on fabricated creator profiles: « Inventer des profils d'auteurs est une forme de tromperie », so fictitious author names are a clear no.";

describe("a thought in Claude's own French words", () => {
  it("is told from the API's English summaries", () => {
    expect(saidInFrench(LOST_REPORT)).toBe(true);
    expect(saidInFrench(LOST_TUTORIAL)).toBe(true);
    expect(saidInFrench(SUMMARY)).toBe(false);
    expect(saidInFrench(SUMMARY_QUOTING_FRENCH)).toBe(false);
    expect(saidInFrench("")).toBe(false);
  });

  it("shows in full, the summaries behind the bulb, the latest too while Claude works", () => {
    const items = [
      { id: "a", text: SUMMARY },
      { id: "b", text: LOST_REPORT },
      { id: "c", text: SUMMARY_QUOTING_FRENCH },
      { id: "d", text: "  " },
    ];
    expect(thoughtsInFull(items, false).map((i) => i.id)).toEqual(["b"]);
    expect(thoughtsInFull(items, true).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("is told once per run, so a bulb leaves it out", () => {
    const { byRun, ids } = fullThoughts(
      [
        { id: "past", items: [{ id: "a", text: SUMMARY }] },
        {
          id: "now",
          items: [
            { id: "b", text: LOST_TUTORIAL },
            { id: "c", text: SUMMARY },
          ],
        },
      ],
      "now",
    );
    expect([...byRun.keys()]).toEqual(["now"]);
    expect([...ids]).toEqual(["b", "c"]);
  });
});

describe("a thinking summary as shown", () => {
  it("is its text without its heading", () => {
    expect(
      thoughtBody(
        "**Lire avant d'écrire**\n\nJe lis note.txt.\n\nPuis le résumé.",
      ),
    ).toBe("Je lis note.txt.\nPuis le résumé.");
    expect(thoughtBody("Je lis note.txt d'abord.")).toBe(
      "Je lis note.txt d'abord.",
    );
    // A heading alone: kept, plain.
    expect(thoughtBody("**Lire avant d'écrire**")).toBe("Lire avant d'écrire");
    expect(thoughtBody("")).toBe("");
  });
});
