import { useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  GripVertical,
  Trash2,
} from "lucide-react";
import { newButtonId } from "@/store";
import { getIcon } from "@/icons";
import { IconPicker } from "@/components/IconPicker";
import {
  canAddFolder,
  countDescendants,
  findItem,
  isDescendant,
  moveItem,
  reindexOrder,
  removeItem,
  subtreeHeight,
  updateItem,
} from "@/lib/toolbarTree";
import {
  MAX_FOLDER_DEPTH,
  type ActionButton,
  type FolderButton,
  type ToolbarButton,
} from "@/types";

interface ToolbarSettingsProps {
  buttons: ToolbarButton[];
  onChangeButtons: (next: ToolbarButton[]) => void;
}

interface DragData {
  type: "tb-item";
  id: string;
}

type DropTarget =
  | { kind: "before"; itemId: string; parentId: string | null }
  | { kind: "into"; folderId: string }
  | { kind: "root-end" };

export function ToolbarSettings({
  buttons,
  onChangeButtons,
}: ToolbarSettingsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeDrag, setActiveDrag] = useState<ToolbarButton | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const sortedRoot = useMemo(
    () => [...buttons].sort((a, b) => a.order - b.order),
    [buttons],
  );

  const selected = useMemo(
    () => (selectedId ? (findItem(buttons, selectedId)?.item ?? null) : null),
    [buttons, selectedId],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandFolder = (id: string) => {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const commit = (next: ToolbarButton[]) => {
    onChangeButtons(reindexOrder(next));
  };

  const addAction = (parentId: string | null) => {
    const action: ActionButton = {
      id: newButtonId(),
      kind: "action",
      label: "",
      icon: "play",
      command: "",
      order: 0,
    };
    const inserted =
      parentId === null
        ? [...buttons, action]
        : buttons.map((b) => addToFolder(b, parentId, action));
    if (parentId !== null) expandFolder(parentId);
    commit(inserted);
    setSelectedId(action.id);
  };

  const addFolder = (parentId: string | null) => {
    if (!canAddFolder(buttons, parentId)) return;
    const folder: FolderButton = {
      id: newButtonId(),
      kind: "folder",
      label: "Folder",
      icon: "folder",
      children: [],
      order: 0,
    };
    const inserted =
      parentId === null
        ? [...buttons, folder]
        : buttons.map((b) => addToFolder(b, parentId, folder));
    if (parentId !== null) expandFolder(parentId);
    commit(inserted);
    setSelectedId(folder.id);
  };

  const onDeleteItem = (id: string) => {
    commit(removeItem(buttons, id));
    if (selectedId === id) setSelectedId(null);
  };

  const onUpdateItem = (id: string, patch: Partial<ToolbarButton>) => {
    commit(updateItem(buttons, id, patch));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (!data) return;
    const found = findItem(buttons, data.id);
    setActiveDrag(found?.item ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as DragData | undefined;
    const overData = over.data.current as DropTarget | undefined;
    if (!activeData || !overData) return;
    const sourceId = activeData.id;

    if (overData.kind === "before") {
      commit(moveItem(buttons, sourceId, overData.parentId, overData.itemId));
      return;
    }
    if (overData.kind === "into") {
      commit(moveItem(buttons, sourceId, overData.folderId, null));
      return;
    }
    if (overData.kind === "root-end") {
      commit(moveItem(buttons, sourceId, null, null));
      return;
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            Toolbar buttons
          </h3>
          <p className="text-xs text-zinc-500">
            Drag to reorder or drop into a folder. Click an item to edit it.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => addAction(null)}
            className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            type="button"
          >
            + Action
          </button>
          <button
            onClick={() => addFolder(null)}
            disabled={!canAddFolder(buttons, null)}
            className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
          >
            + Folder
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="flex flex-1 gap-3 overflow-hidden">
          <TreePane
            buttons={sortedRoot}
            allButtons={buttons}
            selectedId={selectedId}
            expanded={expanded}
            activeDragId={activeDrag?.id ?? null}
            onSelect={setSelectedId}
            onToggleExpand={toggleExpanded}
            onAddAction={addAction}
            onAddFolder={addFolder}
          />
          <EditorPane
            selected={selected}
            onUpdate={onUpdateItem}
            onDelete={onDeleteItem}
          />
        </div>
        <DragOverlay>
          {activeDrag ? <DragPreview item={activeDrag} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function addToFolder(
  b: ToolbarButton,
  parentId: string,
  item: ToolbarButton,
): ToolbarButton {
  if (b.kind !== "folder") return b;
  if (b.id === parentId) {
    return { ...b, children: [...b.children, item] };
  }
  return {
    ...b,
    children: b.children.map((c) => addToFolder(c, parentId, item)),
  };
}

interface TreePaneProps {
  buttons: ToolbarButton[];
  allButtons: ToolbarButton[];
  selectedId: string | null;
  expanded: Set<string>;
  activeDragId: string | null;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onAddAction: (parentId: string | null) => void;
  onAddFolder: (parentId: string | null) => void;
}

function TreePane(props: TreePaneProps) {
  const { buttons, activeDragId } = props;
  return (
    <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
      <div className="flex-1 overflow-y-auto p-1">
        {buttons.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">
            no button yet
            <br />
            click + Action above
          </div>
        ) : (
          <ul>
            {buttons.map((b) => (
              <TreeNode
                key={b.id}
                item={b}
                depth={0}
                parentId={null}
                {...props}
              />
            ))}
          </ul>
        )}
        <RootEndDropZone activeDragId={activeDragId} />
      </div>
    </div>
  );
}

interface TreeNodeProps extends TreePaneProps {
  item: ToolbarButton;
  depth: number;
  parentId: string | null;
}

function TreeNode({
  item,
  depth,
  parentId,
  allButtons,
  selectedId,
  expanded,
  activeDragId,
  onSelect,
  onToggleExpand,
  onAddAction,
  onAddFolder,
  buttons,
}: TreeNodeProps) {
  const isFolder = item.kind === "folder";
  const isSelected = item.id === selectedId;
  const isExpanded = isFolder && expanded.has(item.id);
  const Icon = getIcon(item.icon);

  const dragData: DragData = { type: "tb-item", id: item.id };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `tb-drag:${item.id}`, data: dragData });

  const beforeDrop: DropTarget = { kind: "before", itemId: item.id, parentId };
  const { setNodeRef: setBeforeRef, isOver: isOverBefore } = useDroppable({
    id: `tb-before:${item.id}`,
    data: beforeDrop,
    disabled: !activeDragId || activeDragId === item.id,
  });

  const intoDisabled =
    !isFolder ||
    !activeDragId ||
    activeDragId === item.id ||
    isDescendant(allButtons, activeDragId, item.id) ||
    isDescendant(allButtons, item.id, activeDragId) ||
    depthExceedsForInto(allButtons, item.id, activeDragId);
  const intoDrop: DropTarget = { kind: "into", folderId: item.id };
  const { setNodeRef: setIntoRef, isOver: isOverInto } = useDroppable({
    id: `tb-into:${item.id}`,
    data: intoDrop,
    disabled: intoDisabled,
  });

  const indent = depth * 14;

  return (
    <li>
      <div
        ref={setBeforeRef}
        className={`h-1 rounded transition-colors ${
          isOverBefore ? "bg-blue-500/60" : ""
        }`}
        style={{ marginLeft: indent }}
      />
      <div
        ref={(el) => {
          setDragRef(el);
          if (isFolder) setIntoRef(el);
        }}
        onClick={() => onSelect(item.id)}
        className={`group flex h-7 cursor-pointer items-center gap-1 rounded px-1 text-xs ${
          isSelected
            ? "bg-zinc-800 ring-1 ring-zinc-700"
            : "hover:bg-zinc-800/50"
        } ${isDragging ? "opacity-40" : ""} ${
          isOverInto ? "ring-1 ring-blue-500/70" : ""
        }`}
        style={{ paddingLeft: indent + 2 }}
      >
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex size-5 shrink-0 cursor-grab items-center justify-center text-zinc-500 hover:text-zinc-200 active:cursor-grabbing"
          aria-label="Drag handle"
          type="button"
        >
          <GripVertical size={12} />
        </button>
        {isFolder ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(item.id);
            }}
            className="flex size-4 shrink-0 items-center justify-center text-zinc-500 hover:text-zinc-200"
            type="button"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        {Icon ? (
          <Icon size={12} className="shrink-0 text-zinc-300" />
        ) : isFolder ? (
          <FolderIcon size={12} className="shrink-0 text-amber-300/80" />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-zinc-700" />
        )}
        <span
          className={`flex-1 truncate ${
            item.label.length === 0 ? "italic text-zinc-500" : "text-zinc-200"
          }`}
        >
          {item.label || (isFolder ? "(folder)" : "(unnamed)")}
        </span>
      </div>
      {isFolder && isExpanded && (
        <ul>
          {[...item.children]
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <TreeNode
                key={c.id}
                item={c}
                depth={depth + 1}
                parentId={item.id}
                buttons={buttons}
                allButtons={allButtons}
                selectedId={selectedId}
                expanded={expanded}
                activeDragId={activeDragId}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onAddAction={onAddAction}
                onAddFolder={onAddFolder}
              />
            ))}
          <FolderAddBar
            depth={depth + 1}
            canAddFolderHere={canAddFolder(allButtons, item.id)}
            onAddAction={() => onAddAction(item.id)}
            onAddFolder={() => onAddFolder(item.id)}
          />
        </ul>
      )}
    </li>
  );
}

