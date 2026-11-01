import { describe, expect, it } from "vitest";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { peerLabel, peerMessages } from "@/lib/chat/chatPeer";
import { laterMessages } from "@/lib/chat/chatEdit";
import { groupChatItems, messagesOnly } from "@/lib/chat/chatGroups";
import { sentHistory } from "@/lib/chat/chatInputHistory";
import { EMPTY_CHAT, reduceChat, type ChatItem } from "@/lib/chat/chatState";

const PIPE = "uds:\\\\.\\pipe\\LOCAL\\cc-msg-0c5f5b68";

/** The harness's note around a peer's message, as Claude Code writes it. */
const wrapped = (name: string, body: string) =>
  `Another Claude session sent a message:\n<cross-session-message from="${PIPE}" from-name="${name}" from-mode="prompting">\n${body}\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request… that's permission laundering.`;

/** The CLI's echo of a peer's turn (`--replay-user-messages`, live 31/10/2026). */
const liveEcho: JsonObject = {
  type: "user",
  message: { role: "user", content: wrapped("peer-a-69", "Bonjour de A") },
  parent_tool_use_id: null,
  uuid: "9ed3c3c1",
  timestamp: "2026-10-31T02:36:46.165Z",
  isReplay: true,
  isSynthetic: true,
  origin: {
    kind: "peer",
    from: PIPE,
    name: "peer-a-69",
    fromMode: "prompting",
    body: "Bonjour de A",
  },
};

describe("peerMessages", () => {
  it("reads the sender and the body alone from the origin", () => {
    expect(peerMessages(liveEcho)).toEqual([
      { from: "peer-a-69", agentId: undefined, text: "Bonjour de A" },
    ]);
  });

  it("parses the envelope of a transcript without origin, wrapped or bare", () => {
    const past = (content: string): JsonObject => ({
      type: "user",
      message: { role: "user", content },
    });
    expect(peerMessages(past(wrapped("arkadia-85", "Libre ?")))).toEqual([
      { from: "arkadia-85", text: "Libre ?" },
    ]);
    // Taken mid-turn: the envelope alone (seen live on 31/10/2026).
    const bare = `<cross-session-message from="${PIPE}" from-name="arkadia-85">\nVas-y\n</cross-session-message>`;
    expect(peerMessages(past(bare))).toEqual([
      { from: "arkadia-85", text: "Vas-y" },
    ]);
    // The user quoting one in their own words stays theirs, or pasting one
    // whole in a message stamped as theirs.
    expect(peerMessages(past(`Regarde : ${bare}`))).toBeNull();
    expect(
      peerMessages({ ...past(bare), origin: { kind: "human" } }),
    ).toBeNull();
    expect(peerMessages(past("Bonjour"))).toBeNull();
  });

  it("gives a subagent's report without the harness's frame", () => {
    const body =
      "[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n  Lot 5 en place.\n  \n  ## Fichiers\n  - a.ts";
    const peers = peerMessages({
      type: "user",
      message: { role: "user", content: "x" },
      origin: {
        kind: "peer",
        from: "a2475351",
        senderTaskId: "a2475351",
        name: "general-purpose",
        body,
      },
    });
    expect(peers).toEqual([
      {
        from: "general-purpose",
        agentId: "a2475351",
        text: "Lot 5 en place.\n\n## Fichiers\n- a.ts",
      },
    ]);
    expect(
      peerLabel(peers![0], [{ taskId: "a2475351", description: "Lot 5" }]),
    ).toBe("Message du sous-agent « Lot 5 »");
    expect(peerLabel({ from: "arkadia-85" })).toBe("Message de arkadia-85");
    expect(peerLabel({})).toBe("Message d'une autre session");
  });
});

describe("a peer's message in the column", () => {
  const sdk = (message: JsonObject): ChatEvent => ({
    type: "sdk",
    chatId: "c",
    message,
  });
  const sent: ChatEvent = {
    type: "user_sent",
    chatId: "c",
    text: "Mon message",
    images: 0,
    pasted: [],
    uuid: "u1",
  };

  it("shows live in its own frame, never as the user's", () => {
    const state = [sent, sdk(liveEcho)].reduce(
      (s, e) => reduceChat(s, e, 1_000),
      EMPTY_CHAT,
    );
    const peer = state.items.find((i) => i.kind === "peer");
    expect(peer).toMatchObject({ from: "peer-a-69", text: "Bonjour de A" });
    expect(state.items.filter((i) => i.kind === "user")).toHaveLength(1);
    // ↑ brings back the user's words only.
    expect(sentHistory(state.items)).toEqual(["Mon message"]);
    // « Messages seuls » keeps it.
    expect(
      messagesOnly(groupChatItems(state.items)).map((u) => u.kind),
    ).toEqual(["user", "peer"]);
  });

  it("shows in its own frame from a resumed session too", () => {
    // `getSessionMessages`: the same origin, `is_meta` (seen 31/10/2026).
    const state = reduceChat(
      EMPTY_CHAT,
      {
        type: "history",
        chatId: "c",
        messages: [
          {
            type: "user",
            uuid: "p1",
            message: liveEcho.message,
            is_meta: true,
            origin: liveEcho.origin,
          },
          {
            type: "user",
            uuid: "p2",
            message: { role: "user", content: wrapped("arkadia-85", "Fini") },
          },
        ],
        truncated: false,
      },
      0,
    );
    expect(
      state.items.map((i) =>
        i.kind === "peer" ? `${i.from}: ${i.text}` : i.kind,
      ),
    ).toEqual(["peer-a-69: Bonjour de A", "arkadia-85: Fini"]);
  });

  it("shows nothing of a subagent's report, nor as the user's", () => {
    const report = sdk({
      type: "user",
      uuid: "r1",
      message: { role: "user", content: "x" },
      origin: {
        kind: "peer",
        from: "a2475351",
        senderTaskId: "a2475351",
        name: "general-purpose",
        body: "Lot 5 en place.",
      },
    });
    const state = reduceChat(EMPTY_CHAT, report, 1_000);
    expect(state.items).toEqual([]);
    // One message carrying both: the other session's stays.
    const both = sdk({
      type: "user",
      uuid: "r2",
      message: {
        role: "user",
        content:
          '<cross-session-message from-name="arkadia-85">Libre ?</cross-session-message><agent-message from="a2475351">Fini</agent-message>',
      },
    });
    expect(
      reduceChat(EMPTY_CHAT, both, 1_000).items.map((i) =>
        i.kind === "peer" ? i.text : i.kind,
      ),
    ).toEqual(["Libre ?"]);
  });

  it("counts among the messages an edit drops", () => {
    const user: ChatItem = { kind: "user", id: "u", text: "a", images: 0 };
    const items: ChatItem[] = [
      user,
      { kind: "peer", id: "p", from: "x", text: "b" },
      { kind: "text", id: "t", text: "c", streaming: false },
    ];
    expect(laterMessages(items, user)).toBe(2);
  });
});
