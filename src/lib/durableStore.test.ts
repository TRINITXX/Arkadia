import { describe, it, expect, vi } from "vitest";
import {
  ensureDurableOnLoad,
  pushBackupIfHealthy,
  readNewestHealthyBackup,
  type DurableSpec,
  type Entries,
  type KvStore,
  type Snapshot,
  type StoreOpener,
} from "@/lib/durableStore";

// ── In-memory fake seam (no Tauri runtime) ─────────────────────────────
// A "corrupt / missing / genuinely empty" primary is modelled identically as
// entries() === [] — from JS the plugin cannot tell them apart (the crate
// swallows a deserialize error and starts with an empty cache).

type FakeStore = KvStore & { map: Map<string, unknown>; saves: number };

function makeFakeStore(init: Entries = []): FakeStore {
  const s: FakeStore = {
    map: new Map<string, unknown>(init),
    saves: 0,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return s.map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      s.map.set(key, value);
    },
    async entries(): Promise<Entries> {
      return [...s.map.entries()];
    },
    async save(): Promise<void> {
      s.saves += 1;
    },
  };
  return s;
}

function makeOpener(seed: Record<string, Entries> = {}): {
  open: StoreOpener;
  stores: Map<string, FakeStore>;
} {
  const stores = new Map<string, FakeStore>();
  for (const [name, e] of Object.entries(seed)) {
    stores.set(name, makeFakeStore(e));
  }
  const open: StoreOpener = async (name: string) => {
    let s = stores.get(name);
    if (!s) {
      s = makeFakeStore();
      stores.set(name, s);
    }
    return s;
  };
  return { open, stores };
}

// Deterministic, strictly-increasing clock so savedAt ordering is stable.
function monotonic(start = 1000): () => number {
  let t = start;
  return () => (t += 1);
}

// ── Test fixtures ──────────────────────────────────────────────────────
const proj = (id: string) => ({ id, name: id });
const healthy = (): Entries => [
  ["projects", [proj("p1")]],
  ["font", { family: "X", size: 14 }],
];

const spec: DurableSpec = {
  base: "store",
  ringSize: 3,
  isHealthy: (e) => {
    const p = e.find(([k]) => k === "projects")?.[1];
    return Array.isArray(p) && p.length > 0;
  },
};

const snapOf = (store: FakeStore) => store.map.get("snapshot") as Snapshot;

