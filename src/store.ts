import { Store } from "@tauri-apps/plugin-store";
import { DEFAULT_CUSTOM_PALETTE } from "@/lib/palettes";
import {
  DEFAULT_EDITOR_PROTOCOL,
  DEFAULT_NOTIF_STYLE,
  DEFAULT_NOTIF_WIDTH,
  DEFAULT_PALETTE_ID,
  DEFAULT_TERMINAL_FONT,
  DEFAULT_TOOL_DENSITY,
  MAX_FOLDER_DEPTH,
  NOTIF_WIDTH_MAX,
  NOTIF_WIDTH_MIN,
  SCROLLBACK_LINES_DEFAULT,
  SCROLLBACK_LINES_MAX,
  SCROLLBACK_LINES_MIN,
  type ActionButton,
  type CustomPalette,
  type EditorProtocol,
  type NotifStyle,
  type PaletteId,
  type Project,
  type TerminalFont,
  type ToolbarButton,
  type ToolDensity,
  type Workspace,
} from "@/types";
import {
  ensureDurableOnLoad,
  pushBackupIfHealthy,
  type DurableSpec,
  type KvStore,
  type StoreOpener,
} from "@/lib/durableStore";
import {
  normalizeSessionSnapshot,
  type SessionSnapshot,
} from "@/lib/sessionSnapshot";
import { storeIsHealthy } from "@/lib/storeHealth";
import { dedupeProjectsByPath } from "@/lib/externalAction";

const STORE_FILE = "store.json";
const LEGACY_LOCAL_STORAGE_KEY = "arkadia.v1";

const KEY_PROJECTS = "projects";
const KEY_WORKSPACES = "workspaces";
const KEY_ACTIVE_PROJECT = "activeProjectId";
const KEY_TOOLBAR_BUTTONS = "toolbarButtons";
const KEY_PROMPT_BUTTONS = "promptButtons";
const KEY_PROMPT_BAR_ENABLED = "promptBarEnabled";
const KEY_FONT = "font";
const KEY_PALETTE_ID = "paletteId";
const KEY_USE_WEBGPU = "useWebGPU";
const KEY_CUSTOM_PALETTE = "customPalette";
const KEY_EDITOR_PROTOCOL = "editorProtocol";
// Legacy on/off key, kept for read-only migration into KEY_NOTIF_STYLE.
const KEY_POPUP_ENABLED = "popupEnabled";
const KEY_NOTIF_STYLE = "notifStyle";
const KEY_NOTIF_FULLSCREEN = "notifFullscreen";
const KEY_NOTIF_WIDTH = "notifWidth";
const KEY_NAV_RAIL_ENABLED = "navRailEnabled";
const KEY_MESSAGE_FRAMES_ENABLED = "messageFramesEnabled";
const KEY_AUTO_SCROLL_REPLY = "autoScrollReplyEnabled";
const KEY_MODERN_VIEW_ENABLED = "modernViewEnabled";
const KEY_TOOL_DENSITY = "toolDensity";
const KEY_SIDEPANEL_OPEN = "sidepanelOpen";
const KEY_SCROLLBACK_LINES = "scrollbackLines";
const KEY_SESSION_SNAPSHOT = "sessionSnapshot";

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;
const VALID_PALETTE_IDS: PaletteId[] = [
  "wez",
  "wezterm",
  "dracula",
  "solarized-dark",
  "tokyo-night",
  "custom",
];
const VALID_EDITOR_PROTOCOLS: EditorProtocol[] = [
  "vscode",
  "cursor",
  "idea",
  "fleet",
];
const VALID_TOOL_DENSITIES: ToolDensity[] = ["compact", "preview", "full"];
const VALID_NOTIF_STYLES: NotifStyle[] = ["off", "mirror", "compact"];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface PersistedState {
  projects: Project[];
  workspaces: Workspace[];
  activeProjectId: string | null;
  toolbarButtons: ToolbarButton[];
  /** Bottom prompt-bar buttons: type/send text into the active Claude pane. */
  promptButtons: ToolbarButton[];
  /** Show the bottom prompt bar (on Claude panes only). */
  promptBarEnabled: boolean;
  font: TerminalFont;
  paletteId: PaletteId;
  useWebGPU: boolean;
  customPalette: CustomPalette;
  editorProtocol: EditorProtocol;
  /**
   * Style of the background notification when Claude finishes / asks while
   * Arkadia is backgrounded: off / mirror (full popup) / compact (project·tab).
   */
  notifStyle: NotifStyle;
  /** Let the notification show even over a fullscreen app (game/video). */
  notifFullscreen: boolean;
  /** Compact-notification window width (logical px). */
  notifWidth: number;
  /** Show the message-navigation rail on the right of the terminal. */
  navRailEnabled: boolean;
  /** Draw the green/purple frames around conversation messages. */
  messageFramesEnabled: boolean;
  /** Scroll to the start of Claude's reply when it finishes. */
  autoScrollReplyEnabled: boolean;
  /** Global: render every pane as the structured modern view instead of the terminal. */
  modernViewEnabled: boolean;
  /** Default expand state of tool-call cards in the modern view. */
  toolDensity: ToolDensity;
  /** Show the project sidepanel (toggled from the toolbar). */
  sidepanelOpen: boolean;
  /** Per-pane scrollback line cap (mirrored to the Rust backend). */
  scrollbackLines: number;
  /** Open tabs at last save, for the on-demand "restore previous session". */
  sessionSnapshot: SessionSnapshot | null;
}

