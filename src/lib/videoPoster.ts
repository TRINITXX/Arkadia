import { mediaUrl } from "@/lib/bridge";

/** What a video's thumbnail shows. */
export interface VideoPoster {
  /**
   * A still taken a third of the way in (recordings of a page often open on
   * a blank frame); null when this view cannot decode the file.
   */
  url: string | null;
  /** Length in seconds, when the file says. */
  duration?: number;
}

/**
 * Path → poster, failures included (null: no such file), so a path is probed
 * once. Capped like the image cache, revoking the oldest still.
 */
const cache = new Map<string, Promise<VideoPoster | null>>();
const CACHE_MAX = 80;
/** Width of the still: thumbnails and hover previews never show it larger. */
const POSTER_WIDTH = 640;
/** A file that never decodes (a codec the view lacks) gives up past this. */
const GRAB_TIMEOUT_MS = 10_000;
/** A PC that is off leaves the phone's request hanging: give up past this. */
const PROBE_TIMEOUT_MS = 4000;
/** Decoders running at once: a screen of videos must not open them all. */
const MAX_GRABS = 2;

export function fetchVideoPoster(path: string): Promise<VideoPoster | null> {
  const cached = cache.get(path);
  if (cached) return cached;
  const promise = probe(path).then((found) => {
    // Unreachable is no answer: the next look asks again.
    if (found === "unreachable" && cache.get(path) === promise) {
      cache.delete(path);
    }
    return found === "found" ? withSlot(() => grabFrame(mediaUrl(path))) : null;
  });
  if (cache.size >= CACHE_MAX) {
    const [oldestKey, oldest] = cache.entries().next().value!;
    cache.delete(oldestKey);
    void oldest.then((poster) => {
      if (poster?.url) URL.revokeObjectURL(poster.url);
    });
  }
  cache.set(path, promise);
  return promise;
}

/**
 * `13.8` → `0:13`, `3725` → `1:02:05`. Rounded down, as the player's own
 * controls count, so the thumbnail and the lightbox agree.
 */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Whether the file is there: a decode failure alone can't tell a missing file. */
async function probe(
  path: string,
): Promise<"found" | "missing" | "unreachable"> {
  try {
    const res = await window.fetch(mediaUrl(path), {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok ? "found" : "missing";
  } catch {
    return "unreachable";
  }
}

let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  // A finishing task hands its slot straight to the next in line, so a new
  // caller can't slip in between and run one decoder too many.
  if (running < MAX_GRABS) running++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/** Seeks a detached `<video>` a third of the way in and draws that frame. */
function grabFrame(src: string): Promise<VideoPoster> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    // The still is drawn on a canvas: the desktop serves the file from
    // another origin, which would taint it without CORS.
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let duration: number | undefined;
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // Releases the decoder and the open stream.
      video.removeAttribute("src");
      video.load();
      resolve(duration === undefined ? { url } : { url, duration });
    };
    const timer = window.setTimeout(() => finish(null), GRAB_TIMEOUT_MS);
    video.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          duration = video.duration;
        }
        // No known length (a live-recorded webm): a moment in will do.
        video.currentTime = duration !== undefined ? duration / 3 : 0.5;
      },
      { once: true },
    );
    video.addEventListener(
      "seeked",
      () => {
        if (!video.videoWidth) return finish(null);
        const scale = Math.min(1, POSTER_WIDTH / video.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        try {
          canvas
            .getContext("2d")
            ?.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            // Past the timeout, nobody would ever revoke this URL.
            (blob) =>
              finish(blob && !settled ? URL.createObjectURL(blob) : null),
            "image/jpeg",
            0.82,
          );
        } catch {
          finish(null);
        }
      },
      { once: true },
    );
    video.addEventListener("error", () => finish(null), { once: true });
    video.src = src;
  });
}
