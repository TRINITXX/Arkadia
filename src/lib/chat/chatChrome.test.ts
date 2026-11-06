import { describe, expect, it } from "vitest";
import { callShowsTab } from "@chat-server/chromePanel";

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
