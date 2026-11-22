// Minimal, safe PWA service worker for SyndicUnion.
// Caches only static PWA brand assets (icons & manifest) and passes all API, auth,
// upload, and HTML/JS requests straight through to the network so users never see
// stale financial balances, AG votes, or outdated application bundles.

const CACHE_NAME = 'syndicunion-pwa-assets-v2';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icons/syndicunion-icon.svg',
  '/icons/favicon-32x32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API, uploads, or dynamic routes
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    !STATIC_ASSETS.includes(url.pathname)
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        }),
    ),
  );
});
