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
  /** Bumped each time the link is opened again: the page reloads. */
  nonce: number;
}

export interface TabArtifacts {
  items: ArtifactItem[];
  activeKey: string;
}

export type ArtifactsByTab = Record<string, TabArtifacts>;

export interface ArtifactChange {
  state: ArtifactsByTab;
  /** Native windows to close. */
  closed: string[];
}

/** Opens `url` in tab `tabId`: a link already open there comes forward and
 *  reloads, a new one becomes the tab's last and active artifact. */
export function openArtifact(
  state: ArtifactsByTab,
  tabId: string,
  url: string,
  accountId: string,
  newKey: () => string,
): ArtifactChange {
  const current = state[tabId];
  const same = current?.items.find((i) => i.url === url);
  if (current && same) {
    const items = current.items.map((i) =>
      i === same ? { ...i, nonce: i.nonce + 1 } : i,
    );
    return {
      state: { ...state, [tabId]: { items, activeKey: same.key } },
      closed: [],
    };
  }
  const added: ArtifactItem = {
    key: newKey(),
    url,
    accountId,
    title: null,
    nonce: 1,
  };
  const all = [...(current?.items ?? []), added];
  const evicted = all.slice(0, Math.max(0, all.length - MAX_ARTIFACTS_PER_TAB));
  return {
    state: {
      ...state,
      [tabId]: { items: all.slice(evicted.length), activeKey: added.key },
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

/** Closes one artifact; the neighbour on the right (else left) comes forward,
 *  and a tab left without artifact loses its panel. */
export function closeArtifact(
  state: ArtifactsByTab,
  tabId: string,
  key: string,
): ArtifactChange {
  const current = state[tabId];
  const index = current?.items.findIndex((i) => i.key === key) ?? -1;
  if (!current || index < 0) return { state, closed: [] };
  const items = current.items.filter((i) => i.key !== key);
  const next = { ...state };
  if (items.length === 0) {
    delete next[tabId];
  } else {
    const activeKey =
      current.activeKey === key
        ? items[Math.min(index, items.length - 1)].key
        : current.activeKey;
    next[tabId] = { items, activeKey };
  }
  return { state: next, closed: [key] };
}

/** An Arkadia tab closed: its artifacts close with it. */
export function dropTab(state: ArtifactsByTab, tabId: string): ArtifactChange {
  const current = state[tabId];
  if (!current) return { state, closed: [] };
  const next = { ...state };
  delete next[tabId];
  return { state: next, closed: current.items.map((i) => i.key) };
}

export function setArtifactTitle(
  state: ArtifactsByTab,
  key: string,
  title: string,
): ArtifactsByTab {
  for (const [tabId, current] of Object.entries(state)) {
    if (!current.items.some((i) => i.key === key)) continue;
    const items = current.items.map((i) =>
      i.key === key ? { ...i, title } : i,
    );
    return { ...state, [tabId]: { ...current, items } };
  }
  return state;
}
