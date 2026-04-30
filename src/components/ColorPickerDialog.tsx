import { useEffect, useState } from "react";
import { PROJECT_COLORS } from "@/store";

interface ColorPickerDialogProps {
  open: boolean;
  initialValue: string;
  onCancel: () => void;
  onSubmit: (color: string) => void;
}

export function ColorPickerDialog({
  open,
  initialValue,
  onCancel,
  onSubmit,
}: ColorPickerDialogProps) {
  const [color, setColor] = useState(initialValue);

  useEffect(() => {
    if (open) setColor(initialValue);
  }, [open, initialValue]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[360px] rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold tracking-tight">
          Changer la couleur
        </h2>
        <div className="mb-5 flex flex-wrap gap-2">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`size-8 rounded-full border-2 transition ${
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
            onClick={() => onSubmit(color)}
            className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
