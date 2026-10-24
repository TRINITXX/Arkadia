import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { _resetShownPanesForTests, holdPaneShown } from "./shownPanes";

let sent: string[][];

beforeEach(() => {
  sent = [];
  _resetShownPanesForTests((panes) => sent.push([...panes].sort()));
});

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe("shownPanes", () => {
  it("sends the whole set once for changes made together", async () => {
    holdPaneShown("a");
    holdPaneShown("b");
    await flush();
    expect(sent).toEqual([["a", "b"]]);
  });

  it("keeps a pane shown while any holder remains", async () => {
    const first = holdPaneShown("a");
    holdPaneShown("a");
    await flush();
    first();
    await flush();
    expect(sent).toEqual([["a"]]);
  });

  it("drops a pane once its last holder lets go", async () => {
    const release = holdPaneShown("a");
    holdPaneShown("b");
    await flush();
    release();
    release();
    await flush();
    expect(sent).toEqual([["a", "b"], ["b"]]);
  });
});
