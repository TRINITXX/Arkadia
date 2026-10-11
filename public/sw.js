// Offline cache of the phone companion page. With Arkadia closed (or the PC
// off), the page still opens from here and can say so, and offer to start
// Arkadia through the gate. The page itself is network-first so an update
// shows up as soon as Arkadia serves it; hashed bundle files never change.

const CACHE = "arkadia-mobile-v2";
const EXTRAS = ["/mobile/manifest.webmanifest", "/mobile/icon-180.png"];
/** A PC that is off can leave a request hanging: fall back to the copy. */
const NETWORK_TIMEOUT_MS = 4000;

/** Caches the page and every bundle file it loads, read from its HTML. */
async function cachePage(cache, response) {
  const html = await response.clone().text();
  await cache.put("/", response);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  await cache.addAll(assets);
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

function fetchWithTimeout(request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { signal: abort.signal }).finally(() =>
    clearTimeout(timer),
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // The gate answers live questions ("is Arkadia running?"): never cached.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/gate/")
  )
    return;
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  // Arkadia closed: Tailscale answers 502, which must fall back too.
  event.respondWith(
    fetchWithTimeout(event.request)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        if (url.pathname === "/") {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => cachePage(c, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((hit) => hit || caches.match("/"))
          .then((hit) => hit || Response.error()),
      ),
  );
});
