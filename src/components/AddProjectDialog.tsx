import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { desktopDir } from "@tauri-apps/api/path";
import { PROJECT_COLORS, shortenPath } from "@/store";

interface AddProjectDialogProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (data: { name: string; path: string; color: string }) => void;
}

export function AddProjectDialog({
  open: isOpen,
  onCancel,
  onSubmit,
}: AddProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setPath("");
      setColor(PROJECT_COLORS[0]);
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const browse = async () => {
    try {
      const desktop = await desktopDir();
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: desktop,
      });
      if (typeof selected === "string") {
        setPath(selected);
        // Auto-fill name with the folder's leaf if name is empty
        if (!name.trim()) {
          const parts = selected
            .replace(/\//g, "\\")
            .split("\\")
            .filter(Boolean);
          const leaf = parts[parts.length - 1] ?? "";
          setName(leaf);
        }
      }
    } catch (e) {
      console.error("dialog open failed:", e);
    }
  };

  const submit = () => {
    if (!name.trim() || !path.trim()) return;
    onSubmit({ name: name.trim(), path: path.trim(), color });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[440px] rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-tight">New project</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Pick a folder; tabs spawned for this project use it as cwd.
        </p>

        <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
          Folder
        </label>
        <div className="mb-3 flex items-stretch gap-2">
          <div
            className={`flex-1 rounded border border-zinc-800 px-2 py-1.5 font-mono text-sm ${
              path ? "text-zinc-200" : "text-zinc-600"
            }`}
            title={path}
          >
            {path ? shortenPath(path) : "no folder selected"}
          </div>
          <button
            onClick={browse}
            className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Browse...
          </button>
        </div>

        <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
          Name
        </label>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className="mb-3 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-zinc-600"
          placeholder="My App"
        />

        <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
          Color
        </label>
        <div className="mb-5 flex flex-wrap gap-2">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`size-6 rounded-full border-2 transition ${
                c === color ? "border-zinc-100" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || !path.trim()}
            className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
