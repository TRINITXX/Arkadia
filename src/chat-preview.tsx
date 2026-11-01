import { PromptButtonsContext } from "@/lib/chat/promptButtonsContext";
import type { ToolbarButton } from "@/types";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatView } from "@/components/chat/chat-view";
import { setBridge } from "@/lib/bridge";
import { EMPTY_DRAFT, type ChatDraft } from "@/lib/chat/chatDrafts";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";
import type { DictationEnd, VoiceStatus } from "@/lib/useHiddenVoice";
import "@/styles/app.css";
import {
  contentNotices,
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
import pastedPng from "../src-tauri/icons/128x128@2x.png?inline";
import { attachDraft, attachEvents } from "@/chat-preview-attach";
import { tallEvents, visualNext, visualStart } from "@/chat-preview-visuals";
import { sleepScenarios } from "@/chat-preview-sleep";
import { createVisualProbe } from "@/lib/chat/chatVisualDom";

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
              text: `Corrigé : la barre prend la version nette. Les deux tailles servies :\n\n- ${icons}\\Square310x310Logo.png\n- ${icons}\\Square150x150Logo.png`,
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

/** A request of mine on top of a recorded state: the inputs' panels. */
const withRequest = (
  state: ChatState,
  request: ChatState["requests"][number],
): ChatState => ({ ...state, requests: [request] });

const SCENARIOS: Record<string, () => ChatState> = {
  tools: () => replay(parse(tools)),
  // Claude's thinking before its work (the recording has none).
  thoughts: () => {
    const s = replay(parse(tools));
    const at = s.items.findIndex((i) => i.kind === "tool");
    const items = [...s.items];
    items.splice(at, 0, {
      kind: "thinking",
      id: "preview-thinking",
      text: "**Lire avant d'écrire**\n\nJe lis note.txt d'abord : le résumé doit reprendre ses mots, pas les miens. Puis une seule phrase dans resume.txt.",
      streaming: false,
    });
    return { ...s, items };
  },
  live: () => replay(parse(tools), firstTextDelta),
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
  days: () => replay(dayEvents()),
  older: () => replay([...olderStart(), ...dayEvents()]),
  empty: () => EMPTY_CHAT,
  long: () => replay(longLog(parse(tools), 40)),
  // Real diffs, a command's marks, a cut reply and Claude Code's notices.
  content: () => replay([...parse(content), ...contentNotices()]),
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

/** /resume's and /rewind's lists, without a chat server. */
const ago = (min: number) => Date.now() - min * 60_000;
const PREVIEW_SLASH: SlashActions = {
  sessions: async () => [
    {
      sessionId: state.sessionId ?? "",
      title: state.title ?? "",
      lastModified: ago(1),
      gitBranch: "master-lab",
    },
    {
      sessionId: "s2",
      title: "Menu des commandes du chat",
      lastModified: ago(48),
      gitBranch: "master-lab",
    },
    {
      sessionId: "s3",
      title: "Gel au survol du terminal",
      lastModified: ago(60 * 20),
      gitBranch: "master",
      open: true,
    },
    {
      sessionId: "s4",
      title: "Notifications compactes « projet · onglet »",
      lastModified: ago(60 * 26),
      gitBranch: "master",
    },
    {
      sessionId: "s5",
      title: "App iPhone : reprise du dernier onglet",
      lastModified: ago(60 * 24 * 3),
      gitBranch: "master",
    },
    {
      sessionId: "s6",
      title: "Recherche IA des sessions",
      lastModified: ago(60 * 24 * 12),
      gitBranch: "master",
    },
  ],
  rewindPoints: async () =>
    [
      ["Lis note.txt, puis crée resume.txt avec une phrase qui le résume.", 42],
      ["Ajoute aussi la date du jour en haut du fichier.", 31],
      ["Non, mets la date en bas plutôt, au format 31/10/2026.", 12],
      ["Parfait. Relis le tout et dis-moi s'il reste une faute.", 2],
    ].map(([text, min], i) => ({
      uuid: `p${i}`,
      text: String(text),
      timestamp: new Date(ago(Number(min))).toISOString(),
    })),
  resume: async () => null,
  rewind: () => null,
};

const params = new URLSearchParams(window.location.search);
const name = params.get("s") ?? "tools";
/** What the preview's mic « hears », word by word. */
const PREVIEW_DICTATION =
  "Refais la vue lecture pour qu'elle garde la place du lecteur quand un message arrive.";
const nowSeconds = Math.round(Date.now() / 1000);
const state = {
  ...(SCENARIOS[name] ?? SCENARIOS.tools)(),
  title: "Refonte de la vue lecture",
  gitBranch: "master-lab",
  // The status line's figures: the recorded resets are long past.
  context: { percentage: 45.2 },
  limits: {
    fiveHour: { utilization: 0.37, resetsAt: nowSeconds + 135 * 60 + 30 },
    sevenDay: { utilization: 0.12, resetsAt: nowSeconds + 4 * 86_400 },
  },
};

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
    start: () => {
      setHeard(0);
      setStatus("listening");
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
      <ChatView
        key={mount}
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
