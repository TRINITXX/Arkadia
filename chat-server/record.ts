// Records real chat-server conversations as fixtures for the page's tests:
// `node record.ts <scenario> <out.jsonl>`. Each scenario runs in a scratch
// folder with a small model; permission requests get scripted answers. Runs
// a real Claude Code on the main account, so keep the prompts short.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

type Scenario = {
  prompt: string;
  permissionMode?: string;
  model?: string;
  /** Scripted answer to a permission request. */
  answer: (toolName: string, input: Record<string, unknown>) => unknown;
  /** More files in the scratch folder. */
  files?: Record<string, string>;
  /** Recorded until the background work ends too (agents, shells, workflows). */
  waitBackground?: boolean;
};

/** A workflow of two phases for `activity`: two readers, then a synthesis. */
const ACTIVITY_WORKFLOW = `export const meta = {
  name: 'revue-rapide',
  description: 'Relit note.txt sous deux angles puis conclut',
  phases: [{ title: 'Lire', detail: 'deux lecteurs' }, { title: 'Conclure', detail: 'une synthèse' }],
}
phase('Lire')
const lus = await parallel([
  () => agent("Lance la commande Bash : node -e \"setTimeout(()=>console.log('lu'),12000)\" puis lis note.txt et réponds en 5 mots.", { label: 'lecteur-fond', phase: 'Lire', effort: 'low' }),
  () => agent("Lis note.txt puis lance la commande Bash : node -e \"setTimeout(()=>console.log('lu'),18000)\" et réponds en 5 mots.", { label: 'lecteur-forme', phase: 'Lire', effort: 'low' }),
])
phase('Conclure')
return await agent('Réponds en une phrase : ' + lus.filter(Boolean).join(' / '), { label: 'synthese', phase: 'Conclure', effort: 'low' })`;

const allow = (input: Record<string, unknown>) => ({
  behavior: "allow",
  updatedInput: input,
});

const scenarios: Record<string, Scenario> = {
  tools: {
    prompt:
      "Lis note.txt, puis crée resume.txt avec une phrase qui le résume. Réponds ensuite en une ligne.",
    permissionMode: "acceptEdits",
    answer: (_t, input) => allow(input),
  },
  question: {
    prompt:
      "Utilise l'outil AskUserQuestion pour me demander ma couleur préférée (options Rouge et Bleu), puis réponds en une ligne avec ma réponse.",
    answer: (toolName, input) => {
      if (toolName !== "AskUserQuestion") return allow(input);
      const questions = input.questions as { question: string }[];
      return {
        behavior: "allow",
        updatedInput: {
          ...input,
          answers: Object.fromEntries(questions.map((q) => [q.question, "Bleu"])),
        },
      };
    },
  },
  plan: {
    prompt:
      "Tu es en mode plan. Écris un plan en 2 étapes pour créer hello.txt contenant « bonjour », puis soumets-le avec l'outil ExitPlanMode. Ne pose aucune question. Une fois le plan accepté, exécute-le.",
    permissionMode: "plan",
    model: "claude-sonnet-5-5",
    answer: (_t, input) => allow(input),
  },
  subagent: {
    prompt:
      "Lance un sous-agent avec l'outil Agent (type general-purpose) qui liste les fichiers de ce dossier, puis réponds en une ligne avec ce qu'il a trouvé.",
    permissionMode: "acceptEdits",
    answer: (_t, input) => allow(input),
  },
  // Real diffs (an Edit, a Write over a file) and a command's streams apart.
  content: {
    prompt:
      "Fais exactement ceci, sans commentaire : 1) lis a.txt puis, avec Edit, remplace la ligne « quatre » par « QUATRE » ; 2) lis b.txt puis réécris-le avec Write : « alpha\\nBETA\\ngamma\\ndelta\\n » ; 3) lance avec Bash : echo sortie; echo attention 1>&2 ; 4) lance avec Bash : echo rate; exit 3. Puis réponds « Fait. »",
    permissionMode: "acceptEdits",
    answer: (_t, input) => allow(input),
    files: {
      "a.txt": "un\ndeux\ntrois\nquatre\ncinq\nsix\nsept\nhuit\nneuf\ndix\nonze\ndouze\n",
      "b.txt": "alpha\nbeta\ngamma\n",
    },
  },
};

