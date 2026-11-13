import { PromptButtonsContext } from "@/lib/chat/promptButtonsContext";
import type { ToolbarButton } from "@/types";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatView } from "@/components/chat/chat-view";
import { setBridge } from "@/lib/bridge";
import { EMPTY_DRAFT, type ChatDraft } from "@/lib/chat/chatDrafts";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import {
  EMPTY_CHAT,
  reduceChat,
  type ChatItem,
  type ChatState,
} from "@/lib/chat/chatState";
import type { DictationEnd, VoiceStatus } from "@/lib/useHiddenVoice";
import "@/styles/app.css";
import {
  contentNotices,
  techReply,
  errorEvents,
  peerEvents,
  retryEvents,
  SUGGESTION,
} from "@/chat-preview-content";
import {
  dayEvents,
  grillEvents,
  installRemountMeasure,
  longLog,
  olderPage,
  olderStart,
  TALL_ROUND,
} from "@/chat-preview-ideas";
import type { StartupPhase } from "@/lib/chat/chatStartup";
import content from "../chat-server/fixtures/content.jsonl?raw";
import plan from "../chat-server/fixtures/plan.jsonl?raw";
import question from "../chat-server/fixtures/question.jsonl?raw";
import slash from "../chat-server/fixtures/slash.jsonl?raw";
import subagent from "../chat-server/fixtures/subagent.jsonl?raw";
import type { SlashActions } from "@/lib/chat/useSlashActions";
import { PREVIEW_SDK, sdkScenarios } from "@/chat-preview-sdk";
import {
  activityScenarios,
  PREVIEW_SHELL_OUTPUTS,
} from "@/chat-preview-activity";
import tools from "../chat-server/fixtures/tools.jsonl?raw";
import usageText from "../chat-server/fixtures/usage.txt?raw";
import pastedPng from "../src-tauri/icons/128x128@2x.png?inline";
import { attachDraft, attachEvents } from "@/chat-preview-attach";
import { tallEvents, visualNext, visualStart } from "@/chat-preview-visuals";
import { sleepScenarios } from "@/chat-preview-sleep";
import { rememberPastes } from "@/lib/chat/chatPastes";
import { createVisualProbe } from "@/lib/chat/chatVisualDom";
import { AccountsPanel } from "@/components/AccountsPanel";
import { publishAccountQuota } from "@/lib/accountQuota";
import { modelBlockKey, type Account } from "@/lib/accounts";
import {
  creditsScenarios,
  onCredits,
  PREVIEW_ACCOUNT_ID,
  setupCreditsPreview,
} from "@/chat-preview-credits";

/**
 * Dev-only page (`/chat-preview.html?s=<scenario>`): the chat view fed with
 * conversations recorded by `chat-server/record.ts`, for screenshots without
 * the app. The recorder asks for the history after the turn: left out here.
 * The mic plays a dictation without Claude Code (`&voice=listening` starts
 * on it).
 */
const parse = (raw: string) =>
  raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ChatEvent)
    .filter((e) => e.type !== "history");

function replay(
  events: ChatEvent[],
  stop?: (e: ChatEvent) => boolean,
): ChatState {
  let state = EMPTY_CHAT;
  let now = Date.now() - 74_000;
  for (const e of events) {
    state = reduceChat(state, e, (now += 300));
    if (stop?.(e)) break;
  }
  return state;
}

const firstTextDelta = (e: ChatEvent) =>
  e.type === "sdk" &&
  (e.message.event as { delta?: { type?: string } } | undefined)?.delta
    ?.type === "text_delta";

const LAB = "C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia-lab";
/** This repo: the only folder Vite serves files from. */
const REPO = "C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia";

