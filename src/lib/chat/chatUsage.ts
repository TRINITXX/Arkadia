import { HOT } from "@/lib/chat/chatStatus";

/**
 * /usage's answer read as data for its card (the user's pick A of
 * 03/11/2026: bars as in the terminal, the 24 h / 7 days breakdown behind
 * tabs). A headless Claude Code prints it as plain text: the plan, one line
 * per window, then what weighs on the windows by period. Claude Code's
 * English turns French where known and stays as it is otherwise: a line
 * read as nothing known is kept as it came (`rest`), never dropped. Pure.
 */

/** The commands that print it: /usage and its aliases. */
export const USAGE_COMMANDS = new Set(["usage", "cost", "stats"]);

export interface UsageWindow {
  /** « Session en cours », « Semaine · tous modèles »… */
  label: string;
  /** 0-100. */
  percent: number;
  hot: boolean;
  /** « repart aujourd'hui à 8 h 10 », or Claude Code's words if unread. */
  reset: string | null;
}

export interface UsageTip {
  percent: number;
  text: string;
  detail: string | null;
}

export interface UsageTop {
  /** « Sous-agents », « MCP »… */
  label: string;
  /** No percent for « +2 autres » or an entry not read. */
  entries: { name: string; percent: number | null }[];
}

export interface UsagePeriod {
  /** « 24 h », « 7 jours ». */
  label: string;
  /** « 20 014 requêtes · 21 sessions ». */
  summary: string;
  tips: UsageTip[];
  tops: UsageTop[];
  /** Its lines read as nothing known, as Claude Code wrote them. */
  rest: string[];
}

export interface UsageReport {
  /** « abonnement », « hors forfait », or null. */
  plan: string | null;
  windows: UsageWindow[];
  /**
   * The breakdown's caveat (« estimation · ce PC seulement… »), or why it
   * isn't there.
   */
  note: string | null;
  periods: UsagePeriod[];
  /** Lines outside a period read as nothing known, as written. */
  rest: string[];
}

type Rule = [RegExp, string | ((...groups: string[]) => string)];

/** First rule that matches, else the text as Claude Code wrote it. */
const translate = (text: string, rules: Rule[]): string => {
  const t = text.trim();
  for (const [re, fr] of rules) {
    const m = re.exec(t);
    if (!m) continue;
    return typeof fr === "string" ? t.replace(re, fr) : fr(...m.slice(1));
  }
  return t;
};

/** « 1 agent lancé », « 682 agents lancés ». */
const count = (n: string, one: string, many: string) =>
  `${Number(n).toLocaleString("fr-FR")} ${Number(n) <= 1 ? one : many}`;

const WINDOW_LABELS: Rule[] = [
  [/^Current session$/, "Session en cours"],
  [/^Current week \(all models\)$/, "Semaine · tous modèles"],
  [/^Current week \((.+) only\)$/, "Semaine · $1 seul"],
  [/^Current week \((.+)\)$/, "Semaine · $1"],
];

const TIPS: Rule[] = [
  [
    /^Give simple subagents a cheaper model$/,
    "Donner un modèle moins cher aux sous-agents simples",
  ],
  [
    /^Give "(.+)" subagents a cheaper model$/,
    "Donner un modèle moins cher aux sous-agents « $1 »",
  ],
  [
    /^Save workflows for big tasks$/,
    "Garder les workflows pour les gros chantiers",
  ],
  [
    /^Start fresh when you switch tasks$/,
    "Repartir de zéro en changeant de sujet",
  ],
  [
    /^Stop sessions you no longer need$/,
    "Arrêter les sessions dont tu n'as plus besoin",
  ],
  [/^Run fewer sessions at once$/, "Lancer moins de sessions à la fois"],
];

const DETAILS: Rule[] = [
  [/^(\d+) agents? ran$/, (n) => count(n, "agent lancé", "agents lancés")],
  [/^run (\/\S+)$/, "$1"],
  [/^some ran (\d+) hours? or more$/, "certaines ont tourné $1 h ou plus"],
  [/^up to (\d+) at once$/, "jusqu'à $1 en même temps"],
];

const TOPS: Rule[] = [
  [/^subagents$/i, "Sous-agents"],
  [/^MCP servers$/i, "MCP"],
  [/^skills$/i, "Skills"],
];

const NOTES: Rule[] = [
  [/^Approximate$/, "estimation"],
  [/^sessions on this machine only$/, "ce PC seulement"],
  [/^shares overlap$/, "les parts se recouvrent"],
];

const PERIODS: Rule[] = [
  [/^(\d+)h$/, "$1 h"],
  [/^1d$/, "1 jour"],
  [/^(\d+)d$/, "$1 jours"],
];

const SUMMARY: Rule[] = [
  [/^(\d+) requests?$/, (n) => count(n, "requête", "requêtes")],
  [/^(\d+) sessions?$/, (n) => count(n, "session", "sessions")],
];

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

