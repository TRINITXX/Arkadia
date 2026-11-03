import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUsageReport, resetLine } from "@/lib/chat/chatUsage";

/**
 * A headless Claude Code's real /usage answer (03/11/2026), its week pushed
 * past the hot share.
 */
const USAGE = readFileSync(
  path.resolve(__dirname, "../../../chat-server/fixtures/usage.txt"),
  "utf-8",
).replace("(all models): 14%", "(all models): 84%");

/** Tue 3 Nov 2026, 7:00, local time. */
const NOW = new Date(2026, 10, 3, 7, 0).getTime();

describe("parseUsageReport", () => {
  const report = parseUsageReport(USAGE, NOW);

  it("reads the plan and its windows in French, hot from 80 %", () => {
    expect(report?.plan).toBe("abonnement");
    expect(report?.windows).toEqual([
      {
        label: "Session en cours",
        percent: 24,
        hot: false,
        reset: "repart aujourd'hui à 8 h 10",
      },
      {
        label: "Semaine · tous modèles",
        percent: 84,
        hot: true,
        reset: "repart lun. 9 nov. à 13 h",
      },
      {
        label: "Semaine · Fable",
        percent: 0,
        hot: false,
        reset: "repart lun. 9 nov. à 13 h",
      },
    ]);
  });

  it("reads each period: its figures, its tips and their details, its tops", () => {
    expect(report?.note).toBe(
      "estimation · ce PC seulement · les parts se recouvrent",
    );
    const [day, week] = report?.periods ?? [];
    expect(day.label).toBe("24 h");
    expect(day.summary).toBe(
      `${(20080).toLocaleString("fr-FR")} requêtes · 21 sessions`,
    );
    expect(day.tips[1]).toEqual({
      percent: 79,
      text: "Garder les workflows pour les gros chantiers",
      detail: "682 agents lancés",
    });
    expect(day.tops.map((t) => t.label)).toEqual(["Sous-agents", "MCP"]);
    expect(day.tops[0].entries[0]).toEqual({
      name: "workflow-subagent",
      percent: 73,
    });
    expect(week.label).toBe("7 jours");
    expect(week.tips.map((t) => t.text)).toEqual([
      "Donner un modèle moins cher aux sous-agents « general-purpose »",
      "Repartir de zéro en changeant de sujet",
      "Arrêter les sessions dont tu n'as plus besoin",
      "Garder les workflows pour les gros chantiers",
      "Lancer moins de sessions à la fois",
    ]);
    expect(week.tips[2].detail).toBe("certaines ont tourné 8 h ou plus");
    expect(week.tops[0]).toEqual({
      label: "Skills",
      entries: [{ name: "/chrome-browser", percent: 1 }],
    });
  });

  it("keeps Claude Code's words where it knows no French, never drops a line", () => {
    const text = [
      "Current session: 5% used · resets soon",
      "Extra usage: on",
      "",
      "What's contributing to your usage?",
      "Approximate",
      "",
      "Last 24h · 1 request · 1 session",
      "  50%  Try something new · 1 agent ran",
      "  breakdown · opus: 80% · cache hit: 95%",
      "  Top subagents: a 9%, b 2%, +2 more",
    ].join("\n");
    const r = parseUsageReport(text, NOW);
    expect(r?.windows[0].reset).toBe("repart soon");
    expect(r?.rest).toEqual(["Extra usage: on"]);
    const [day] = r?.periods ?? [];
    expect(day.summary).toBe("1 requête · 1 session");
    expect(day.tips[0]).toEqual({
      percent: 50,
      text: "Try something new",
      detail: "1 agent lancé",
    });
    expect(day.rest).toEqual(["breakdown · opus: 80% · cache hit: 95%"]);
    expect(day.tops[0].entries[2]).toEqual({
      name: "+2 autres",
      percent: null,
    });
  });

  it("reads overages as off the plan, though their line names it too", () => {
    const text =
      "You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset\n\nCurrent session: 100% used";
    expect(parseUsageReport(text, NOW)?.plan).toBe("hors forfait");
  });

  it("is null for any other command's answer", () => {
    expect(parseUsageReport("Session renamed to: slash-live", NOW)).toBeNull();
  });
});

describe("resetLine", () => {
  it("reads the year Claude Code adds for next year's reset, a reset gone by in the past", () => {
    const dec30 = new Date(2026, 11, 30, 12, 0).getTime();
    expect(resetLine("Jan 2, 2027, 1pm (Europe/Paris)", dec30)).toBe(
      "repart sam. 2 janv. 2027 à 13 h",
    );
    expect(resetLine("Nov 2, 8:05pm", NOW)).toBe(
      "remise à zéro hier à 20 h 05",
    );
  });
});