/** A file of the worktree as Vite serves it (the app reads it over IPC). */
const fsUrl = (path: string) => `/@fs/${encodeURI(path.replace(/\\/g, "/"))}`;
setBridge({
  invoke: async <T,>(cmd: string, args?: Record<string, unknown>) => {
    // A pasted path: a file Vite serves exists (`usePastedPaths`).
    if (cmd === "path_exists" && typeof args?.path === "string") {
      const res = await window.fetch(fsUrl(args.path), { method: "HEAD" });
      const html = res.headers.get("content-type")?.startsWith("text/html");
      return (res.ok && !html) as T;
    }
    const path = typeof args?.path === "string" ? args.path : "";
    if (cmd !== "read_image_bytes" || !path)
      throw new Error(`${cmd} : absent de l'aperçu`);
    const res = await window.fetch(fsUrl(path));
    // A missing file comes back as the page: no image, as in the app.
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/"))
      throw new Error(`${res.status}`);
    return (await res.arrayBuffer()) as unknown as T;
  },
  listen: async () => () => {},
  openUrl: async () => {},
  mediaUrl: fsUrl,
});

/** Code in both messages: inline, a highlighted block, a long one. */
function codeEvents(): ChatEvent[] {
  const fence = "```";
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: `Pourquoi \`npm run dev\` plante ? Voici l'erreur :\n\n${fence}\nError: Cannot find module 'vite'\n${fence}`,
      images: 0,
    },
    {
      type: "sdk",
      chatId: "preview",
      message: {
        type: "assistant",
        uuid: "code-a1",
        message: {
          id: "code-m1",
          content: [
            {
              type: "text",
              text: [
                "Le paquet `vite` manque dans `node_modules` : l'installation s'est arrêtée avant la fin. Réinstalle, puis relance :",
                "",
                `${fence}bash`,
                "rm -r node_modules",
                "pnpm install --frozen-lockfile",
                "pnpm dev",
                fence,
                "",
                "Le script qui vérifie la version de Node avant le lancement :",
                "",
                `${fence}ts`,
                "export function checkNode(min = 20): void {",
                '  const major = Number(process.versions.node.split(".")[0]);',
                '  if (major < min) throw new Error(`Node ${min}+ requis, trouvé ${process.versions.node} (mets à jour avec "winget upgrade OpenJS.NodeJS.LTS" puis rouvre le terminal)`);',
                "}",
                fence,
              ].join("\n"),
            },
          ],
        },
      },
    },
    {
      type: "sdk",
      chatId: "preview",
      message: { type: "result", subtype: "success", duration_ms: 12_000 },
    },
  ];
}

/** A pasted image and image files named by both sides: the strips. */
function imageEvents(): ChatEvent[] {
  const [, mediaType = "image/png", data = ""] =
    /^data:([^;]+);base64,(.*)$/.exec(pastedPng) ?? [];
  const icons = `${LAB}\\src-tauri\\icons`;
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: `Le logo est flou dans la barre (capture collée). Compare avec \`${icons}\\icon.png\`.`,
      images: 1,
      pasted: [{ mediaType, data }],
    },
    // A series of calls, each worded as the display mod does.
    {
      type: "sdk",
      chatId: "preview",
      message: {
        type: "assistant",
        uuid: "img-t1",
        message: {
          id: "img-m0",
          content: [
            ["t1", "Grep", { pattern: "logo-bar" }],
            [
              "t2",
              "Read",
              { file_path: `${LAB}\\src\\components\\Toolbar.tsx` },
            ],
            [
              "t3",
              "Bash",
              {
                command: "pnpm tauri icon",
                description: "Régénérer les icônes",
              },
            ],
            ["t4", "Bash", { command: "pnpm test --run icons" }],
          ].map(([id, name, input]) => ({ type: "tool_use", id, name, input })),
        },
      },
    },
    {
      type: "sdk",
      chatId: "preview",
      message: {
        type: "user",
        message: {
          content: ["t1", "t2", "t3", "t4"].map((id) => ({
            type: "tool_result",
            tool_use_id: id,
            content: "ok",
          })),
        },
      },
    },
    {
      type: "sdk",
      chatId: "preview",
      message: {
        type: "assistant",
        uuid: "img-a1",
        message: {
          id: "img-m1",
          content: [
            {
              type: "text",
              text: `Corrigé : la barre prend la version nette. Les deux tailles servies :\n\n- ${icons}\\Square310x310Logo.png\n- ${icons}\\Square150x150Logo.png\n\nCaptures : ${icons}\\icon.png ${icons}\\Square44x44Logo.png ${icons}\\128x128.png\n\n\`\`\`\ncopy ${icons}\\32x32.png\n\`\`\`\n\nFichiers à ouvrir :\n\n- Règles de relecture : ${LAB}\\REVIEW.md\n- Pas encore écrit : ${LAB}\\docs\\brouillon-absent.md\n- Réglages : \`${LAB}\\package.json\``,
            },
          ],
        },
      },
    },
    {
      type: "sdk",
      chatId: "preview",
      message: { type: "result", subtype: "success", duration_ms: 48_000 },
    },
  ];
}

