import {
  MAX_FOLDER_DEPTH,
  type FolderButton,
  type ToolbarButton,
} from "@/types";

export interface ItemLocation {
  item: ToolbarButton;
  parentId: string | null;
  parents: FolderButton[];
}

export function findItem(
  buttons: ToolbarButton[],
  id: string,
): ItemLocation | null {
  const visit = (
    list: ToolbarButton[],
    parentId: string | null,
    parents: FolderButton[],
  ): ItemLocation | null => {
    for (const item of list) {
      if (item.id === id) return { item, parentId, parents };
      if (item.kind === "folder") {
        const hit = visit(item.children, item.id, [...parents, item]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return visit(buttons, null, []);
}

/** Depth of `id` within the tree. Root = 0. Returns -1 if not found. */
export function depthOf(buttons: ToolbarButton[], id: string): number {
  const loc = findItem(buttons, id);
  return loc ? loc.parents.length : -1;
}

/** Number of levels below this item (0 for actions and empty folders). */
export function subtreeHeight(b: ToolbarButton): number {
  if (b.kind !== "folder" || b.children.length === 0) return 0;
  let max = 0;
  for (const c of b.children) {
    const h = subtreeHeight(c);
    if (h > max) max = h;
  }
  return 1 + max;
}

export function isDescendant(
  buttons: ToolbarButton[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const ancestor = findItem(buttons, ancestorId);
  if (!ancestor || ancestor.item.kind !== "folder") return false;
  const walk = (list: ToolbarButton[]): boolean => {
    for (const item of list) {
      if (item.id === candidateId) return true;
      if (item.kind === "folder" && walk(item.children)) return true;
    }
    return false;
  };
  return walk(ancestor.item.children);
}

export function removeItem(
  buttons: ToolbarButton[],
  id: string,
): ToolbarButton[] {
  const out: ToolbarButton[] = [];
  for (const b of buttons) {
    if (b.id === id) continue;
    if (b.kind === "folder") {
      out.push({ ...b, children: removeItem(b.children, id) });
    } else {
      out.push(b);
    }
  }
  return out;
}

export function insertItem(
  buttons: ToolbarButton[],
  parentId: string | null,
  insertBeforeId: string | null,
  item: ToolbarButton,
): ToolbarButton[] {
  if (parentId === null) {
    return insertIntoList(buttons, insertBeforeId, item);
  }
  return buttons.map((b) => {
    if (b.kind !== "folder") return b;
    if (b.id === parentId) {
      return {
        ...b,
        children: insertIntoList(b.children, insertBeforeId, item),
      };
    }
    return {
      ...b,
      children: insertItem(b.children, parentId, insertBeforeId, item),
    };
  });
}

function insertIntoList(
  list: ToolbarButton[],
  insertBeforeId: string | null,
  item: ToolbarButton,
): ToolbarButton[] {
  if (insertBeforeId === null) return [...list, item];
  const idx = list.findIndex((b) => b.id === insertBeforeId);
  if (idx === -1) return [...list, item];
  return [...list.slice(0, idx), item, ...list.slice(idx)];
}

export function moveItem(
  buttons: ToolbarButton[],
  sourceId: string,
  targetParentId: string | null,
  insertBeforeId: string | null,
): ToolbarButton[] {
  const loc = findItem(buttons, sourceId);
  if (!loc) return buttons;
  if (loc.parentId === targetParentId && insertBeforeId === sourceId)
    return buttons;

  if (
    targetParentId !== null &&
    isDescendant(buttons, sourceId, targetParentId)
  ) {
    return buttons;
  }
  if (targetParentId === sourceId) return buttons;

  const targetDepth =
    targetParentId === null ? -1 : depthOf(buttons, targetParentId);
  if (targetDepth === -1 && targetParentId !== null) return buttons;
  const newRootDepth = targetDepth + 1;
  const deepestLeafDepth = newRootDepth + subtreeHeight(loc.item);
  if (deepestLeafDepth >= MAX_FOLDER_DEPTH) return buttons;

  const without = removeItem(buttons, sourceId);
  return insertItem(without, targetParentId, insertBeforeId, loc.item);
}

/** Returns true iff a new folder can be created inside `parentId` (null = root). */
export function canAddFolder(
  buttons: ToolbarButton[],
  parentId: string | null,
): boolean {
  const parentDepth = parentId === null ? -1 : depthOf(buttons, parentId);
  if (parentDepth === -1 && parentId !== null) return false;
  return parentDepth + 1 < MAX_FOLDER_DEPTH;
}

/** Recursively reset every `.order` to its index in its sibling list. */
export function reindexOrder(buttons: ToolbarButton[]): ToolbarButton[] {
  return buttons.map((b, i) => {
    if (b.kind === "folder") {
      return { ...b, order: i, children: reindexOrder(b.children) };
    }
    return { ...b, order: i };
  });
}

/** Recursively update an item by id. `kind` is preserved (the patch is filtered). */
export function updateItem(
  buttons: ToolbarButton[],
  id: string,
  patch: Partial<ToolbarButton>,
): ToolbarButton[] {
  return buttons.map((b) => {
    if (b.id === id) {
      const safe = { ...patch } as Record<string, unknown>;
      delete safe.id;
      delete safe.kind;
      if (b.kind === "folder") {
        return { ...b, ...safe } as ToolbarButton;
      }
      delete safe.children;
      return { ...b, ...safe } as ToolbarButton;
    }
    if (b.kind === "folder") {
      return { ...b, children: updateItem(b.children, id, patch) };
    }
    return b;
  });
}

export function countDescendants(b: ToolbarButton): number {
  if (b.kind !== "folder") return 0;
  let n = b.children.length;
  for (const c of b.children) n += countDescendants(c);
  return n;
}
