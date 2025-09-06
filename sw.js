
const CACHE = 'manhole-pro-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './lib/jszip.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './brand/logo.png'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => { const copy=resp.clone(); caches.open(CACHE).then(cache => cache.put(e.request, copy)); return resp; }).catch(() => cached)));
  }
});