/** The « Récit » scenario: two exchanges, the second under way. */
function recitState(): ChatState {
  const now = Date.now();
  let n = 0;
  const id = (p: string) => `recit-${p}-${n++}`;
  const user = (text: string): ChatItem => ({
    kind: "user",
    id: id("u"),
    text,
    images: 0,
    at: now - 300_000 + n * 1000,
  });
  const say = (text: string): ChatItem => ({
    kind: "text",
    id: id("t"),
    text,
    streaming: false,
  });
  const think = (text: string): ChatItem => ({
    kind: "thinking",
    id: id("th"),
    text,
    streaming: false,
  });
  const run = (name: string, input: JsonObject, done = true): ChatItem => ({
    kind: "tool",
    id: id("tool"),
    name,
    input,
    ...(done ? { result: { text: "ok", isError: false } } : {}),
  });
  const items: ChatItem[] = [
    user("Les chemins de fichiers prennent toute la ligne, mets juste le nom."),
    think(
      "The paths come from MarkdownContent. I'll look for where it draws them before touching anything.",
    ),
    run("Grep", { pattern: "modern-path" }),
    run("Read", { file_path: "src/components/modern/MarkdownContent.tsx" }),
    say("Je cherche où le chat dessine les chemins de fichiers."),
    run("Read", { file_path: "src/lib/filePaths.ts" }),
    think(
      "I'll wrap each one found on disk in a tag and keep the folder hidden, so copying the sentence still gives the full path.",
    ),
    say("Je remplace chaque chemin par une étiquette avec le nom du fichier."),
    run("Edit", {
      file_path: "src/components/modern/MarkdownContent.tsx",
      old_string: "a",
      new_string: "b",
    }),
    run("Bash", { command: "npx vitest run", description: "lancer les tests" }),
    // The images its tools look at or make: on its line (07/11/2026).
    run("mcp__playwright__browser_take_screenshot", {
      filename: `${REPO}\\src-tauri\\icons\\Square150x150Logo.png`,
    }),
    run("Read", { file_path: `${REPO}\\src-tauri\\icons\\icon.png` }),
    say(
      "✅ Les chemins de fichiers s'affichent en étiquette avec leur nom. Un clic ouvre le fichier.\n\n⏳",
    ),
    { kind: "turn", id: id("turn"), durationMs: 252_000, tools: 5, files: 1 },
    user("… la question suivante. Donc, il faut changer ça."),
    think(
      'I\'m checking which sheet the user means: the one capped at max-height with a scroll, which holds the questions I ask in text, with multi-line options and "why" descriptions. The user said two answers wrapped over several lines so they had to scroll in the menu.',
    ),
    run("Grep", { pattern: "chat-sheet" }),
    run("Read", { file_path: "src/components/chat/chat-css.ts" }),
    say(
      "Je regarde le panneau de questions du chat (celui qui s'ouvre au-dessus de la saisie) pour corriger la hauteur et la touche Entrée.",
    ),
    think(
      "I'm switching chat-root to size containment, which looks fine for its absolute inset-0 layout. But size containment also brings in layout containment, which makes the element the containing block for absolute and fixed descendants.",
    ),
    run("Grep", { pattern: "chat-root" }),
    run("Bash", { command: "git diff", description: "relire le diff" }),
    say(
      "Je corrige deux choses dans le panneau « Questions de Claude » : sa hauteur plafonnée à 420 px et la touche Entrée du champ libre.",
    ),
    think(
      "The earlier diagnostic might be out of date since it predates the Enter key change. Next I'll write tests for it, adding them to chatQuestionRound.test.ts.",
    ),
    run(
      "Edit",
      {
        file_path: "src/lib/chat/chatQuestionRound.test.ts",
        old_string: "a",
        new_string: "b",
      },
      false,
    ),
  ];
  return { ...EMPTY_CHAT, items, working: true, turnStartedAt: now - 120_000 };
}

