// Offline cache of the phone companion page. With Arkadia closed (or the PC
// off), the page still opens from here and can say so, and offer to start
// Arkadia through the gate. The page waits a moment for Arkadia's fresh one,
// else opens from the copy; hashed bundle files never change.

// v3: v2 could hold a page without its bundle files (white page, PC off).
const CACHE = "arkadia-mobile-v3";
const EXTRAS = ["/mobile/manifest.webmanifest", "/mobile/icon-180.png"];
/** A PC that is off can leave a request hanging: give up past this. */
const NETWORK_TIMEOUT_MS = 4000;
/**
 * How long the page waits for the PC before opening from the copy: with the
 * PC off, « PC éteint » shows about this fast. A slow PC still refreshes the
 * copy in the background, so it only costs the newest page until next launch.
 */
const PAGE_WAIT_MS = 1500;
const PAGE_REFRESH_TIMEOUT_MS = 15_000;

/**
 * Caches the page and every bundle file it loads, read from its HTML. The
 * page goes in last, once its files are in: a cached page missing one stays
 * white with the PC off. The files of older pages go out after it.
 */
async function cachePage(cache, response) {
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  // None found: the HTML changed shape. Keep the copy that works.
  if (!assets.length) return;
  await cache.addAll(assets);
  await cache.put("/", response);
  const keep = new Set(assets);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(EXTRAS);
      const page = await fetch("/", { cache: "no-store" });
      if (page.ok) await cachePage(cache, page);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request, timeoutMs = NETWORK_TIMEOUT_MS) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  return fetch(request, { signal: abort.signal }).finally(() =>
    clearTimeout(timer),
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // The gate answers live questions ("is Arkadia running?") and /image serves
  // the conversation's pictures: never cached, never answered with the page.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/gate/") ||
    url.pathname === "/image"
  )
    return;
  // Cache writes run under waitUntil: iOS may stop the worker as soon as the
  // response is out, leaving a write half done.
  if (url.pathname.startsWith("/assets/")) {
    const got = caches.match(event.request).then((hit) =>
      hit
        ? { res: hit, copy: null }
        : fetchWithTimeout(event.request).then((res) => ({
            res,
            copy: res.ok ? res.clone() : null,
          })),
    );
    event.respondWith(got.then(({ res }) => res));
    event.waitUntil(
      got
        .then(
          ({ copy }) =>
            copy && caches.open(CACHE).then((c) => c.put(event.request, copy)),
        )
        .catch(() => {}),
    );
    return;
  }
  // Arkadia closed: Tailscale answers 502, which must fall back too.
  const fresh = (timeoutMs) =>
    fetchWithTimeout(event.request, timeoutMs).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res;
    });
  // The manifest and the icon: from the PC, else their copy, never the page.
  if (event.request.mode !== "navigate") {
    event.respondWith(
      fresh().catch(() =>
        caches.match(event.request).then((hit) => hit || Response.error()),
      ),
    );
    return;
  }
  const page = fresh(PAGE_REFRESH_TIMEOUT_MS).then((res) => ({
    res,
    copy: url.pathname === "/" ? res.clone() : null,
  }));
  const cached = () =>
    caches.match(event.request).then((hit) => hit || caches.match("/"));
  const slow = new Promise((resolve) =>
    setTimeout(() => resolve(null), PAGE_WAIT_MS),
  );
  event.respondWith(
    Promise.race([page.then(({ res }) => res), slow])
      // Slow: the copy, or the PC after all when there is none yet.
      .then(
        (res) => res || cached().then((hit) => hit || page.then((p) => p.res)),
      )
      .catch(() => cached().then((hit) => hit || Response.error())),
  );
  event.waitUntil(
    page
      .then(
        ({ copy }) =>
          copy && caches.open(CACHE).then((c) => cachePage(c, copy)),
      )
      .catch(() => {}),
  );
});