const DEFAULT_STATE: PersistedState = {
  projects: [],
  workspaces: [],
  activeProjectId: null,
  toolbarButtons: [],
  promptButtons: [],
  promptBarEnabled: true,
  font: DEFAULT_TERMINAL_FONT,
  paletteId: DEFAULT_PALETTE_ID,
  useWebGPU: false,
  customPalette: DEFAULT_CUSTOM_PALETTE,
  editorProtocol: DEFAULT_EDITOR_PROTOCOL,
  notifStyle: DEFAULT_NOTIF_STYLE,
  notifFullscreen: false,
  notifWidth: DEFAULT_NOTIF_WIDTH,
  navRailEnabled: true,
  messageFramesEnabled: true,
  autoScrollReplyEnabled: true,
  modernViewEnabled: false,
  toolDensity: DEFAULT_TOOL_DENSITY,
  sidepanelOpen: true,
  scrollbackLines: SCROLLBACK_LINES_DEFAULT,
  sessionSnapshot: null,
};

/** Reads a boolean store key, defaulting to `fallback`. */
function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** Validates a persisted tool-density value, falling back to the default. */
function normalizeToolDensity(raw: unknown): ToolDensity {
  if (
    typeof raw === "string" &&
    (VALID_TOOL_DENSITIES as string[]).includes(raw)
  ) {
    return raw as ToolDensity;
  }
  return DEFAULT_TOOL_DENSITY;
}

/**
 * Resolves the notification style. When the new `notifStyle` key is absent,
 * migrates from the legacy boolean `popupEnabled` (true/absent → "mirror",
 * false → "off") so existing users keep their prior behavior.
 */
function normalizeNotifStyle(
  raw: unknown,
  legacyPopupEnabled: unknown,
): NotifStyle {
  if (
    typeof raw === "string" &&
    (VALID_NOTIF_STYLES as string[]).includes(raw)
  ) {
    return raw as NotifStyle;
  }
  if (typeof legacyPopupEnabled === "boolean") {
    return legacyPopupEnabled ? "mirror" : "off";
  }
  return DEFAULT_NOTIF_STYLE;
}

/** Clamps the persisted compact-notification width to its allowed range. */
function normalizeNotifWidth(raw: unknown): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return DEFAULT_NOTIF_WIDTH;
  return Math.min(NOTIF_WIDTH_MAX, Math.max(NOTIF_WIDTH_MIN, Math.round(raw)));
}

/** Clamps the persisted scrollback line cap to its allowed range. */
function normalizeScrollbackLines(raw: unknown): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    return SCROLLBACK_LINES_DEFAULT;
  }
  return Math.min(
    SCROLLBACK_LINES_MAX,
    Math.max(SCROLLBACK_LINES_MIN, Math.round(raw)),
  );
}

