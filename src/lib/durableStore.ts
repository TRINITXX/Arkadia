/**
 * Crash-resilient persistence for `@tauri-apps/plugin-store` files.
 *
 * The plugin writes store files with a non-atomic in-place `fs::write` and, on a
 * corrupt/truncated file, silently starts with an empty cache. A PC crash mid-
 * write therefore wiped all data (the empty state was then re-saved over the
 * corrupt file). This module layers redundancy + a load-time guard on top of the
 * existing plugin — no atomic writes, no new dependencies:
 *
 *   - a ring of N SEPARATE backup files per store, so one corrupt write can never
 *     take out every copy at once;
 *   - a write-gate, so only HEALTHY snapshots ever enter the ring;
 *   - a load-time guard that restores from the newest healthy backup when the
 *     primary is corrupt/empty, and heals the primary in place.
 *
 * It is deliberately free of any `@tauri-apps` import so the logic is unit-
 * testable with an in-memory fake. Callers inject the plugin via `StoreOpener`.
 */

export type Entries = Array<[string, unknown]>;

/** Structural subset of the plugin's `Store` that this module relies on. */
export interface KvStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  entries(): Promise<Entries>;
  save(): Promise<void>;
}

/** Opens (or returns the shared instance of) a store file by name. */
export type StoreOpener = (name: string) => Promise<KvStore>;

export interface DurableSpec {
  /** File base name, e.g. "store" → primary "store.json", backups "store.bakN.json". */
  base: string;
  /** Number of backup slots in the ring. */
  ringSize: number;
  /** True when a snapshot of `entries` is worth keeping and trusting. */
  isHealthy: (entries: Entries) => boolean;
}

export interface DurableOptions {
  /** Main window: `true` (may write/heal). Popup: `false` (read-only). */
  heal: boolean;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface Snapshot {
  savedAt: number;
  data: Entries;
}

export type LoadStatus = "healthy" | "restored" | "empty";

const SNAPSHOT_KEY = "snapshot";

/** Backup file name for a 1-based slot, e.g. `backupName("store", 2)` → "store.bak2.json". */
export function backupName(base: string, slot: number): string {
  return `${base}.bak${slot}.json`;
}

function asSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { savedAt?: unknown; data?: unknown };
  if (typeof s.savedAt !== "number" || !Array.isArray(s.data)) return null;
  return { savedAt: s.savedAt, data: s.data as Entries };
}

/** Reads a slot's snapshot, or null if the file is missing/empty/torn. */
async function readSlot(
  open: StoreOpener,
  base: string,
  slot: number,
): Promise<Snapshot | null> {
  const store = await open(backupName(base, slot));
  return asSnapshot(await store.get(SNAPSHOT_KEY));
}

/**
 * Newest valid + healthy backup across the ring, or null.
 * Ties on `savedAt` resolve to the higher slot index (written more recently).
 */
export async function readNewestHealthyBackup(
  open: StoreOpener,
  spec: DurableSpec,
): Promise<Snapshot | null> {
  let best: Snapshot | null = null;
  for (let slot = 1; slot <= spec.ringSize; slot++) {
    const snap = await readSlot(open, spec.base, slot);
    if (!snap || !spec.isHealthy(snap.data)) continue;
    if (!best || snap.savedAt >= best.savedAt) best = snap;
  }
  return best;
}

/**
 * The slot to overwrite next: the one with the smallest `savedAt` (a missing or
 * torn slot counts as 0 = oldest). Ties resolve to the lowest slot index.
 */
export async function pickOldestSlot(
  open: StoreOpener,
  spec: DurableSpec,
): Promise<number> {
  let oldestSlot = 1;
  let oldestAt = -1; // sentinel: "unset"
  for (let slot = 1; slot <= spec.ringSize; slot++) {
    const snap = await readSlot(open, spec.base, slot);
    const at = snap ? snap.savedAt : 0;
    if (oldestAt < 0 || at < oldestAt) {
      oldestAt = at;
      oldestSlot = slot;
    }
  }
  return oldestSlot;
}

async function writeBackup(
  open: StoreOpener,
  spec: DurableSpec,
  data: Entries,
  now: () => number,
): Promise<void> {
  const slot = await pickOldestSlot(open, spec);
  const store = await open(backupName(spec.base, slot));
  const snapshot: Snapshot = { savedAt: now(), data };
  await store.set(SNAPSHOT_KEY, snapshot);
  await store.save();
}

/**
 * Write-gate: push the current primary state into the ring, but ONLY when it is
 * healthy and healing is enabled. Call right after every successful primary save.
 */
export async function pushBackupIfHealthy(
  open: StoreOpener,
  spec: DurableSpec,
  primary: KvStore,
  opts: DurableOptions,
): Promise<void> {
  if (!opts.heal) return; // popup / read-only: never writes
  const cur = await primary.entries();
  if (!spec.isHealthy(cur)) return; // never let an empty/reset state into the ring
  await writeBackup(open, spec, cur, opts.now ?? Date.now);
}

/**
 * Load-time guard. Returns the entries the caller should use, plus a status:
 *  - "healthy": primary is fine (and the ring gets seeded if empty, when healing);
 *  - "restored": primary was corrupt/empty but a healthy backup was found — when
 *    healing, it is written back into the primary in place and a warning is logged;
 *  - "empty": nothing healthy anywhere → the primary's (empty) entries; the caller
 *    then falls back to its own defaults (true first run).
 */
export async function ensureDurableOnLoad(
  open: StoreOpener,
  spec: DurableSpec,
  primary: KvStore,
  opts: DurableOptions,
): Promise<{ status: LoadStatus; entries: Entries }> {
  const now = opts.now ?? Date.now;
  const cur = await primary.entries();

  if (spec.isHealthy(cur)) {
    if (opts.heal && (await readNewestHealthyBackup(open, spec)) === null) {
      await writeBackup(open, spec, cur, now); // seed-on-load
    }
    return { status: "healthy", entries: cur };
  }

  const newest = await readNewestHealthyBackup(open, spec);
  if (newest) {
    if (opts.heal) {
      for (const [k, v] of newest.data) await primary.set(k, v);
      await primary.save(); // heal the primary in place
      console.warn(
        `[durableStore] ${spec.base}: primary unhealthy on load → restored backup (savedAt=${newest.savedAt})`,
      );
    }
    return { status: "restored", entries: newest.data };
  }

  return { status: "empty", entries: cur };
}
