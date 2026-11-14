import { describe, expect, it } from "vitest";
import {
  closeLimitNotice,
  limitNotice,
  setLimitNotice,
} from "@/lib/chat/chatLimitNotice";

describe("closeLimitNotice", () => {
  it("hides the banner for the rest of its wait, back at the next one", () => {
    setLimitNotice("c1", { text: "bascule à 08:01" });
    closeLimitNotice("c1");
    expect(limitNotice("c1")).toBeNull();
    // The wait goes on with a new time: still closed.
    setLimitNotice("c1", { text: "bascule à 13:01" });
    expect(limitNotice("c1")).toBeNull();
    // That wait over, the next one shows again.
    setLimitNotice("c1", null);
    setLimitNotice("c1", { text: "reprise ici à 18:01" });
    expect(limitNotice("c1")?.text).toBe("reprise ici à 18:01");
  });
});
