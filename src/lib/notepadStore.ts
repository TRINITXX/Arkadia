import { Store } from "@tauri-apps/plugin-store";

/**
 * Persistence for the notepad panel. Separate file from store.json so the
 * main saveState() doesn't rewrite notepad data (and vice versa).
 * Keys: "panelWidth" (global) and one key per projectId ("proj-…").
 */
const STORE_FILE = "notepad.json";
const KEY_PANEL_WIDTH = "panelWidth";

export const HISTORY_CAP = 100;
export const PANEL_WIDTH_MIN = 240;
export const PANEL_WIDTH_MAX = 600;
export const PANEL_WIDTH_DEFAULT = 320;

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
  await store.save();
}

export async function loadPanelWidth(): Promise<number> {
  const store = await getStore();
  const raw = await store.get<unknown>(KEY_PANEL_WIDTH);
  return clampPanelWidth(raw);
}

export async function savePanelWidth(width: number): Promise<void> {
  const store = await getStore();
  await store.set(KEY_PANEL_WIDTH, clampPanelWidth(width));
  await store.save();
}
