import { describe, expect, it } from "vitest";
import { endsWithHourglass } from "@/lib/chat/chatHourglass";

describe("endsWithHourglass", () => {
  it("sees a lone ⏳ paragraph at the end of a reply", () => {
    expect(endsWithHourglass("Tests Rust verts.\n\n⏳")).toBe(true);
    expect(endsWithHourglass("Tests Rust verts.\n\n⏳\n")).toBe(true);
  });

  it("leaves a ⏳ inside a sentence or alone in the reply", () => {
    expect(endsWithHourglass("J'attends ⏳")).toBe(false);
    expect(endsWithHourglass("⏳")).toBe(false);
    expect(endsWithHourglass("Fini.\n\n⏳ encore 2 min")).toBe(false);
  });
});