/** A request of mine on top of a recorded state: the inputs' panels. */
const withRequest = (
  state: ChatState,
  request: ChatState["requests"][number],
): ChatState => ({ ...state, requests: [request] });

/** `?s=paste-history`'s pasted text. */
const PREVIEW_REPORT =
  "Bonjour Alexis, voici le rapport du serveur de cette nuit avec toutes les erreurs relevées par le moniteur.";

const SCENARIOS: Record<string, () => ChatState> = {
  tools: () => replay(parse(tools)),
  // Claude's thinking before its work (the recording has none).
  thoughts: () => {
    const s = replay(parse(tools));
    const at = s.items.findIndex((i) => i.kind === "tool");
    const items = [...s.items];
    // Two blocks: the first hidden, the last cut to two lines.
    items.splice(
      at,
      0,
      {
        kind: "thinking",
        id: "preview-thinking-0",
        text: "**Comprendre la demande**\n\nIl veut un résumé d'une phrase.",
        streaming: false,
      },
      {
        kind: "thinking",
        id: "preview-thinking",
        text: "**Lire avant d'écrire**\n\nJe lis note.txt d'abord : le résumé doit reprendre ses mots, pas les miens. Puis une seule phrase dans resume.txt, sans reformuler ce qu'il a déjà dit.\n\nSi la note parle de plusieurs sujets, je garde celui du titre et je laisse les autres de côté : une phrase ne tient pas trois idées, et il relira vite. Je vérifie ensuite que le fichier existe bien avant de l'écraser.",
        streaming: false,
      },
    );
    return { ...s, items };
  },
  // A reply that only says what comes next, before Claude's work: a step.
  narration: () => {
    const s = replay(parse(tools));
    const at = s.items.findIndex((i) => i.kind === "tool");
    const items = [...s.items];
    items.splice(at, 0, {
      kind: "text",
      id: "preview-step",
      text: "Je lis d'abord note.txt, puis j'écris le résumé dans resume.txt.",
      streaming: false,
    });
    return { ...s, items };
  },
  live: () => replay(parse(tools), firstTextDelta),
  // /usage's real answer (03/11/2026) as its card shows it.
  usage: () => {
    const s = replay(parse(tools));
    return {
      ...s,
      items: [
        ...s.items,
        {
          kind: "command",
          id: "preview-usage",
          name: "usage",
          args: "",
          absorbed: [],
          output: usageText.trim(),
        },
      ],
    };
  },
  // « Récit » (02/11/2026): a past exchange, its thinking and tools behind
  // the icons of Claude's replies; the one under way with its tool lines and
  // its latest thought in full (the texts of the user's screenshot).
  recit: () => recitState(),
  // Claude at work on a task list (TodoWrite): its steps in the live line.
  tasks: () => {
    const s = replay(parse(tools), firstTextDelta);
    const todos = [
      ["Lire le site vtc-planner.fr", "completed"],
      ["Caler les 30 questions", "completed"],
      ["Écrire le script du relevé", "in_progress"],
      ["Lancer le relevé sur Claude et GPT", "pending"],
      ["Comparer et écrire le rapport", "pending"],
    ].map(([content, status]) => ({ content, status, activeForm: content }));
    return {
      ...s,
      items: [
        ...s.items,
        {
          kind: "tool",
          id: "preview-todos",
          name: "TodoWrite",
          input: { todos },
          result: { text: "ok", isError: false },
        },
      ],
    };
  },
  // Two questions: the terminal's tabs.
  questions: () =>
    withRequest(replay(parse(tools)), {
      requestId: "q2",
      toolName: "AskUserQuestion",
      toolUseId: "q2",
      input: {
        questions: [
          {
            question: "Quel format pour le résumé ?",
            header: "Format",
            options: [
              { label: "Markdown", description: "Titres et listes" },
              { label: "Texte brut" },
            ],
          },
          {
            question: "Où l'enregistrer ?",
            header: "Où",
            options: [{ label: "Dans le projet" }, { label: "Sur le bureau" }],
          },
        ],
      },
    }),
  // A command Claude Code suggests to allow from now on (live check, 31/10).
  permission: () =>
    withRequest(replay(parse(tools)), {
      requestId: "p1",
      toolName: "Bash",
      toolUseId: "p1",
      input: { command: "pnpm add lodash", description: "Ajouter lodash" },
      description: "Ajouter lodash",
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "pnpm add:*" }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
    }),
  // A long text sent from a tag: its text on hover scrolls (`ChatPasteChip`).
  paste: () => {
    const log = Array.from(
      { length: 60 },
      (_, i) =>
        `12:${String(i).padStart(2, "0")}:07 [remote] phone connected, then left after ${i + 1} s`,
    ).join("\n");
    rememberPastes([log]);
    return replay([
      {
        type: "user_sent",
        chatId: "preview",
        text: `Regarde ce journal :\n\n${log}\n\nPourquoi ça boucle ?`,
        images: 0,
      },
    ]);
  },
  // A resumed session's message: Claude Code's `<pasted_content>` tags
  // read back as a paste's tag (`unwrapPastes`).
  "paste-history": () =>
    reduceChat(
      EMPTY_CHAT,
      {
        type: "history",
        chatId: "preview",
        truncated: false,
        messages: [
          {
            type: "user",
            uuid: "preview-paste-history",
            message: {
              content: [
                {
                  type: "text",
                  text:
                    "Résume ce rapport en une ligne :\n\n" +
                    `<pasted_content id="d947">\n${PREVIEW_REPORT}\n` +
                    '</pasted_content id="d947">\n',
                },
              ],
            },
          },
        ],
      },
      0,
    ),
  // A message typed while Claude works: grey until Claude Code takes it.
  queued: () =>
    reduceChat(
      replay(parse(tools), firstTextDelta),
      {
        type: "user_sent",
        chatId: "preview",
        text: "Ajoute aussi la date du jour en haut du fichier.",
        images: 0,
        uuid: "preview-queued",
      },
      Date.now(),
    ),
  question: () => replay(parse(question), (e) => e.type === "permission"),
  plan: () =>
    replay(
      parse(plan),
      (e) => e.type === "permission" && e.toolName === "ExitPlanMode",
    ),
  subagent: () => replay(parse(subagent)),
  // A long turn: its « Terminé en » line (the recording took 8 s).
  done: () =>
    replay(
      parse(tools).map((e) =>
        e.type === "sdk" && e.message.type === "result"
          ? { ...e, message: { ...e.message, duration_ms: 962_000 } }
          : e,
      ),
    ),
  // A subagent's command running: the live line's « agent · » step.
  step: () =>
    replay(
      parse(subagent),
      (e) =>
        e.type === "sdk" &&
        e.message.type === "assistant" &&
        Boolean(e.message.parent_tool_use_id),
    ),
  images: () => replay(imageEvents()),
  // Files as cards: sent, read by Claude, and waiting in the input.
  attach: () => replay(attachEvents()),
  code: () => replay(codeEvents()),
  // /context, /compact and /rename as cards (`&draft=/` opens the menu,
  // `&draft=/resume ` or `/rewind ` their panels); `clear`: after /clear.
  slash: () => {
    const events = parse(slash);
    const renamed = events.findIndex(
      (e) => e.type === "user_sent" && e.text.startsWith("/rename"),
    );
    return replay(
      events,
      (e) =>
        e.type === "sdk" &&
        e.message.type === "result" &&
        events.indexOf(e) > renamed,
    );
  },
  clear: () => replay(parse(slash)),
  // Ideas of 31/10: the answer sheet, day marks and cards, older messages,
  // an empty column (`&startup=starting|resuming|welcome`), a long chat.
  grill: () => replay(grillEvents()),
  grilltall: () => replay(grillEvents(TALL_ROUND)),
  days: () => replay(dayEvents()),
  older: () => replay([...olderStart(), ...dayEvents()]),
  empty: () => EMPTY_CHAT,
  long: () => replay(longLog(parse(tools), 40)),
  // Real diffs, a command's marks, a cut reply and Claude Code's notices.
  content: () => replay([...parse(content), ...contentNotices()]),
  // A report's « Détail technique », greyed under the reply.
  tech: () => replay(techReply()),
  errors: () => replay(errorEvents()),
  // The live line's « Claude réessaie », its wait counted from now.
  retry: () => {
    const state = replay(retryEvents());
    return state.retry
      ? { ...state, retry: { ...state.retry, at: Date.now() } }
      : state;
  },
  suggest: () => replay([...parse(tools), SUGGESTION]),
  // Another session's message, in its own frame.
  peer: () => replay([...parse(tools), ...peerEvents()]),
  // Claude's visuals, checked by the real probe as they come (`chat-preview-visuals`).
  visuals: () => replay(visualStart()),
  // One tall screenshot and its caption: the card fits the pane's height.
  tall: () => replay(tallEvents()),
};
// SDK settings: model, effort and fast mode chips, MCP chip and requests,
// a running hook, plugin errors, a cautious permission, a message withdrawn.
Object.assign(
  SCENARIOS,
  sdkScenarios(SCENARIOS.tools, SCENARIOS.subagent, SCENARIOS.queued),
);
// Live activity: agent cards, the workflow card, the shells chip.
Object.assign(SCENARIOS, activityScenarios());
// Chats at rest: asleep, `!` commands, resumed after the server stopped.
Object.assign(SCENARIOS, sleepScenarios(SCENARIOS.tools, SCENARIOS.live));
// A request the session limit refuses (`&credits=banner|exhausted`).
Object.assign(SCENARIOS, creditsScenarios(SCENARIOS.tools));