/** Opens any plugin-store file as a durable-store-compatible KV handle. */
const openStore: StoreOpener = async (name) =>
  (await Store.load(name, { autoSave: false, defaults: {} })) as KvStore;

/**
 * Backup ring for store.json (store.bak1..3.json, alongside it). "Healthy" =
 * the store has been INITIALIZED by us (it carries a `projects` array, even an
 * empty one). A crash truncates the file so the plugin surfaces a completely
 * empty cache (no keys at all): that is the only unhealthy state, and the one
 * that triggers a restore on load. An empty `projects` list is a legitimate
 * user state (they deleted every project) and must persist — not be resurrected
 * from an old backup. See `storeIsHealthy`.
 */
const STORE_SPEC: DurableSpec = {
  base: "store",
  ringSize: 3,
  isHealthy: storeIsHealthy,
};

let storePromise: Promise<Store> | null = null;

// NOTE: the popup window shares this exact Store instance — the plugin caches
// stores per path across windows. Only the main window may write it; the popup
// calls loadState({ heal: false }) so it never mutates this shared cache.
function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return storePromise;
}

function normalizeAction(b: unknown): ActionButton {
  const x = (b ?? {}) as Record<string, unknown>;
  const action: ActionButton = {
    id: typeof x.id === "string" ? x.id : newButtonId(),
    kind: "action",
    label: typeof x.label === "string" ? x.label : "",
    icon: typeof x.icon === "string" ? x.icon : "",
    command: typeof x.command === "string" ? x.command : "",
    order: typeof x.order === "number" ? x.order : 0,
  };
  // Prompt-bar buttons carry a `submit` flag; the top toolbar omits it.
  if (typeof x.submit === "boolean") action.submit = x.submit;
  // Prompt-bar shortcut buttons ("keys" mode) carry captured PTY bytes + label.
  if (x.mode === "keys") action.mode = "keys";
  if (Array.isArray(x.keys)) {
    action.keys = x.keys.filter((n): n is number => typeof n === "number");
  }
  if (typeof x.keysLabel === "string") action.keysLabel = x.keysLabel;
  return action;
}

function normalizePaletteId(p: unknown): PaletteId {
  if (typeof p === "string" && (VALID_PALETTE_IDS as string[]).includes(p)) {
    return p as PaletteId;
  }
  return DEFAULT_PALETTE_ID;
}

function normalizeFont(f: unknown): TerminalFont {
  const x = (f ?? {}) as Record<string, unknown>;
  const family =
    typeof x.family === "string" && x.family.trim().length > 0
      ? x.family
      : DEFAULT_TERMINAL_FONT.family;
  const rawSize =
    typeof x.size === "number" ? x.size : DEFAULT_TERMINAL_FONT.size;
  const size = Math.min(
    FONT_SIZE_MAX,
    Math.max(FONT_SIZE_MIN, Math.round(rawSize)),
  );
  return { family, size };
}

function normalizeHex(s: unknown, fallback: string): string {
  if (typeof s !== "string") return fallback;
  return HEX_COLOR_RE.test(s) ? s : fallback;
}

function normalizeCustomPalette(p: unknown): CustomPalette {
  const x = (p ?? {}) as Record<string, unknown>;
  const ansiRaw = Array.isArray(x.ansi) ? x.ansi : [];
  const ansi: string[] = Array.from({ length: 16 }, (_, i) =>
    normalizeHex(ansiRaw[i], DEFAULT_CUSTOM_PALETTE.ansi[i]),
  );
  return {
    bg: normalizeHex(x.bg, DEFAULT_CUSTOM_PALETTE.bg),
    fg: normalizeHex(x.fg, DEFAULT_CUSTOM_PALETTE.fg),
    ansi,
  };
}

function normalizeEditorProtocol(p: unknown): EditorProtocol {
  if (
    typeof p === "string" &&
    (VALID_EDITOR_PROTOCOLS as string[]).includes(p)
  ) {
    return p as EditorProtocol;
  }
  return DEFAULT_EDITOR_PROTOCOL;
}

