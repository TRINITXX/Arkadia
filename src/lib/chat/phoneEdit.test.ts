import { describe, expect, it } from "vitest";
import { editConfirmText } from "@/lib/chat/phoneEdit";

describe("editConfirmText", () => {
  it("says how many messages go, one or more", () => {
    expect(editConfirmText(1).message).toBe(
      "La conversation revient juste avant, et le message suivant part.",
    );
    expect(editConfirmText(3).message).toBe(
      "La conversation revient juste avant, et les 3 messages suivants partent.",
    );
  });
});
