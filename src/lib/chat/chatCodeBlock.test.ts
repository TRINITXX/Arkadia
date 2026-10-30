import { describe, expect, it } from "vitest";
import { lastCodeBlock, lastFencedBlock } from "@/lib/chat/chatCodeBlock";
import type { ChatItem } from "@/lib/chat/chatState";

const text = (t: string, streaming = false): ChatItem => ({
  kind: "text",
  id: t,
  text: t,
  streaming,
});

describe("lastFencedBlock", () => {
  it("takes the last block, only closed by its own fence, and runs an unclosed one to the end", () => {
    expect(lastFencedBlock("a\n```sh\nold\n```\nb\n```ts\nnew\n```")).toBe(
      "new",
    );
    expect(lastFencedBlock("````md\n```\ninner\n```\n````")).toBe(
      "```\ninner\n```",
    );
    expect(lastFencedBlock("~~~\nopen\nend")).toBe("open\nend");
  });

  it("finds nothing without a fence or in an empty one", () => {
    expect(lastFencedBlock("juste de la prose `inline`")).toBeNull();
    expect(lastFencedBlock("```\n\n```")).toBeNull();
  });
});

describe("lastCodeBlock", () => {
  it("skips the user, thinking, tools and a reply still streaming", () => {
    const items: ChatItem[] = [
      text("voici\n```sh\nold\n```"),
      text("et puis\n```sh\ncargo test\n```"),
      text("sans code"),
      {
        kind: "thinking",
        id: "th",
        text: "```sh\npensee\n```",
        streaming: false,
      },
      {
        kind: "tool",
        id: "t9",
        name: "Bash",
        input: { command: "```sh\noutil\n```" },
        result: { text: "```\nsortie\n```", isError: false },
      },
      { kind: "user", id: "u", text: "```sh\nmoi\n```", images: 0 },
      text("en cours\n```sh\nmoitié", true),
    ];
    expect(lastCodeBlock(items)).toBe("cargo test");
    expect(lastCodeBlock([text("rien")])).toBeNull();
  });
});