function normalizeProject(p: unknown): Project | null {
  const x = (p ?? {}) as Record<string, unknown>;
  if (typeof x.id !== "string" || typeof x.name !== "string") return null;
  return {
    id: x.id,
    name: x.name,
    path: typeof x.path === "string" ? x.path : "",
    color: typeof x.color === "string" ? x.color : PROJECT_COLORS[0],
    order: typeof x.order === "number" ? x.order : 0,
    workspaceId:
      typeof x.workspaceId === "string" && x.workspaceId.length > 0
        ? x.workspaceId
        : null,
    rootOrder: typeof x.rootOrder === "number" ? x.rootOrder : undefined,
    activeOrder: typeof x.activeOrder === "number" ? x.activeOrder : undefined,
  };
}

function normalizeWorkspace(w: unknown): Workspace | null {
  const x = (w ?? {}) as Record<string, unknown>;
  if (typeof x.id !== "string" || typeof x.name !== "string") return null;
  return {
    id: x.id,
    name: x.name,
    icon: typeof x.icon === "string" ? x.icon : undefined,
    order: typeof x.order === "number" ? x.order : 0,
    collapsed: typeof x.collapsed === "boolean" ? x.collapsed : false,
  };
}

function normalizeButton(b: unknown, depth = 0): ToolbarButton {
  const x = (b ?? {}) as Record<string, unknown>;
  if (x.kind === "folder") {
    const rawChildren = Array.isArray(x.children) ? x.children : [];
    const children: ToolbarButton[] =
      depth + 1 >= MAX_FOLDER_DEPTH
        ? rawChildren.map(normalizeAction)
        : rawChildren.map((c) => normalizeButton(c, depth + 1));
    return {
      id: typeof x.id === "string" ? x.id : newButtonId(),
      kind: "folder",
      label: typeof x.label === "string" ? x.label : "",
      icon: typeof x.icon === "string" ? x.icon : "folder",
      children,
      order: typeof x.order === "number" ? x.order : 0,
    };
  }
  return normalizeAction(x);
}

async function tryMigrateFromLocalStorage(
  store: Store,
): Promise<PersistedState | null> {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    // Legacy localStorage only ever held projects/activeProjectId/toolbarButtons;
    // everything else inherits the current defaults so adding a field to
    // PersistedState never silently skips the migration path.
    const state: PersistedState = {
      ...DEFAULT_STATE,
      projects: Array.isArray(parsed.projects)
        ? (parsed.projects.map(normalizeProject).filter(Boolean) as Project[])
        : [],
      activeProjectId: parsed.activeProjectId ?? null,
      toolbarButtons: Array.isArray(parsed.toolbarButtons)
        ? parsed.toolbarButtons.map((b) => normalizeButton(b))
        : [],
    };
    await store.set(KEY_PROJECTS, state.projects);
    await store.set(KEY_WORKSPACES, state.workspaces);
    await store.set(KEY_ACTIVE_PROJECT, state.activeProjectId);
    await store.set(KEY_TOOLBAR_BUTTONS, state.toolbarButtons);
    await store.set(KEY_FONT, state.font);
    await store.set(KEY_PALETTE_ID, state.paletteId);
    await store.set(KEY_USE_WEBGPU, state.useWebGPU);
    await store.set(KEY_CUSTOM_PALETTE, state.customPalette);
    await store.set(KEY_EDITOR_PROTOCOL, state.editorProtocol);
    await store.save();
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    return state;
  } catch {
    return null;
  }
}

