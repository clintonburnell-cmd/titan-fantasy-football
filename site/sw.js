/* Titan Fantasy Football Manager — service worker.
 *
 * The app's own files (scripts, styles, fonts, images) come from the saved copy at once, and the
 * network's answer is saved for next time (stale-while-revalidate): a slow connection on game day
 * never keeps the app from drawing. Pages go to the network first, but only for a moment: past
 * PAGE_WAIT with a saved copy at hand, the saved page serves and the fresh one lands for the next
 * open. Sleeper's API is never touched here: live data always comes straight from Sleeper.
 */
const CACHE = 'titan-v21';
const PAGE_WAIT = 2500;
/* The website (the root page) and the app (/app/), with everything the app loads at once. espn.js, yahoo.js and
   newsletter.js are deliberately absent (v1.89.0): the app fetches each only when it needs it, and the handler
   below saves any asset it serves, so a person who does use one has it from the cache next time. */
const SHELL = ['./', 'index.html', 'site.css', 'theme.js', 'stats.js', 'titan.svg', 'app/', 'app/index.html', 'styles.css', 'engine.js', 'demo.js', 'sleeper.js',
  'syncplan.js', 'app.js', 'sync.js', 'icon.svg', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest', 'privacy.html', 'terms.html', '404.html',
  'fonts/inter-latin-wght.woff2', 'newsletter/', 'guides/', 'guides/import-fantasy-rankings.html', 'guides/combine-fantasy-rankings.html',
  'guides/sleeper-start-sit.html', 'guides/espn-private-league.html', 'guides/fantasy-draft-grades.html', 'guides/fantasy-trade-help.html'];
const ASSET = /\.(js|css|woff2|png|jpg|svg|webmanifest)$/;

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
  const req = event.request, url = new URL(req.url);
  // Titan's server addresses (/api/...) are left to the browser: their answers are live,
  // and Yahoo's sign-in comes back through one that answers with a redirect, which a
  // service worker can't hand to a page load (Chrome shows ERR_FAILED).
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isPage = req.mode === 'navigate';
  // A navigation request can't be re-issued with extra options, so page loads fetch the URL itself.
  const fresh = (isPage ? fetch(req.url, {cache: 'no-cache', credentials: 'same-origin'}) : fetch(req, {cache: 'no-cache'}))
    .then(res => {
      // Refreshing the saved copy is best effort; a failed write must not surface as an error.
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    });
  const saved = () => caches.match(req, {ignoreSearch: true});
  const shell = () => caches.match(url.pathname.startsWith('/app') ? 'app/index.html' : 'index.html');
  if (!isPage && ASSET.test(url.pathname)) {
    // The saved copy at once; the network only when there's none. (fresh keeps running, to update the copy.)
    event.respondWith(saved().then(hit => {
      if (hit) { fresh.catch(() => {}); return hit; }
      return fresh.catch(() => shell());
    }));
    return;
  }
  event.respondWith(saved().then(hit => {
    if (!hit) return fresh.catch(() => shell());
    const wait = new Promise(resolve => setTimeout(() => resolve(hit), PAGE_WAIT));
    return Promise.race([fresh.catch(() => hit), wait]);
  }));
});
