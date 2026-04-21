// Trainos Service Worker — v3
// Strategy:
//  - Shell (HTML/JS/icons): stale-while-revalidate → instant load from cache, background-refresh for next visit
//  - External assets (fonts, exercise images): cache-first with 7-day TTL
//  - Firebase/Google APIs: pass through, never cache
//
// Bumped CACHE_NAME → old caches (trainos-v2) auto-purged on activate.

const CACHE_VERSION = 'v3';
const SHELL_CACHE = `trainos-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `trainos-assets-${CACHE_VERSION}`;
const ALL_CACHES = [SHELL_CACHE, ASSET_CACHE];

const SHELL_URLS = [
  '/trainos/',
  '/trainos/index.html',
  '/trainos/coach.html',
  '/trainos/exercises.js',
  '/trainos/manifest.json',
  '/trainos/favicon.png',
  '/trainos/apple-touch-icon.png',
  '/trainos/icon-192.png',
  '/trainos/icon-512.png',
];

const ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Install — prefetch shell
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_URLS)));
  self.skipWaiting();
});

// Activate — nuke caches from older versions so users get fresh bundle
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Helper: is this a request for our own app shell (same origin, under /trainos/)?
function isShellRequest(url) {
  try {
    const u = new URL(url);
    return u.origin === self.location.origin && u.pathname.startsWith('/trainos/');
  } catch { return false; }
}

// Helper: is this a cacheable external asset (fonts, exercise images)?
function isExternalAsset(url) {
  return url.includes('fonts.googleapis.com') ||
         url.includes('fonts.gstatic.com') ||
         url.includes('raw.githubusercontent.com');
}

// Helper: is this a never-cache API request?
function isApiRequest(url) {
  return url.includes('firestore.googleapis.com') ||
         url.includes('identitytoolkit.googleapis.com') ||
         url.includes('securetoken.googleapis.com') ||
         url.includes('accounts.google') ||
         url.includes('generativelanguage.googleapis.com'); // Gemini
}

// Stale-while-revalidate: return cache immediately, update cache from network in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(resp => {
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);
  // If no cache AND network returns non-ok (e.g. 304 with empty body when we have no cache), prefer offline response
  const networkOrOffline = networkPromise.then(r => (r && r.ok) ? r : new Response('Offline', { status: 503 }));
  return cached || networkOrOffline;
}

// Cache-first with TTL: serve cache if fresh, else fetch + store
async function cacheFirstWithTTL(request, cacheName, ttl) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    const dateHeader = cached.headers.get('sw-cached-at');
    if (dateHeader && Date.now() - parseInt(dateHeader) < ttl) return cached;
  }
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      // Clone and add a timestamp header so we can expire it
      const headers = new Headers(resp.headers);
      headers.set('sw-cached-at', String(Date.now()));
      const body = await resp.clone().blob();
      const stamped = new Response(body, { status: resp.status, statusText: resp.statusText, headers });
      cache.put(request, stamped);
    }
    return resp;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // Never intercept API calls — let them hit the network directly
  if (isApiRequest(url)) return;

  // App shell → stale-while-revalidate (users get updates next visit, no manual refresh needed)
  if (isShellRequest(url)) {
    e.respondWith(staleWhileRevalidate(e.request, SHELL_CACHE));
    return;
  }

  // External assets (fonts, exercise gifs) → cache-first with 7-day TTL
  if (isExternalAsset(url)) {
    e.respondWith(cacheFirstWithTTL(e.request, ASSET_CACHE, ASSET_TTL_MS));
    return;
  }

  // Everything else (CDNs, etc.) — pass through without caching
});
