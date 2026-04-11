const CACHE_NAME = 'trainos-v2';
const URLS_TO_CACHE = [
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

// Install — cache app shell
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS_TO_CACHE)));
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Fetch — cache first, network fallback (skip Firebase/Google API calls)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.includes('firestore') || url.includes('googleapis') || url.includes('gstatic') || url.includes('accounts.google')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // Cache new resources (fonts, exercise images)
        if (resp.ok && (url.includes('fonts.googleapis') || url.includes('raw.githubusercontent'))) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
