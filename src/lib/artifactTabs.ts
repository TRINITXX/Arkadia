/**
 * The artifacts of each Arkadia tab, shown as tabs of the artifact panel.
 * Pure state: the native windows (`artifact_view.rs`) follow it from
 * `ArtifactPanel` and from the keys these functions report as closed.
 */

/** Oldest artifact of a tab closes beyond this: each one is a live page. */
export const MAX_ARTIFACTS_PER_TAB = 8;

export interface ArtifactItem {
  /** Unique for the app's lifetime; names the native window. */
  key: string;
  url: string;
  /** Claude account the page is signed in to (its own claude.ai session). */
  accountId: string;
  /** The page's own title, once it has loaded. */
  title: string | null;
  /** Bumped when Claude publishes the link again: the page reloads. */
  nonce: number;
}

export interface TabArtifacts {
  /** The panel's tabs; none once the panel is closed. */
  items: ArtifactItem[];
  activeKey: string;
  /** The artifact on screen when the panel closed, kept loaded and hidden:
   *  its link opens it again at once. */
  parked?: ArtifactItem;
}

export type ArtifactsByTab = Record<string, TabArtifacts>;

export interface ArtifactChange {
  state: ArtifactsByTab;
  /** Native windows to close. */
  closed: string[];
}

/** Whether the tab shows the artifact panel (it may hold only a parked one). */
export function hasPanel(tab: TabArtifacts | undefined): boolean {
  return (tab?.items.length ?? 0) > 0;
}

/** How a link reaches the panel: clicked in a terminal, opened by Claude Code
 *  on a first publish, or republished (relayed by the `artifact-refresh`
 *  Claude Code hook, as Claude Code itself never reopens a republish). */
export type OpenSource = "click" | "publish" | "republish";

/** Opens `url` in tab `tabId`. A link already open there, or parked, comes
 *  forward: as it was on a click, reloaded when Claude published it. A new
 *  one becomes the tab's last and active artifact. A republish only reloads
 *  what the tab holds: a parked page reloads when it comes back, and a page
 *  the user closed stays closed. */
export function openArtifact(
  state: ArtifactsByTab,
  tabId: string,
  url: string,
  accountId: string,
  newKey: () => string,
  source: OpenSource,
): ArtifactChange {
  const current = state[tabId];
  const bump = (i: ArtifactItem) =>
    source === "click" ? i : { ...i, nonce: i.nonce + 1 };
  const same = current?.items.find((i) => i.url === url);
  if (current && same) {
    const items = current.items.map((i) => (i === same ? bump(i) : i));
    return {
      state: { ...state, [tabId]: { ...current, items, activeKey: same.key } },
      closed: [],
    };
  }
  const parked = current?.parked?.url === url ? current.parked : undefined;
  if (source === "republish") {
    if (!current || !parked) return { state, closed: [] };
    return {
      state: { ...state, [tabId]: { ...current, parked: bump(parked) } },
      closed: [],
    };
  }
  const added: ArtifactItem = parked
    ? bump(parked)
    : { key: newKey(), url, accountId, title: null, nonce: 1 };
  const all = [...(current?.items ?? []), added];
  const evicted = all.slice(0, Math.max(0, all.length - MAX_ARTIFACTS_PER_TAB));
  return {
    state: {
      ...state,
      [tabId]: {
        items: all.slice(evicted.length),
        activeKey: added.key,
        parked: parked ? undefined : current?.parked,
      },
    },
    closed: evicted.map((i) => i.key),
  };
}

export function selectArtifact(
  state: ArtifactsByTab,
  tabId: string,
  key: string,
): ArtifactsByTab {
  const current = state[tabId];
  if (!current?.items.some((i) => i.key === key)) return state;
  return { ...state, [tabId]: { ...current, activeKey: key } };
}

/** Closes one artifact's tab; the neighbour on the right (else left) comes
 *  forward. The closed page stays parked, loaded and hidden, in place of the
 *  one parked before, which closes: its link opens it again at once. */
export function closeArtifact(
  state: ArtifactsByTab,
  tabId: string,
  key: string,
): ArtifactChange {
  const current = state[tabId];
  const index = current?.items.findIndex((i) => i.key === key) ?? -1;
  if (!current || index < 0) return { state, closed: [] };
  const items = current.items.filter((i) => i.key !== key);
  const activeKey =
    items.length === 0
      ? ""
      : current.activeKey === key
        ? items[Math.min(index, items.length - 1)].key
        : current.activeKey;
  return {
    state: {
      ...state,
      [tabId]: { items, activeKey, parked: current.items[index] },
    },
    closed: current.parked ? [current.parked.key] : [],
  };
}

/** The panel closes: the artifact on screen stays parked (the one parked
 *  before closes), the others close. */
export function closePanel(
  state: ArtifactsByTab,
  tabId: string,
): ArtifactChange {
  const current = state[tabId];
  if (!current || !hasPanel(current)) return { state, closed: [] };
  const kept =
    current.items.find((i) => i.key === current.activeKey) ?? current.items[0];
  const closed = current.items.filter((i) => i !== kept).map((i) => i.key);
  if (current.parked) closed.push(current.parked.key);
  return {
    state: { ...state, [tabId]: { items: [], activeKey: "", parked: kept } },
    closed,
  };
}

/** An Arkadia tab closed: its artifacts close with it, the parked one too. */
export function dropTab(state: ArtifactsByTab, tabId: string): ArtifactChange {
  const current = state[tabId];
  if (!current) return { state, closed: [] };
  const next = { ...state };
  delete next[tabId];
  const keys = current.items.map((i) => i.key);
  if (current.parked) keys.push(current.parked.key);
  return { state: next, closed: keys };
}

export function setArtifactTitle(
  state: ArtifactsByTab,
  key: string,
  title: string,
): ArtifactsByTab {
  for (const [tabId, current] of Object.entries(state)) {
    if (current.parked?.key === key) {
      return {
        ...state,
        [tabId]: { ...current, parked: { ...current.parked, title } },
      };
    }
    if (!current.items.some((i) => i.key === key)) continue;
    const items = current.items.map((i) =>
      i.key === key ? { ...i, title } : i,
    );
    return { ...state, [tabId]: { ...current, items } };
  }
  return state;
}
