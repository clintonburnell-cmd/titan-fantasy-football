/* Titan Fantasy Football Manager: visit counts for the website.
 *
 * The website's pages (home, guides, privacy, terms) load Cloudflare Web
 * Analytics, which counts visits without cookies. The app never does: not at
 * /app/, not in the Android app (it opens /?source=play, and the home page
 * shows for a moment before forwarding), and not in home-screen copies. The
 * Play Data safety form declares no analytics, and the privacy policy says the
 * app has none. Only titanfantasyfootball.com counts, so tests and the web.app
 * address send nothing.
 */
(function () {
  // Cloudflare Web Analytics' site token. It's public: it shows in every page's source.
  var TOKEN = '13c0711ed1484b70b4ef79d36c68e4ea';
  var HOST = 'titanfantasyfootball.com';

  function counts(w, token) {
    var loc = w.location, q = loc.search || '';
    if (!token || loc.hostname !== HOST || /^\/app(\/|$)/.test(loc.pathname)) return false;
    if (/[?&]source=play\b/.test(q) || (w.document.referrer || '').indexOf('android-app://') === 0) return false;
    try { if (w.sessionStorage.getItem('titan.play') === '1') return false; } catch (e) { /* storage blocked: go by the rest */ }
    if (w.navigator.standalone === true) return false;
    return !(w.matchMedia && w.matchMedia('(display-mode: standalone)').matches);
  }

  if (typeof module === 'object' && module.exports) { module.exports = {counts: counts}; return; }
  if (!counts(window, TOKEN)) return;
  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({token: TOKEN}));
  document.head.appendChild(s);
})();
