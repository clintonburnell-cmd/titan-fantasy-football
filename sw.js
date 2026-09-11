/* Titan Fantasy Football Manager — service worker.
 *
 * Network first for the app's own files, so an update is picked up the next
 * time the app opens, with the cached copy as the offline fallback. Sleeper's
 * API is never touched here: live data always comes straight from Sleeper.
 */
const CACHE = 'titan-v11';
// The website (the root page) and the app (/app/), with everything the app loads.
const SHELL = ['./', 'index.html', 'site.css', 'theme.js', 'titan.svg', 'app/', 'app/index.html', 'styles.css', 'engine.js', 'demo.js', 'espn.js', 'sleeper.js',
  'syncplan.js', 'app.js', 'sync.js', 'icon.svg', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest', 'privacy.html'];

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

/* Game-day alerts, sent by Titan's server job through Firebase Cloud
   Messaging: each message carries its title, text, the page to open and a
   tag (a newer alert with the same tag replaces the old one). */
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { /* not JSON: show a plain alert */ }
  const d = m.data || m, n = m.notification || {};
  event.waitUntil(self.registration.showNotification(n.title || d.title || 'Titan', {
    body: n.body || d.body || '', icon: '/icon-192.png', badge: '/icon-192.png',
    tag: d.tag || undefined, data: {url: d.url || '/app/'}
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/app/', self.location.origin).href;
  // A news alert opens the story itself; the others open Titan (or bring it forward).
  if (!url.startsWith(self.location.origin)) { event.waitUntil(self.clients.openWindow(url)); return; }
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin + '/app'));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
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
        .then(hit => hit || caches.match(new URL(req.url).pathname.startsWith('/app') ? 'app/index.html' : 'index.html')))
  );
});
