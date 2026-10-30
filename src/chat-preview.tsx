import React from "react";
import ReactDOM from "react-dom/client";
import { ChatView } from "@/components/chat/chat-view";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";
import "@/styles/app.css";
import plan from "../chat-server/fixtures/plan.jsonl?raw";
import question from "../chat-server/fixtures/question.jsonl?raw";
import subagent from "../chat-server/fixtures/subagent.jsonl?raw";
import tools from "../chat-server/fixtures/tools.jsonl?raw";

/**
 * Dev-only page (`/chat-preview.html?s=<scenario>`): the chat view fed with
 * conversations recorded by `chat-server/record.ts`, for screenshots without
 * the app. The recorder asks for the history after the turn: left out here.
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

const SCENARIOS: Record<string, () => ChatState> = {
  tools: () => replay(parse(tools)),
  live: () => replay(parse(tools), firstTextDelta),
  question: () => replay(parse(question), (e) => e.type === "permission"),
  plan: () =>
    replay(
      parse(plan),
      (e) => e.type === "permission" && e.toolName === "ExitPlanMode",
    ),
  subagent: () => replay(parse(subagent)),
};

const name = new URLSearchParams(window.location.search).get("s") ?? "tools";
const state = {
  ...(SCENARIOS[name] ?? SCENARIOS.tools)(),
  title: "Refonte de la vue lecture",
  gitBranch: "master-lab",
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div style={{ position: "relative", height: "100%" }}>
      <ChatView
        state={state}
        agents={{}}
        cwd="C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-lab"
        isActive
        switching={false}
        onSwitchToTerminal={() => {}}
        onActivate={() => {}}
        onSend={() => {}}
        onInterrupt={() => {}}
        onAnswer={() => {}}
        onMode={() => {}}
        onModel={() => {}}
        onOpenAgent={() => {}}
        onRestart={() => {}}
      />
    </div>
  </React.StrictMode>,
);
