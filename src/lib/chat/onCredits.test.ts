import { describe, expect, it } from "vitest";
import {
  bangEnv,
  CREDITS_MODEL,
  sessionArgs,
  sessionModel,
  strayModel,
} from "@chat-server/onCredits";

describe("a chat server on the API credits", () => {
  it("runs Opus 5.5 whatever the pane asked, and no Chrome", () => {
    expect(sessionModel("api", "fable")).toBe(CREDITS_MODEL);
    expect(sessionModel("api", undefined)).toBe(CREDITS_MODEL);
    expect(sessionModel("main", "fable")).toBe("fable");
    expect(sessionModel(null, undefined)).toBeUndefined();
    expect(sessionArgs("api")).not.toHaveProperty("chrome");
    expect(sessionArgs("1e37cada")).toHaveProperty("chrome", null);
    expect(sessionArgs("api")).toHaveProperty("thinking-display", "summarized");
  });

  it("brings a session switched off Opus 5.5 back to it, on the credits only", () => {
    expect(strayModel("api", "claude-fable-5-2")).toBe(CREDITS_MODEL);
    expect(strayModel("api", "claude-sonnet-5-5")).toBe(CREDITS_MODEL);
    expect(strayModel("api", CREDITS_MODEL)).toBeNull();
    expect(strayModel("api", `${CREDITS_MODEL}[1m]`)).toBeNull();
    expect(strayModel("main", "claude-fable-5-2")).toBeNull();
  });

  it("never hands the key to a `!` command", () => {
    expect(bangEnv({ ANTHROPIC_API_KEY: "sk-ant-x", PATH: "C:/bin" })).toEqual({
      PATH: "C:/bin",
    });
  });
});
