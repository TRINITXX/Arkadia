import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { formatSize } from "@/lib/fileSize";
import { fetchThumbnailUrl } from "@/lib/imageUrlCache";
import { formatWhen } from "@/lib/sessionsIndex";
import { subscribeStable } from "@/lib/tauriEvents";

/** Mirrors `Source` in `src-tauri/src/photos.rs`. */
type SourceKey = "photos" | "downloads";

/** Mirrors `FileEntry` in `src-tauri/src/photos.rs`. */
interface FileEntry {
  path: string;
  name: string;
  mtime: number;
  size: number;
  is_dir: boolean;
}

const TABS: { key: SourceKey; label: string }[] = [
  { key: "photos", label: "Photos" },
  { key: "downloads", label: "Téléchargements" },
];

/** Tiles per row in the photo grid; the downloads list is one column. */
const PHOTO_COLS = 5;

/** Backend signal that a watched folder changed; payload is the source key. */
const FILES_CHANGED = "recent-files-changed";

const EMPTY: Record<SourceKey, null> = { photos: null, downloads: null };

/**
 * A photo listing started on hover, and how long it stays usable. Hovering the
 * button buys the round-trip of listing plus the thumbnail generation that would
 * otherwise run after the click; the age cap keeps a hover that never became a
 * click from serving a stale roll ten minutes later.
 */
let prefetched: { at: number; roll: Promise<FileEntry[]> } | null = null;
const PREFETCH_TTL_MS = 30_000;

function listSource(source: SourceKey): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_recent_files", { source });
}