export async function loadState(
  opts: { heal?: boolean } = {},
): Promise<PersistedState> {
  const store = await getStore();
  const heal = opts.heal ?? true;

  // Guard: if store.json is corrupt/empty but a healthy backup exists, restore
  // it into the store (and heal the file) before we read any keys below. The
  // popup passes { heal: false } so it only reads — never touches the shared file.
  await ensureDurableOnLoad(openStore, STORE_SPEC, store as KvStore, { heal });

  const hasProjects = (await store.has(KEY_PROJECTS)) === true;
  if (!hasProjects) {
    const migrated = await tryMigrateFromLocalStorage(store);
    if (migrated) {
      // Seed a backup from the freshly-migrated legacy state.
      await pushBackupIfHealthy(openStore, STORE_SPEC, store as KvStore, {
        heal,
      });
      return migrated;
    }
  }

  const rawProjects = (await store.get<unknown[]>(KEY_PROJECTS)) ?? [];
  const rawWorkspaces = (await store.get<unknown[]>(KEY_WORKSPACES)) ?? [];
  const activeProjectId =
    (await store.get<string | null>(KEY_ACTIVE_PROJECT)) ??
    DEFAULT_STATE.activeProjectId;
  const rawButtons = (await store.get<unknown[]>(KEY_TOOLBAR_BUTTONS)) ?? [];
  const rawPromptButtons =
    (await store.get<unknown[]>(KEY_PROMPT_BUTTONS)) ?? [];
  const rawPromptBarEnabled = await store.get<unknown>(KEY_PROMPT_BAR_ENABLED);
  const rawFont = await store.get<unknown>(KEY_FONT);
  const rawPaletteId = await store.get<unknown>(KEY_PALETTE_ID);
  const rawUseWebGPU = await store.get<unknown>(KEY_USE_WEBGPU);
  const rawCustomPalette = await store.get<unknown>(KEY_CUSTOM_PALETTE);
  const rawEditorProtocol = await store.get<unknown>(KEY_EDITOR_PROTOCOL);
  const rawNotifStyle = await store.get<unknown>(KEY_NOTIF_STYLE);
  const rawPopupEnabled = await store.get<unknown>(KEY_POPUP_ENABLED);
  const rawNotifFullscreen = await store.get<unknown>(KEY_NOTIF_FULLSCREEN);
  const rawNotifWidth = await store.get<unknown>(KEY_NOTIF_WIDTH);
  const rawNavRailEnabled = await store.get<unknown>(KEY_NAV_RAIL_ENABLED);
  const rawMessageFrames = await store.get<unknown>(KEY_MESSAGE_FRAMES_ENABLED);
  const rawAutoScrollReply = await store.get<unknown>(KEY_AUTO_SCROLL_REPLY);
  const rawModernViewEnabled = await store.get<unknown>(
    KEY_MODERN_VIEW_ENABLED,
  );
  const rawToolDensity = await store.get<unknown>(KEY_TOOL_DENSITY);
  const rawSidepanelOpen = await store.get<unknown>(KEY_SIDEPANEL_OPEN);
  const rawScrollbackLines = await store.get<unknown>(KEY_SCROLLBACK_LINES);
  const rawSessionSnapshot = await store.get<unknown>(KEY_SESSION_SNAPSHOT);

  return {
    projects: dedupeProjectsByPath(
      Array.isArray(rawProjects)
        ? (rawProjects.map(normalizeProject).filter(Boolean) as Project[])
        : DEFAULT_STATE.projects,
    ),
    workspaces: Array.isArray(rawWorkspaces)
      ? (rawWorkspaces.map(normalizeWorkspace).filter(Boolean) as Workspace[])
      : DEFAULT_STATE.workspaces,
    activeProjectId,
    toolbarButtons: Array.isArray(rawButtons)
      ? rawButtons.map((b) => normalizeButton(b))
      : DEFAULT_STATE.toolbarButtons,
    promptButtons: Array.isArray(rawPromptButtons)
      ? rawPromptButtons.map((b) => normalizeButton(b))
      : DEFAULT_STATE.promptButtons,
    promptBarEnabled: boolOr(
      rawPromptBarEnabled,
      DEFAULT_STATE.promptBarEnabled,
    ),
    font: normalizeFont(rawFont),
    paletteId: normalizePaletteId(rawPaletteId),
    useWebGPU:
      typeof rawUseWebGPU === "boolean"
        ? rawUseWebGPU
        : DEFAULT_STATE.useWebGPU,
    customPalette: normalizeCustomPalette(rawCustomPalette),
    editorProtocol: normalizeEditorProtocol(rawEditorProtocol),
    notifStyle: normalizeNotifStyle(rawNotifStyle, rawPopupEnabled),
    notifFullscreen: boolOr(rawNotifFullscreen, DEFAULT_STATE.notifFullscreen),
    notifWidth: normalizeNotifWidth(rawNotifWidth),
    navRailEnabled: boolOr(rawNavRailEnabled, DEFAULT_STATE.navRailEnabled),
    messageFramesEnabled: boolOr(
      rawMessageFrames,
      DEFAULT_STATE.messageFramesEnabled,
    ),
    autoScrollReplyEnabled: boolOr(
      rawAutoScrollReply,
      DEFAULT_STATE.autoScrollReplyEnabled,
    ),
    modernViewEnabled: boolOr(
      rawModernViewEnabled,
      DEFAULT_STATE.modernViewEnabled,
    ),
    toolDensity: normalizeToolDensity(rawToolDensity),
    sidepanelOpen: boolOr(rawSidepanelOpen, DEFAULT_STATE.sidepanelOpen),
    scrollbackLines: normalizeScrollbackLines(rawScrollbackLines),
    sessionSnapshot: normalizeSessionSnapshot(rawSessionSnapshot),
  };
}