describe("ensureDurableOnLoad", () => {
  it("healthy primary with an existing backup → healthy, no writes", async () => {
    const primary = makeFakeStore(healthy());
    const { open, stores } = makeOpener({
      "store.bak1.json": [["snapshot", { savedAt: 5, data: healthy() }]],
    });

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: true,
      now: () => 999,
    });

    expect(res.status).toBe("healthy");
    expect(res.entries).toEqual(healthy());
    expect(primary.saves).toBe(0); // not healed
    expect(stores.get("store.bak1.json")!.saves).toBe(0); // not re-seeded
  });

  it("healthy primary with an empty ring → seeds bak1", async () => {
    const primary = makeFakeStore(healthy());
    const { open, stores } = makeOpener();

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: true,
      now: monotonic(1000),
    });

    expect(res.status).toBe("healthy");
    const bak1 = stores.get("store.bak1.json");
    expect(bak1).toBeDefined();
    expect(snapOf(bak1!).data).toEqual(healthy());
    expect(typeof snapOf(bak1!).savedAt).toBe("number");
  });

  it("popup (heal:false) never seeds a healthy primary", async () => {
    const primary = makeFakeStore(healthy());
    const { open, stores } = makeOpener();

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: false,
      now: () => 1,
    });

    expect(res.status).toBe("healthy");
    expect([...stores.keys()].some((k) => k.startsWith("store.bak"))).toBe(
      false,
    );
  });

  it("corrupt/empty primary + healthy backup → restore + heal + one warn", async () => {
    const primary = makeFakeStore([]); // corrupt/empty
    const data = healthy();
    const { open } = makeOpener({
      "store.bak2.json": [["snapshot", { savedAt: 50, data }]],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: true,
      now: () => 1,
    });

    expect(res.status).toBe("restored");
    expect(res.entries).toEqual(data);
    expect([...primary.map.entries()]).toEqual(data); // healed in place
    expect(primary.saves).toBeGreaterThanOrEqual(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("corrupt/empty primary + healthy backup, popup → restored but no write, no warn", async () => {
    const primary = makeFakeStore([]);
    const data = healthy();
    const { open } = makeOpener({
      "store.bak1.json": [["snapshot", { savedAt: 10, data }]],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: false,
      now: () => 1,
    });

    expect(res.status).toBe("restored");
    expect(res.entries).toEqual(data);
    expect(primary.map.size).toBe(0); // untouched
    expect(primary.saves).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("empty primary + empty ring → empty, no writes", async () => {
    const primary = makeFakeStore([]);
    const { open, stores } = makeOpener();

    const res = await ensureDurableOnLoad(open, spec, primary, {
      heal: true,
      now: () => 1,
    });

    expect(res.status).toBe("empty");
    expect(res.entries).toEqual([]);
    expect(primary.saves).toBe(0);
    // reads may lazily open bak slots, but none should be written
    expect(
      [...stores.values()].every((s) => s.saves === 0 && s.map.size === 0),
    ).toBe(true);
  });
});

describe("pushBackupIfHealthy — ring rotation & write-gate", () => {
  it("keeps the 3 newest healthy snapshots and drops the oldest", async () => {
    const primary = makeFakeStore(healthy());
    const { open, stores } = makeOpener();
    const now = monotonic(1000); // 1001..1004

    for (let i = 0; i < 4; i++) {
      await pushBackupIfHealthy(open, spec, primary, { heal: true, now });
    }

    const savedAts = [1, 2, 3]
      .map((s) => snapOf(stores.get(`store.bak${s}.json`)!).savedAt)
      .sort((a, b) => a - b);
    expect(savedAts).toEqual([1002, 1003, 1004]); // 1001 evicted
  });

  it("write-gate: an unhealthy primary is never pushed", async () => {
    const primary = makeFakeStore(healthy());
    const { open, stores } = makeOpener();
    await pushBackupIfHealthy(open, spec, primary, {
      heal: true,
      now: () => 100,
    });
    const savesBefore = stores.get("store.bak1.json")!.saves;

    primary.map.clear(); // primary now empty/reset
    await pushBackupIfHealthy(open, spec, primary, {
      heal: true,
      now: () => 200,
    });

    expect(stores.get("store.bak1.json")!.saves).toBe(savesBefore); // unchanged
    expect(snapOf(stores.get("store.bak1.json")!).savedAt).toBe(100); // healthy snapshot kept
  });

  it("popup (heal:false) never pushes", async () => {
    const primary = makeFakeStore(healthy());
    const { open, stores } = makeOpener();
    await pushBackupIfHealthy(open, spec, primary, {
      heal: false,
      now: () => 1,
    });
    expect([...stores.keys()].some((k) => k.startsWith("store.bak"))).toBe(
      false,
    );
  });

  it("targets the slot with the smallest savedAt (round-robin)", async () => {
    const primary = makeFakeStore(healthy());
    const data = healthy();
    const { open, stores } = makeOpener({
      "store.bak1.json": [["snapshot", { savedAt: 10, data }]],
      "store.bak2.json": [["snapshot", { savedAt: 30, data }]],
      "store.bak3.json": [["snapshot", { savedAt: 20, data }]],
    });

    await pushBackupIfHealthy(open, spec, primary, {
      heal: true,
      now: () => 100,
    });

    expect(snapOf(stores.get("store.bak1.json")!).savedAt).toBe(100); // was oldest (10)
    expect(snapOf(stores.get("store.bak2.json")!).savedAt).toBe(30);
    expect(snapOf(stores.get("store.bak3.json")!).savedAt).toBe(20);
  });
});

describe("readNewestHealthyBackup", () => {
  it("ignores torn and unhealthy backups, returns the newest healthy one", async () => {
    const good = healthy();
    const { open } = makeOpener({
      "store.bak1.json": [["snapshot", { savedAt: 50, data: good }]],
      "store.bak2.json": [["junk", 1]], // torn: no snapshot key
      "store.bak3.json": [
        ["snapshot", { savedAt: 90, data: [["projects", []]] }],
      ], // unhealthy
    });

    const snap = await readNewestHealthyBackup(open, spec);

    expect(snap).not.toBeNull();
    expect(snap!.savedAt).toBe(50);
    expect(snap!.data).toEqual(good);
  });

  it("returns null when no healthy backup exists", async () => {
    const { open } = makeOpener({
      "store.bak1.json": [
        ["snapshot", { savedAt: 1, data: [["projects", []]] }],
      ],
    });
    expect(await readNewestHealthyBackup(open, spec)).toBeNull();
  });
});

describe("store isHealthy predicate", () => {
  it("is false for empty projects, true for non-empty", () => {
    expect(spec.isHealthy([["projects", []]])).toBe(false);
    expect(spec.isHealthy([["projects", [proj("x")]]])).toBe(true);
    expect(spec.isHealthy([])).toBe(false);
  });
});
