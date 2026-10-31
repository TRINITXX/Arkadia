import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { VISUAL_TOOL_NAME, type VisualReport } from "@/lib/chat/chatVisual";
import { visualResult } from "@chat-server/visualHtml";

/**
 * The chat preview's visuals (`chat-preview.html?s=visuals`): Claude shows a
 * chart that breaks (the Lab's check folds it), its fix, then three mockups
 * side by side with a choice. Each page goes through the real probe
 * (`createVisualProbe`); its report becomes the tool's result here, as the
 * chat server would answer Claude.
 */

const ev = (type: string, rest: JsonObject = {}) =>
  ({ type, chatId: "preview", ...rest }) as ChatEvent;
const sdk = (message: JsonObject) => ev("sdk", { message });

const chartPage = (broken: boolean) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
.kpis{display:flex;gap:10px;margin-bottom:14px}
.kpi{flex:1;background:var(--card);border-radius:var(--radius-sm);padding:10px 12px}
.kpi b{display:block;font-size:20px;line-height:1.2;color:var(--text)}
.kpi b.good{color:var(--ok)}
.kpi span{font-size:12px;color:var(--muted)}
.chart{position:relative;height:220px}
</style></head><body>
<div class="kpis">
  <div class="kpi"><b>4,8 s</b><span>avant, conversation de 167 Mo</span></div>
  <div class="kpi"><b>0,5 s</b><span>après</span></div>
  <div class="kpi"><b class="good">−90 %</b><span>temps de retour</span></div>
</div>
<div class="chart"><canvas id="c"></canvas></div>
<script>
const css = getComputedStyle(document.documentElement);
const v = (name) => css.getPropertyValue(name).trim();
${broken ? "drawChart(document.getElementById('c'));" : ""}
new Chart(document.getElementById("c"), {
  type: "bar",
  data: {
    labels: ["10 Mo", "40 Mo", "90 Mo", "167 Mo"],
    datasets: [
      { label: "Avant", data: [0.6, 1.4, 2.9, 4.8], backgroundColor: v("--chart-2"), borderRadius: 4 },
      { label: "Après", data: [0.2, 0.3, 0.4, 0.5], backgroundColor: v("--chart-1"), borderRadius: 4 },
    ],
  },
  options: {
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: v("--muted"), boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: v("--muted") }, grid: { display: false } },
      y: { ticks: { color: v("--muted"), callback: (s) => s + " s" }, grid: { color: v("--border") } },
    },
  },
});
</script></body></html>`;

/** A chat column drawn in boxes: each mockup's own arrangement. */
const screen = (body: string) => `<div class="screen">${body}</div>`;
const bars = (n: number, side: "l" | "r" = "l") =>
  Array.from(
    { length: n },
    (_, i) =>
      `<i class="bar ${side}" style="width:${[78, 55, 66, 40][i % 4]}%"></i>`,
  ).join("");

const MOCKUPS = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><style>
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.m{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:10px}
.m h3{margin:0;font-size:13.5px;font-weight:600;color:var(--text)}
.m p{margin:0;font-size:12.5px;color:var(--muted);min-height:38px}
.screen{position:relative;height:170px;border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--border);padding:10px;display:flex;flex-direction:column;gap:6px;overflow:hidden}
.bar{display:block;height:7px;border-radius:4px;background:var(--border-strong)}
.bar.r{align-self:flex-end;background:#3a3f47}
.input{position:absolute;left:10px;right:10px;bottom:10px;height:26px;border-radius:13px;background:var(--card-2);border:1px solid var(--border-strong)}
.input.dock{left:0;right:0;bottom:0;border-radius:0;border-width:1px 0 0}
.input.wide{height:44px;border-radius:12px}
.chip{position:absolute;right:16px;bottom:16px;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.side{position:absolute;top:0;bottom:0;right:0;width:34%;border-left:1px solid var(--border);background:var(--card-2)}
.pick{margin-top:auto;border:0;border-radius:8px;padding:8px 10px;background:var(--accent-soft);color:var(--accent);font:inherit;font-weight:600;cursor:pointer}
.pick:hover{background:var(--accent);color:var(--accent-text)}
@media (max-width:640px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="grid">
  <div class="m"><h3>A · Saisie flottante</h3>
    ${screen(`${bars(6)}<i class="input"></i><i class="chip"></i>`)}
    <p>La carte de saisie flotte au-dessus de la colonne, ombre légère.</p>
    <button class="pick" onclick="arkadia.choose('Maquette A, saisie flottante')">Choisir A</button></div>
  <div class="m"><h3>B · Saisie ancrée</h3>
    ${screen(`${bars(5)}${bars(1, "r")}<i class="input dock"></i>`)}
    <p>La saisie colle au bas du volet, pleine largeur, comme un terminal.</p>
    <button class="pick" onclick="arkadia.choose('Maquette B, saisie ancrée')">Choisir B</button></div>
  <div class="m"><h3>C · Volet latéral</h3>
    ${screen(`${bars(4)}<i class="side"></i><i class="input wide" style="right:38%"></i>`)}
    <p>Les tâches et sous-agents passent dans un volet à droite.</p>
    <button class="pick" onclick="arkadia.choose('Maquette C, volet latéral')">Choisir C</button></div>
</div>
</body></html>`;

