import { describe, expect, it } from "vitest";

import { subscribeStable, type ListenFn } from "./tauriEvents";

/**
 * Regression tests for the zombie-listener leak: the old App.tsx pattern
 * (`unlisten = await listen(...)` inside an effect re-run on every render)
 * never unsubscribed a listener whose `listen()` promise resolved *after*
 * the effect cleanup — each race leaked a live listener holding the whole
 * render closure (incl. the full `tabs` state with every RenderPayload).
 */

interface MockListener {
  event: string;
  handler: (e: { payload: unknown }) => void;
  unlistened: boolean;
}

/** In-memory Tauri event bus whose `listen` resolves only on `flush()`. */
function mockBus() {
  const listeners: MockListener[] = [];
  const pending: (() => void)[] = [];
  const listen: ListenFn = (event, handler) => {
    const entry: MockListener = {
      event,
      handler: handler as MockListener["handler"],
      unlistened: false,
    };
    return new Promise((resolve) => {
      pending.push(() => {
        listeners.push(entry);
        resolve(() => {
          entry.unlistened = true;
        });
      });
    });
  };
  return {
    listen,
    listeners,
    /** Resolves every pending `listen()` registration. */
    async flush() {
      while (pending.length > 0) pending.shift()!();
      await Promise.resolve();
    },
    emit(event: string, payload: unknown) {
      for (const l of listeners) {
        if (l.event === event && !l.unlistened) l.handler({ payload });
      }
    },
    live(event: string) {
      return listeners.filter((l) => l.event === event && !l.unlistened).length;
    },
  };
}

describe("subscribeStable", () => {
  it("delivers events to the handler once registered", async () => {
    const bus = mockBus();
    const seen: unknown[] = [];
    subscribeStable(bus.listen, "terminal-render", (p) => seen.push(p));
    await bus.flush();
    bus.emit("terminal-render", { session_id: "a" });
    expect(seen).toEqual([{ session_id: "a" }]);
  });

  it("unsubscribes on dispose", async () => {
    const bus = mockBus();
    const dispose = subscribeStable(bus.listen, "terminal-render", () => {});
    await bus.flush();
    expect(bus.live("terminal-render")).toBe(1);
    dispose();
    expect(bus.live("terminal-render")).toBe(0);
  });

  it("unsubscribes a listener whose registration resolves AFTER dispose (the zombie race)", async () => {
    const bus = mockBus();
    const seen: unknown[] = [];
    const dispose = subscribeStable(bus.listen, "terminal-render", (p) =>
      seen.push(p),
    );
    // Dispose while listen() is still in flight — the old pattern leaked here.
    dispose();
    await bus.flush();
    expect(bus.live("terminal-render")).toBe(0);
    bus.emit("terminal-render", { session_id: "a" });
    expect(seen).toEqual([]);
  });

  it("does not accumulate live listeners across rapid resubscribe cycles", async () => {
    // Simulates the 60 Hz effect churn of the old code: subscribe, dispose,
    // resubscribe — with registrations resolving late and out of cycle.
    const bus = mockBus();
    for (let i = 0; i < 100; i++) {
      const dispose = subscribeStable(bus.listen, "terminal-render", () => {});
      dispose(); // cleanup fires before listen() resolves
    }
    const last = subscribeStable(bus.listen, "terminal-render", () => {});
    await bus.flush();
    expect(bus.live("terminal-render")).toBe(1);
    last();
    expect(bus.live("terminal-render")).toBe(0);
  });

  it("keeps calling the CURRENT handler (fresh closure) on each event", async () => {
    // The subscribe-once pattern requires reading the handler through a ref;
    // subscribeStable takes a getter so callers can swap the handler without
    // resubscribing.
    const bus = mockBus();
    let which = "old";
    const dispose = subscribeStable(bus.listen, "e", () => {
      // handler body reads mutable state — stands in for a React ref
      calls.push(which);
    });
    const calls: string[] = [];
    await bus.flush();
    bus.emit("e", null);
    which = "new";
    bus.emit("e", null);
    dispose();
    expect(calls).toEqual(["old", "new"]);
  });
});
