import { Store } from "@tauri-apps/plugin-store";
import {
  ensureDurableOnLoad,
  pushBackupIfHealthy,
  type DurableSpec,
  type KvStore,
  type StoreOpener,
} from "@/lib/durableStore";

/**
 * Persistence for the notepad panel. Separate file from store.json so the
 * main saveState() doesn't rewrite notepad data (and vice versa).
 * Keys: "panelWidth" (global) and one key per projectId ("proj-…").
 */
const STORE_FILE = "notepad.json";
const KEY_PANEL_WIDTH = "panelWidth";
const KEY_EDITOR_HEIGHT = "editorHeight";

export const HISTORY_CAP = 100;
export const PANEL_WIDTH_MIN = 240;
export const PANEL_WIDTH_MAX = 600;
export const PANEL_WIDTH_DEFAULT = 320;
export const EDITOR_HEIGHT_MIN = 120;

export interface NotepadEntry {
  id: string;
  text: string;
  createdAt: number; // epoch ms
}

export interface NotepadProjectState {
  /** In-progress text, not yet copied/archived. */
  draft: string;
  /** Archived messages, most recent first. */
  history: NotepadEntry[];
}

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return storePromise;
}

/** Opens any plugin-store file as a durable-store-compatible KV handle. */
const openStore: StoreOpener = async (name) =>
  (await Store.load(name, { autoSave: false, defaults: {} })) as KvStore;

/**
 * Backup ring for notepad.json (notepad.bak1..3.json). "Healthy" = at least one
 * project has real notepad content. A fresh user has an empty notepad, which is
 * legitimately empty — so the guard leans on corrupt-restore, not emptiness, and
 * the ring only starts filling once there is real content to protect.
 */
export const NOTEPAD_SPEC: DurableSpec = {
  base: "notepad",
  ringSize: 3,
  isHealthy: (entries) =>
    entries.some(([k, v]) => {
      if (!k.startsWith("proj-") || !v || typeof v !== "object") return false;
      const s = v as { draft?: unknown; history?: unknown };
      return (
        (typeof s.draft === "string" && s.draft.length > 0) ||
        (Array.isArray(s.history) && s.history.length > 0)
      );
    }),
};

/** Runs the load-time guard once (memoised). Notepad is main-window only. */
let durableReady: Promise<void> | null = null;
function ensureNotepadDurable(): Promise<void> {
  if (!durableReady) {
    durableReady = getStore().then(async (store) => {
      await ensureDurableOnLoad(openStore, NOTEPAD_SPEC, store as KvStore, {
        heal: true,
      });
    });
  }
  return durableReady;
}

/** Saves the notepad store, then rotates a healthy snapshot into the ring. */
async function saveAndBackup(store: Store): Promise<void> {
  await store.save();
  await pushBackupIfHealthy(openStore, NOTEPAD_SPEC, store as KvStore, {
    heal: true,
  });
}

export function newEntryId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clampPanelWidth(w: unknown): number {
  if (typeof w !== "number" || !Number.isFinite(w)) return PANEL_WIDTH_DEFAULT;
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(w)));
}

function normalizeEntry(e: unknown): NotepadEntry | null {
  const x = (e ?? {}) as Record<string, unknown>;
  if (typeof x.text !== "string" || x.text.length === 0) return null;
  return {
    id: typeof x.id === "string" ? x.id : newEntryId(),
    text: x.text,
    createdAt: typeof x.createdAt === "number" ? x.createdAt : 0,
  };
}

export function normalizeProjectState(raw: unknown): NotepadProjectState {
  const x = (raw ?? {}) as Record<string, unknown>;
  const history = Array.isArray(x.history)
    ? (x.history.map(normalizeEntry).filter(Boolean) as NotepadEntry[]).slice(
        0,
        HISTORY_CAP,
      )
    : [];
  return {
    draft: typeof x.draft === "string" ? x.draft : "",
    history,
  };
}

export async function loadProjectNotepad(
  projectId: string,
): Promise<NotepadProjectState> {
  await ensureNotepadDurable();
  const store = await getStore();
  const raw = await store.get<unknown>(projectId);
  return normalizeProjectState(raw);
}

export async function saveProjectNotepad(
  projectId: string,
  state: NotepadProjectState,
): Promise<void> {
  const store = await getStore();
  await store.set(projectId, {
    draft: state.draft,
    history: state.history.slice(0, HISTORY_CAP),
  });
  await saveAndBackup(store);
}

export async function loadPanelWidth(): Promise<number> {
  await ensureNotepadDurable();
  const store = await getStore();
  const raw = await store.get<unknown>(KEY_PANEL_WIDTH);
  return clampPanelWidth(raw);
}

export async function savePanelWidth(width: number): Promise<void> {
  const store = await getStore();
  await store.set(KEY_PANEL_WIDTH, clampPanelWidth(width));
  await saveAndBackup(store);
}

/** Persisted editor height in px, or null when unset/invalid — the panel
 *  then defaults to half the window height. The upper bound depends on the
 *  live window size, so the caller clamps it. */
export async function loadEditorHeight(): Promise<number | null> {
  await ensureNotepadDurable();
  const store = await getStore();
  const raw = await store.get<unknown>(KEY_EDITOR_HEIGHT);
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(EDITOR_HEIGHT_MIN, Math.round(raw));
}

export async function saveEditorHeight(height: number): Promise<void> {
  const store = await getStore();
  await store.set(
    KEY_EDITOR_HEIGHT,
    Math.max(EDITOR_HEIGHT_MIN, Math.round(height)),
  );
  await saveAndBackup(store);
}
