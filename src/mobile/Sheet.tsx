/** A panel rising from the bottom of the screen over a dimmed backdrop. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        className="relative max-h-[75%] overflow-y-auto rounded-t-2xl border-t border-zinc-800 bg-zinc-950 pt-2"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-700" />
        <h2 className="px-4 pb-2 text-sm font-semibold text-zinc-300">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** A full-width row of a sheet. */
export function SheetRow({
  onClick,
  children,
  danger = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] active:bg-zinc-900 ${
        danger ? "text-red-400" : "text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