export async function saveState(state: PersistedState): Promise<void> {
  const store = await getStore();
  await store.set(KEY_PROJECTS, state.projects);
  await store.set(KEY_WORKSPACES, state.workspaces);
  await store.set(KEY_ACTIVE_PROJECT, state.activeProjectId);
  await store.set(KEY_TOOLBAR_BUTTONS, state.toolbarButtons);
  await store.set(KEY_PROMPT_BUTTONS, state.promptButtons);
  await store.set(KEY_PROMPT_BAR_ENABLED, state.promptBarEnabled);
  await store.set(KEY_FONT, state.font);
  await store.set(KEY_PALETTE_ID, state.paletteId);
  await store.set(KEY_USE_WEBGPU, state.useWebGPU);
  await store.set(KEY_CUSTOM_PALETTE, state.customPalette);
  await store.set(KEY_EDITOR_PROTOCOL, state.editorProtocol);
  await store.set(KEY_NOTIF_STYLE, state.notifStyle);
  await store.set(KEY_NOTIF_FULLSCREEN, state.notifFullscreen);
  await store.set(KEY_NOTIF_WIDTH, state.notifWidth);
  await store.set(KEY_NAV_RAIL_ENABLED, state.navRailEnabled);
  await store.set(KEY_MESSAGE_FRAMES_ENABLED, state.messageFramesEnabled);
  await store.set(KEY_AUTO_SCROLL_REPLY, state.autoScrollReplyEnabled);
  await store.set(KEY_MODERN_VIEW_ENABLED, state.modernViewEnabled);
  await store.set(KEY_TOOL_DENSITY, state.toolDensity);
  await store.set(KEY_SIDEPANEL_OPEN, state.sidepanelOpen);
  await store.set(KEY_SCROLLBACK_LINES, state.scrollbackLines);
  // Never clobber the previous session's snapshot with an empty one: after a
  // relaunch the tabs start empty, and this key IS what "restore previous
  // session" reads.
  if (state.sessionSnapshot && state.sessionSnapshot.tabs.length > 0) {
    await store.set(KEY_SESSION_SNAPSHOT, state.sessionSnapshot);
  }
  await store.save();
  // Rotate a healthy snapshot into the backup ring (main window only). Ordered
  // after the primary save so at most one file is ever mid-write on a crash.
  await pushBackupIfHealthy(openStore, STORE_SPEC, store as KvStore, {
    heal: true,
  });
}

export function newProjectId() {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newWorkspaceId() {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newButtonId() {
  return `btn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const PROJECT_COLORS = [
  "#ff6b6b",
  "#ee9b00",
  "#84c452",
  "#4ecdc4",
  "#4f9dff",
  "#c671ff",
  "#ff61a6",
  "#a8a8a8",
];

export function shortenPath(path: string): string {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 2) return parts.join("\\");
  return parts.slice(-2).join("\\");
}