function depthExceedsForInto(
  buttons: ToolbarButton[],
  folderId: string,
  draggedId: string,
): boolean {
  const folder = findItem(buttons, folderId);
  const dragged = findItem(buttons, draggedId);
  if (!folder || !dragged) return true;
  const folderDepth = folder.parents.length;
  return folderDepth + 1 + subtreeHeight(dragged.item) >= MAX_FOLDER_DEPTH;
}

function FolderAddBar({
  depth,
  canAddFolderHere,
  onAddAction,
  onAddFolder,
}: {
  depth: number;
  canAddFolderHere: boolean;
  onAddAction: () => void;
  onAddFolder: () => void;
}) {
  return (
    <li className="flex gap-1 py-0.5" style={{ paddingLeft: depth * 14 + 8 }}>
      <button
        onClick={onAddAction}
        className="rounded border border-zinc-800/60 bg-zinc-900/60 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        type="button"
      >
        + action
      </button>
      {canAddFolderHere && (
        <button
          onClick={onAddFolder}
          className="rounded border border-zinc-800/60 bg-zinc-900/60 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          type="button"
        >
          + folder
        </button>
      )}
    </li>
  );
}

function RootEndDropZone({ activeDragId }: { activeDragId: string | null }) {
  const drop: DropTarget = { kind: "root-end" };
  const { setNodeRef, isOver } = useDroppable({
    id: "tb-root-end",
    data: drop,
    disabled: !activeDragId,
  });
  return (
    <div
      ref={setNodeRef}
      className={`mt-1 h-4 rounded transition-colors ${
        isOver ? "bg-blue-500/30" : ""
      }`}
    />
  );
}

