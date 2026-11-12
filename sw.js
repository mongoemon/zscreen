// App-shell cache so the installed PWA opens instantly and works offline.
// Bump CACHE_VERSION whenever the shell files change.
// The OCR files in ocr/ (~8 MB) and the speech-to-text engine in stt/ (~15 MB) are not precached:
// the fetch handler below caches them on first use. The speech model (stt/models/, ~240 MB) is
// never cached here. Activating a new version deletes every other cache, including the model cache
// (zcreenshot-stt-…) that v1.7.0 downloaded into.
const CACHE_VERSION = 'zcreenshot-v26';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './version.js',
  './i18n.js',
  './keys.js',
  './shortcuts.js',
  './video-options.js',
  './blank-page.js',
  './gif-encoder.js',
  './webm-duration.js',
  './scene.js',
  './doc-tabs.js',
  './draw.js',
  './app.js',
  './viewport.js',
  './text-editor.js',
  './tools.js',
  './selection.js',
  './annotate.js',
  './scene-actions.js',
  './export.js',
  './region.js',
  './ocr-config.js',
  './ocr.js',
  './stt-config.js',
  './stt.js',
  './text-snippets.js',
  './snippets-dialog.js',
  './blank-dialog.js',
  './shortcut-settings.js',
  './documents.js',
  './mediabunny.min.js',
  './mediabunny-mp3-encoder.min.js',
  './THIRD_PARTY_LICENSES.txt',
  './video-editor.js',
  './scroll-stitch.js',
  './scroll-capture.js',
  './recorder.js',
  './pointer.js',
  './input.js',
  './clipboard-history.js',
  './web-history.js',
  './history-panel.js',
  './i18n-dom.js',
  './version-badge.js',
  './dialog-drag.js',
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
      .then((keys) => Promise.all(keys
        .filter((k) => k !== CACHE_VERSION)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive), falling back to the cache when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).pathname.includes('/stt/models/')) return; // far too big for the app cache
  event.respondWith(
    // 'no-cache' revalidates with the server so the browser's HTTP cache cannot serve a stale shell
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
