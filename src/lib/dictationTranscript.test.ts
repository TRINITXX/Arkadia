import { describe, expect, it } from "vitest";
import {
  addResult,
  EMPTY_TRANSCRIPT,
  transcriptText,
  type TranscriptState,
} from "./dictationTranscript";

const r = (transcript: string, isFinal = false) => ({
  isFinal,
  results: [{ transcript }],
});
const play = (events: Parameters<typeof addResult>[1][]) =>
  transcriptText(events.reduce<TranscriptState>(addResult, EMPTY_TRANSCRIPT));

describe("dictation transcript", () => {
  it("keeps the words said before a pause (iOS 18 segments)", () => {
    expect(
      play([
        r("ajoute"),
        r("ajoute un son"),
        r("ajoute un son", true),
        r(" quand l'artefact"),
        r(" quand l'artefact se ferme"),
        r(" quand l'artefact se ferme", true),
        { isFinal: true, results: [] },
      ]),
    ).toBe("ajoute un son quand l'artefact se ferme");
  });

  it("uses the cumulative results of older iOS once", () => {
    expect(
      play([r("fais le"), r("fais le commit"), r("fais le commit", true)]),
    ).toBe("fais le commit");
  });

  it("shows the words being said before any pause", () => {
    expect(play([r("continue")])).toBe("continue");
  });

  it("is not wiped by a final event without results", () => {
    expect(play([r("oui", true), { isFinal: true, results: [] }])).toBe("oui");
  });
});
