/* Titan Fantasy Football — service worker.
 *
 * Network first for the app's own files, so an update is picked up the next
 * time the app opens, with the cached copy as the offline fallback. Sleeper's
 * API is never touched here: live data always comes straight from Sleeper.
 */
const CACHE = 'titan-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'engine.js', 'sleeper.js', 'app.js',
  'icon.svg', 'icon-192.png', 'manifest.webmanifest', 'privacy.html'];

/* Each file is cached on its own with put(). cache.addAll() failed intermittently
   in Chrome with "Entry already exists", and any single failure there rejects
   the whole install, which throws the service worker away. Caching here is best
   effort: a file that fails just isn't available offline. */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => Promise.all(SHELL.map(url =>
      fetch(url, {cache: 'no-cache'})
        .then(res => (res.ok ? cache.put(url, res) : null))
        .catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // A navigation request can't be re-issued with extra options, so page loads
  // fetch the URL itself.
  const fresh = req.mode === 'navigate'
    ? fetch(req.url, {cache: 'no-cache', credentials: 'same-origin'})
    : fetch(req, {cache: 'no-cache'});
  event.respondWith(
    fresh
      .then(res => {
        // Refreshing the offline copy is best effort; a failed write must not surface as an error.
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(req, {ignoreSearch: true})
        .then(hit => hit || caches.match('index.html')))
  );
});
