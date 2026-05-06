import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ActionButton, FolderButton, ToolbarButton } from "@/types";
import { getIcon } from "@/icons";

interface ToolbarProps {
  buttons: ToolbarButton[];
  onRunAction: (button: ActionButton) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
}

export function Toolbar({
  buttons,
  onRunAction,
  onOpenSettings,
  disabled = false,
}: ToolbarProps) {
  return (
    <div className="flex h-9 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-2">
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {buttons.length === 0 && (
          <span className="text-xs text-zinc-600">
            no toolbar button — open settings to add one
          </span>
        )}
        {[...buttons]
          .sort((a, b) => a.order - b.order)
          .map((b) =>
            b.kind === "folder" ? (
              <FolderToolbarButton
                key={b.id}
                button={b}
                onRunAction={onRunAction}
                disabled={disabled}
              />
            ) : (
              <ActionToolbarButton
                key={b.id}
                button={b}
                onRunAction={onRunAction}
                disabled={disabled}
              />
            ),
          )}
      </div>
      <button
        onClick={onOpenSettings}
        className="ml-1 flex size-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        title="Settings"
        aria-label="Settings"
        type="button"
      >
        <SettingsIcon size={14} />
      </button>
    </div>
  );
}

function ActionToolbarButton({
  button,
  onRunAction,
  disabled,
}: {
  button: ActionButton;
  onRunAction: (b: ActionButton) => void;
  disabled: boolean;
}) {
  const Icon = getIcon(button.icon);
  const showLabel = button.label.length > 0;
  return (
    <button
      onClick={() => onRunAction(button)}
      disabled={disabled}
      className="flex h-7 items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      title={button.command || button.label}
      type="button"
    >
      {Icon && <Icon size={14} />}
      {showLabel && <span>{button.label}</span>}
      {!Icon && !showLabel && <span className="text-zinc-500">unnamed</span>}
    </button>
  );
}

function FolderToolbarButton({
  button,
  onRunAction,
  disabled,
}: {
  button: FolderButton;
  onRunAction: (b: ActionButton) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<FolderButton[]>([]);
  const [pos, setPos] = useState<{ left: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const Icon = getIcon(button.icon);
  const showLabel = button.label.length > 0;

  const close = () => {
    setOpen(false);
    setPath([]);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popoverRef.current?.contains(t) && !buttonRef.current?.contains(t)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (path.length > 0) {
          setPath((p) => p.slice(0, -1));
        } else {
          close();
        }
      }
    };
    const onResize = () => close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open, path.length]);

  const toggle = () => {
    if (disabled) return;
    if (open) {
      close();
      return;
    }
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ left: rect.left, y: rect.bottom + 4 });
    }
    setOpen(true);
  };

  const onActionClick = (child: ActionButton) => {
    onRunAction(child);
    close();
  };

  const onFolderClick = (child: FolderButton) => {
    setPath((p) => [...p, child]);
  };

  const onBack = () => {
    setPath((p) => p.slice(0, -1));
  };

  const popoverStyle: React.CSSProperties | undefined = pos
    ? {
        position: "fixed",
        top: pos.y,
        left: Math.max(0, pos.left),
      }
    : undefined;

  const currentFolder = path.length > 0 ? path[path.length - 1] : button;
  const parentFolder =
    path.length > 1 ? path[path.length - 2] : path.length === 1 ? button : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        disabled={disabled}
        className={`flex h-7 items-center gap-1 rounded border border-zinc-800 px-2 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "bg-zinc-800" : "bg-zinc-900"
        }`}
        title={`${button.label || "folder"} (${button.children.length})`}
        type="button"
      >
        {Icon && <Icon size={14} />}
        {showLabel && <span>{button.label}</span>}
        {!Icon && !showLabel && <span className="text-zinc-500">folder</span>}
        <ChevronDown size={12} className="text-zinc-500" />
      </button>

      {open && pos && (
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="z-50 inline-block w-max min-w-[100px] max-w-[360px] rounded border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
        >
          {parentFolder && (
            <div className="mb-1 flex items-center gap-2 border-b border-zinc-800 px-1.5 pb-1">
              <button
                onClick={onBack}
                className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                title={`Back to ${parentFolder.label || "folder"}`}
                type="button"
              >
                <ArrowLeft size={12} />
              </button>
              <span className="truncate text-[11px] text-zinc-400">
                {currentFolder.label || "folder"}
              </span>
            </div>
          )}
          {currentFolder.children.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-zinc-500">
              empty folder
            </div>
          ) : (
            [...currentFolder.children]
              .sort((a, b) => a.order - b.order)
              .map((child) => {
                const ChildIcon = getIcon(child.icon);
                if (child.kind === "folder") {
                  const folderLabel = child.label || "folder";
                  return (
                    <button
                      key={child.id}
                      onClick={() => onFolderClick(child)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                      title={`${folderLabel} (${child.children.length})`}
                      type="button"
                    >
                      {ChildIcon && (
                        <ChildIcon
                          size={14}
                          className="shrink-0 text-zinc-300"
                        />
                      )}
                      <span className="flex-1 truncate">{folderLabel}</span>
                      <ChevronRight
                        size={12}
                        className="shrink-0 text-zinc-500"
                      />
                    </button>
                  );
                }
                const childLabel = child.label || child.command || "unnamed";
                return (
                  <button
                    key={child.id}
                    onClick={() => onActionClick(child)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                    title={child.command}
                    type="button"
                  >
                    {ChildIcon && (
                      <ChildIcon size={14} className="shrink-0 text-zinc-300" />
                    )}
                    <span className="truncate">{childLabel}</span>
                  </button>
                );
              })
          )}
        </div>
      )}
    </>
  );
}