const DAY_MS = 86_400_000;

const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « 8 h 10 », « 13 h ». */
const clock = (d: Date) =>
  d.getMinutes() === 0
    ? `${d.getHours()} h`
    : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * « Nov 3, 8:10am (Europe/Paris) », « Jan 2, 2027, 1pm »: Claude Code
 * writes the year only when it isn't this one, the time in the machine's
 * own zone (it runs on it). Null if unread.
 */
export function resetDate(text: string, now: number): Date | null {
  const m =
    /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),?(?: (\d{4}),?)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(
      text.trim(),
    );
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toLowerCase() === "pm") hour += 12;
  const year = m[3] ? Number(m[3]) : new Date(now).getFullYear();
  return new Date(year, month, Number(m[2]), hour, Number(m[5] ?? 0));
}

/** « repart aujourd'hui à 8 h 10 », « remise à zéro hier à 13 h ». */
export function resetLine(text: string, now: number): string {
  const d = resetDate(text, now);
  if (!d) return `repart ${text.trim()}`;
  const days = Math.round((dayStart(d) - dayStart(new Date(now))) / DAY_MS);
  const day =
    days === 0
      ? "aujourd'hui"
      : days === 1
        ? "demain"
        : days === -1
          ? "hier"
          : d.toLocaleDateString("fr-FR", {
              weekday: "short",
              day: "numeric",
              month: "short",
              ...(d.getFullYear() === new Date(now).getFullYear()
                ? {}
                : { year: "numeric" }),
            });
  const verb = d.getTime() > now ? "repart" : "remise à zéro";
  return `${verb} ${day} à ${clock(d)}`;
}

/** Which way the plan pays: overages first, their line names the plan too. */
function planLabel(line: string): string | null {
  if (/\boverages?\b/i.test(line)) return "hors forfait";
  if (/\bsubscription\b/i.test(line)) return "abonnement";
  return null;
}

/** A top's entry: « exa 2% », « +2 more ». */
function topEntry(raw: string): { name: string; percent: number | null } {
  const entry = raw.trim();
  const e = /^(.+?)\s+(\d+(?:\.\d+)?)%$/.exec(entry);
  if (e) return { name: e[1], percent: Number(e[2]) };
  const more = /^\+(\d+) more$/.exec(entry);
  if (more) return { name: `+${more[1]} autres`, percent: null };
  return { name: entry, percent: null };
}

const WINDOW = /^(.+?):\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets\s+(.+))?$/;
const PERIOD = /^Last (\S+)\s*·\s*(.+)$/;
const TIP = /^\s+(\d+(?:\.\d+)?)%\s+(.+)$/;
const TOP = /^\s+Top ([^:]+):\s*(.+)$/;

/** /usage's answer as its card shows it, or null for any other text. */
export function parseUsageReport(
  text: string,
  now: number,
): UsageReport | null {
  const report: UsageReport = {
    plan: null,
    windows: [],
    note: null,
    periods: [],
    rest: [],
  };
  let inBreakdown = false;
  let noteNext = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (noteNext) {
      noteNext = false;
      report.note = trimmed
        .split(" · ")
        .map((part) => translate(part, NOTES))
        .join(" · ");
      continue;
    }
    if (/^What's contributing to your usage\?$/.test(trimmed)) {
      inBreakdown = true;
      noteNext = true;
      continue;
    }
    if (!inBreakdown) {
      const plan = /^You are currently using/i.test(trimmed)
        ? planLabel(trimmed)
        : null;
      const w = WINDOW.exec(trimmed);
      if (plan) report.plan = plan;
      else if (w) {
        const percent = Number(w[2]);
        report.windows.push({
          label: translate(w[1], WINDOW_LABELS),
          percent,
          hot: percent / 100 >= HOT,
          reset: w[3] ? resetLine(w[3], now) : null,
        });
      } else report.rest.push(trimmed);
      continue;
    }
    const p = PERIOD.exec(trimmed);
    if (p) {
      report.periods.push({
        label: translate(p[1], PERIODS),
        summary: p[2]
          .split(" · ")
          .map((part) => translate(part, SUMMARY))
          .join(" · "),
        tips: [],
        tops: [],
        rest: [],
      });
      continue;
    }
    const period = report.periods[report.periods.length - 1];
    const top = period && TOP.exec(line);
    const tip = period && TIP.exec(line);
    if (top) {
      period.tops.push({
        label: translate(top[1], TOPS),
        entries: top[2].split(/,\s*/).map(topEntry),
      });
    } else if (tip) {
      const [text, ...rest] = tip[2].split(" · ");
      period.tips.push({
        percent: Number(tip[1]),
        text: translate(text, TIPS),
        detail: rest.length
          ? rest.map((d) => translate(d, DETAILS)).join(" · ")
          : null,
      });
    } else (period?.rest ?? report.rest).push(trimmed);
  }
  return report.windows.length || report.periods.length ? report : null;
}
