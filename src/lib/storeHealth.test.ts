import { describe, it, expect } from "vitest";
import { storeIsHealthy } from "@/lib/storeHealth";
import {
  ensureDurableOnLoad,
  type DurableSpec,
  type Entries,
  type KvStore,
  type StoreOpener,
} from "@/lib/durableStore";

// ── Minimal in-memory store seam (mirrors durableStore.test.ts) ─────────
function makeFakeStore(
  init: Entries = [],
): KvStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>(init);
  return {
    map,
    async get<T = unknown>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, value);
    },
    async entries() {
      return [...map.entries()];
    },
    async save() {},
  };
}

function makeOpener(seed: Record<string, Entries> = {}): StoreOpener {
  const stores = new Map<string, ReturnType<typeof makeFakeStore>>();
  for (const [name, e] of Object.entries(seed))
    stores.set(name, makeFakeStore(e));
  return async (name: string) => {
    let s = stores.get(name);
    if (!s) {
      s = makeFakeStore();
      stores.set(name, s);
    }
    return s;
  };
}

const spec: DurableSpec = {
  base: "store",
  ringSize: 3,
  isHealthy: storeIsHealthy,
};

describe("storeIsHealthy", () => {
  it("crash-wiped store (no keys at all) is unhealthy", () => {
    expect(storeIsHealthy([])).toBe(false);
  });

  it("initialized store with ZERO projects is healthy (user deleted every project)", () => {
    // Regression guard: the old predicate (`projects.length > 0`) marked this
    // unhealthy, so an intentional full delete was resurrected from backup on
    // the next launch. An empty-but-present projects array must be trusted.
    expect(
      storeIsHealthy([
        ["projects", []],
        ["font", { family: "X", size: 14 }],
      ]),
    ).toBe(true);
  });

  it("store with projects is healthy", () => {
    expect(storeIsHealthy([["projects", [{ id: "p1" }]]])).toBe(true);
  });

  it("store lacking the projects key entirely is unhealthy", () => {
    expect(storeIsHealthy([["font", { family: "X", size: 14 }]])).toBe(false);
  });
});

describe("delete-all persists across load (durable ring regression)", () => {
  it("does NOT restore a backup over an intentionally-emptied primary", async () => {
    // Primary: the user just deleted their last project — the store is still
    // initialized (projects: []), only now empty.
    const emptied: Entries = [
      ["projects", []],
      ["font", { family: "X", size: 14 }],
    ];
    const primary = makeFakeStore(emptied);
    // A pre-delete backup still sits in the ring.
    const open = makeOpener({
      "store.bak1.json": [
        ["snapshot", { savedAt: 50, data: [["projects", [{ id: "p1" }]]] }],
      ],
    });

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: true,
      now: () => 1,
    });

    // Before the fix this returned "restored" with the old project — the bug.
    expect(res.status).toBe("healthy");
    expect(res.entries).toEqual(emptied);
  });

  it("still restores over a genuinely crash-wiped primary (recovery intact)", async () => {
    const primary = makeFakeStore([]); // no keys → crash-wiped
    const data: Entries = [["projects", [{ id: "p1" }]]];
    const open = makeOpener({
      "store.bak1.json": [["snapshot", { savedAt: 50, data }]],
    });

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: true,
      now: () => 1,
    });

    expect(res.status).toBe("restored");
    expect(res.entries).toEqual(data);
  });
});
