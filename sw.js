/* Nocta service worker
 *
 * Strategy:
 *   - App shell (the HTML itself, the manifest, the icons): stale-while-revalidate.
 *     Offline launch always opens something sensible.
 *   - Third-party CDN scripts (marked, KaTeX, highlight.js, fonts, code CSS):
 *     cache-first with network fallback. They don't change often and we want
 *     them available offline.
 *   - Ollama API calls (/api/*): network-only with a tiny in-flight cache
 *     dedupe. Never cache chat responses.
 *   - Everything else: network-first, fall back to cached version offline.
 *
 * Bump CACHE_VERSION on any change to app shell HTML/CSS/JS.
 */
const CACHE_VERSION = "nocta-v7";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/favicon-32.png",
  "./assets/favicon-16.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-192.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // addAll is atomic — if any request fails the install fails.
        // Use individual add() so a single 404 doesn't break installation.
        Promise.all(
          SHELL_ASSETS.map((url) =>
            cache
              .add(new Request(url, { cache: "reload" }))
              .catch(() => undefined)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isCdnAsset(url) {
  return (
    url.hostname === "cdnjs.cloudflare.com" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Network-only for /api/* (chat, tags, etc.). Don't cache user data.
  if (url.pathname.includes("/api/")) {
    return; // fall through to default network fetch
  }

  // Cache-first for CDN assets.
  if (isCdnAsset(url)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          // Refresh in the background.
          fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone());
            })
            .catch(() => undefined);
          return cached;
        }
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          // Last resort: return a synthetic opaque response so the page
          // doesn't crash when offline and missing a critical CDN.
          return new Response("", { status: 504, statusText: "offline" });
        }
      })
    );
    return;
  }

  // Stale-while-revalidate for same-origin shell assets.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || (await networkPromise) || Response.error();
      })
    );
    return;
  }

  // Everything else: try network, fall back to runtime cache.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })
  );
});

// Allow the page to ask the SW to skip waiting (used after a version bump).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
