// Becoming Schwiizer service worker — version-based cache, network-first for index.html,
// cache-first for everything else.
//
// 🔄 To force every existing user to update: bump CACHE_VERSION.

const CACHE_VERSION = 'schwiizer-v31-2026-05-30-verabreden';
const CACHE_NAME = CACHE_VERSION;

// On install, skip waiting so the new SW activates immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// On activate, clean up old caches AND claim all clients (force-update open tabs)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
      // Tell all clients to reload so they pick up the new index.html
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => {
        c.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
      });
    })()
  );
});

// Strategy:
//   - HTML (navigation requests, /, /index.html): network-first, fall back to cache
//   - Other GETs (CSS bundled inline, fonts, images): cache-first, fall back to network
//   - Audio files (/audio/*): cache-first with background refresh
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin requests we don't want to cache (analytics, API calls, etc.)
  if (url.origin !== location.origin) {
    return; // let browser handle it
  }

  // Network-first for navigation and HTML — so a github-pages deploy lands ASAP
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: 'no-store' });
          // Update the cache in the background
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          // Offline → serve from cache
          const cached = await caches.match(req);
          if (cached) return cached;
          // Last resort: serve the cached index
          const indexCached = await caches.match('/index.html') || await caches.match('/');
          return indexCached || new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) {
        // Refresh in background (stale-while-revalidate)
        fetch(req).then((fresh) => {
          if (fresh && fresh.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, fresh.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'Offline and not cached' });
      }
    })()
  );
});
