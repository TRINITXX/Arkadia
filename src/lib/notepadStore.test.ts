import { describe, it, expect, vi } from "vitest";
import type { Entries } from "@/lib/durableStore";

// notepadStore imports @tauri-apps/plugin-store; stub it so the module loads
// under Node. We only exercise the pure NOTEPAD_SPEC.isHealthy predicate, which
// never touches the plugin. (vi.mock is hoisted above the import below.)
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: async () => ({}) },
}));

import { NOTEPAD_SPEC } from "@/lib/notepadStore";

describe("notepad isHealthy predicate", () => {
  it("is false without real per-project content, true with it", () => {
    // Global-only keys are not "data".
    expect(NOTEPAD_SPEC.isHealthy([["panelWidth", 320]])).toBe(false);
    expect(
      NOTEPAD_SPEC.isHealthy([["proj-x", { draft: "", history: [] }]]),
    ).toBe(false);
    // A non-empty draft counts.
    expect(
      NOTEPAD_SPEC.isHealthy([["proj-x", { draft: "hello", history: [] }]]),
    ).toBe(true);
    // A non-empty history counts.
    const withHistory: Entries = [
      [
        "proj-x",
        { draft: "", history: [{ id: "n", text: "t", createdAt: 0 }] },
      ],
    ];
    expect(NOTEPAD_SPEC.isHealthy(withHistory)).toBe(true);
  });
});