/** /resume's and /rewind's lists, without a chat server. */
const ago = (min: number) => Date.now() - min * 60_000;
const PREVIEW_SLASH: SlashActions = {
  sessions: async () => [
    {
      sessionId: state.sessionId ?? "",
      title: state.title ?? "",
      lastModified: ago(1),
      gitBranch: "master-lab",
      size: 2_340_000,
    },
    {
      sessionId: "s2",
      title: "Menu des commandes du chat",
      lastModified: ago(48),
      gitBranch: "master-lab",
      size: 18_700_000,
    },
    {
      sessionId: "s3",
      title: "Gel au survol du terminal",
      lastModified: ago(60 * 20),
      gitBranch: "master",
      size: 153_000_000,
      open: true,
    },
    {
      sessionId: "s4",
      title: "Notifications compactes « projet · onglet »",
      lastModified: ago(60 * 26),
      gitBranch: "master",
      size: 640_000,
    },
    {
      sessionId: "s5",
      title: "App iPhone : reprise du dernier onglet",
      lastModified: ago(60 * 24 * 3),
      gitBranch: "master",
      size: 8_560_000,
    },
    {
      sessionId: "s6",
      title: "Recherche IA des sessions",
      lastModified: ago(60 * 24 * 12),
      gitBranch: "master",
      size: 31_200_000,
    },
  ],
  rewindPoints: async () =>
    [
      ["Lis note.txt, puis crée resume.txt avec une phrase qui le résume.", 42],
      ["Ajoute aussi la date du jour en haut du fichier.", 31],
      ["Non, mets la date en bas plutôt, au format 31/10/2026.", 12],
      ["Parfait. Relis le tout et dis-moi s'il reste une faute.", 2],
    ]
      .map(([text, min], i) => ({
        uuid: `p${i}`,
        text: String(text),
        timestamp: new Date(ago(Number(min))).toISOString(),
      }))
      .concat(
        // `?s=paste-history`'s message, out of its tags as the server reads it.
        name === "paste-history"
          ? [
              {
                uuid: "preview-paste-history",
                text: `Résume ce rapport en une ligne :\n\n${PREVIEW_REPORT}`,
                timestamp: new Date(ago(1)).toISOString(),
              },
            ]
          : [],
      ),
  resume: async () => null,
  rewind: () => null,
};