// Background work: a shell, two subagents and a workflow at once (live cards).
scenarios.activity = {
  prompt: `Fais ces trois choses tout de suite, sans attendre leur fin, puis réponds « lancé » :
1) Lance avec Bash, run_in_background: true : for i in $(seq 1 40); do echo "étape $i/40"; sleep 1; done
2) Lance deux sous-agents avec l'outil Agent, run_in_background: true, subagent_type general-purpose : description « Compter les lignes », prompt « Lance au premier plan la commande Bash : node -e "setTimeout(()=>console.log(3),15000)" puis réponds juste : 3 » ; description « Résumer la note », prompt « Lis note.txt, puis lance au premier plan la commande Bash : node -e "setTimeout(()=>console.log('ok'),20000)", puis résume note.txt en 5 mots ».
3) Appelle l'outil Workflow avec exactement ce script (paramètre script) :

${ACTIVITY_WORKFLOW}`,
  permissionMode: "acceptEdits",
  answer: (_t, input) => allow(input),
  waitBackground: true,
};

const [name, out] = process.argv.slice(2);
const scenario = name ? scenarios[name] : undefined;
if (!scenario || !out) {
  console.error(`usage: node record.ts <${Object.keys(scenarios).join("|")}> <out.jsonl>`);
  process.exit(2);
}

const cwd = mkdtempSync(join(tmpdir(), "arkadia-chat-"));
writeFileSync(join(cwd, "note.txt"), "Arkadia est un terminal pour Claude Code, avec une vue chat.\n");
for (const [file, text] of Object.entries(scenario.files ?? {})) writeFileSync(join(cwd, file), text);
writeFileSync(out, "");

// A Lab pane id keeps the user's hooks off the daily notifications.
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
  env[k] = v;
}
const server = spawn(process.execPath, [join(import.meta.dirname, "server.ts")], {
  env,
  stdio: ["pipe", "pipe", "inherit"],
});
const chatId = "rec";
const send = (cmd: unknown) => server.stdin.write(`${JSON.stringify(cmd)}\n`);
let sessionId = "";
/** The live background set (`background_tasks_changed`). */
let background = new Set<string>();
const asked = new Set<string>();

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * What the tests need, nothing personal: no hook output (it carries the
 * user's context), and an init message without tools, plugins or skills.
 */
function sanitized(event: { type: string; message?: Record<string, unknown> }) {
  const m = event.message;
  if (event.type !== "sdk" || !m) return event;
  if (m.type === "system" && String(m.subtype).startsWith("hook_")) return null;
  if (m.type === "system" && m.subtype === "init") {
    const { type, subtype, model, permissionMode, session_id, uuid, slash_commands } = m;
    return {
      ...event,
      message: { type, subtype, model, permissionMode, session_id, uuid, slash_commands },
    };
  }
  return event;
}

createInterface({ input: server.stdout }).on("line", (line) => {
  const event = JSON.parse(line);
  const kept = sanitized(event);
  // Skill descriptions in the command list can name the user's addresses.
  if (kept) appendFileSync(out, `${JSON.stringify(kept).replace(EMAIL, "user@example.com")}\n`);
  if (event.type === "sdk" && event.message.session_id) sessionId = event.message.session_id;
  if (event.type === "permission") {
    send({ type: "answer", chatId, requestId: event.requestId, result: scenario.answer(event.toolName, event.input) });
  }
  if (event.type === "sdk" && event.message.subtype === "background_tasks_changed") {
    const tasks = event.message.tasks as { task_id: string; task_type: string }[];
    background = new Set(tasks.map((t) => t.task_id));
    // A shell's output, as the shells list asks it.
    for (const t of tasks) {
      if (t.task_type === "local_bash" && !asked.has(t.task_id)) {
        asked.add(t.task_id);
        setTimeout(() => send({ type: "task_output", chatId, taskId: t.task_id }), 6000);
      }
    }
  }
  if (event.type === "sdk" && event.message.type === "result") {
    // The turn is over: fetch its history as the page would on reopening.
    // With background work, the turn that follows its end does.
    if (!scenario.waitBackground || background.size === 0)
      send({ type: "history", chatId, sessionId, cwd, limit: 50 });
  }
  if (event.type === "history") {
    send({ type: "close", chatId });
    setTimeout(() => server.stdin.end(), 500);
  }
});

send({
  type: "start",
  chatId,
  cwd,
  model: scenario.model ?? "claude-haiku-5-5",
  permissionMode: scenario.permissionMode,
  env: { ARKADIA_PANE_ID: randomUUID(), ARKADIA_LAB: "1" },
});
send({ type: "send", chatId, text: scenario.prompt });
server.on("exit", (code) => {
  console.error(`server exited ${code}; cwd ${cwd}`);
});