interface Step {
  id: string;
  title: string;
  html: string;
  wide: boolean;
  /** Claude's words before the call, if any. */
  before?: string;
}

const STEPS: Step[] = [
  {
    id: "vis-chart-1",
    title: "Retour sur une longue conversation",
    html: chartPage(true),
    wide: false,
  },
  {
    id: "vis-chart-2",
    title: "Retour sur une longue conversation",
    html: chartPage(false),
    wide: false,
  },
  {
    id: "vis-mockups",
    title: "Trois places pour la saisie",
    html: MOCKUPS,
    wide: true,
    before: "Pour la saisie, trois placements possibles :",
  },
];

function callEvents(step: Step, n: number): ChatEvent[] {
  return [
    sdk({
      type: "assistant",
      uuid: `vis-a${n}`,
      message: {
        id: `vis-m${n}`,
        content: [
          ...(step.before ? [{ type: "text", text: step.before }] : []),
          {
            type: "tool_use",
            id: step.id,
            name: VISUAL_TOOL_NAME,
            input: {
              html: step.html,
              title: step.title,
              ...(step.wide ? { wide: true } : {}),
            },
          },
        ],
      },
    }),
    ev("visual_check", {
      checkId: step.id,
      toolUseId: step.id,
      html: step.html,
      title: step.title,
      wide: step.wide,
    }),
  ];
}

/** The conversation up to the first visual's check. */
export function visualStart(): ChatEvent[] {
  return [
    ev("user_sent", {
      text: "Montre-moi le gain de la reprise rapide, puis propose des places pour la saisie.",
      images: 0,
    }),
    ...callEvents(STEPS[0], 0),
  ];
}

/**
 * What follows a visual's report: its result as the server words it, the
 * check's end, then the next call, or Claude's reply after the last one.
 */
export function visualNext(checkId: string, report: VisualReport): ChatEvent[] {
  const at = STEPS.findIndex((s) => s.id === checkId);
  if (at < 0) return [];
  const { text, isError } = visualResult(report, []);
  const done: ChatEvent[] = [
    ev("visual_checked", { checkId }),
    sdk({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: checkId,
            content: text,
            is_error: isError,
          },
        ],
      },
    }),
  ];
  const next = STEPS[at + 1];
  if (next) return [...done, ...callEvents(next, at + 1)];
  return [
    ...done,
    sdk({
      type: "assistant",
      uuid: "vis-end",
      message: {
        id: "vis-mend",
        content: [
          {
            type: "text",
            text: "La reprise rapide divise le temps de retour par dix sur les longues conversations. Pour la saisie, choisis une maquette : elle arrive dans ta saisie, ajoute un mot si besoin.",
          },
        ],
      },
    }),
    sdk({ type: "result", subtype: "success", duration_ms: 21_000 }),
  ];
}