interface EditorPaneProps {
  selected: ToolbarButton | null;
  onUpdate: (id: string, patch: Partial<ToolbarButton>) => void;
  onDelete: (id: string) => void;
}

function EditorPane({ selected, onUpdate, onDelete }: EditorPaneProps) {
  if (!selected) {
    return (
      <div className="flex flex-1 items-center justify-center rounded border border-zinc-800 bg-zinc-900/40 p-6 text-center text-xs text-zinc-500">
        Select an item on the left to edit it.
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/40 p-4">
      {selected.kind === "action" ? (
        <ActionEditorPane
          button={selected}
          onUpdate={(patch) => onUpdate(selected.id, patch)}
          onDelete={() => onDelete(selected.id)}
        />
      ) : (
        <FolderEditorPane
          button={selected}
          onUpdate={(patch) => onUpdate(selected.id, patch)}
          onDelete={() => onDelete(selected.id)}
        />
      )}
    </div>
  );
}

function ActionEditorPane({
  button,
  onUpdate,
  onDelete,
}: {
  button: ActionButton;
  onUpdate: (patch: Partial<ActionButton>) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          action
        </span>
      </div>
      <FieldRow label="Icon">
        <IconPicker
          value={button.icon}
          onChange={(icon) => onUpdate({ icon })}
        />
      </FieldRow>
      <FieldRow label="Label">
        <input
          value={button.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="optional"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-zinc-600"
        />
      </FieldRow>
      <FieldRow label="Command">
        <textarea
          value={button.command}
          onChange={(e) => onUpdate({ command: e.target.value })}
          placeholder="powershell command (e.g. npm run dev)"
          rows={5}
          className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-600"
        />
      </FieldRow>
      <div className="mt-auto flex justify-end pt-2">
        <DeleteButton onClick={onDelete} />
      </div>
    </>
  );
}

function FolderEditorPane({
  button,
  onUpdate,
  onDelete,
}: {
  button: FolderButton;
  onUpdate: (patch: Partial<FolderButton>) => void;
  onDelete: () => void;
}) {
  const total = countDescendants(button);
  const handleDelete = () => {
    if (button.children.length > 0) {
      const ok = window.confirm(
        `Delete folder "${button.label || "folder"}" and ${total} item(s) inside?`,
      );
      if (!ok) return;
    }
    onDelete();
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
          folder
        </span>
        <span className="text-[11px] text-zinc-500">
          {total} item{total === 1 ? "" : "s"}
        </span>
      </div>
      <FieldRow label="Icon">
        <IconPicker
          value={button.icon}
          onChange={(icon) => onUpdate({ icon })}
        />
      </FieldRow>
      <FieldRow label="Label">
        <input
          value={button.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="optional"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-zinc-600"
        />
      </FieldRow>
      <p className="text-[11px] text-zinc-500">
        Add items to this folder by dragging them onto its row, or by expanding
        it in the tree and clicking + action / + folder.
      </p>
      <div className="mt-auto flex justify-end pt-2">
        <DeleteButton onClick={handleDelete} />
      </div>
    </>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/70 hover:text-red-200"
      type="button"
    >
      <Trash2 size={12} /> Delete
    </button>
  );
}

function DragPreview({ item }: { item: ToolbarButton }) {
  const Icon = getIcon(item.icon);
  return (
    <div className="inline-flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 shadow-lg">
      {item.kind === "folder" ? (
        <FolderIcon size={12} className="text-amber-300" />
      ) : Icon ? (
        <Icon size={12} className="text-zinc-300" />
      ) : null}
      <span>
        {item.label || (item.kind === "folder" ? "folder" : "action")}
      </span>
    </div>
  );
}
