import { describe, expect, it } from "vitest";
import { bashCommand, bashCutNote, runningBash } from "@/lib/chat/chatBash";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";

const chatId = "c";
const fold = (events: ChatEvent[], state: ChatState = EMPTY_CHAT) =>
  events.reduce((s, e) => reduceChat(s, e, 1_000), state);

/** A past user entry, as the transcript holds it. */
const past = (uuid: string, content: string): JsonObject => ({
  type: "user",
  uuid,
  message: { role: "user", content },
});

describe("the input's `!` commands (chatBash)", () => {
  it("runs what follows a leading !, never an empty one", () => {
    expect(bashCommand("!git status")).toBe("git status");
    expect(bashCommand("  ! ls -la ")).toBe("ls -la");
    expect(bashCommand("!")).toBeNull();
    expect(bashCommand("pourquoi ! ?")).toBeNull();
  });

  it("shows a command's output as it comes, then how it ended", () => {
    const running = fold([
      {
        type: "bash",
        chatId,
        id: "b1",
        command: "pnpm test",
        state: "running",
      },
      {
        type: "bash_output",
        chatId,
        id: "b1",
        stream: "stdout",
        text: "ok 1\n",
      },
      {
        type: "bash_output",
        chatId,
        id: "b1",
        stream: "stderr",
        text: "warn\n",
      },
    ]);
    expect(running.items[0]).toMatchObject({
      kind: "bash",
      running: true,
      stdout: "ok 1\n",
      stderr: "warn\n",
    });
    expect(runningBash(running.items)).toBe("b1");
    const done = fold(
      [
        {
          type: "bash",
          chatId,
          id: "b1",
          command: "pnpm test",
          state: "done",
          stdout: "ok 1\nok 2\n",
          stderr: "warn\n",
          code: 1,
          sent: 15,
          total: 15,
        },
      ],
      running,
    );
    expect(done.items).toHaveLength(1);
    expect(done.items[0]).toMatchObject({
      running: false,
      code: 1,
      stdout: "ok 1\nok 2\n",
    });
    expect(runningBash(done.items)).toBeNull();
  });

  it("says when Claude got the output cut", () => {
    const state = fold([
      {
        type: "bash",
        chatId,
        id: "b",
        command: "cat x",
        state: "done",
        sent: 30_000,
        total: 212_345,
      },
    ]);
    const item = state.items[0];
    expect(item.kind === "bash" && bashCutNote(item)).toBe(
      "Sortie coupée pour Claude : il en reçoit 30 000 caractères sur 212 345.",
    );
  });

  it("holds a message sent while a command runs: waiting, withdrawable, no turn yet", () => {
    const held = fold([
      { type: "bash", chatId, id: "b", command: "sleep 5", state: "running" },
      { type: "user_sent", chatId, text: "et donc ?", images: 0, uuid: "m1" },
    ]);
    expect(held.working).toBe(false);
    expect(held.items[1]).toMatchObject({ id: "sent:m1", queued: true });
    const withdrawn = fold(
      [{ type: "queued_removed", chatId, uuid: "m1" }],
      held,
    );
    expect(withdrawn.items.map((i) => i.id)).toEqual(["bash:b"]);
  });

  it("holds a slash command sent while a command runs, as a message", () => {
    const held = fold([
      {
        type: "commands",
        chatId,
        commands: [{ name: "context", description: "", argumentHint: "" }],
      },
      {
        type: "bash",
        chatId,
        id: "b",
        command: "pnpm build",
        state: "running",
      },
      { type: "user_sent", chatId, text: "/context", images: 0, uuid: "c1" },
    ]);
    expect(held.working).toBe(false);
    expect(held.items[1]).toMatchObject({
      kind: "command",
      id: "sent:c1",
      queued: true,
    });
  });

  it("opens the turn of a held /compact when Claude Code takes it", () => {
    const held = fold([
      {
        type: "commands",
        chatId,
        commands: [{ name: "compact", description: "", argumentHint: "" }],
      },
      {
        type: "bash",
        chatId,
        id: "b",
        command: "pnpm build",
        state: "running",
      },
      { type: "user_sent", chatId, text: "/compact", images: 0, uuid: "c1" },
      { type: "bash", chatId, id: "b", command: "pnpm build", state: "done" },
    ]);
    expect(held.working).toBe(false);
    // /compact streams nothing: its turn opens with its « started » frame.
    const taken = fold(
      [
        {
          type: "sdk",
          chatId,
          message: {
            type: "command_lifecycle",
            command_uuid: "c1",
            state: "started",
          },
        },
      ],
      held,
    );
    expect(taken.working).toBe(true);
    expect(taken.items[1]).toMatchObject({ queued: false, running: true });
  });

  it("stops a running command with its chat", () => {
    const state = fold([
      { type: "bash", chatId, id: "b", command: "ping -t x", state: "running" },
      { type: "closed", chatId },
    ]);
    expect(state.items[0]).toMatchObject({ running: false, stopped: true });
  });

  it("rebuilds a past command's card from Claude Code's two entries", () => {
    const state = fold([
      {
        type: "history",
        chatId,
        truncated: false,
        messages: [
          past("p1", "<bash-input> ls -1</bash-input>"),
          past(
            "p2",
            "<bash-stdout>a &amp; b\n&lt;c&gt;</bash-stdout><bash-stderr></bash-stderr>",
          ),
          past("p3", "<bash-input>true</bash-input>"),
          past(
            "p4",
            "<bash-stdout>(Bash completed with no output)</bash-stdout><bash-stderr></bash-stderr>",
          ),
        ],
      },
    ]);
    expect(state.items).toMatchObject([
      {
        kind: "bash",
        id: "p1",
        command: "ls -1",
        stdout: "a & b\n<c>",
        running: false,
      },
      { kind: "bash", id: "p3", command: "true", stdout: "" },
    ]);
  });
});