const params = new URLSearchParams(window.location.search);
const name = params.get("s") ?? "tools";
/** What the preview's mic « hears », word by word. */
const PREVIEW_DICTATION =
  "Refais la vue lecture pour qu'elle garde la place du lecteur quand un message arrive.";
const nowSeconds = Math.round(Date.now() / 1000);
// `&credits=pill`: on the API credits, no quotas.
const state = onCredits({
  ...(SCENARIOS[name] ?? SCENARIOS.tools)(),
  title: "Refonte de la vue lecture",
  gitBranch: "master-lab",
  // The status line's figures: the recorded resets are long past.
  context: { percentage: 45.2 },
  limits: {
    fiveHour: { utilization: 0.37, resetsAt: nowSeconds + 135 * 60 + 30 },
    sevenDay: { utilization: 0.12, resetsAt: nowSeconds + 4 * 86_400 },
    models: [
      { model: "Fable", utilization: 0.33, resetsAt: nowSeconds + 4 * 86_400 },
    ],
  },
});

/** The accounts of the user's screenshot of 12/11/2026 (`&accounts=1`). */
const previewAccount = (
  id: string,
  label: string,
  color: string,
  five: [number, number],
  week: [number, number],
  fable: number,
): Account => ({
  id,
  label,
  customLabel: true,
  color,
  email: null,
  plan: null,
  loggedIn: true,
  stale: false,
  usage: {
    fiveHour: { pct: five[0], resetsAt: nowSeconds + five[1] * 60 },
    sevenDay: { pct: week[0], resetsAt: nowSeconds + week[1] * 3600 },
    models: [
      { model: "Fable", pct: fable, resetsAt: nowSeconds + week[1] * 3600 },
    ],
    updatedAt: Date.now(),
    source: "live",
  },
});
const PREVIEW_ACCOUNTS = [
  previewAccount("main", "1 Perso", "#a78bfa", [100, 135], [11, 165], 14),
  previewAccount("b", "2 Boutique", "#f472b6", [100, 155], [73, 95], 58),
  previewAccount("c", "3 Équipe", "#22d3ee", [64, 65], [54, 66], 33),
];
// Account 2: a « Fable limit » refusal holds Fable till its 5-hour reset.
publishAccountQuota(PREVIEW_ACCOUNTS, {
  [modelBlockKey("b", "fable")]: Date.now() + 155 * 60_000,
});
// `&credits=…`: the API credits, and the limit's banner (`chat-preview-credits`).
setupCreditsPreview();

