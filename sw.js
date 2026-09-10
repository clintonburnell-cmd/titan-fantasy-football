/* Titan Fantasy Football — service worker.
 *
 * Network first for the app's own files, so an update is picked up the next
 * time the app opens, with the cached copy as the offline fallback. Sleeper's
 * API is never touched here: live data always comes straight from Sleeper.
 */
const CACHE = 'titan-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'engine.js', 'sleeper.js', 'app.js',
  'icon.svg', 'icon-192.png', 'manifest.webmanifest', 'privacy.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, {cache: 'no-cache'})
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
