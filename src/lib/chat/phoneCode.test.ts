import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/chatState";
import { lastCodeBlock } from "@/lib/chat/phoneCode";

const reply = (id: string, text: string): ChatItem => ({
  kind: "text",
  id,
  text,
  streaming: false,
});

describe("lastCodeBlock", () => {
  it("takes the last block of the latest reply that has one", () => {
    const items = [
      reply("a", "```ts\nold()\n```"),
      reply("b", "Voilà :\n```bash\nnpm i\n```\npuis\n```\nnpm test\n```"),
      reply("c", "Plus de code ici."),
    ];
    expect(lastCodeBlock(items)).toBe("npm test");
  });

  it("is null without a block", () => {
    expect(lastCodeBlock([reply("a", "rien")])).toBeNull();
  });
});