/** Lists the roll and warms every thumbnail. Safe to call repeatedly. */
export function prefetchPhotos() {
  if (prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS) return;
  const roll = listSource("photos");
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

/** Consumes a fresh-enough photo prefetch, or lists the source from scratch. */
function takeList(source: SourceKey): Promise<FileEntry[]> {
  if (source !== "photos") return listSource(source);
  const hit =
    prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS
      ? prefetched.roll
      : null;
  prefetched = null;
  return hit ?? listSource("photos");
}

interface FilePickerProps {
  /** Types the paths into the pane and closes; empty selections never reach it. */
  onInsert: (paths: string[]) => void;
  onClose: () => void;
}

/**
 * The input rail's file picker: the ten most recent camera-roll photos as a
 * grid, and the ten most recent downloads as a list. Downloads get no preview —
 * what lands there is an installer or a CSV as often as an image.
 *
 * The selection spans both tabs, so a screenshot and a log file can go into the
 * same prompt. It takes keyboard focus on open — arrows move, space toggles, Tab
 * switches tab, Enter inserts, Escape cancels — and the rail hands focus back to
 * the terminal afterwards. Closing on an outside click is the rail's job, since
 * its own button sits outside this subtree.
 */
export function FilePicker({ onInsert, onClose }: FilePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SourceKey>("photos");
  const [lists, setLists] =
    useState<Record<SourceKey, FileEntry[] | null>>(EMPTY);
  const [errors, setErrors] = useState<Record<SourceKey, string | null>>(EMPTY);
  // Insertion order is the display order of the badges, so this is a list.
  const [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  // Bumped per source by the watcher, to re-run the load effect below.
  const [nonce, setNonce] = useState<Record<SourceKey, number>>({
    photos: 0,
    downloads: 0,
  });

  const entries = lists[tab];
  // Reference point for the rows' relative dates. Stamped alongside each load
  // rather than during render, which has to stay pure.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    const source = tab;
    takeList(source)
      .then((list) => {
        if (!active) return;
        setNow(Date.now());
        setLists((prev) => ({ ...prev, [source]: list }));
        setErrors((prev) => ({ ...prev, [source]: null }));
      })
      .catch((e) => {
        if (!active) return;
        setErrors((prev) => ({ ...prev, [source]: String(e) }));
      });
    return () => {
      active = false;
    };
  }, [tab, nonce]);

  // A refresh can drop an entry that was picked. Returning `prev` untouched when
  // there is nothing to prune keeps this from looping on its own output.
  useEffect(() => {
    const known = new Set(
      [...(lists.photos ?? []), ...(lists.downloads ?? [])].map((e) => e.path),
    );
    if (known.size === 0) return;
    setSelected((prev) =>
      prev.every((p) => known.has(p)) ? prev : prev.filter((p) => known.has(p)),
    );
  }, [lists]);

  // Keep the cursor inside the tab actually on screen.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, (entries?.length ?? 1) - 1)));
  }, [entries, tab]);

  // Grab focus once mounted so the shortcuts below reach us rather than the PTY.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // A new photo syncing in, or a download finishing, refreshes its tab in place.
  // Disposed on unmount, so closing and reopening never stacks a second listener.
  useEffect(
    () =>
      subscribeStable<SourceKey>(listen, FILES_CHANGED, (source) => {
        if (source === "photos") invalidatePrefetch();
        setNonce((prev) => ({ ...prev, [source]: prev[source] + 1 }));
      }),
    [],
  );

  const toggle = useCallback((path: string) => {
    setSelected((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  const insert = useCallback(() => {
    if (selected.length > 0) onInsert(selected);
  }, [selected, onInsert]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = entries?.length ?? 0;
    const cols = tab === "photos" ? PHOTO_COLS : 1;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -cols,
      ArrowDown: cols,
    };
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      insert();
    } else if (e.key === "Tab") {
      e.preventDefault();
      setTab((t) => (t === "photos" ? "downloads" : "photos"));
    } else if (e.key === " " && count > 0) {
      e.preventDefault();
      toggle(entries![cursor].path);
    } else if (e.key in step && count > 0) {
      // In the one-column list, left and right have nowhere to go.
      if (cols === 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
        return;
      e.preventDefault();
      const next = cursor + step[e.key];
      if (next >= 0 && next < count) setCursor(next);
    }
  };

  const error = errors[tab];
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
      aria-label="Fichiers récents"
    >
      <div className="mb-2 flex items-center gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              tab === t.key
                ? "bg-[rgba(56,189,248,0.18)] text-sky-200"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error !== null ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-500">{error}</p>
      ) : entries === null ? (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
          <Loader2 size={13} className="animate-spin" /> Lecture du dossier…
        </p>
      ) : entries.length === 0 ? (
        <p className="px-1 py-8 text-center text-xs text-zinc-500">
          {tab === "photos"
            ? "Aucune photo (HEIC, JPEG, PNG, GIF, WebP) dans le dossier."
            : "Aucun fichier dans le dossier."}
        </p>
      ) : tab === "photos" ? (
        <div className="grid grid-cols-5 gap-1.5">
          {entries.map((photo, i) => (
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
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry, i) => (
            <FileRow
              key={entry.path}
              entry={entry}
              now={now}
              rank={selected.indexOf(entry.path)}
              atCursor={i === cursor}
              onPick={() => {
                setCursor(i);
                toggle(entry.path);
              }}
            />
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-2">
        <span className="truncate text-[11px] text-zinc-500">
          {selected.length === 0
            ? "Clic pour sélectionner · Tab pour changer d'onglet · Échap pour fermer"
            : `${selected.length} élément${selected.length > 1 ? "s" : ""} sélectionné${selected.length > 1 ? "s" : ""}`}
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

interface RowProps {
  entry: FileEntry;
  now: number;
  /** Position in the selection, or -1 when unselected. */
  rank: number;
  atCursor: boolean;
  onPick: () => void;
}

/** One download: no preview, just what tells two files apart at a glance. */
function FileRow({ entry, now, rank, atCursor, onPick }: RowProps) {
  const picked = rank >= 0;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        title={entry.path}
        aria-pressed={picked}
        className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
          picked
            ? "border-sky-400 bg-[rgba(56,189,248,0.08)]"
            : atCursor
              ? "border-zinc-600 bg-zinc-900"
              : "border-transparent hover:bg-zinc-900"
        }`}
      >
        <span className="shrink-0 text-zinc-500">
          {entry.is_dir ? <Folder size={13} /> : <FileIcon size={13} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">
          {entry.name}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
          {entry.is_dir ? "dossier" : formatSize(entry.size)}
        </span>
        <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">
          {formatWhen(entry.mtime, now)}
        </span>
        {picked && (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[9px] font-semibold text-zinc-950">
            {rank + 1}
          </span>
        )}
      </button>
    </li>
  );
}

interface PhotoTileProps {
  photo: FileEntry;
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
