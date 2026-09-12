/* Titan's two themes: white and blue (the default) and dark, remembered on each
   device. Every page sets a saved dark theme in its <head> before anything draws;
   this wires the switches. Any [data-theme-toggle] button flips the theme, any
   [data-theme-set="light"|"dark"] chooses one (the app's Settings), and a
   'titan-theme' event tells the page it changed. */
(function () {
  var KEY = 'titan.theme', BAR = {light: '#f3f6fc', dark: '#0a0f1a'};
  var root = document.documentElement;
  var current = function () { return root.dataset.theme === 'dark' ? 'dark' : 'light'; };

  // The browser's bar colour and each switch's label follow the theme.
  function paint() {
    var t = current(), meta = document.querySelector('meta[name="theme-color"]');
    var label = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    if (meta) meta.content = BAR[t];
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-label', label);
      b.title = label;
    });
  }

  function set(t) {
    if (t === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    try {
      if (t === 'dark') localStorage.setItem(KEY, 'dark');
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked: the theme still applies to this page */ }
    paint();
    document.dispatchEvent(new CustomEvent('titan-theme', {detail: t}));
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle],[data-theme-set]');
    if (!b) return;
    set(b.hasAttribute('data-theme-toggle') ? (current() === 'dark' ? 'light' : 'dark') : b.getAttribute('data-theme-set'));
  });
  paint();
  window.TitanTheme = {current: current, set: set};

  // Every page loads this file, so it also hides the tip jar at the bottom of the page: inside the
  // Google Play app, where tips must go through Play billing (the app remembers a Play session as
  // titan.play, and a page opened straight from it carries ?source=play or the android-app referrer),
  // and from anyone who links Yahoo (the app sets titan.noTip; the owner's call, given Yahoo's terms).
  try {
    var play = sessionStorage.getItem('titan.play') === '1' || /[?&]source=play\b/.test(location.search) ||
      document.referrer.indexOf('android-app://') === 0;
    if (play || localStorage.getItem('titan.noTip') === '1') {
      document.querySelectorAll('a[href^="https://ko-fi.com/"]').forEach(function (a) { a.hidden = true; });
    }
  } catch (e) { /* storage blocked: the tip jar shows */ }
})();
