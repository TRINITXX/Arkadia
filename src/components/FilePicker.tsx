import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import {
  ImageHoverPreview,
  useImageHoverPreview,
} from "@/components/ImageHoverPreview";
import { formatSize } from "@/lib/fileSize";
import { isImagePath } from "@/lib/imagePaths";
import { fetchThumbnailUrl } from "@/lib/imageUrlCache";
import { formatWhen } from "@/lib/sessionsIndex";
import { subscribeStable } from "@/lib/tauriEvents";
import { useLazyThumbnail } from "@/lib/useLazyThumbnail";

/** Mirrors `Source` in `src-tauri/src/photos.rs`. */
type SourceKey = "photos" | "downloads";

/** Mirrors `FileEntry` in `src-tauri/src/photos.rs`. */
interface FileEntry {
  path: string;
  name: string;
  mtime: number;
  size: number;
  is_dir: boolean;
  is_image: boolean;
}

const TABS: { key: SourceKey; label: string }[] = [
  { key: "photos", label: "Photos" },
  { key: "downloads", label: "Téléchargements" },
];

/** Tiles per row in the photo grid; the downloads list is one column. */
const PHOTO_COLS = 5;

/**
 * Entries per listing step. Enough to overflow the panel, so scrolling to its
 * bottom is what asks for the next step.
 */
const PAGE = 30;
/** Distance from the list's bottom, in px, at which the next step is fetched. */
const NEAR_END_PX = 200;

/** Backend signal that a watched folder changed; payload is the source key. */
const FILES_CHANGED = "recent-files-changed";

const EMPTY: Record<SourceKey, null> = { photos: null, downloads: null };
const FIRST_PAGE: Record<SourceKey, number> = { photos: PAGE, downloads: PAGE };

/**
 * A photo listing started on hover, and how long it stays usable. Hovering the
 * button buys the round-trip of listing plus the thumbnail generation that would
 * otherwise run after the click; the age cap keeps a hover that never became a
 * click from serving a stale roll ten minutes later.
 */
let prefetched: { at: number; roll: Promise<FileEntry[]> } | null = null;
const PREFETCH_TTL_MS = 30_000;

function listSource(source: SourceKey, limit: number): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_recent_files", { source, limit });
}

