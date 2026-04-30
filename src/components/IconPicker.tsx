import { useEffect, useRef, useState } from "react";
import { ICON_NAMES, getIcon } from "@/icons";

interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const Current = getIcon(value);
  const filtered = filter
    ? ICON_NAMES.filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
    : ICON_NAMES;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900"
        title={value || "no icon"}
        type="button"
      >
        {Current ? (
          <Current size={16} />
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded border border-zinc-800 bg-zinc-950 p-2 shadow-xl"
        >
          <div className="mb-2 flex items-center gap-1">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="search..."
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs outline-none focus:border-zinc-600"
            />
            {value && (
              <button
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-900"
                title="Clear icon"
                type="button"
              >
                clear
              </button>
            )}
          </div>
          <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
            {filtered.map((name) => {
              const Icon = getIcon(name);
              if (!Icon) return null;
              const selected = name === value;
              return (
                <button
                  key={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className={`flex size-8 items-center justify-center rounded ${
                    selected
                      ? "bg-zinc-700 text-zinc-50"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                  title={name}
                  type="button"
                >
                  <Icon size={16} />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-7 py-3 text-center text-xs text-zinc-500">
                no match
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
