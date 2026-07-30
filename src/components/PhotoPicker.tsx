import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { fetchThumbnailUrl } from "@/lib/imageUrlCache";
import { subscribeStable } from "@/lib/tauriEvents";

/** Mirrors `PhotoEntry` in `src-tauri/src/photos.rs`. */
interface PhotoEntry {
  path: string;
  name: string;
  mtime: number;
}

/** Tiles per row. The backend returns exactly 10, so the grid is 5×2. */
const COLS = 5;

/** Backend signal that the roll gained, lost or changed a listable photo. */
const ROLL_CHANGED = "photos-changed";

/**
 * A listing started on hover, and how long it stays usable. Hovering the button
 * buys the roughly one round-trip of listing plus the thumbnail generation that
 * would otherwise run after the click; the age cap keeps a hover that never
 * became a click from serving a stale roll ten minutes later.
 */
let prefetched: { at: number; roll: Promise<PhotoEntry[]> } | null = null;
const PREFETCH_TTL_MS = 30_000;

/** Lists the roll and warms every thumbnail. Safe to call repeatedly. */
export function prefetchPhotos() {
  if (prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS) return;
  const roll = invoke<PhotoEntry[]>("list_recent_photos");
  void roll
    .then((list) =>
      list.forEach((p) => void fetchThumbnailUrl(p.path, p.mtime)),
    )
    .catch(() => {});
  prefetched = { at: Date.now(), roll };
}

/** Drops a prefetch the watcher has just made obsolete. */
function invalidatePrefetch() {
  prefetched = null;
}

/** Consumes a fresh-enough prefetch, or starts a listing of its own. */
function takeRoll(): Promise<PhotoEntry[]> {
  const hit =
    prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS
      ? prefetched.roll
      : null;
  prefetched = null;
  return hit ?? invoke<PhotoEntry[]>("list_recent_photos");
}

interface PhotoPickerProps {
  /** Types the paths into the pane and closes; empty selections never reach it. */
  onInsert: (paths: string[]) => void;
  onClose: () => void;
}

/**
 * The camera-roll picker: the ten most recent readable photos, newest first.
 *
 * It takes keyboard focus on open — arrows move, space toggles, Enter inserts,
 * Escape cancels — and the rail hands focus back to the terminal afterwards.
 * Closing on an outside click is the rail's job, since its own button sits
 * outside this subtree.
 */
export function PhotoPicker({ onInsert, onClose }: PhotoPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [photos, setPhotos] = useState<PhotoEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Insertion order is the display order of the badges, so this is a list.
  const [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  // Bumped by the watcher; the first pass consumes the hover prefetch, later
  // ones always go back to the backend for a genuinely current roll.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const roll =
      reloadKey === 0 ? takeRoll() : invoke<PhotoEntry[]>("list_recent_photos");
    roll
      .then((list) => {
        if (!active) return;
        setPhotos(list);
        setError(null);
        // A refresh can drop a photo that was picked, or shorten the grid under
        // the cursor.
        const paths = new Set(list.map((p) => p.path));
        setSelected((prev) => prev.filter((p) => paths.has(p)));
        setCursor((c) => Math.min(c, Math.max(0, list.length - 1)));
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // iCloud dropping a new photo in refreshes the grid in place. Disposed on
  // unmount, so closing and reopening never stacks a second listener.
  useEffect(
    () =>
      subscribeStable(listen, ROLL_CHANGED, () => {
        invalidatePrefetch();
        setReloadKey((k) => k + 1);
      }),
    [],
  );

  // Grab focus once mounted so the shortcuts below reach us rather than the PTY.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const toggle = useCallback((path: string) => {
    setSelected((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  const insert = useCallback(() => {
    if (selected.length > 0) onInsert(selected);
  }, [selected, onInsert]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = photos?.length ?? 0;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -COLS,
      ArrowDown: COLS,
    };
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      insert();
    } else if (e.key === " " && count > 0) {
      e.preventDefault();
      toggle(photos![cursor].path);
    } else if (e.key in step && count > 0) {
      e.preventDefault();
      const next = cursor + step[e.key];
      if (next >= 0 && next < count) setCursor(next);
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The rail blocks mousedown to keep the terminal focused; this panel wants
      // the focus, so its clicks must not reach that handler.
      onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute bottom-full right-0 mb-2 w-[512px] rounded border border-zinc-800 bg-zinc-950 p-2.5 shadow-xl outline-none"
      role="dialog"
      aria-label="Photos récentes"
    >
      {error !== null ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-500">{error}</p>
      ) : photos === null ? (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
          <Loader2 size={13} className="animate-spin" /> Lecture du dossier…
        </p>
      ) : photos.length === 0 ? (
        <p className="px-1 py-8 text-center text-xs text-zinc-500">
          Aucune photo (HEIC, JPEG, PNG, GIF, WebP) dans le dossier.
        </p>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {photos.map((photo, i) => (
            <PhotoTile
              key={photo.path}
              photo={photo}
              rank={selected.indexOf(photo.path)}
              atCursor={i === cursor}
              onPick={() => {
                setCursor(i);
                toggle(photo.path);
              }}
            />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-2">
        <span className="truncate text-[11px] text-zinc-500">
          {selected.length === 0
            ? "Clic pour sélectionner · Échap pour fermer"
            : `${selected.length} photo${selected.length > 1 ? "s" : ""} sélectionnée${selected.length > 1 ? "s" : ""}`}
        </span>
        <button
          type="button"
          onClick={insert}
          disabled={selected.length === 0}
          className="shrink-0 rounded bg-[rgba(56,189,248,0.15)] px-2.5 py-1 text-[11px] text-sky-200 transition-colors hover:bg-[rgba(56,189,248,0.28)] disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600"
        >
          Insérer{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}

interface PhotoTileProps {
  photo: PhotoEntry;
  /** Position in the selection, or -1 when unselected. */
  rank: number;
  atCursor: boolean;
  onPick: () => void;
}

/** One square thumbnail; a photo whose bytes can't be read renders its name. */
function PhotoTile({ photo, rank, atCursor, onPick }: PhotoTileProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchThumbnailUrl(photo.path, photo.mtime).then((u) => {
      if (!active) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [photo.path, photo.mtime]);

  const picked = rank >= 0;
  return (
    <button
      type="button"
      onClick={onPick}
      title={photo.name}
      aria-pressed={picked}
      className={`relative aspect-square overflow-hidden rounded border transition-colors ${
        picked
          ? "border-sky-400"
          : atCursor
            ? "border-zinc-500"
            : "border-zinc-800 hover:border-zinc-600"
      }`}
    >
      {url ? (
        <img
          src={url}
          alt={photo.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-zinc-900 px-1 text-[9px] leading-tight text-zinc-600">
          <ImageIcon size={14} />
          {failed && (
            <span className="line-clamp-2 break-all">{photo.name}</span>
          )}
        </span>
      )}
      {picked && (
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-semibold text-zinc-950">
          {rank + 1}
        </span>
      )}
    </button>
  );
}
