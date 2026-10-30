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
};

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
};

const [name, out] = process.argv.slice(2);
const scenario = name ? scenarios[name] : undefined;
if (!scenario || !out) {
  console.error(`usage: node record.ts <${Object.keys(scenarios).join("|")}> <out.jsonl>`);
  process.exit(2);
}

const cwd = mkdtempSync(join(tmpdir(), "arkadia-chat-"));
writeFileSync(join(cwd, "note.txt"), "Arkadia est un terminal pour Claude Code, avec une vue chat.\n");
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
  if (kept) appendFileSync(out, `${JSON.stringify(kept)}\n`);
  if (event.type === "sdk" && event.message.session_id) sessionId = event.message.session_id;
  if (event.type === "permission") {
    send({ type: "answer", chatId, requestId: event.requestId, result: scenario.answer(event.toolName, event.input) });
  }
  if (event.type === "sdk" && event.message.type === "result") {
    // The turn is over: fetch its history as the page would on reopening.
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
