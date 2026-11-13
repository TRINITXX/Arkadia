import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  answerDeadline,
  askedMarker,
  callShowsTab,
} from "@chat-server/chromePanel";

describe("answerDeadline", () => {
  it("waits for a window being launched far longer than for a plain answer", () => {
    // Chrome reopened after going down: the profile took over 12 s to
    // start, the call went on and Claude's tabs opened outside the panel
    // (13/11/2026).
    expect(answerDeadline(1_000, false)).toBe(13_000);
    expect(answerDeadline(1_000, true)).toBeGreaterThanOrEqual(1_000 + 40_000);
  });
});

describe("callShowsTab", () => {
  it("counts a call whose result names one of the session's tabs", () => {
    // tabs_context_mcp with createIfEmpty, then a navigate (06/11/2026).
    expect(
      callShowsTab([
        {
          type: "text",
          text: '{"availableTabs":[{"tabId":879386302,"title":"New Tab"}],"tabGroupId":1404881381}',
        },
      ]),
    ).toBe(true);
    expect(
      callShowsTab({
        content: [
          {
            type: "text",
            text: "Navigated to https://example.com/\n- Executed on tabId: 879386302",
          },
        ],
      }),
    ).toBe(true);
    expect(callShowsTab("Created new tab. Tab ID: 879386149")).toBe(true);
  });

  it("never counts a call that opened no tab: the launch tab is the window's only one", () => {
    // The first call of the Cockpit session closed its window (06/11/2026).
    expect(
      callShowsTab([
        {
          type: "text",
          text: '[{"deviceId":"b1602f70","name":"Browser 1","osPlatform":"Windows","isLocal":true,"inUse":true}]',
        },
      ]),
    ).toBe(false);
    expect(
      callShowsTab([
        {
          type: "text",
          text: "No MCP tab groups found. Use createIfEmpty: true to create a group.",
        },
      ]),
    ).toBe(false);
    expect(callShowsTab('{"tabGroupId":1}')).toBe(false);
    expect(
      callShowsTab([
        {
          type: "text",
          text: "Browser extension is not connected. Please ensure the Claude browser extension is installed and running.",
        },
      ]),
    ).toBe(false);
    expect(
      callShowsTab([
        {
          type: "text",
          text: "The hidden tabs_context_mcp lookup did not respond within 8s; call tabs_context_mcp explicitly to get a tabId first.",
        },
      ]),
    ).toBe(false);
    expect(callShowsTab(undefined)).toBe(false);
  });
});

describe("askedMarker", () => {
  it("names the 20 s marker as the PowerShell hook and Arkadia do", () => {
    // `$env:ARKADIA_PANE_ID -replace '[^\w-]', ''`, and `asked_marker`.
    expect(askedMarker("T", "631e166b-34b4-424e-81da-6deed7dea66e")).toBe(
      join("T", "claude-chrome-panel", "631e166b-34b4-424e-81da-6deed7dea66e"),
    );
    expect(askedMarker("T", "../a b")).toBe(
      join("T", "claude-chrome-panel", "ab"),
    );
  });
});
