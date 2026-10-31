import { draftFile } from "@/lib/chat/chatAttachments";
import type { ChatDraft } from "@/lib/chat/chatDrafts";

/**
 * Chat drafts written to the webview's storage, so a page reload (the
 * watchdog rebuilding the window) or a restart keeps what was being typed.
 * Text and attached paths are always kept (a few dozen paths per pane);
 * pasted images only up to a few per pane and a total size, the newest
 * first: the storage is small and shared by the page.
 */

export const DRAFTS_KEY = "arkadia.chatDrafts.v1";
/** Pasted images kept per pane, the newest. */
export const KEPT_IMAGES = 4;
/** Base64 characters of images kept across all panes. */
export const KEPT_IMAGE_CHARS = 2_500_000;
/** Attached paths kept per pane, the first ones. */
export const KEPT_FILES = 40;
/** A draft nobody came back to (pane closed without Arkadia) goes. */
export const DRAFT_TTL_MS = 7 * 24 * 3_600_000;

interface StoredImage {
  mediaType: string;
  data: string;
}
interface StoredDraft {
  text: string;
  images: StoredImage[];
  /** Attached paths; absent before they existed. */
  files?: string[];
  savedAt: number;
}

/** The drafts to store, images capped; `withImages` false keeps text alone. */
export function serializeDrafts(
  drafts: ReadonlyMap<string, ChatDraft>,
  savedAt: ReadonlyMap<string, number>,
  now: number,
  withImages = true,
): string {
  let budget = withImages ? KEPT_IMAGE_CHARS : 0;
  const out: Record<string, StoredDraft> = {};
  // The latest typed first: their images take the budget.
  const order = [...drafts.keys()].sort(
    (a, b) => (savedAt.get(b) ?? now) - (savedAt.get(a) ?? now),
  );
  for (const paneId of order) {
    const draft = drafts.get(paneId)!;
    const images: StoredImage[] = [];
    for (const img of [...draft.images].reverse()) {
      if (images.length >= KEPT_IMAGES || img.data.length > budget) continue;
      budget -= img.data.length;
      images.unshift({ mediaType: img.mediaType, data: img.data });
    }
    const files = (draft.files ?? []).slice(0, KEPT_FILES).map((f) => f.path);
    if (!draft.text && images.length === 0 && files.length === 0) continue;
    out[paneId] = {
      text: draft.text,
      images,
      ...(files.length > 0 && { files }),
      savedAt: savedAt.get(paneId) ?? now,
    };
  }
  return JSON.stringify(out);
}

/** Drafts read back, the stale ones dropped; nothing on a torn value. */
export function parseDrafts(
  raw: string | null,
  now: number,
): Map<string, { draft: ChatDraft; savedAt: number }> {
  const out = new Map<string, { draft: ChatDraft; savedAt: number }>();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  for (const [paneId, value] of Object.entries(parsed)) {
    const v = value as Partial<StoredDraft>;
    if (typeof v.savedAt !== "number" || now - v.savedAt > DRAFT_TTL_MS)
      continue;
    const images = (Array.isArray(v.images) ? v.images : [])
      .filter(
        (i): i is StoredImage =>
          typeof i?.mediaType === "string" && typeof i?.data === "string",
      )
      .map((img, n) => ({
        ...img,
        id: `restored-${paneId}-${n}`,
        url: `data:${img.mediaType};base64,${img.data}`,
      }));
    const files = (Array.isArray(v.files) ? v.files : [])
      .filter((p): p is string => typeof p === "string")
      .slice(0, KEPT_FILES)
      .map(draftFile);
    const text = typeof v.text === "string" ? v.text : "";
    if (!text && images.length === 0 && files.length === 0) continue;
    out.set(paneId, {
      draft: files.length > 0 ? { text, images, files } : { text, images },
      savedAt: v.savedAt,
    });
  }
  return out;
}
