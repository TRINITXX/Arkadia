import { describe, expect, it } from "vitest";
import { suggestionDetail, suggestionLabel } from "@/lib/chat/chatPermissions";

describe("suggestionLabel", () => {
  // As Claude Code 2.1.314 sent them in a live check (31/10/2026).
  it("names the command a project rule lets through, without its wildcard", () => {
    const rule = {
      type: "addRules" as const,
      rules: [{ toolName: "Bash", ruleContent: "pnpm add:*" }],
      behavior: "allow" as const,
      destination: "localSettings" as const,
    };
    expect(suggestionLabel(rule)).toBe("Toujours autoriser « pnpm add » ici");
    expect(suggestionDetail(rule)).toBe(
      "Bash(pnpm add:*), dans .claude/settings.local.json du projet",
    );
  });

  it("offers the session's edit mode, and nothing for what allows less", () => {
    expect(
      suggestionLabel({
        type: "setMode",
        mode: "acceptEdits",
        destination: "session",
      }),
    ).toBe("Accepter les modifications pendant cette session");
    expect(
      suggestionLabel({
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "rm:*" }],
        behavior: "deny",
        destination: "localSettings",
      }),
    ).toBeNull();
  });
});
