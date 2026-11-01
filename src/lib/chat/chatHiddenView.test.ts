import { describe, expect, it } from "vitest";
import { restsWhileHidden } from "@/lib/chat/chatHiddenView";

const draft = { text: "salut", images: [] };
const view = (hidden: boolean, status = "idle", d: unknown = draft) => ({
  hidden,
  voice: { status },
  draft: d,
});

describe("a hidden chat view at rest (restsWhileHidden)", () => {
  it("skips the renders of a tab hidden before and after", () => {
    expect(restsWhileHidden(view(true), view(true))).toBe(true);
    expect(restsWhileHidden(view(false), view(true))).toBe(false);
    expect(restsWhileHidden(view(true), view(false))).toBe(false);
  });

  it("lets a dictation end and its text land: the message sent during it goes", () => {
    expect(
      restsWhileHidden(view(true, "transcribing"), view(true, "idle")),
    ).toBe(false);
    expect(
      restsWhileHidden(
        view(true),
        view(true, "idle", { text: "salut ça va", images: [] }),
      ),
    ).toBe(false);
  });
});