function Preview() {
  const [chat, setChat] = useState<ChatState>(state);
  /** Bumped to mount the view anew (`?s=long`). */
  const [mount, setMount] = useState(0);
  // `?s=long`: `window.__remount()` measures a long chat's return.
  useEffect(() => {
    if (name !== "long") return;
    installRemountMeasure(
      longLog(parse(tools), 40),
      (s, e) => reduceChat(s, e, Date.now()),
      EMPTY_CHAT,
      (s, anew) =>
        flushSync(() => {
          setChat({ ...state, ...s });
          if (anew) setMount((m) => m + 1);
        }),
    );
  }, []);
  const [draft, setDraft] = useState<ChatDraft>(() =>
    name === "attach"
      ? attachDraft(pastedPng)
      : { ...EMPTY_DRAFT, text: params.get("draft") ?? "" },
  );
  const [messagesOnly, setMessagesOnly] = useState(false);
  // `?s=visuals`: each page goes through the probe; its report answers the
  // call as the chat server would, and the next call follows.
  useEffect(() => {
    if (name !== "visuals") return;
    let live = true;
    const onEvent = createVisualProbe((_chatId, checkId, report) => {
      if (!live) return;
      const next = visualNext(checkId, report);
      setChat((s) =>
        next.reduce((acc, e) => reduceChat(acc, e, Date.now()), s),
      );
      for (const e of next) if (e.type === "visual_check") onEvent(e, false);
    });
    for (const e of visualStart())
      if (e.type === "visual_check") onEvent(e, false);
    return () => {
      live = false;
    };
  }, []);
  const [status, setStatus] = useState<VoiceStatus>(
    params.get("voice") === "listening" ? "listening" : "idle",
  );
  // The words come one by one while it listens, as the hidden field shows them.
  const [heard, setHeard] = useState(0);
  useEffect(() => {
    if (status !== "listening") return;
    const id = setInterval(() => setHeard((n) => n + 1), 350);
    return () => clearInterval(id);
  }, [status]);
  const voice = {
    status,
    interim:
      status === "idle"
        ? ""
        : PREVIEW_DICTATION.split(" ").slice(0, heard).join(" "),
    // Listening at once, as `useHiddenVoice` says: the question sheet's
    // field shows the words as they come (its text still lands in the
    // input: `stop` below writes the draft, no `redirectDictation`).
    start: () => {
      setHeard(0);
      setStatus("listening");
      return true;
    },
    stop: () => {
      setStatus("transcribing");
      return new Promise<DictationEnd>((resolve) =>
        setTimeout(() => {
          setDraft((d) => ({
            ...d,
            text: `${d.text}${PREVIEW_DICTATION}`,
          }));
          setStatus("idle");
          resolve({ ok: true });
        }, 3000),
      );
    },
  };
  return (
    <div style={{ position: "relative", height: "100%" }}>
      {params.get("accounts") === "1" && (
        <div
          style={{ position: "fixed", left: 16, bottom: 16, width: 300, zIndex: 30 }}
        >
          <AccountsPanel
            state={{ current: "main", max: 5, accounts: PREVIEW_ACCOUNTS }}
            onSelect={() => {}}
            onAdd={() => {}}
            onLogin={() => {}}
            onRename={() => {}}
            onRecolor={() => {}}
            onRemove={() => {}}
            openPanesByAccount={{}}
          />
        </div>
      )}
      <ChatView
        key={mount}
        paneId="preview"
        accountId={PREVIEW_ACCOUNT_ID}
        state={chat}
        agents={{}}
        cwd={"C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia-lab"}
        isActive
        onActivate={() => {}}
        onSend={() => {}}
        // Said in the console: Esc's checks read it (`chatLayers`).
        onInterrupt={() => console.info("[aperçu] interruption")}
        onAnswer={() => {}}
        onMode={() => {}}
        onModel={() => {}}
        onOpenAgent={() => {}}
        onRestart={() => {}}
        draft={draft}
        onDraft={setDraft}
        voice={voice}
        messagesOnly={messagesOnly}
        onMessagesOnly={setMessagesOnly}
        slashActions={PREVIEW_SLASH}
        sdkActions={{
          ...PREVIEW_SDK,
          // Said in the console: no chat server to write the file.
          openVisual: (_html, title) =>
            console.info("[aperçu] ouvrir dans le navigateur :", title),
        }}
        shellOutputs={PREVIEW_SHELL_OUTPUTS}
        onBackground={() => {}}
        // Said in the console: no chat server to stop a task.
        onStopTask={(taskId) => console.info("[aperçu] arrêt de", taskId)}
        // `&hidden=1`: as a hidden tab's view, its clocks stopped (`useChatShown`).
        hidden={params.get("hidden") === "1"}
        onBash={(command) => console.info("[aperçu] commande", command)}
        onStopBash={(id) => console.info("[aperçu] arrêt de la commande", id)}
        memoryKey="preview"
        startup={(params.get("startup") as StartupPhase) ?? null}
        onLoadOlder={
          name === "older"
            ? () =>
                setTimeout(
                  () => setChat((s) => reduceChat(s, olderPage(), Date.now())),
                  600,
                )
            : undefined
        }
      />
    </div>
  );
}

/** The prompt bar's buttons as the user set them (01/11/2026), for « Commandes ». */
const PREVIEW_COMMANDS: ToolbarButton[] = [
  ["commit", "/commit", "check", true],
  ["clear", "/clear", "x", true],
  ["compact", "/compact", "database", true],
  ["resume", "/resume", "play", true],
  ["fais", "Fais le", "check", true],
  ["continue", "Continue", "play", true],
].map(([id, label, icon, submit], order) => ({
  id: String(id),
  kind: "action" as const,
  label: String(label),
  icon: String(icon),
  command: String(label),
  submit: Boolean(submit),
  order,
}));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PromptButtonsContext.Provider value={PREVIEW_COMMANDS}>
      <Preview />
    </PromptButtonsContext.Provider>
  </React.StrictMode>,
);
