import { describe, expect, it } from "vitest";
import { answersWithPaths } from "@chat-server/answerImages";
import type { DraftImage } from "@/lib/chat/chatDrafts";
import {
  lastImageNumber,
  withEveryTag,
  withImageTags,
  withoutImageTag,
} from "@/lib/chat/pastedImages";

const image = (n?: number): DraftImage => ({
  id: `i${n ?? "x"}`,
  url: "data:,",
  mediaType: "image/png",
  data: "x",
  ...(n ? { n } : {}),
});

describe("images pasted into a field", () => {
  it("numbers them after every number in use, their tags in place of the selection", () => {
    expect(lastImageNumber(["voir [Image #4]", ""], [image(2)])).toBe(4);
    const put = withImageTags("Comme ça", 5, 5, [image(), image()], 4);
    expect(put.text).toBe("Comme[Image #5] [Image #6] ça");
    expect(put.images.map((i) => i.n)).toEqual([5, 6]);
    expect(put.caret).toBe(5 + "[Image #5] [Image #6]".length);
    expect(withImageTags("abc", 1, 3, [image()], 0).text).toBe("a[Image #1]");
  });

  it("takes a tag away with its image, and puts back one the user erased", () => {
    expect(withoutImageTag("a [Image #2] b", 2)).toBe("a  b");
    expect(withEveryTag("Trop sombre", [image(1), image(2)])).toBe(
      "Trop sombre [Image #1] [Image #2]",
    );
    expect(withEveryTag("[Image #1] ok", [image(1)])).toBe("[Image #1] ok");
    // An image alone answers.
    expect(withEveryTag("", [image(3)])).toBe("[Image #3]");
  });
});

describe("an AskUserQuestion's pasted images", () => {
  it("name their file in the answers that tag them", () => {
    const input = {
      questions: [],
      answers: { Logo: "Celui-ci [Image #1]", Couleur: "Bleu [Image #9]" },
    };
    expect(answersWithPaths(input, new Map([[1, "C:\\tmp\\a.png"]]))).toEqual({
      questions: [],
      answers: {
        Logo: "Celui-ci [Image #1 : C:\\tmp\\a.png]",
        Couleur: "Bleu [Image #9]",
      },
    });
    expect(answersWithPaths({ answers: "x" }, new Map([[1, "p"]]))).toEqual({
      answers: "x",
    });
  });
});