/** Lists the roll's first page and warms its thumbnails. Safe to call repeatedly. */
export function prefetchPhotos() {
  if (prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS) return;
  const roll = listSource("photos", PAGE);
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

/**
 * Consumes a fresh-enough photo prefetch, or lists the source from scratch. The
 * prefetch only ever holds the first page, so a deeper listing skips it.
 */
function takeList(source: SourceKey, limit: number): Promise<FileEntry[]> {
  if (source !== "photos" || limit !== PAGE) return listSource(source, limit);
  const hit =
    prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS
      ? prefetched.roll
      : null;
  prefetched = null;
  return hit ?? listSource("photos", limit);
}

interface FilePickerProps {
  /** Types the paths into the pane and closes; empty selections never reach it. */
  onInsert: (paths: string[]) => void;
  onClose: () => void;
}

/**
 * The input rail's file picker: the camera roll as a grid of thumbnails, and
 * the downloads as a list, both newest first and extended a page at a time as
 * the panel is scrolled. A download that is an image shows its thumbnail; the
 * rest show an icon.
 *
 * The selection spans both tabs, so a screenshot and a log file can go into the
 * same prompt. It takes keyboard focus on open — arrows move, space toggles, Tab
 * switches tab, Enter inserts, Escape cancels — and the rail hands focus back to
 * the terminal afterwards. Closing on an outside click is the rail's job, since
 * its own button sits outside this subtree.
 */
export function FilePicker({ onInsert, onClose }: FilePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  // How deep each tab has been scrolled into, in entries. A refresh keeps it.
  const [limits, setLimits] = useState(FIRST_PAGE);
  // A download's thumbnail, hovered, shows the image larger beside the panel.
  const {
    preview,
    api: previewApi,
    elRef: previewElRef,
  } = useImageHoverPreview();

  const entries = lists[tab];
  const limit = limits[tab];
  // Only the tab on screen re-lists on news; the other reloads when shown.
  const refreshes = nonce[tab];
  // Reference point for the rows' relative dates. Stamped alongside each load
  // rather than during render, which has to stay pure.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    const source = tab;
    takeList(source, limit)
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
  }, [tab, refreshes, limit]);

  // Asks for the next page once the list is scrolled near its end. A listing
  // shorter than requested means either the folder has nothing older or the
  // next page is still on its way, and neither should ask again.
  const loadMoreNearEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el || entries === null || entries.length < limit) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_END_PX) return;
    setLimits((prev) => ({ ...prev, [tab]: limit + PAGE }));
  }, [entries, limit, tab]);

  // A page too short to fill the panel never scrolls, so also check on arrival.
  useEffect(loadMoreNearEnd, [loadMoreNearEnd]);

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

  // Beside the panel rather than over it, level with the hovered row, so the
  // rest of the list stays in view.
  const previewImage = useCallback(
    (path: string, thumb: HTMLElement | null) => {
      const panel = rootRef.current?.getBoundingClientRect();
      if (!thumb || !panel) {
        previewApi.hover(null);
        return;
      }
      const row = thumb.getBoundingClientRect();
      previewApi.hover(path, {
        left: panel.left,
        right: panel.right,
        top: row.top,
        bottom: row.bottom,
      });
    },
    [previewApi],
  );

  // A tab opens scrolled to its top, so its cursor starts there too rather
  // than on a row off screen. And switching unmounts the hovered row before
  // it can report leaving, so its preview goes with it.
  useEffect(() => {
    setCursor(0);
    previewApi.hide();
  }, [tab, previewApi]);

  // The rows move under a still pointer, so the card would float beside the
  // wrong one; the next row hovered brings its own.
  const onScroll = () => {
    previewApi.hide();
    loadMoreNearEnd();
  };

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
      if (next < 0 || next >= count) return;
      setCursor(next);
      // The scroller's only child is the grid or the list, one child per entry.
      scrollRef.current?.firstElementChild?.children[next]?.scrollIntoView({
        block: "nearest",
      });
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
      ) : (
        // Keyed by tab so each one opens scrolled to its top.
        <div
          key={tab}
          ref={scrollRef}
          onScroll={onScroll}
          className="scrollbar-none max-h-80 overflow-y-auto"
        >
          {tab === "photos" ? (
            <div className="grid grid-cols-5 gap-1.5">
              {entries.map((photo, i) => (
                <PhotoTile
                  key={photo.path}
                  photo={photo}
                  scroller={scrollRef}
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
                  scroller={scrollRef}
                  rank={selected.indexOf(entry.path)}
                  atCursor={i === cursor}
                  onPick={() => {
                    setCursor(i);
                    toggle(entry.path);
                  }}
                  // Only what the webview decodes full size: not HEIC.
                  onPreview={
                    entry.is_image && isImagePath(entry.path)
                      ? (thumb) => previewImage(entry.path, thumb)
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {preview && <ImageHoverPreview preview={preview} elRef={previewElRef} />}

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
  /** The scrolling list, which decides when the row's thumbnail loads. */
  scroller: RefObject<HTMLElement | null>;
  /** Position in the selection, or -1 when unselected. */
  rank: number;
  atCursor: boolean;
  onPick: () => void;
  /** Fed the hovered thumbnail, then null on leaving it; absent, no preview. */
  onPreview?: (thumb: HTMLElement | null) => void;
}

/**
 * One download: what tells two files apart at a glance, and for an image, a
 * thumbnail of it.
 */
function FileRow({
  entry,
  now,
  scroller,
  rank,
  atCursor,
  onPick,
  onPreview,
}: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const { url } = useLazyThumbnail(
    ref,
    scroller,
    entry.path,
    entry.mtime,
    entry.is_image,
  );
  const picked = rank >= 0;
  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={onPick}
        title={entry.path}
        aria-pressed={picked}
        className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left transition-colors ${
          picked
            ? "border-sky-400 bg-[rgba(56,189,248,0.08)]"
            : atCursor
              ? "border-zinc-600 bg-zinc-900"
              : "border-transparent hover:bg-zinc-900"
        }`}
      >
        <span
          onMouseEnter={onPreview && ((e) => onPreview(e.currentTarget))}
          onMouseLeave={onPreview && (() => onPreview(null))}
          className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded text-zinc-500"
        >
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : entry.is_dir ? (
            <Folder size={13} />
          ) : entry.is_image ? (
            <ImageIcon size={13} />
          ) : (
            <FileIcon size={13} />
          )}
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
  /** The scrolling grid, which decides when the tile's thumbnail loads. */
  scroller: RefObject<HTMLElement | null>;
  /** Position in the selection, or -1 when unselected. */
  rank: number;
  atCursor: boolean;
  onPick: () => void;
}

/** One square thumbnail; a photo whose bytes can't be read renders its name. */
function PhotoTile({
  photo,
  scroller,
  rank,
  atCursor,
  onPick,
}: PhotoTileProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { url, failed } = useLazyThumbnail(
    ref,
    scroller,
    photo.path,
    photo.mtime,
  );

  const picked = rank >= 0;
  return (
    <button
      ref={ref}
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
