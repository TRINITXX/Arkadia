import { describe, expect, it } from "vitest";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { SERVER_GONE } from "@/lib/chat/phoneChat";
import { NEW_PHONE_WATCH, watchPhoneChat } from "@/lib/chat/phoneChatFeel";

const NOW = 1_000_000;

const sdk = (message: JsonObject): ChatEvent => ({
  type: "sdk",
  chatId: "c",
  message,
});
const sent: ChatEvent = {
  type: "user_sent",
  chatId: "c",
  text: "x",
  images: 0,
};
const said = sdk({
  type: "assistant",
  message: { content: [{ type: "text", text: "Fait." }] },
});
const end = (uuid: string, extra: JsonObject = {}) =>
  sdk({ type: "result", subtype: "success", num_turns: 2, uuid, ...extra });
const ask = (requestId: string): ChatEvent => ({
  type: "permission",
  chatId: "c",
  requestId,
  toolName: "Bash",
  input: {},
  toolUseId: `t-${requestId}`,
});
const attached: ChatEvent = { type: "attached", chatId: "c" };
const replayed: ChatEvent = { type: "replayed", chatId: "c" };

describe("watchPhoneChat", () => {
  it("feels a live end and a live ask once, never their replay", () => {
    let { watch, feel } = watchPhoneChat(
      NEW_PHONE_WATCH,
      [sent, said, end("e1")],
      NOW,
    );
    expect(feel).toBe("done");
    ({ watch, feel } = watchPhoneChat(watch, [sent, ask("r1")], NOW));
    expect(feel).toBe("ask");
    // The same ask sent again: felt already.
    ({ watch, feel } = watchPhoneChat(watch, [ask("r1")], NOW));
    expect(feel).toBeNull();
    // The chat opened again: its whole life replayed over two batches, an
    // end and an ask that came while the phone looked elsewhere included.
    ({ watch, feel } = watchPhoneChat(watch, [attached, sent, said], NOW));
    expect(feel).toBeNull();
    ({ watch, feel } = watchPhoneChat(
      watch,
      [end("e1"), sent, said, end("e9"), sent, ask("r9"), replayed],
      NOW,
    ));
    expect(feel).toBeNull();
    // After the replay, a new end is felt, an error as such.
    ({ feel } = watchPhoneChat(
      watch,
      [sent, said, end("e2", { subtype: "error_during_execution" })],
      NOW,
    ));
    expect(feel).toBe("failed");
  });

  it("feels Claude Code dying mid-turn, never the phone's own « server gone »", () => {
    const died: ChatEvent = { type: "closed", chatId: "c", error: "exit 1" };
    expect(watchPhoneChat(NEW_PHONE_WATCH, [sent, said, died], NOW).feel).toBe(
      "failed",
    );
    const gone: ChatEvent = { type: "closed", chatId: "c", error: SERVER_GONE };
    expect(
      watchPhoneChat(NEW_PHONE_WATCH, [sent, said, gone], NOW).feel,
    ).toBeNull();
  });
});
