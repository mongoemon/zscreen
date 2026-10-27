// App-shell cache so the installed PWA opens instantly and works offline.
// Bump CACHE_VERSION whenever the shell files change.
const CACHE_VERSION = 'zcreenshot-v9';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './version.js',
  './i18n.js',
  './keys.js',
  './scene.js',
  './draw.js',
  './app.js',
  './viewport.js',
  './text-editor.js',
  './tools.js',
  './annotate.js',
  './scene-actions.js',
  './export.js',
  './region.js',
  './pointer.js',
  './input.js',
  './history-panel.js',
  './i18n-dom.js',
  './version-badge.js',
  './renderer.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive), falling back to the cache when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
