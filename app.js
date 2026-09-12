/* Titan Fantasy Football Manager — the app.
 *
 * Everything lives in this browser: the linked Sleeper account, the last pull
 * from Sleeper (the snapshot) and the rankings the user imported. Every screen
 * is computed from those, so importing new rankings re-scores the lineups
 * instantly, with no refetch. Sleeper is read-only — lineup changes are still
 * made in the Sleeper app.
 */
(() => {
  'use strict';

  const {SCC, SleeperAPI: API, EspnAPI: ESPN} = window;
  const store = API.store;
  // "Try a demo" (/app/?demo): sample leagues from real NFL players, kept apart
  // from any real account (its own storage names, and sync.js never loads), so
  // the demo can't overwrite someone's leagues or rankings.
  const DEMO = new URLSearchParams(location.search).has('demo');
  const KEY = DEMO
    ? {account: 'titan.demo.account.v1', ranks: 'titan.demo.ranks.v1', snap: 'titan.demo.snapshot.v1', ui: 'titan.demo.ui.v1'}
    : {account: 'titan.account.v1', ranks: 'titan.ranks.v1', snap: 'titan.snapshot.v1', ui: 'titan.ui.v1'};
  const STALE_MS = 5 * 60 * 1000;
  const TABS = ['lineups', 'matchup', 'standings', 'rosters', 'waivers', 'exposure', 'byes', 'score', 'news', 'trade', 'moves', 'ranks', 'settings'];
  // Each screen's name, as a heading for screen readers (the tabs show it visually).
  const TAB_NAMES = {lineups: 'Lineups', matchup: 'Matchup', standings: 'Standings', rosters: 'Rosters', waivers: 'Waivers', exposure: 'Exposure', byes: 'Byes',
    score: 'Results', news: 'News', ranks: 'Rankings', trade: 'Trade', moves: 'Transactions', settings: 'Settings'};
  // Each screen's address under /app/ (the Results tab's id is still 'score').
  const SLUG = {lineups: 'lineups', matchup: 'matchup', standings: 'standings', rosters: 'rosters', waivers: 'waivers', exposure: 'exposure', byes: 'byes',
    score: 'results', news: 'news', ranks: 'rankings', trade: 'trade', moves: 'transactions', settings: 'settings'};
  const tabFromPath = () => {
    const m = location.pathname.match(/^\/app\/([a-z]+)\/?$/);
    return (m && Object.keys(SLUG).find(t => SLUG[t] === m[1])) || '';
  };
  const AVATAR = 'https://sleepercdn.com/avatars/thumbs/';
  // News-only accounts on the News tab. X doesn't let apps read posts without a
  // paid plan, so each one opens on X.
  const NEWS_ACCOUNTS = [
    {handle: 'UnderdogNFL', name: 'Underdog NFL', about: 'NFL news from Underdog'}
  ];

  // Inside the Google Play app, tips would have to go through Google Play billing,
  // so the Ko-fi tip jar (in the header) shows only on the website. The Play app opens
  // /?source=play (and arrives with an android-app:// referrer); remembering it
  // for the session covers reloads that drop the query string.
  const IN_PLAY_APP = (() => {
    try {
      if (new URLSearchParams(location.search).get('source') === 'play' ||
          document.referrer.startsWith('android-app://com.titanfantasyfootball.app')) {
        sessionStorage.setItem('titan.play', '1');
      }
      return sessionStorage.getItem('titan.play') === '1';
    } catch (e) {
      return false;
    }
  })();

  // iPhone and iPad visitors in the browser get a one-time tip on putting Titan on
  // their home screen. iPadOS reports itself as a Mac, so touch support gives it away.
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = navigator.standalone === true ||
    !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  // The Android app and home-screen copies keep the app look even on a wide
  // screen; only a browser window gets the website look (styles.css).
  document.documentElement.classList.toggle('in-app', IN_PLAY_APP || STANDALONE);
  // A wide browser window (the website look); Rosters draws tables there.
  const WIDE = window.matchMedia ? window.matchMedia('(min-width: 900px)') : null;
  const wide = () => !!(WIDE && WIDE.matches) && !(IN_PLAY_APP || STANDALONE);
  // Wider still: Lineups, Matchup, Rosters and Results list their leagues down the left side (sideNav).
  const SIDE = window.matchMedia ? window.matchMedia('(min-width: 1100px)') : null;
  const side = () => !!(SIDE && SIDE.matches) && !(IN_PLAY_APP || STANDALONE);
  let sideItems = null; // the leagues a screen hands to the sidebar while it's drawn
  const IOS_HINT_KEY = 'titan.iosHint.v1';
  const SHARE_ICON = '<svg class="share-ico" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12' +
    'a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function iosHint() {
    if (!IS_IOS || STANDALONE || store.get(IOS_HINT_KEY)) return '';
    const device = /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : 'iPad';
    return `<div class="banner ios-hint" role="note"><span><b>Install Titan on your ${device}:</b> tap Share ${SHARE_ICON}, then
      <b>Add to Home Screen</b>.</span><button class="link" data-action="ios-hint-close">Got it</button></div>`;
  }

  const S = {
    account: store.get(KEY.account),
    ranks: store.get(KEY.ranks) || {weeks: {}},
    snap: store.get(KEY.snap),
    ui: Object.assign({tab: 'lineups', filter: 'all', league: 'all'}, store.get(KEY.ui) || {}),
    busy: false,
    error: '',
    A: null, // the snapshot analysed under the current rankings
    score: {week: 0, busy: false, data: null, error: ''},
    draft: {week: 0, text: '', parsed: null, file: '', pos: ''},
    link: {busy: false, error: ''},
    sync: {ready: false, api: null, user: null, state: 'off', error: '', at: 0},
    espn: {busy: false, error: '', pick: null, login: null, openLogin: false}, // adding ESPN leagues
    match: {busy: false, data: null, error: '', at: 0, week: 0}, // this week's matchups, loaded on the Matchup tab
    rosterQuery: '', // the Rosters page's player search
    owner: {is: false, busy: false, data: null, error: ''}, // Titan's owner: the stats card in Settings
    alerts: null, // game-day alerts on this device: {supported, permission, on, prefs}, once signed in
    alertsBusy: false,
    alertsError: '',
    proj: {}, // Sleeper's projections for the snapshot's week
    projAt: 0, // when they were last fetched (0: not yet this visit)
    view: {week: 0, pos: 'QB'}, // the saved rankings open on the Rankings tab
    // The Trade tab: each league's teams, FantasyCalc's values by league format, and the trade being built.
    trade: {teams: {}, values: {}, pick: {league: '', partner: '', give: [], get: []}, ideas: {}},
    news: {busy: false, at: 0, list: null, error: ''}, // ESPN's latest stories, on the News tab
    stand: {}, // the Standings tab: each league's schedule ({busy, error, sched, result})
    // The Waivers tab: Sleeper's trending adds, each FAAB league's budget and bids, and the search.
    waiv: {trend: null, busy: false, error: '', faab: {}, q: ''},
    ctx: {busy: false, at: 0, data: null}, // game context on Lineups rows (/api/game-context)
    moves: {} // the Transactions tab: each Sleeper league's recent moves ({busy, error, list, at})
  };
  if (!TABS.includes(S.ui.tab)) S.ui.tab = 'lineups';
  // An address like /app/matchup opens that screen.
  if (tabFromPath()) S.ui.tab = tabFromPath();
  if (S.snap && S.account && S.snap.userId !== S.account.userId) S.snap = null;
  if (DEMO && !S.account) {
    S.account = {demo: true, userId: '', username: '', displayName: 'Demo leagues', avatar: '', prefs: {}, espn: {leagues: []}, updatedAt: Date.now()};
    store.set(KEY.account, S.account);
  }

  const $ = id => document.getElementById(id);
  const view = $('view');

  /* ------------------------------------------------------------ helpers */

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const fmt = n => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);
  const signed = n => (n > 0 ? '+' : '') + fmt(n);
  const slotName = s => SCC.slotLabel(s);
  const rl = p => SCC.rankLabel(p.pos, p.rank);
  const has = v => v !== '' && v !== null && v !== undefined;
  const pos = p => `<span class="pos" data-pos="${esc(p)}">${esc(p)}</span>`;
  const tile = (n, label, tone) => `<div class="tile t-${tone}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  const saveUi = () => store.set(KEY.ui, S.ui);
  const avatar = (a, size) => a
    ? `<img class="avatar" src="${AVATAR}${esc(a)}" alt="" width="${size}" height="${size}" loading="lazy">`
    : `<span class="avatar blank" style="width:${size}px;height:${size}px"></span>`;

  function when(ts) {
    const d = new Date(ts);
    const t = d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    return d.toDateString() === new Date().toDateString()
      ? t : d.toLocaleDateString([], {month: 'short', day: 'numeric'}) + ', ' + t;
  }

  function countsText(rows) {
    const c = SCC.rankCounts(rows);
    return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(p => c[p]).map(p => `${p} ${c[p]}`).join(' · ');
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  /* ----------------------------------------------------------- rankings */

  /* The rankings for a week (`proj`: Sleeper's projections for it). The week's
     import comes first, and Titan's default rankings (those projections, in
     each league's scoring) fill any position it leaves out, or everything when
     nothing is imported. Without projections (offline), the latest earlier
     import stands in, and the screens say so. */
  function ranksFor(week, proj) {
    const hasProj = !!proj && Object.keys(proj).length > 0;
    const saved = S.ranks.weeks[week];
    if (saved) {
      const have = SCC.rankCounts(saved.rows);
      return {week, rows: saved.rows, exact: true, filled: hasProj ? SCC.DEFAULT_POS.filter(p => !have[p]) : []};
    }
    if (hasProj) return {week, rows: [], exact: true, defaults: true, filled: SCC.DEFAULT_POS.slice()};
    const weeks = Object.keys(S.ranks.weeks).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return {week: 0, rows: [], exact: false, filled: []};
    const earlier = weeks.filter(w => w < week);
    const w = earlier.length ? earlier[earlier.length - 1] : weeks[weeks.length - 1];
    return {week: w, rows: S.ranks.weeks[w].rows, exact: false, filled: []};
  }

  // A week's rankings as each league reads them.
  const rankingsOf = (r, proj, players) => SCC.rankingsBy(r.rows, r.filled.length ? proj : null, players);

  // Sleeper's trimmed player list (names for the default rankings), read from
  // storage once per refresh.
  let playersMemo = {at: -1, map: {}};
  function playerList() {
    // The demo carries its own small list (names from the week's projections).
    if (S.snap && S.snap.players) return S.snap.players;
    const at = S.snap ? S.snap.at : 0;
    if (playersMemo.at !== at) playersMemo = {at, map: (store.get(API.PLAYERS_KEY) || {}).map || {}};
    return playersMemo.map;
  }

  function analyze() {
    if (!S.snap) { S.A = null; return; }
    const r = ranksFor(S.snap.week, S.proj);
    S.A = SCC.analyzeAll(S.snap, rankingsOf(r, S.proj, playerList()));
    S.A.ranks = r;
  }

  /* ------------------------------------------------------------ refresh */

  function setProgress(msg) {
    const el = $('progress');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function refresh() {
    if (S.busy || !S.account) return;
    S.busy = true;
    S.error = '';
    if (S.snap) paintHeader();
    else render(); // swap the empty state for the loading message
    setProgress('Starting…');
    try {
      const snap = await API.collect(S.account, setProgress, S.snap && S.snap.available);
      snap.userId = S.account.userId;
      S.snap = snap;
      store.set(KEY.snap, snap);
      S.proj = await API.fetchProjections(snap.season, snap.week);
      S.projAt = Date.now();
      if (S.score.week === snap.week) S.score.data = null; // live points have moved
      S.trade.teams = {}; // rosters may have changed too, and with them the trade ideas
      S.trade.ideas = {};
      S.stand = {}; // and scores
      S.waiv.faab = {}; // and waiver budgets
      S.moves = {}; // and each league's transactions
    } catch (e) {
      S.error = 'Refresh failed: ' + (e && e.message ? e.message : e);
    } finally {
      S.busy = false;
      setProgress('');
      analyze();
      render();
      scheduleLive();
      if (S.ui.tab === 'matchup' && S.snap) loadMatchups(true);
    }
  }

  // Sleeper's projections for the snapshot's week; kept on the device for an hour.
  async function loadProj() {
    if (!S.snap) return;
    const week = S.snap.week;
    const map = await API.fetchProjections(S.snap.season, week);
    if (!S.snap || S.snap.week !== week) return;
    S.proj = map;
    S.projAt = Date.now();
    // Titan's default rankings come from these projections.
    analyze();
    if (['lineups', 'matchup', 'rosters'].includes(S.ui.tab)) render();
  }

  /* Scores while games are on: about every minute, while the app is open on
     Lineups, a light update (the game clock and each league's points, ESPN's
     larger box scores every other time) instead of a full refresh. It runs on
     game days until the week's games are over. */
  let liveTimer = 0, liveTick = 0;
  const etToday = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  const rostered = () => (S.snap ? [].concat(...S.snap.leagues.map(d => d.roster)) : []);
  const gamesLive = () => rostered().some(p => p.game === 'in_game');
  const gameDay = () => { const t = etToday(); return rostered().some(p => p.game === 'in_game' || (p.game === 'pre' && p.kick === t)); };

  function scheduleLive() {
    clearTimeout(liveTimer);
    if (!gameDay()) return;
    liveTimer = setTimeout(async () => {
      const tab = S.ui.tab;
      if (document.visibilityState === 'visible' && (tab === 'lineups' || tab === 'matchup') && !S.busy && S.snap) {
        try {
          // Every minute: the game clock and your points (ESPN's box score every
          // other minute). On Matchup, both lineups reload every other minute.
          const second = gamesLive() && liveTick % 2 === 0;
          await API.livePoints(S.snap, tab === 'lineups' && second);
          store.set(KEY.snap, S.snap);
          analyze();
          if (tab === 'matchup' && second) await loadMatchups(true);
          else if (S.ui.tab === tab && !S.busy) render();
        } catch (e) {
          // The next tick tries again.
        }
        liveTick++;
      }
      scheduleLive();
    }, 60000);
  }

  /* A week's results, scored against the record the server job froze at each
     kickoff (signed-in users), or against today's rankings and projections. */
  async function loadScore(week) {
    if (DEMO) return;
    S.score = {week, busy: true, data: null, error: ''};
    if (S.ui.tab === 'score') render();
    try {
      const leagues = S.snap.leagues.map(d => d.cfg);
      const [res, hist, proj] = await Promise.all([
        API.collectScores(S.account, leagues, week, S.snap.season),
        S.sync.api && S.sync.user ? S.sync.api.getHistory(week).catch(() => null) : null,
        API.fetchProjections(S.snap.season, week)
      ]);
      if (S.score.week !== week) return; // another week was picked meanwhile
      if (!res.started) {
        S.score.error = `Week ${week} has not kicked off yet, so there's nothing to score.`;
      } else {
        const r = ranksFor(week, proj);
        const D = SCC.scoreWeek(res, rankingsOf(r, proj, res.players), hist, proj);
        D.ranks = r;
        D.history = hist ? hist.updatedAt || 1 : 0;
        D.provisional = res.done < res.total;
        S.score.data = D;
      }
    } catch (e) {
      if (S.score.week !== week) return;
      S.score.error = `Could not load week ${week}: ${e && e.message ? e.message : e}`;
    }
    S.score.busy = false;
    if (S.ui.tab === 'score') render();
  }

  /* ------------------------------------------------------------- render */

  function paintHeader() {
    const s = S.snap, a = S.account;
    $('meta').textContent = !a ? 'Every Sleeper and ESPN league, your rankings'
      : s ? `${a.displayName} · Week ${s.week} · updated ${when(s.at)}`
      : `${a.displayName} · not pulled yet`;
    const b = $('refresh');
    b.hidden = !a;
    b.disabled = S.busy;
    b.classList.toggle('spin', S.busy);
    $('tabs').hidden = !a;
    document.querySelectorAll('#tabs [data-tab]').forEach(t =>
      t.setAttribute('aria-current', t.dataset.tab === S.ui.tab ? 'page' : 'false'));
    paintAccount();
  }

  function render() {
    paintHeader();
    view.dataset.tab = S.account ? S.ui.tab : 'welcome'; // lets wide screens lay out each screen
    if (!S.account) { document.title = 'Titan Fantasy Football Manager'; view.innerHTML = iosHint() + screenWelcome(); return; }
    const err = S.error ? `<div class="banner stop">${esc(S.error)}</div>` : '';
    sideItems = null;
    const body = `<h2 class="sr-only">${TAB_NAMES[S.ui.tab]}</h2>` + iosHint() + demoBanner() + err + SCREENS[S.ui.tab]();
    // On a wide computer window Lineups, Matchup, Rosters and Results put their leagues down the left side.
    view.innerHTML = sideItems ? `<div class="with-side">${sideNav(sideItems)}<div class="side-main">${body}</div></div>` : body;
    if (S.ui.tab === 'rosters' && S.rosterQuery) applyRosterSearch();
    spySide();
    syncUrl(false);
  }

  /* Each screen has its own address (/app/lineups, /app/results…) and title,
     so Back, Forward, bookmarks and shared links work as on any website. The
     query (?demo, ?source=play) is kept. */
  function syncUrl(push) {
    document.title = TAB_NAMES[S.ui.tab] + ' · Titan Fantasy Football Manager';
    if (location.protocol === 'file:') return;
    const want = '/app/' + SLUG[S.ui.tab];
    if (location.pathname !== want) history[push ? 'pushState' : 'replaceState']({tab: S.ui.tab}, '', want + location.search);
  }

  function emptyState() {
    return S.busy
      // Placeholder cards in the shape of what's coming, rather than a blank page.
      ? `<div class="skeleton" aria-hidden="true">${'<div class="card sk-card"><i></i><i></i><i></i><i></i></div>'.repeat(3)}</div>
        <p class="fine" role="status">Pulling your leagues… The first load takes a few seconds.</p>`
      : `<div class="empty"><h2>Nothing pulled yet</h2><p>Tap Refresh to load your leagues from Sleeper.</p></div>`;
  }

  const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  function ranksBanner(r, week) {
    if (r.defaults) {
      return `<div class="banner ok">Using Titan's <b>default rankings</b> for week ${week}: Sleeper's projections, in each league's own scoring. Import your own and they take over.
        <button class="link" data-go="ranks">Import week ${week} →</button></div>`;
    }
    if (r.exact && r.filled.length) {
      const many = r.filled.length > 1;
      return `<p class="fine">${esc(andList(r.filled))} use${many ? '' : 's'} the default rankings, since your week ${week} rankings don't include ${many ? 'them' : 'it'}.</p>`;
    }
    if (!r.week) {
      if (!S.projAt) return '<p class="fine">Loading the default rankings…</p>';
      return `<div class="banner stop"><b>No rankings yet.</b> Titan's default rankings come from Sleeper's projections, which couldn't be loaded. Import your rankings to get start/sit calls.
        <button class="link" data-go="ranks">Import rankings →</button></div>`;
    }
    if (!r.exact) {
      return `<div class="banner swap">Using your <b>week ${r.week}</b> rankings, since nothing is imported for week ${week} yet.
        <button class="link" data-go="ranks">Import week ${week} →</button></div>`;
    }
    return '';
  }

  /* ---- The demo (/app/?demo) */

  const demoBanner = () => !DEMO ? '' : `<div class="banner ok demo-note"><b>This is a demo:</b> two sample leagues built from real NFL
    players and this week's projections. <a href="/app/">Link your own leagues →</a></div>`;

  function demoOnly(what, why) {
    return `<div class="empty"><h2>${esc(what)} need your real leagues</h2><p>${esc(why)}</p>
      <p><a class="btn" href="/app/">Link your own leagues</a></p></div>`;
  }

  function demoSettings() {
    return `<section class="card pad"><h3>You're trying the demo</h3>
      <p class="help">Its two leagues are samples built from Sleeper's real player list and this week's projections. Nothing
        here is linked to an account, and nothing you do here changes one. Rankings you import stay in the demo.</p>
      <div class="bar"><a class="btn" href="/app/">Link your own leagues</a><a class="btn ghost" href="/?home">About Titan</a></div></section>
      ${appearanceCard()}`;
  }

  /* ---- Welcome / link account */

  function screenWelcome() {
    return `<section class="welcome">
      <img src="/icon.svg" alt="" width="76" height="76">
      <h2>Titan Fantasy Football Manager</h2>
      <p class="lede">One place to manage every league you play on Sleeper and ESPN. Import your own rankings, and Titan tells you who to start, who to sit and who to pick up, based on them.</p>
      <form class="card pad" data-form="link" novalidate>
        <label class="field block"><span>Your Sleeper username</span>
          <input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="e.g. fantasyking22" value="${esc(S.link.name || '')}" ${S.link.busy ? 'disabled' : ''}></label>
        ${S.link.error ? `<div class="banner stop">${esc(S.link.error)}</div>` : ''}
        <button class="btn big" type="submit" ${S.link.busy ? 'disabled' : ''}>${S.link.busy ? 'Finding you…' : 'Link Sleeper account'}</button>
        <p class="fine">No password. Titan only reads what Sleeper already shows publicly, and it can't change your lineups.</p>
      </form>
      <p class="fine">Play on ESPN? <button class="link" data-action="espn-start">Add an ESPN league instead</button>, and link Sleeper later if you like.</p>
      <p class="fine">Just looking? <a href="/app/?demo">Try a demo</a> with two sample leagues built from real NFL players.</p>
      <div class="sync-welcome" data-sync-slot="welcome">${syncWelcome()}</div>
      <ol class="how">
        <li><b>Link</b> your Sleeper username and add your ESPN leagues. Every league loads with its own lineup format and scoring.</li>
        <li><b>Import</b> your own weekly rankings as a CSV. Until you do, Titan uses Sleeper's projections.</li>
        <li><b>Follow</b> the calls your rankings make: who to start, who to swap, who's on the wire.</li>
      </ol>
    </section>`;
  }

  async function linkAccount(name) {
    if (S.link.busy) return;
    if (!name.trim()) { S.link.error = 'Type your Sleeper username.'; render(); return; }
    // Keep what was typed, so a typo can be corrected rather than retyped.
    S.link = {busy: true, error: '', name};
    render();
    try {
      const u = await API.lookupUser(name);
      if (!u) {
        S.link = {busy: false, name, error: `No Sleeper account called "${name.trim()}". Check the spelling: it's the name on your Sleeper profile.`};
        render();
        return;
      }
      // Linking Sleeper to an account that already has ESPN leagues keeps them.
      const prev = S.account || {};
      S.account = Object.assign(u, {prefs: prev.prefs || {}, updatedAt: Date.now()}, prev.espn ? {espn: prev.espn} : {});
      store.set(KEY.account, S.account);
      pushAccount();
      S.snap = null;
      store.del(KEY.snap);
      S.link = {busy: false, error: ''};
      S.ui.tab = 'lineups';
      saveUi();
      render();
      refresh();
    } catch (e) {
      S.link = {busy: false, name, error: 'Could not reach Sleeper. Check your connection and try again.'};
      render();
    }
  }

  /* ---- Lineups */

  const VERDICT = {'OK': 'ok', 'UNRANKED': 'unranked', 'SWAP OUT': 'swap', 'DO NOT START': 'stop', 'ON BYE': 'stop', 'FILL SLOT': 'stop', 'LOCKED': 'locked'};
  const needsAction = L => L.moves.length || L.stops || L.hurt.length;

  /* The Lineups filters: every league, any that need action, and each kind of
     problem on its own. Players whose game has started can't be changed, so
     they don't count. A chip shows only when a league has that problem. */
  const starter = (L, f) => L.rows.some(r => r.p && !r.p.locked && f(r.p));
  const LEAGUE_FILTERS = [
    {id: 'all', label: 'All', test: () => true},
    {id: 'action', label: 'Needs action', test: L => !!needsAction(L)},
    {id: 'changes', label: 'Lineup changes', test: L => L.moves.length > 0},
    {id: 'empty', label: 'Empty spots', test: L => L.rows.some(r => !r.p)},
    {id: 'out', label: 'Out or doubtful', test: L => starter(L, p => p.outish)},
    {id: 'questionable', label: 'Questionable', test: L => starter(L, p => p.inj && !p.outish)},
    {id: 'bye', label: 'On bye', test: L => starter(L, p => p.onBye)},
    {id: 'unranked', label: 'Unranked starters', test: L => starter(L, p => p.rank === null && !p.onBye)},
    {id: 'wire', label: 'Wire upgrades', test: L => L.wire.length > 0}
  ];

  /* Folding leagues on Lineups, Rosters and Matchup. Lineups and Rosters start
     open (the folded ones are remembered); Matchup starts folded to its headers
     (the open ones are remembered). */
  const FOLD_KEY = {lineup: 'closedLineup', roster: 'closedRoster', match: 'openMatch', score: 'openScore'};
  const SHUT = {match: true, score: true}; // folded until opened (the others start open)
  function isOpen(kind, id) {
    const set = S.ui[FOLD_KEY[kind]] || {};
    return SHUT[kind] ? !!set[id] : !set[id];
  }
  function setFold(kind, id, open) {
    const set = Object.assign({}, S.ui[FOLD_KEY[kind]]);
    if (!!SHUT[kind] === open) set[id] = 1;
    else delete set[id];
    S.ui[FOLD_KEY[kind]] = set;
    saveUi();
  }
  // A Results row names its league by key; this finds the league (or stands in for a gone one).
  const cfgByKey = key => (S.A && S.A.leagues.find(L => L.cfg.key === key) || {}).cfg || {id: key, key};
  function foldAll(kind, open) {
    const ids = kind === 'match' ? (S.match.data || []).map(x => x.cfg.id)
      : kind === 'score' ? (S.score.data ? S.score.data.rows : []).map(r => cfgByKey(r.key).id)
      : S.A ? S.A.leagues.map(L => L.cfg.id) : [];
    const set = {};
    if (!!SHUT[kind] === open) ids.forEach(id => { set[id] = 1; });
    S.ui[FOLD_KEY[kind]] = set;
    saveUi();
    render();
  }
  const foldTools = kind => `<div class="match-tools"><button class="link" data-action="fold-all" data-kind="${kind}">Expand all</button>
    <button class="link" data-action="fold-none" data-kind="${kind}">Collapse all</button></div>`;
  const foldAttrs = (kind, cfg) => `id="${anchor(cfg)}" data-fold="${kind}" data-id="${esc(cfg.id)}"${isOpen(kind, cfg.id) ? ' open' : ''}`;

  // Quick navigation to a league's card further down the page: chips above the
  // leagues, or on a wide computer window a list down the left side (sideNav,
  // drawn by render). chips=false gives the sidebar only.
  const anchor = cfg => 'lg-' + String(cfg.id).replace(/[^\w-]/g, '_');
  function jumpBar(items, chips = true) {
    if (side()) { sideItems = items; return ''; }
    if (!chips || items.length < 2) return '';
    return `<nav class="jump" aria-label="Jump to a league">${items.map(x => `<button type="button" class="jump-chip" data-jump="${anchor(x.cfg)}">${
      x.flag ? '<i class="dot" title="Needs action"></i>' : ''}${leagueIcon(x.cfg, 'xs')}${esc(x.cfg.key)}</button>`).join('')}</nav>`;
  }
  function sideNav(items) {
    // When some leagues have a needs-action dot, the others keep an empty slot so the names line up.
    const dots = items.some(x => x.flag);
    return `<nav class="side" aria-label="Your leagues"><p class="side-h">${plural(items.length, 'league')}</p>${items.map(x =>
      `<button type="button" class="side-link" data-jump="${anchor(x.cfg)}">${x.flag ? '<i class="dot" title="Needs action"></i>'
        : dots ? '<i class="dot off" aria-hidden="true"></i>' : ''}${leagueIcon(x.cfg)}<span class="sl-name">${
        esc(x.cfg.key)}<small>${siteName(x.cfg)}</small></span></button>`).join('')}</nav>`;
  }
  // The sidebar marks the league at the top of the window as the page scrolls.
  let spyQueued = false;
  function spySide() {
    spyQueued = false;
    const links = [...view.querySelectorAll('.side [data-jump]')].filter(b => !b.hidden);
    if (!links.length) return;
    let cur = links[0];
    for (const b of links) {
      const card = document.getElementById(b.dataset.jump);
      if (card && !card.hidden && card.getBoundingClientRect().top <= 180) cur = b;
    }
    links.forEach(b => { b.classList.toggle('on', b === cur); b.setAttribute('aria-current', b === cur ? 'location' : 'false'); });
  }
  window.addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spySide); } }, {passive: true});

  function screenLineups() {
    if (!S.snap) return emptyState();
    const A = S.A;
    const filters = LEAGUE_FILTERS.map(f => Object.assign({n: A.leagues.filter(f.test).length}, f));
    const pickF = filters.find(f => f.id === S.ui.filter) || filters[0];
    const list = A.leagues.filter(pickF.test);
    let h = ranksBanner(A.ranks, S.snap.week);
    if (gamesLive()) {
      h += `<p class="fine live-note">Games are on: scores update about every minute while Lineups is open${
        S.snap.pointsAt ? ` (last ${esc(when(S.snap.pointsAt))})` : ''}.</p>`;
    }
    const G = gameCounts(A.leagues);
    h += `<section class="tiles three">
      ${tile(A.changes.length, A.changes.length === 1 ? 'lineup change' : 'lineup changes', A.changes.length ? 'swap' : 'ok')}
      ${tile(A.hurtStarters.length, A.hurtStarters.length === 1 ? 'injured starter' : 'injured starters', A.hurtStarters.length ? 'stop' : 'ok')}
      ${tile(A.wireLines.length, A.wireLines.length === 1 ? 'wire upgrade' : 'wire upgrades', A.wireLines.length ? 'wire' : 'ok')}
    </section>
    <section class="tiles tiles-games" aria-label="This week's games">
      ${tile(G.startLocked, 'starters locked', 'muted')}
      ${tile(G.startLeft, 'starters yet to play', G.startLeft ? 'ok' : 'muted')}
      ${tile(G.benchLocked, 'bench locked', 'muted')}
      ${tile(G.benchLeft, 'bench yet to play', 'muted')}
    </section>`;
    h += `<div class="chips" role="group" aria-label="Filter leagues">${filters
      .filter(f => f.id === 'all' || f.id === 'action' || f.n > 0 || f.id === pickF.id)
      .map(f => `<button class="chip" data-filter="${f.id}" aria-pressed="${f.id === pickF.id}">${esc(f.label)} ${f.n}</button>`).join('')}</div>`;
    if (list.length) h += jumpBar(list.map(L => ({cfg: L.cfg, flag: !!needsAction(L)})));
    if (list.length) h += foldTools('lineup');
    if (!A.leagues.length) {
      h += `<div class="empty-note">No leagues to show. ${S.snap.available && S.snap.available.length
        ? 'Switch some on in <button class="link" data-go="settings">Settings</button>.'
        : S.account.userId ? `Sleeper shows no ${esc(S.snap.season)} leagues on this account.`
        : 'Add an ESPN league or link Sleeper in <button class="link" data-go="settings">Settings</button>.'}</div>`;
    } else if (!list.length) {
      h += `<div class="empty-note">${pickF.id === 'action' ? 'Nothing to do. Every lineup matches your rankings.'
        : `No leagues with ${esc(pickF.label.toLowerCase())} right now.`}</div>`;
    }
    if (!S.ctx.busy && Date.now() - S.ctx.at > CONTEXT_EVERY) loadContext();
    const C = S.ctx.data, credit = Object.keys(S.proj).length || C ? `<p class="fine">${Object.keys(S.proj).length ? 'Projections via Sleeper. ' : ''}${C
      ? `Game lines from ESPN, forecasts from the <a href="https://www.weather.gov" target="_blank" rel="noopener">National Weather Service</a>, and points
        allowed by position from <a href="https://github.com/nflverse" target="_blank" rel="noopener">nflverse</a> (CC BY 4.0${C.dvpSeason ? ', ' + esc(C.dvpSeason) + ' season' : ''}).` : ''}</p>` : '';
    // Leagues sit two across on wide screens (.league-grid).
    return h + (list.length ? `<div class="league-grid">${list.map(leagueCard).join('')}</div>` : '') + credit;
  }

  const projOf = (p, cfg) => SCC.projFor(S.proj, p.id, cfg.ppr);

  /* This week's games across every lineup: starters and bench players whose
     game has started (locked) or is still to come. Players on IR or a taxi
     squad aren't counted, and players on bye are neither. */
  function gameCounts(leagues) {
    const c = {startLocked: 0, startLeft: 0, benchLocked: 0, benchLeft: 0};
    leagues.forEach(L => L.roster.forEach(p => {
      if (p.held) return;
      const side = p.start ? 'start' : 'bench';
      if (p.locked) c[side + 'Locked']++;
      else if (p.game === 'pre') c[side + 'Left']++;
    }));
    return c;
  }

  // The lineup's points so far once games start (in green), and Sleeper's
  // projection for it (in bold), plus Titan's lineup's, before kickoff, when
  // that differs. Returns HTML (numbers and fixed words only).
  function projLine(L) {
    const starters = L.roster.filter(p => p.start);
    const played = starters.filter(scored);
    let s = '';
    if (played.length) {
      const pts = played.reduce((t, p) => t + p.pts, 0);
      const final = starters.every(p => p.game === 'complete');
      s = ` · ${final ? 'scored' : 'scored so far'} <b class="pts-actual">${fmt(pts)}</b>${starters.some(p => p.game === 'in_game') ? ' (live)' : ''}`;
    }
    const mine = SCC.sumProj(starters.map(p => ({proj: projOf(p, L.cfg)})));
    if (!mine) return s;
    const titan = SCC.sumProj((L.opt || []).filter(o => o.p).map(o => ({proj: projOf(o.p, L.cfg)})));
    return s + ` · projected <b class="pts-proj">${fmt(mine)}</b>${!played.length && Math.abs(titan - mine) >= 0.1 ? `, Titan's lineup ${fmt(titan)}` : ''}`;
  }

  // Where a league's lineup is set: the team's page on Sleeper or ESPN.
  const siteName = cfg => cfg.platform === 'espn' ? 'ESPN' : cfg.platform === 'yahoo' ? 'Yahoo' : 'Sleeper';
  /* A league's own picture (its Sleeper avatar, or your team's logo in an ESPN league) with a
     small badge for its site in the corner, like the team logo on a player's headshot. With no
     picture, or one that fails to load, a plain football shows (as Sleeper shows its default).
     size 'xs' is smaller, without the badge. */
  const SITE_LETTER = {sleeper: 'S', espn: 'E', yahoo: 'Y'};
  const BALL = '<svg viewBox="0 0 24 24" width="62%" height="62%"><g transform="rotate(-40 12 12)"><ellipse cx="12" cy="12" rx="10.5" ry="6.2" fill="currentColor"/>' +
    '<path d="M8.5 12h7M10 10.4v3.2M12 10.4v3.2M14 10.4v3.2" stroke="var(--surface-2)" stroke-width="1.3" stroke-linecap="round"/></g></svg>';
  function leagueIcon(cfg, size = '') {
    const site = SITE_LETTER[cfg.platform] ? cfg.platform : 'sleeper';
    return `<span class="licon${size ? ' ' + size : ''}" aria-hidden="true"><span class="lini">${BALL}</span>${
      cfg.pic ? `<img src="${esc(cfg.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${
      size === 'xs' ? '' : `<i class="lsite s-${site}" title="${siteName(cfg)}">${SITE_LETTER[site]}</i>`}</span>`;
  }
  function lineupUrl(cfg) {
    if (cfg.platform !== 'espn') return `https://sleeper.com/leagues/${encodeURIComponent(cfg.id)}/team`;
    const team = cfg.teamId !== null && cfg.teamId !== undefined ? `&teamId=${encodeURIComponent(cfg.teamId)}` : '';
    return `https://fantasy.espn.com/football/team?leagueId=${encodeURIComponent(cfg.espnId)}${team}&seasonId=${encodeURIComponent(S.snap ? S.snap.season : '')}`;
  }
  // Demo leagues have no team page to open.
  const openSite = cfg => cfg.demo ? '' : `<a class="btn ghost small open-site" href="${esc(lineupUrl(cfg))}" target="_blank" rel="noopener">Open in ${siteName(cfg)} ↗</a>`;
  const kickOf = p => kickText(p) ? ', ' + kickText(p) : '';

  function leagueCard(L) {
    const st = L.stops ? ['stop', plural(L.stops, 'problem')]
      : L.moves.length ? ['swap', plural(L.moves.length, 'change')]
      : ['ok', 'Set'];
    let h = `<details class="card league fold" ${foldAttrs('lineup', L.cfg)}>
      <summary class="card-h"><div><h3>${leagueIcon(L.cfg)}${esc(L.cfg.key)}</h3><p>${esc(SCC.describeLeague(L.cfg)) + projLine(L)}</p></div><span class="pill p-${st[0]}">${st[1]}</span></summary>`;
    if (L.moves.length) {
      // A starter changing spots shows where he goes or comes from, and when he plays.
      h += `<div class="moves"><div class="moves-h"><h4>Make these changes in ${siteName(L.cfg)}</h4>${openSite(L.cfg)}</div>${L.moves.map(m => `
        <div class="move"><span class="slot">${esc(slotName(m.slot))}</span>
          <span class="mv out${m.to ? ' to' : ''}">${m.out ? `${esc(m.out.name)} <em>${m.to ? `to ${esc(slotName(m.to))}${esc(kickOf(m.out))}` : esc(rl(m.out))}</em>` : '<em>nobody</em>'}</span>
          <span class="mv in">${esc(m.inn.name)} <em>${m.from ? `from ${esc(slotName(m.from))}${esc(kickOf(m.inn))}` : esc(rl(m.inn)) + (m.inn.opp ? ' vs ' + esc(m.inn.opp) : '')}</em></span>
        </div>`).join('')}${L.moves.some(m => m.from || m.to) ? '<p class="fine">Later kickoffs go in FLEX, so a late scratch can still be covered from your bench.</p>' : ''}</div>`;
    }
    h += `<ol class="lineup">${L.rows.map(r => lineupRow(r, L.cfg)).join('')}</ol>`;
    L.wire.forEach(w => {
      const tail = w.cur ? `, better than ${esc(w.cur.name)} (${esc(rl(w.cur))})`
        : w.anyUnranked ? ', and you are starting someone unranked here' : '';
      h += `<p class="note wire"><b>Wire ${esc(w.pos)}:</b> ${w.list.map(x =>
        `${esc(x.name)} (${esc(SCC.rankLabel(x.pos, x.rank))}${x.opp ? ' ' + esc(x.opp) : ''})`).join(', ')}${tail}</p>`;
    });
    if (L.hurt.length) {
      h += `<p class="note hurt"><b>Injured in your lineup:</b> ${L.hurt.map(p => `${esc(p.name)} (${esc(p.inj)})`).join(', ')}</p>`;
    }
    if (!L.moves.length && !L.cfg.demo) h += `<div class="card-foot">${openSite(L.cfg)}</div>`;
    return h + '</details>';
  }

  function rankCell(p) {
    return `<span class="rank">${p.rank === null ? 'NR' : esc(rl(p))}${has(p.tier) ? `<small>T${esc(p.tier)}</small>` : ''}</span>`;
  }

  // A started player's points: LIVE while his game is on, FINAL once it's over.
  const scored = p => p.locked && typeof p.pts === 'number';
  const playDay = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', {weekday: 'short', timeZone: 'UTC'});

  // When a team plays this week, in the viewer's own time zone ("Sun 1:00 PM"):
  // ESPN's kickoff time, else the day from Sleeper's schedule, else "Bye".
  function teamKick(team) {
    if (!S.snap) return '';
    const t = SCC.teamAbbr(team), games = S.snap.games || {};
    const k = S.snap.kickoffs && S.snap.kickoffs[t];
    if (k) {
      const d = new Date(k[0]), day = d.toLocaleDateString([], {weekday: 'short'});
      return k[1] ? day + ', time TBD' : day + ' ' + d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    }
    if (games[t] && games[t].kick) return playDay(games[t].kick);
    return t && Object.keys(games).length ? 'Bye' : '';
  }

  function kickText(p) {
    if (!S.snap) return '';
    if (p.bye && Number(p.bye) === Number(S.snap.week)) return 'Bye';
    return teamKick(p.team) || (p.kick ? playDay(p.kick) : '');
  }

  // The player's name with his kickoff beside it; a long name shortens, the time never does.
  function nameLine(p) {
    const k = kickText(p);
    return `<span class="name-line"><b>${esc(p.name)}</b>${k ? `<em class="kick">${esc(k)}</em>` : ''}</span>`;
  }
  const scoreChip = p => `<span class="score-chip${p.game === 'in_game' ? ' live' : ''}"><b>${fmt(p.pts)}</b><small>${
    p.game === 'in_game' ? 'LIVE' : 'FINAL'}</small></span>`;

  function statusText(p) {
    const s = [p.locked && !scored(p) && 'Locked', p.inj].filter(Boolean).join(' · ');
    return s ? ` · <span class="${p.outish ? 'bad' : 'warn'}">${esc(s)}</span>` : '';
  }

  /* Game context for start/sit calls, from Titan's server (/api/game-context): each team's
     expected points, how soft its matchup is by position, and weather worth knowing. Loaded
     at most every half hour; the loader never draws synchronously. */
  const CONTEXT_EVERY = 30 * 60000;
  async function loadContext() {
    S.ctx.busy = true;
    try {
      const res = await fetch('/api/game-context');
      if (!res.ok) throw new Error('answered ' + res.status);
      S.ctx.data = await res.json();
    } catch (e) { /* no context this time: the rows just go without it */ }
    S.ctx.at = Date.now();
    S.ctx.busy = false;
    if (S.ui.tab === 'lineups') render();
  }

  // A player's game context under his name (SCC.gameTags); who he plays only when his rankings don't say.
  function ctxLine(p) {
    const tags = SCC.gameTags(S.ctx.data, p, {opp: !p.opp});
    return tags.length ? `<small class="gctx">${tags.map(t => `<span class="${t.tone}">${esc(t.text)}</span>`).join(' · ')}</small>` : '';
  }

  function lineupRow(r, cfg) {
    if (!r.p) {
      return `<li class="row r-stop"><span class="slot">${esc(slotName(r.slot))}</span><span class="pphoto"><span class="hs"></span></span>
        <span class="who"><b>Slot empty</b></span><span class="right"><span class="verdict v-stop">FILL SLOT</span></span></li>`;
    }
    const p = r.p, v = VERDICT[r.verdict] || 'ok';
    const proj = projOf(p, cfg);
    const sub = [p.pos, p.team, p.opp && 'vs ' + p.opp, p.bye && 'bye ' + p.bye, proj !== null && 'proj ' + fmt(proj)].filter(Boolean).join(' · ');
    return `<li class="row r-${v}"><span class="slot" data-pos="${esc(p.pos)}">${esc(slotName(r.slot))}</span>${headshot(p)}
      <span class="who">${nameLine(p)}<small>${esc(sub)}${statusText(p)}</small>${ctxLine(p)}</span>
      <span class="right">${rankCell(p)}${scored(p) ? scoreChip(p) : `<span class="verdict v-${v}">${esc(r.verdict)}</span>`}</span></li>`;
  }

  /* ---- News */

  /* ESPN's latest NFL news, read through Titan's server (/api/news: ESPN turns some
     browsers away), refreshed every couple of minutes while the tab is open. Stories that tag someone on your rosters are marked, with a filter for them.
     The loader never draws synchronously, so screenNews can start it. */
  const NEWS_EVERY = 2 * 60000;
  async function loadNews() {
    if (S.news.busy) return;
    S.news.busy = true;
    try {
      const res = await fetch('/api/news');
      if (!res.ok) throw new Error('answered ' + res.status);
      const j = await res.json();
      // at: when Titan asked (for the refresh); from: when the server read ESPN.
      Object.assign(S.news, {list: j.stories || [], at: Date.now(), from: j.at || Date.now(), error: ''});
    }
    catch (e) { S.news.error = 'Could not load the news from ESPN.'; }
    S.news.busy = false;
    if (S.ui.tab === 'news') render();
  }
  setInterval(() => {
    if (S.ui.tab === 'news' && !document.hidden && S.news.list && Date.now() - S.news.at > NEWS_EVERY) loadNews();
  }, 30000);

  const ago = ts => {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 24 * 60 ? Math.round(m / 60) + ' hr ago' : when(ts);
  };

  // Everyone on your rosters by name (as norm() reads it), with the leagues he's in.
  function rosterNames() {
    const m = {};
    ((S.A && S.A.leagues) || []).forEach(L => L.roster.forEach(p => {
      const k = SCC.norm(p.name);
      if (k) (m[k] = m[k] || new Set()).add(L.cfg.key);
    }));
    return m;
  }

  function newsRow(s, yours, mine) {
    return `<li class="news-item${yours.length ? ' mine' : ''}"><a class="news-link" href="${esc(s.url)}" target="_blank" rel="noopener">
      <span class="news-text"><b>${esc(s.headline)}</b>${s.text && s.text !== s.headline ? `<small>${esc(s.text)}</small>` : ''}
        <span class="news-meta">${esc(ago(s.at))}${s.video ? ' · Video' : ''}${s.plus ? ' · ESPN+' : ''}</span></span>
      ${s.image ? `<img class="news-img" src="${esc(s.image)}" alt="" loading="lazy" width="96" height="64">` : ''}</a>
      ${yours.length ? `<div class="news-tags">${yours.map(a => {
        const ls = [...mine[SCC.norm(a.name)]];
        return `<span class="ntag">Your player: ${esc(a.name)} <small>${esc(ls.length === 1 ? ls[0] : ls.length + ' leagues')}</small></span>`;
      }).join('')}</div>` : ''}</li>`;
  }

  function screenNews() {
    const N = S.news;
    if (!N.list && !N.busy && !N.error) loadNews();
    const mine = rosterNames(), list = N.list || [];
    const yoursIn = s => s.athletes.filter(a => mine[SCC.norm(a.name)]);
    const yours = list.filter(s => yoursIn(s).length), shown = S.ui.newsMine ? yours : list;
    let h = `<p class="lede">The latest NFL news from <a href="https://www.espn.com/nfl/" target="_blank" rel="noopener">ESPN</a>, newest first${
      N.from ? `, updated ${esc(when(N.from))}` : ''}. It refreshes every couple of minutes while this tab is open.</p>
      <div class="chips" role="group" aria-label="Filter the news"><button class="chip" data-news="all" aria-pressed="${!S.ui.newsMine}">All news ${list.length}</button>
        <button class="chip" data-news="mine" aria-pressed="${!!S.ui.newsMine}">Your players ${yours.length}</button></div>`;
    if (N.error) h += `<div class="banner stop">${esc(N.error)} <button class="link" data-action="news-retry">Try again</button></div>`;
    if (!N.list) h += N.error ? '' : '<div class="empty-note">Loading the latest news…</div>';
    else if (!shown.length) h += `<div class="empty-note">${S.ui.newsMine ? 'Nothing about your players in ESPN\'s latest news.' : 'No news right now.'}</div>`;
    else h += `<ul class="card news-list">${shown.map(s => newsRow(s, yoursIn(s), mine)).join('')}</ul>`;
    return h + `<h3 class="news-h">Insiders on X</h3><p class="fine">Accounts that only post news. Tap one to see its latest posts on X.</p>
      <ul class="card list">${NEWS_ACCOUNTS.map(a => `
        <li class="row xrow"><span class="pos" aria-hidden="true">X</span>
          <span class="who"><b>${esc(a.name)}</b><small>@${esc(a.handle)} · ${esc(a.about)}</small></span>
          <span class="right"><a class="btn small" href="https://x.com/${esc(a.handle)}" target="_blank" rel="noopener">Open on X</a></span>
        </li>`).join('')}</ul>
      <p class="fine">X doesn't let apps show posts without a paid plan, so each account opens in the X app or on x.com.</p>`;
  }

  /* ---- Matchup */

  async function loadMatchups(quiet) {
    if (DEMO || !S.snap || S.match.busy) return;
    S.match.busy = true;
    if (!quiet && S.ui.tab === 'matchup') render();
    try {
      const data = await API.collectMatchups(S.snap);
      S.match = {busy: false, data, error: '', at: Date.now(), week: S.snap.week};
    } catch (e) {
      Object.assign(S.match, {busy: false, error: 'Could not load this week\'s matchups: ' + (e && e.message ? e.message : e)});
    }
    if (S.ui.tab === 'matchup') render();
  }

  // A player's game this week: 'pre', 'in_game' or 'complete' (or nothing on a bye).
  const gameOf = team => ((S.snap && S.snap.games) || {})[SCC.teamAbbr(team)] || null;

  // Points so far (players whose game has started) and projection, for one side's starters.
  function sideTotals(side, cfg) {
    let pts = 0, proj = 0, live = false, done = true, started = false;
    side.players.forEach(p => {
      if (!p || p.empty) return;
      const g = gameOf(p.team);
      if (g && g.state !== 'pre') { pts += p.pts || 0; started = true; }
      if (g && g.state === 'in_game') live = true;
      if (g && g.state !== 'complete') done = false;
      proj += SCC.projFor(S.proj, p.id, cfg.ppr) || 0;
    });
    return {pts, proj, live, done: done && started, started};
  }

  // Laid out like Sleeper's matchup: headshots, short names ("J. Allen"), points toward the middle.
  const HEADSHOT = 'https://sleepercdn.com/content/nfl/players/thumb/';
  const LOGO = 'https://sleepercdn.com/images/team_logos/nfl/';
  const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const shortName = p => {
    const parts = String(p.name || '').split(' ');
    return p.pos === 'DEF' || parts.length < 2 ? p.name : parts[0][0] + '. ' + parts.slice(1).join(' ');
  };

  // A player's Sleeper headshot with his team's logo in the corner; a defense is its logo.
  // Used on Lineups, Rosters and (smaller) Matchup.
  function headshot(p, small) {
    const team = String(p.team || '').toLowerCase(), logo = team ? LOGO + team + '.png' : '';
    const face = p.pos === 'DEF' ? logo : /^\d+$/.test(String(p.id || '')) ? HEADSHOT + p.id + '.jpg' : '';
    return `<span class="pphoto${small ? ' sm' : ''}">${face
      ? `<img class="hs" src="${esc(face)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="hs"></span>'}${
      p.pos !== 'DEF' && logo ? `<img class="tl" src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
  }

  function matchInfo(p, side) {
    if (!p || p.empty) return `<div class="minfo ${side}"><span class="pphoto sm"><span class="hs"></span></span><div class="mtext"><b class="muted">Empty</b></div></div>`;
    const g = gameOf(p.team);
    const when = g && g.state !== 'pre'
      ? `<span class="mstate${g.state === 'in_game' ? ' live' : ''}">${g.state === 'in_game' ? 'LIVE' : 'FINAL'}</span>`
      : `<em class="kick">${esc(teamKick(p.team))}</em>`;
    return `<div class="minfo ${side}">${headshot(p, true)}<div class="mtext"><b>${esc(shortName(p))}</b>
      <small>${esc([p.pos, p.team].filter(Boolean).join(' · '))}</small><small>${when}</small></div></div>`;
  }

  // Points once his game starts (grey 0.0 before), his projection underneath.
  function matchPts(p, cfg, side) {
    if (!p || p.empty) return `<div class="mpts-col ${side}"></div>`;
    const g = gameOf(p.team), started = g && g.state !== 'pre', proj = SCC.projFor(S.proj, p.id, cfg.ppr);
    return `<div class="mpts-col ${side}"><b${started ? '' : ' class="muted"'}>${fmt(started ? p.pts : 0)}</b>${proj !== null ? `<small>${fmt(proj)}</small>` : ''}</div>`;
  }

  function matchCard(m) {
    const head = `<header class="card-h"><div><h3>${leagueIcon(m.cfg)}${esc(m.cfg.key)}</h3><p>${esc(SCC.describeLeague(m.cfg))}</p></div></header>`;
    if (m.error) return `<article class="card league">${head}<p class="note">Couldn't load this matchup: ${esc(m.error)}</p></article>`;
    if (m.none) return `<article class="card league">${head}<p class="note">No matchup this week.</p></article>`;
    const a = sideTotals(m.me, m.cfg), b = sideTotals(m.opp, m.cfg);
    const status = a.live || b.live ? '<span class="vs live">LIVE</span>' : a.done && b.done ? '<span class="vs">FINAL</span>' : '';
    const lead = (x, y) => (x.started || y.started) && x.pts > y.pts ? ' lead' : '';
    const pic = s => (s.avatar ? avatar(s.avatar, 36)
      : `<span class="avatar blank initials" style="width:36px;height:36px">${esc(initials(s.name))}</span>`);
    const team = (s, cls) => `<div class="bside ${cls}">${pic(s)}<div class="sinfo"><b class="bname">${esc(s.name)}</b><small>${esc(s.record || '')}</small></div></div>`;
    const projected = (t, cls) => `<div class="bscore ${cls}"><small>projected</small><span class="bproj">${fmt(t.proj)}</span></div>`;
    const rows = m.cfg.lineup.map((slot, i) => `<li class="mrow">${matchInfo(m.me.players[i], 'me')}${matchPts(m.me.players[i], m.cfg, 'me')}
      <span class="mslot">${esc(slotName(slot))}</span>${matchPts(m.opp.players[i], m.cfg, 'opp')}${matchInfo(m.opp.players[i], 'opp')}</li>`).join('');
    // The header, shown collapsed or open: league, score, and each side's chance to win.
    const wp = SCC.winProbability(winList(m.me, m.cfg), winList(m.opp, m.cfg));
    const pa = Math.round(wp.a * 100), pb = 100 - pa;
    const bar = a.proj || b.proj || a.started || b.started ? `<div class="winbar" title="Chance to win">
        <span class="wp me${pa >= pb ? ' up' : ''}">${pa}%</span><span class="wbar"><i class="wme" style="width:${pa}%"></i><i class="wopp" style="width:${pb}%"></i></span>
        <span class="wp opp${pb > pa ? ' up' : ''}">${pb}%</span></div>` : '';
    return `<details class="card match" ${foldAttrs('match', m.cfg)}>
      <summary class="mhead"><div class="mh-top"><span class="sname">${leagueIcon(m.cfg)}${esc(m.cfg.key)}</span>${status}</div>
        <div class="mh-score"><span class="mh-name">${esc(m.me.name)}</span><b class="mh-pts${lead(a, b)}">${fmt(a.pts)}</b>
          <b class="mh-pts${lead(b, a)}">${fmt(b.pts)}</b><span class="mh-name opp">${esc(m.opp.name)}</span></div>${bar}</summary>
      <div class="board">${team(m.me, 'me')}${projected(a, 'me')}<span class="vs">VS</span>${projected(b, 'opp')}${team(m.opp, 'opp')}</div>
      <ol class="mlist">${rows}</ol></details>`;
  }

  // One side's starters as the win-chance model reads them.
  const winList = (side, cfg) => side.players.map(p => (!p || p.empty ? null : {pts: p.pts, proj: SCC.projFor(S.proj, p.id, cfg.ppr), state: (gameOf(p.team) || {}).state || ''}));

  function screenMatchup() {
    if (DEMO) return demoOnly('Matchups', 'Matchups show your real opponent in every league, week by week.');
    if (!S.snap) return emptyState();
    const M = S.match;
    let h = `<div class="bar match-bar"><p class="lede">Your lineup against this week's opponent in every league, as both are set right now.</p>
      <button class="btn ghost small" data-action="matchups" ${M.busy ? 'disabled' : ''}>${M.busy ? 'Loading…' : 'Reload'}</button></div>`;
    if (gamesLive()) {
      h += `<p class="fine live-note">Games are on: scores update every couple of minutes while Matchup is open${M.at ? ` (last ${esc(when(M.at))})` : ''}.</p>`;
    }
    // The leagues down the left side on a wide computer window (Matchup has no chips).
    jumpBar((M.data && M.data.length ? M.data : S.A.leagues).map(x => ({cfg: x.cfg})), false);
    if (M.error) h += `<div class="banner stop">${esc(M.error)}</div>`;
    if (!M.data) return h + (M.busy ? '<div class="empty-note">Loading this week\'s matchups…</div>' : '');
    if (!M.data.length) return h + '<div class="empty-note">No leagues to show.</div>';
    return h + foldTools('match') + '<div class="league-grid">' + M.data.map(matchCard).join('') + '</div>' +
      (Object.keys(S.proj).length ? '<p class="fine">Projections via Sleeper. Chance to win is Titan\'s estimate from them and the points so far.</p>' : '');
  }

  /* ---- Rosters */

  function screenRosters() {
    if (!S.snap) return emptyState();
    const leagues = S.A.leagues;
    const pick = leagues.some(L => L.cfg.key === S.ui.league) ? S.ui.league : 'all';
    const shown = pick === 'all' ? leagues : leagues.filter(L => L.cfg.key === pick);
    let h = `<div class="bar"><label class="field grow"><span>Find a player</span><input type="search" data-roster-search
        placeholder="Name, team or position" value="${esc(S.rosterQuery)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label class="field"><span>League</span><select data-ui="league">
      <option value="all">All leagues</option>
      ${leagues.map(L => `<option ${L.cfg.key === pick ? 'selected' : ''}>${esc(L.cfg.key)}</option>`).join('')}
    </select></label></div>
    <p class="fine" data-find-count hidden></p>`;
    if (shown.length) h += jumpBar(shown.map(L => ({cfg: L.cfg})));
    if (shown.length) h += foldTools('roster');
    h += '<p class="empty-note" data-find-none hidden>No player on your rosters matches that.</p>';
    h += '<div class="league-grid">' + shown.map(L => {
      // Sleeper's order: the starters spot by spot, then the bench by position
      // (QB, RB, WR, TE, K, DEF, then IDP), best rank first, then IR and taxi.
      const byPos = (a, b) => posOrder(a.pos) - posOrder(b.pos) || SCC.rankKey(a) - SCC.rankKey(b) || a.name.localeCompare(b.name);
      const bench = L.roster.filter(p => !p.start && !p.held).sort(byPos);
      const held = L.roster.filter(p => !p.start && p.held).sort(byPos);
      if (wide()) return rosterTable(L, bench, held);
      const row = (p, label, cls) => {
        const sub = [p.pos, p.team, p.opp && 'vs ' + p.opp, has(p.implied) && 'implied ' + p.implied, p.bye && 'bye ' + p.bye].filter(Boolean).join(' · ');
        const find = [SCC.norm(p.name), String(p.team || '').toLowerCase(), String(p.pos || '').toLowerCase()].join(' ');
        return `<li class="row${p.start ? ' is-start' : ''}" data-find=" ${esc(find)} "><span class="slot${cls ? ' ' + cls : ''}"${
          p.start ? ` data-pos="${esc(p.pos)}"` : ''}>${esc(label)}</span>${headshot(p)}
          <span class="who">${nameLine(p)}<small>${esc(sub)}${statusText(p)}</small></span>
          <span class="right">${rankCell(p)}${scored(p) ? scoreChip(p) : ''}</span></li>`;
      };
      const starters = L.rows.map(r => (r.p ? row(r.p, slotName(r.slot))
        : `<li class="row r-stop" data-find=" "><span class="slot">${esc(slotName(r.slot))}</span><span class="pphoto"><span class="hs"></span></span>
          <span class="who"><b>Empty</b></span><span class="right"></span></li>`)).join('');
      return `<details class="card roster-card fold" ${foldAttrs('roster', L.cfg)}><summary class="card-h"><div><h3>${leagueIcon(L.cfg)}${esc(L.cfg.key)}</h3>
        <p>${plural(L.roster.length, 'player')} · ${L.roster.filter(p => p.start).length} starting</p></div></summary>
        <ul class="roster">${starters}${bench.length ? '<li class="rdiv">Bench</li>' + bench.map(p => row(p, 'BN')).join('') : ''}${
          held.length ? '<li class="rdiv">Reserve</li>' + held.map(p => row(p, p.heldAs || 'IR', 'held')).join('') : ''}</ul></details>`;
    }).join('') + '</div>';
    return h;
  }

  /* Computers: a league's roster as a table (spot, player, team, opponent,
     kickoff, rank, projection, points), in the same order as the phone list.
     Rows keep data-find, so the player search works the same way. */
  function rosterTable(L, bench, held) {
    // Opponents come from imported rankings; with none, the column stays out.
    const hasOpp = L.roster.some(p => p.opp), cols = hasOpp ? 8 : 7;
    const cell = (p, label, cls) => {
      const find = [SCC.norm(p.name), String(p.team || '').toLowerCase(), String(p.pos || '').toLowerCase()].join(' ');
      const proj = projOf(p, L.cfg);
      return `<tr class="${p.start ? 'is-start' : ''}" data-find=" ${esc(find)} "><td><span class="slot${cls ? ' ' + cls : ''}"${
        p.start ? ` data-pos="${esc(p.pos)}"` : ''}>${esc(label)}</span></td>
        <td class="tplayer"><span class="tp">${headshot(p, true)}<span><b>${esc(p.name)}</b><small>${esc(p.pos)}${statusText(p)}</small></span></span></td>
        <td>${esc(p.team || '')}</td>${hasOpp ? `<td>${esc(p.opp || '')}</td>` : ''}<td class="tkick">${esc(kickText(p))}</td>
        <td class="tnum">${rankCell(p)}</td><td class="tnum">${proj !== null ? fmt(proj) : ''}</td><td class="tnum">${scored(p) ? scoreChip(p) : ''}</td></tr>`;
    };
    const divider = label => `<tr class="rdiv"><td colspan="${cols}">${label}</td></tr>`;
    const starters = L.rows.map(r => (r.p ? cell(r.p, slotName(r.slot))
      : `<tr class="r-stop" data-find=" "><td><span class="slot">${esc(slotName(r.slot))}</span></td><td colspan="${cols - 1}"><b>Empty</b></td></tr>`)).join('');
    return `<details class="card roster-card fold" ${foldAttrs('roster', L.cfg)}><summary class="card-h"><div><h3>${leagueIcon(L.cfg)}${esc(L.cfg.key)}</h3>
      <p>${plural(L.roster.length, 'player')} · ${L.roster.filter(p => p.start).length} starting</p></div></summary>
      <div class="table-wrap"><table class="rtable"><thead><tr><th>Spot</th><th>Player</th><th>Team</th>${hasOpp ? '<th>Opp</th>' : ''}<th>Kickoff</th>
        <th class="tnum">Rank</th><th class="tnum">Proj</th><th class="tnum">Pts</th></tr></thead>
      <tbody>${starters}${bench.length ? divider('Bench') + bench.map(p => cell(p, 'BN')).join('') : ''}${
        held.length ? divider('Reserve') + held.map(p => cell(p, p.heldAs || 'IR', 'held')).join('') : ''}</tbody></table></div></details>`;
  }

  // Sleeper's position order, for benches: QB, RB, WR, TE, K, DEF, then IDP.
  const POS_ORDER = {QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5, DL: 6, DE: 6, DT: 6, LB: 7, DB: 8, CB: 8, S: 8};
  const posOrder = pos => (POS_ORDER[pos] !== undefined ? POS_ORDER[pos] : 9);

  /* Filters the Rosters page in place as the search is typed (no redraw, so the
     box keeps its cursor): matching rows stay, leagues without a match and
     their jump chips hide. Matches name, team or position. */
  function applyRosterSearch() {
    const q = SCC.norm(S.rosterQuery || '').trim();
    const hits = new Set();
    let rows = 0;
    view.querySelectorAll('.roster-card').forEach(card => {
      let n = 0;
      card.querySelectorAll('[data-find]').forEach(row => {
        const show = !q || row.dataset.find.includes(' ' + q) || row.dataset.find.includes(q);
        row.hidden = !show;
        if (show) n++;
      });
      card.hidden = !!q && !n;
      card.querySelectorAll('.rdiv').forEach(d => { d.hidden = !!q; });
      // A folded league opens while it has a match, and goes back to how it was after.
      if (q) { if (n && !card.open) card.open = true; }
      else card.open = isOpen('roster', card.dataset.id);
      if (q && n) { rows += n; hits.add(card.id); }
    });
    const none = view.querySelector('[data-find-none]'), count = view.querySelector('[data-find-count]');
    if (none) none.hidden = !q || rows > 0;
    if (count) {
      count.hidden = !q || !rows;
      count.textContent = rows ? `${plural(rows, 'match', 'matches')} in ${plural(hits.size, 'league')}` : '';
    }
    view.querySelectorAll('.jump [data-jump], .side [data-jump]').forEach(b => { b.hidden = !!q && !hits.has(b.dataset.jump); });
    spySide();
  }

  /* ---- Exposure */

  function screenExposure() {
    if (!S.snap) return emptyState();
    const E = SCC.exposure(S.A.leagues);
    let h = `<p class="lede">How many of your ${E.active} teams own each player (anyone on two or more).</p>`;
    if (!E.rows.length) return h + '<div class="empty-note">No player is on more than one of your teams.</div>';
    h += `<ul class="card list">${E.rows.map(r => `
      <li class="row xrow${r.count >= 5 ? ' x-hi' : r.count === 4 ? ' x-mid' : ''}">${pos(r.pos)}
        <span class="who"><b>${esc(r.name)}</b>
          <small>${esc([r.team, r.bye && 'bye ' + r.bye, 'starting in ' + r.starts].filter(Boolean).join(' · '))}</small>
          <small class="leagues">${esc(r.leagues.join(', '))}</small></span>
        <span class="right"><span class="count">${r.count}<small>/${E.active}</small></span>
          <span class="meter"><i style="width:${Math.round(100 * r.count / Math.max(E.active, 1))}%"></i></span></span>
      </li>`).join('')}</ul>`;
    return h;
  }

  /* ---- Byes */

  // "RB, FLEX" or "2 RB": the spots a bye week leaves open.
  function needText(list) {
    const c = {};
    list.forEach(s => { c[s] = (c[s] || 0) + 1; });
    return 'Need ' + Object.keys(c).map(s => (c[s] > 1 ? c[s] + ' ' : '') + s).join(', ');
  }

  function needRow(n, cols) {
    if (!n.needs.length) return '';
    return `<tr class="needs"><td colspan="${cols}"><div class="needs-in">${n.needs.map(x =>
      `<span class="need"><b>Wk ${x.week}</b> ${esc(needText(x.need))}${x.off.length ? `<small>${esc(x.off.join(', '))} off</small>` : ''}</span>`).join('')}</div></td></tr>`;
  }

  function screenByes() {
    if (!S.snap) return emptyState();
    const B = SCC.byeMap(S.A.leagues, S.snap.byes);
    const N = SCC.byeNeeds(S.A.leagues, S.snap.week);
    const short = N.filter(n => n.needs.length).length;
    const cell = n => (n ? `<td style="--heat:${(Math.min(n, 6) / 6).toFixed(2)}">${n}</td>` : '<td class="zero">·</td>');
    let h = `<p class="lede">Players on your current rosters who are off each week. Under a league, each upcoming week where byes
      leave a starting spot you can't fill, and who's off.</p>
      ${short ? `<div class="banner swap">${plural(short, 'league')} will need a pickup for a bye week.</div>`
        : '<div class="banner ok">Every lineup is covered through the byes.</div>'}
      <div class="card table-wrap"><table class="byes">
      <thead><tr><th>Week</th>${B.weeks.map(w => `<th>${w}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${B.rows.map((r, i) => `<tr${N[i].needs.length ? ' class="has-needs"' : ''}><th title="${esc(r.name)}">${leagueIcon(cfgByKey(r.key), 'xs')}${esc(r.key)}</th>${
        B.weeks.map(w => cell(r.counts[w] || 0)).join('')}<td class="tot">${r.total}</td></tr>${needRow(N[i], B.weeks.length + 2)}`).join('')}
      <tr class="all"><th>All teams</th>${B.weeks.map(w => cell(B.totals[w] || 0)).join('')}<td class="tot"></td></tr>
      </tbody></table></div>`;
    if (B.clean.length) h += `<div class="banner ok">Week ${B.clean.join(', ')} completely clean: nobody you roster anywhere is off.</div>`;
    return h;
  }

  /* ---- Results (each week's scores; the tab id is still 'score') */

  // How Titan's call on a player reads in a week's record.
  const CALL = {'OK': 'start', 'START': 'start', 'BENCH': 'bench', 'SWAP OUT': 'swap out', 'DO NOT START': "don't start", 'ON BYE': 'on bye',
    'UNRANKED': 'unranked', 'LOCKED': 'locked', 'FILL SLOT': 'fill slot'};

  function screenScore() {
    if (DEMO) return demoOnly('Results', 'Results score your real teams week by week, against what your rankings would have started.');
    if (!S.snap) return emptyState();
    const cur = S.snap.week;
    const wk = S.score.week || cur;
    let h = `<div class="bar">
      <label class="field"><span>Week</span><select data-ui="scoreWeek">
        ${Array.from({length: 18}, (_, i) => i + 1).map(w => `<option value="${w}" ${w === wk ? 'selected' : ''} ${w > cur ? 'disabled' : ''}>Week ${w}${
          w === cur ? ' (this week)' : w > cur ? ' (not played yet)' : ''}</option>`).join('')}
      </select></label>
      <button class="btn" data-action="score" ${S.score.busy ? 'disabled' : ''}>${S.score.busy ? 'Loading…' : S.score.data ? 'Reload' : 'Load'}</button>
    </div>
    <p class="lede"><b>Projected</b> is Sleeper's projection for the players you started. <b>By rank</b> is what your rankings would have
      started from the same bench, and <b>perfect</b> is the best that roster could have done in hindsight. Open a league for every player's
      rank, Titan's call, projection and points.</p>`;
    if (S.score.error) h += `<div class="banner swap">${esc(S.score.error)}</div>`;
    const D = S.score.data;
    // The leagues down the left side on a wide computer window, as on Lineups (Results has no chips).
    jumpBar(D && D.rows.length ? D.rows.map(r => ({cfg: cfgByKey(r.key)})) : S.A.leagues.map(L => ({cfg: L.cfg})), false);
    if (!D) return h;

    const T = D.totals, gained = Math.round((T.byRank - T.actual) * 10) / 10;
    if (D.provisional) {
      h += `<div class="banner swap"><b>Live:</b> games are still in progress, so these numbers will move. Projections cover the whole week.</div>`;
    }
    h += historyBanner(D);
    if (D.ranks.defaults && !D.history) {
      h += `<div class="banner ok">No rankings saved for week ${D.week}, so "By rank" uses Titan's default rankings from Sleeper's projections.</div>`;
    }
    if (!D.ranks.exact && !D.history) {
      h += `<div class="banner swap">No rankings saved for week ${D.week}${D.ranks.week
        ? `, so "By rank" is using week ${D.ranks.week}.` : ', so "By rank" has nothing to order by.'}</div>`;
    }
    h += `<section class="tiles">${tile(fmt(T.actual), 'you scored', 'muted')}${tile(T.projActual ? fmt(T.projActual) : 'None', 'projected', 'muted')}${
      tile(fmt(T.byRank), 'by rank', gained > 0 ? 'swap' : 'ok')}${tile(fmt(T.perfect), 'perfect', 'muted')}</section>`;
    const vsProj = !T.projActual ? ''
      : D.provisional ? `So far: <b>${fmt(T.actual)}</b> of <b>${fmt(T.projActual)}</b> projected. `
      : T.vsProj >= 0 ? `You beat the projection by <b class="good">${fmt(T.vsProj)}</b>. `
      : `You finished <b class="amber">${fmt(-T.vsProj)}</b> under the projection. `;
    h += `<p class="verdict-line">${vsProj}${gained > 0 ? `Following your rankings would have scored <b class="amber">${fmt(gained)}</b> more.`
      : gained < 0 ? `Your lineups beat your rankings by <b class="good">${fmt(-gained)}</b>.` : 'Your lineups matched your rankings.'}${
      T.ct ? ` Close calls right: ${T.cw} of ${T.ct}.` : ''}</p>`;
    if (D.skipped.length) h += `<p class="fine">Skipped: ${esc(D.skipped.join('; '))}</p>`;
    if (D.rows.length) h += foldTools('score');
    h += D.rows.map(r => `<details class="card score" ${foldAttrs('score', cfgByKey(r.key))}><summary>
        <span class="sname">${leagueIcon(cfgByKey(r.key))}${esc(r.key)}</span>
        <span class="n"><small>Actual</small>${fmt(r.actual)}</span>
        <span class="n"><small>Projected</small>${r.projActual ? fmt(r.projActual) : 'None'}</span>
        <span class="n${r.projActual && !D.provisional ? (r.vsProj >= 0 ? ' good' : ' amber') : ''}"><small>vs proj</small>${
          !r.projActual ? '' : D.provisional ? 'Live' : signed(r.vsProj)}</span>
        <span class="n${r.leftOnBench > 0 ? ' amber' : ''}"><small>Left on bench</small>${signed(r.leftOnBench)}</span>
      </summary>
      <p class="sub">By rank ${fmt(r.byRank)} · perfect ${fmt(r.perfect)} · close calls ${r.close.total ? `${r.close.wins} of ${r.close.total}` : 'none'}</p>
      <ul class="detail">${r.detail.map(d => detailRow(d, D.provisional)).join('')}</ul>
    </details>`).join('');
    h += `<p class="fine">Projections via Sleeper.${D.ranks.week
      ? ` <button class="link" data-action="ranks-view" data-week="${D.ranks.week}">See your week ${D.ranks.week} rankings</button>` : ''}</p>`;
    return h;
  }

  function historyBanner(D) {
    if (D.history) {
      return `<div class="banner ok">Ranks, Titan's calls and projections are as they stood at each player's kickoff, saved automatically.</div>`;
    }
    const why = `Nothing was saved at kickoff for week ${D.week}, so ranks and calls use your rankings as they are now, with Sleeper's latest projections.`;
    return S.sync.user ? `<div class="banner swap">${why}</div>`
      : `<div class="banner swap">${why} <button class="link" data-go="settings">Sign in with Google</button> and Titan saves them at every kickoff.</div>`;
  }

  // While the week is live, a player who hasn't scored yet shows no gap to his projection.
  function detailRow(d, live) {
    const slot = `<span class="slot">${esc(d.slot === 'bench' ? 'BENCH' : slotName(d.slot))}</span>`;
    if (!d.p) return `<li class="row r-stop">${slot}<span class="pos"></span><span class="who"><b>Empty slot</b></span><span class="right"></span></li>`;
    const p = d.p, proj = has(p.proj) ? Number(p.proj) : null;
    const bits = [p.rank === null ? 'unranked' : rl(p), p.call && 'Titan: ' + (CALL[p.call] || String(p.call).toLowerCase()),
      proj !== null && 'proj ' + fmt(proj)].filter(Boolean).join(' · ');
    const diff = proj !== null && !(live && !p.pts) ? `<small class="${p.pts >= proj ? 'good' : 'amber'}">${signed(p.pts - proj)}</small>` : '';
    return `<li class="row${d.benchWin ? ' r-swap' : ''}">${slot}${pos(p.pos)}
      <span class="who"><b>${esc(p.name)}</b><small>${esc(bits)}${d.benchWin ? ' · outscored your weakest starter' : ''}</small></span>
      <span class="right"><span class="rank pts">${fmt(p.pts)}${diff}</span></span></li>`;
  }

  /* ---- Rankings */

  function screenRanks() {
    const cur = S.snap ? S.snap.week : 1;
    if (!S.draft.week) S.draft.week = cur;
    const weeks = Object.keys(S.ranks.weeks).map(Number).sort((a, b) => b - a);
    return `<p class="lede">Import your own rankings and Titan makes every call from them.
      Until you import for a week, it uses default rankings (Sleeper's weekly projections, in each league's own scoring), and those also fill any position your file leaves out. ${S.sync.user
        ? 'Imported rankings sync to your devices through your Google sign-in, and only you can see them.'
        : 'Imported rankings are kept on this device and never shared. Sign in on Settings to sync them to your other devices.'}</p>
      <section class="card pad"><h3>Saved rankings</h3>${weeks.length ? `<ul class="saved">${weeks.map(w => {
        const e = S.ranks.weeks[w];
        return `<li><span><b>Week ${w}</b> · ${e.rows.length} players<small>${esc(countsText(e.rows))} · saved ${esc(when(e.savedAt))}${
          e.source ? ' from ' + esc(e.source) : ''}</small></span>
          <span class="saved-btns"><button class="btn ghost small" data-action="ranks-view" data-week="${w}">${S.view.week === w ? 'Hide' : 'View'}</button>
          <button class="btn ghost small" data-action="ranks-del" data-week="${w}">Delete</button></span></li>`;
      }).join('')}</ul>` : '<p class="muted">None yet.</p>'}</section>
      ${ranksViewer()}
      <section class="card pad"><h3>Import rankings</h3>
        <div class="bar">
          <label class="field narrow"><span>Week</span><input type="number" min="1" max="18" data-draft="week" value="${S.draft.week}"></label>
          <label class="btn ghost file">Choose CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" data-draft="file" hidden></label>
        </div>
        <label class="field block"><span>…or paste them as CSV, or copied straight out of a spreadsheet</span>
          <textarea data-draft="text" rows="7" spellcheck="false" placeholder="Player,Pos,Team,Rank,Opp,Implied,Tier&#10;Joe Burrow,QB,CIN,1,TB,27.5,1">${esc(S.draft.text)}</textarea></label>
        <div id="draft-preview" class="draft">${draftPreview()}</div>
        <details class="help"><summary>What format works?</summary>
          <p>Two layouts are read automatically:</p>
          <ul>
            <li><b>One row per player</b> with columns <code>Player, Pos, Team, Rank</code> and optionally <code>Opp, Implied, Tier</code>.
              Rank is your overall (FLEX) rank for RB/WR/TE and your positional rank for QB, K and DEF.</li>
            <li><b>Side-by-side position tables</b>, like the export from Late-Round: <code>QB Rank, QB Player, …, FLEX Rank, FLEX Player, …</code>.
              RB/WR/TE are ranked by the FLEX table.</li>
            <li><b>FantasyPros rankings</b>, one file per position. Import the QB, K and DST files, plus the FLEX
              file for RB/WR/TE. Each file is added to that week and replaces only its own position.</li>
            <li><b>The Hall's weekly rankings</b>: one overall list of every position, read as it is. Defensive
              players (LB, DB, DL) are skipped.</li>
          </ul>
          <p>Name defenses by team (<code>LAC D/ST</code>, <code>Los Angeles Chargers</code> or <code>LAC</code> all work).</p>
        </details>
      </section>`;
  }

  // One saved week's rankings, a position at a time.
  function ranksViewer() {
    const w = S.view.week, e = S.ranks.weeks[w];
    if (!e) return '';
    const counts = SCC.rankCounts(e.rows);
    const shown = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(p => counts[p]);
    const pick = shown.includes(S.view.pos) ? S.view.pos : shown[0];
    const rows = e.rows.filter(r => r.pos === pick).sort((a, b) => SCC.rankKey(a) - SCC.rankKey(b));
    const flex = pick === 'RB' || pick === 'WR' || pick === 'TE';
    return `<section class="card pad" id="ranks-view">
      <div class="view-h"><h3>Week ${w} rankings</h3><button class="btn ghost small" data-action="ranks-view" data-week="0">Close</button></div>
      <p class="fine">Saved ${esc(when(e.savedAt))}${e.source ? ' from ' + esc(e.source) : ''}.${
        flex ? ' RB, WR and TE are in FLEX order, with each player\'s FLEX rank on the right.' : ''}</p>
      <div class="chips" role="group" aria-label="Position">${shown.map(p =>
        `<button class="chip" data-view-pos="${p}" aria-pressed="${p === pick}">${p} ${counts[p]}</button>`).join('')}</div>
      <ol class="roster">${rows.map((r, i) => `<li class="row"><span class="slot">${esc(pick)}${i + 1}</span>${pos(r.pos)}
        <span class="who"><b>${esc(r.name)}</b><small>${esc([r.team, has(r.opp) && 'vs ' + r.opp, has(r.tier) && 'tier ' + r.tier].filter(Boolean).join(' · '))}</small></span>
        <span class="right"><span class="rank">${flex && r.rank !== null && r.rank < 1000 ? 'FLEX ' + esc(r.rank) : ''}</span></span></li>`).join('')}</ol>
    </section>`;
  }

  // Opens a saved week's rankings on the Rankings tab, or closes them.
  function viewRanks(w) {
    S.view.week = S.ui.tab === 'ranks' && S.view.week === w ? 0 : w;
    if (S.ui.tab !== 'ranks') go('ranks'); else render();
    const el = $('ranks-view');
    if (el) el.scrollIntoView({block: 'start', behavior: 'smooth'});
  }

  const parseDraft = () => (S.draft.text.trim() ? SCC.parseRanks(S.draft.text, {pos: S.draft.pos}) : null);

  // What saving the draft would do to that week: replace it, or add to it.
  function mergePlan(P, w) {
    const prev = S.ranks.weeks[w];
    return Object.assign({prev}, SCC.mergeRanks(prev && prev.rows, P.rows));
  }

  function posPicker() {
    return `<label class="field narrow-select"><span>Which position does this file rank?</span><select data-draft="pos">
      <option value="">Choose…</option>${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p =>
        `<option ${S.draft.pos === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>`;
  }

  function draftPreview() {
    const P = S.draft.parsed, w = S.draft.week;
    const plan = P && P.rows.length ? mergePlan(P, w) : null;
    const label = plan && plan.merged ? `Add to week ${w} rankings`
      : `Save as week ${w} rankings${S.ranks.weeks[w] ? ' (replaces saved)' : ''}`;
    const save = `<button class="btn" data-action="ranks-save" ${plan ? '' : 'disabled'}>${label}</button>`;
    if (!P) return save;
    if (P.needsPosition) return `<div class="banner swap">${esc(P.error)}</div>${posPicker()}${save}`;
    if (P.error) return `<div class="banner stop">${esc(P.error)}</div>${save}`;
    if (P.format === 'fantasypros' || P.format === 'single') {
      const skippedFp = P.skipped.length ? ` · skipped ${P.skipped.length}` : '';
      const what = plan.merged ? `<p class="fine">Saving replaces week ${w}'s ${esc(plan.positions.join(', '))} rankings and keeps the rest.</p>` : '';
      return `<div class="banner ok"><b>${P.rows.length} players read${P.format === 'fantasypros' ? ' from FantasyPros' : ''}</b> · ${
        esc(countsText(P.rows))}${skippedFp}</div>${P.warning ? `<div class="banner swap">${esc(P.warning)}</div>` : ''}${
        P.position ? posPicker() : ''}${what}${save}`;
    }
    const skipped = P.skipped.length
      ? ` · skipped ${P.skipped.length} (${esc(P.skipped.slice(0, 3).map(s => `${s.text}: ${s.why}`).join('; '))}${P.skipped.length > 3 ? '…' : ''})` : '';
    const from = P.format === 'wide' ? ' from the position tables' : P.source ? ' from ' + P.source : '';
    return `<div class="banner ok"><b>${P.rows.length} players read${from}</b> · ${esc(countsText(P.rows))}${skipped}</div>${save}`;
  }

  function paintDraft() {
    const el = $('draft-preview');
    if (el) el.innerHTML = draftPreview();
  }

  function saveRanks() {
    const P = S.draft.parsed;
    if (!P || !P.rows.length) return;
    const w = S.draft.week;
    const plan = mergePlan(P, w);
    const name = S.draft.file || 'paste';
    const kept = keepStarted(plan.rows, w);
    S.ranks.weeks[w] = {rows: plan.rows.concat(kept), savedAt: Date.now(),
      source: plan.merged ? `${(plan.prev && plan.prev.source) || 'earlier import'} + ${name}` : name};
    if (!store.set(KEY.ranks, S.ranks)) { toast('Could not save. Browser storage is full or blocked.'); return; }
    pushWeek(w);
    S.draft = {week: w, text: '', parsed: null, file: '', pos: ''};
    if (S.score.week === w) S.score.data = null;
    analyze();
    render();
    toast((plan.merged ? `Week ${w} ${plan.positions.join(', ')} rankings added. Lineups re-scored.`
      : `Week ${w} rankings saved. Lineups re-scored.`) +
      (kept.length ? ` Kept the ranks of ${plural(kept.length, 'player')} whose games have started.` : ''));
  }

  /* Rankings files usually drop players whose games are over. For this week's
     rostered players whose game has started, keep the rank they had, from the
     rankings this import replaces. */
  function keepStarted(rows, w) {
    if (!S.snap || S.snap.week !== w) return [];
    const started = {};
    S.snap.leagues.forEach(d => d.roster.forEach(p => { if (p.locked) started[SCC.norm(p.name)] = 1; }));
    // Replacing the default rankings, a started player keeps his default rank (at
    // half PPR, a middle ground: he's locked, so it's only shown). Only positions
    // the new rankings cover are kept, so the defaults still fill the rest.
    const r = ranksFor(w, S.proj), have = SCC.rankCounts(rows);
    const old = r.defaults ? SCC.defaultRanks(S.proj, playerList(), 0.5) : r.rows;
    return SCC.keepStartedRanks(rows, old.filter(x => have[x.pos]), started);
  }

  function deleteRanks(w) {
    if (!confirm(`Delete your week ${w} rankings from this device?`)) return;
    delete S.ranks.weeks[w];
    store.set(KEY.ranks, S.ranks);
    pushWeek(w);
    analyze();
    render();
  }

  /* ---- Link more leagues: one tab per platform */

  const LINK_TABS = [{id: 'sleeper', name: 'Sleeper'}, {id: 'espn', name: 'ESPN'}, {id: 'yahoo', name: 'Yahoo'}];

  function linkLeagues(sleeperHtml) {
    const n = espnLinks().length;
    const status = {sleeper: S.account.userId ? 'Linked' : '', espn: n ? plural(n, 'league') : '', yahoo: 'Soon'};
    const tab = LINK_TABS.some(t => t.id === S.ui.linkTab) ? S.ui.linkTab : S.account.userId ? 'espn' : 'sleeper';
    return `<h3>Link more leagues?</h3>
      <p class="fine">Every league you link is managed together: one set of rankings, one lineup check.</p>
      <div class="chips" role="tablist" aria-label="Fantasy sites">${LINK_TABS.map(t =>
        `<button class="chip" role="tab" data-link-tab="${t.id}" aria-selected="${t.id === tab}" aria-pressed="${t.id === tab}">${t.name}${
          status[t.id] ? ` <small>${esc(status[t.id])}</small>` : ''}</button>`).join('')}</div>
      <div class="link-pane" role="tabpanel">${tab === 'sleeper' ? sleeperHtml : tab === 'espn' ? espnSettings() : yahooLink()}</div>`;
  }

  function yahooLink() {
    return `<p>Yahoo leagues are next. Yahoo reviews every app before it can read fantasy leagues, and Titan's request is with Yahoo now.
        Once it's approved, you'll sign in with Yahoo here and your leagues will load on their own.</p>
      <div class="bar"><button class="btn" type="button" disabled>Sign in with Yahoo</button></div>`;
  }

  /* ---- ESPN leagues */

  const espnLinks = () => (S.account && S.account.espn && S.account.espn.leagues) || [];
  const espnSeason = () => (S.snap && S.snap.season) || String(new Date().getFullYear());

  function espnSettings() {
    const E = S.espn, links = espnLinks();
    const cfgOf = id => ((S.snap && S.snap.available) || []).filter(l => l.id === 'espn:' + id)[0];
    let h = '';
    h += links.length ? `<ul class="saved">${links.map(l => {
      const c = cfgOf(l.id);
      const note = !c ? 'Added. It loads on the next refresh.'
        : c.error === 'private' ? 'Private: save your ESPN login below to read it.'
        : c.error ? 'Could not read it: ' + c.error : SCC.describeLeague(c);
      return `<li><span><b>${esc(c && !c.error ? c.key : l.name || 'ESPN league ' + l.id)}</b><small${c && c.error ? ' class="bad-text"' : ''}>${
        esc((l.teamName ? l.teamName + ' · ' : '') + note)}</small></span>
        <button class="btn ghost small" data-action="espn-remove" data-id="${esc(l.id)}">Remove</button></li>`;
    }).join('')}</ul>` : '<p class="fine">None yet.</p>';
    if (E.pick) {
      h += `<div class="pick"><p><b>Which team is yours in ${esc(E.pick.name)}?</b></p><div class="chips">${E.pick.teams.map(t =>
        `<button class="chip" data-action="espn-team" data-team="${esc(t.id)}">${esc(t.name)}${t.manager ? ` <small>${esc(t.manager)}</small>` : ''}</button>`).join('')}</div>
        <button class="link" data-action="espn-cancel">Cancel</button></div>`;
    }
    h += `<form class="bar" data-form="espn-add" novalidate>
        <label class="field grow"><span>League ID or ESPN link</span><input name="league" autocapitalize="off" autocorrect="off"
          spellcheck="false" placeholder="e.g. 1234567" ${E.busy ? 'disabled' : ''}></label>
        <button class="btn" type="submit" ${E.busy ? 'disabled' : ''}>${E.busy ? 'Finding it…' : 'Add league'}</button></form>`;
    if (E.error) h += `<div class="banner stop">${esc(E.error)}</div>`;
    h += `<p class="fine">The ID is the number after <code>leagueId=</code> in the league's address on fantasy.espn.com. Titan only reads your league; it can't change your lineup.</p>
      <details class="help"${E.openLogin ? ' open' : ''}><summary>Private leagues: your ESPN login</summary><div data-espn-login>${espnLoginHtml()}</div></details>`;
    return h;
  }

  function espnLoginHtml() {
    if (!S.sync.user) {
      return `<p>Private ESPN leagues need your ESPN login, kept in your private Titan account. <button class="link" data-action="sync-in">Sign in with Google</button> first.</p>`;
    }
    const L = S.espn.login;
    if (L && L.saved) {
      return `<p>Your ESPN login is saved in your private Titan account${L.savedAt ? ` (since ${esc(when(L.savedAt))})` : ''}. Titan's server uses it only to read your ESPN leagues.</p>
        <p><button class="btn ghost small" data-action="espn-login-del">Remove my ESPN login</button></p>`;
    }
    return `<p>ESPN keeps private leagues behind your login. On a computer, sign in at fantasy.espn.com, open the browser's developer tools (F12),
        then Application, Cookies, fantasy.espn.com, and copy the values of <b>espn_s2</b> and <b>SWID</b>.</p>
      <form class="login-form" data-form="espn-login" novalidate>
        <label class="field block"><span>espn_s2</span><input name="s2" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label class="field block"><span>SWID</span><input name="swid" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"></label>
        <button class="btn" type="submit">Save ESPN login</button></form>
      <p class="fine">Saved only in your private Titan account; Titan's server uses them only to read your leagues. Remove them here anytime. Signing out of ESPN on every device also stops them working.</p>`;
  }

  // Starts an account with no Sleeper link, for people who play only on ESPN.
  function startEspnOnly() {
    S.account = {userId: '', username: '', displayName: 'My leagues', avatar: '', prefs: {}, espn: {leagues: []}, updatedAt: Date.now()};
    store.set(KEY.account, S.account);
    pushAccount();
    S.snap = null;
    store.del(KEY.snap);
    S.ui.tab = 'settings';
    S.ui.linkTab = 'espn';
    saveUi();
    render();
    const input = view.querySelector('[data-form="espn-add"] input');
    if (input) input.focus();
  }

  async function addEspn(text) {
    const E = S.espn, id = ESPN.parseLeagueId(text);
    E.pick = null;
    if (!id) { E.error = 'Type the league ID (a number) or paste the league\'s ESPN link.'; return render(); }
    if (espnLinks().some(l => String(l.id) === id)) { E.error = 'That league is already added.'; return render(); }
    Object.assign(E, {busy: true, error: ''});
    render();
    const r = await ESPN.fetchLeague(id, espnSeason());
    E.busy = false;
    if (!r.json) {
      E.error = r.error === 'not found' ? `ESPN has no league ${id} for the ${espnSeason()} season.`
        : r.error !== 'private' ? 'Could not read it from ESPN: ' + r.error
        : E.login && E.login.saved ? 'This league is private and your saved ESPN login can\'t open it. Check the espn_s2 and SWID values, and that this ESPN account is in the league.'
        : 'This league is private. Save your ESPN login below, then add it again.';
      if (r.error === 'private') E.openLogin = true;
      return render();
    }
    const name = (r.json.settings && r.json.settings.name) || 'ESPN league ' + id;
    const teams = ESPN.teamsOf(r.json);
    const mine = E.login && E.login.swid ? ESPN.ownedTeam(r.json, E.login.swid) : null;
    if (mine !== null) return saveEspnLink({id, teamId: mine, name, teamName: (teams.find(t => t.id === mine) || {}).name || ''});
    E.pick = {id, name, teams};
    render();
  }

  function saveEspnLinks(leagues) {
    S.account.espn = {leagues};
    S.account.updatedAt = Date.now();
    store.set(KEY.account, S.account);
    pushAccount();
  }

  function saveEspnLink(link) {
    Object.assign(S.espn, {pick: null, error: ''});
    saveEspnLinks(espnLinks().concat([link]));
    toast(`${link.name} added.`);
    refresh();
  }

  function pickEspnTeam(teamId) {
    const P = S.espn.pick;
    if (!P) return;
    const t = P.teams.find(x => String(x.id) === String(teamId));
    if (t) saveEspnLink({id: P.id, teamId: t.id, name: P.name, teamName: t.name});
  }

  function removeEspn(id) {
    const l = espnLinks().find(x => String(x.id) === String(id));
    if (!l || !confirm(`Remove ${l.name || 'this ESPN league'} from Titan?`)) return;
    saveEspnLinks(espnLinks().filter(x => x !== l));
    refresh();
  }

  async function saveEspnLogin(s2, swid) {
    if (!s2.trim() || !swid.trim()) { toast('Paste both espn_s2 and SWID.'); return; }
    try {
      await S.sync.api.saveEspnLogin({s2, swid});
      S.espn.login = {saved: true, swid: ESPN.normSwid(swid), savedAt: Date.now()};
      S.espn.error = '';
      toast('ESPN login saved to your private Titan account.');
      render();
      refresh();
    } catch (e) {
      toast('Could not save it: ' + (e.code || e.message));
    }
  }

  async function deleteEspnLogin() {
    if (!confirm('Remove your ESPN login from Titan? Private ESPN leagues stop loading until you save it again.')) return;
    try {
      await S.sync.api.deleteEspnLogin();
      S.espn.login = null;
      render();
      refresh();
    } catch (e) {
      toast('Could not remove it: ' + (e.code || e.message));
    }
  }

  /* ---- Settings */

  function screenSettings() {
    if (DEMO) return demoSettings();
    const a = S.account;
    const all = (S.snap && S.snap.available) || [];
    const sleeper = a.userId
      ? `<div class="account">${avatar(a.avatar, 44)}<div><b>${esc(a.displayName)}</b><small>@${esc(a.username)}</small></div>
        <button class="btn ghost small" data-action="unlink">${espnLinks().length ? 'Unlink' : 'Switch account'}</button></div>`
      : `<form class="bar" data-form="link" novalidate>
          <label class="field grow"><span>Sleeper username</span><input name="username" autocomplete="username" autocapitalize="off"
            autocorrect="off" spellcheck="false" value="${esc(S.link.name || '')}" ${S.link.busy ? 'disabled' : ''}></label>
          <button class="btn" type="submit" ${S.link.busy ? 'disabled' : ''}>${S.link.busy ? 'Finding you…' : 'Link Sleeper'}</button></form>
        ${S.link.error ? `<div class="banner stop">${esc(S.link.error)}</div>` : ''}`;
    let h = `<section class="card pad" data-sync-slot="settings">${syncSettings()}</section>${alertsCard()}${appearanceCard()}${S.owner.is ? ownerCard() : ''}
      <section class="card pad" id="link-leagues">${linkLeagues(sleeper)}</section>
      <section class="card pad"><h3>Leagues</h3>
        <p class="fine">Your Sleeper leagues are found automatically and your ESPN leagues are the ones you added, each with its own lineup format. Switch off any you don't want Titan to manage.</p>
        ${all.length ? `<ul class="lg-list">${all.map(l => `<li><label class="check">
          <input type="checkbox" data-league="${esc(l.id)}" ${l.active ? 'checked' : ''}>
          <span><b>${leagueIcon(l)}${esc(l.key)}</b><small>${esc(SCC.describeLeague(l))} · ${esc(l.lineup.map(slotName).join(' '))}</small></span></label></li>`).join('')}</ul>
          <div class="bar"><button class="btn" data-action="leagues-save">Save and refresh</button></div>`
        : `<p class="muted">${S.busy ? 'Loading…' : 'No leagues yet. Tap Refresh.'}</p>`}
      </section>
      <section class="card pad"><h3>Player list</h3>
        <p class="fine">Names, positions and teams are saved on this device and refreshed every few days. Injuries and game locks are pulled fresh on every refresh.</p>
        <div class="bar"><button class="btn ghost" data-action="players-reload">Reload player list now</button></div>
      </section>`;
    if (S.snap) {
      const lines = S.snap.log.concat(S.A ? [''].concat(S.A.log) : []);
      h += `<section class="card pad"><h3>Refresh log</h3><pre class="log">${esc(lines.join('\n'))}</pre></section>`;
    }
    return h;
  }

  function saveLeagues() {
    const prefs = Object.assign({}, S.account.prefs);
    view.querySelectorAll('[data-league]').forEach(el => { prefs[el.dataset.league] = {active: el.checked}; });
    S.account.prefs = prefs;
    S.account.updatedAt = Date.now();
    store.set(KEY.account, S.account);
    pushAccount();
    toast('Leagues saved.');
    refresh();
  }

  function unlink() {
    // With ESPN leagues saved, only the Sleeper link goes; the account stays.
    if (espnLinks().length) {
      if (!confirm('Unlink this Sleeper account? Your ESPN leagues and rankings stay.')) return;
      Object.assign(S.account, {userId: '', username: '', displayName: 'My leagues', avatar: '', updatedAt: Date.now()});
      store.set(KEY.account, S.account);
      pushAccount();
      S.snap = null;
      store.del(KEY.snap);
      render();
      refresh();
      return;
    }
    if (!confirm('Unlink this Sleeper account from Titan on this device? Your rankings stay.')) return;
    S.account = null;
    S.snap = null;
    S.A = null;
    store.del(KEY.account);
    store.del(KEY.snap);
    render();
  }

  /* ---- Sync across the person's own devices (sync.js; optional) */

  function pushAccount() {
    if (S.sync.api && S.sync.user && S.account) S.sync.api.pushAccount(S.account);
  }

  function pushWeek(w) {
    if (S.sync.api && S.sync.user) S.sync.api.pushWeek(w, S.ranks.weeks[w] || null);
  }

  // White and blue (the default) or dark, remembered on this device (theme.js handles the chips).
  function appearanceCard() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return `<section class="card pad"><h3>Appearance</h3><p class="fine">White and blue, or dark. Remembered on this device. On a computer,
      the moon and sun button at the top switches it too.</p>
      <div class="chips" role="group" aria-label="Theme"><button type="button" class="chip" data-theme-set="light" aria-pressed="${!dark}">Light</button>
        <button type="button" class="chip" data-theme-set="dark" aria-pressed="${dark}">Dark</button></div></section>`;
  }

  /* Game-day alerts, chosen per device by signed-in people. The server job
     sends them (SCC.alertsFor); sw.js shows them. */
  function alertsCard() {
    const head = `<h3>Game-day alerts</h3><p class="fine">Titan can tell you when a starter is ruled out or in the news, and check
      your lineups about 75 minutes before each kickoff, once inactives are out.</p>`;
    const card = inner => `<section class="card pad">${head}${inner}</section>`;
    if (!S.sync.user) return card('<p class="help">Sign in with Google above to turn them on.</p>');
    if (IS_IOS && !STANDALONE) {
      return card(`<p class="help">On iPhone and iPad, alerts work once Titan is on your Home Screen: tap Share ${SHARE_ICON}, then
        <b>Add to Home Screen</b>, and turn them on from there.</p>`);
    }
    const a = S.alerts;
    if (!a) return card('<p class="fine">Checking this device…</p>');
    if (!a.supported) return card('<p class="help">This browser can\'t show alerts. Chrome, Edge and Firefox can, and so can the Titan app.</p>');
    const box = (k, label, sub) => `<li><label class="check"><input type="checkbox" data-alert="${k}" ${a.prefs[k] ? 'checked' : ''}>
      <span><b>${label}</b><small>${sub}</small></span></label></li>`;
    return card(`<ul class="lg-list">${box('out', 'Starter ruled out', 'Someone in your lineup is ruled out, doubtful or on IR, with who Titan would start instead, and his backup when he\'s a free agent')}
        ${box('check', 'Lineup check', 'About 75 minutes before each kickoff, one alert for all your leagues: a starter ruled out or on bye, or an empty spot')}
        ${box('news', 'News about your starters', 'When ESPN posts a story about someone in your lineup, checked every 15 minutes. Tap the alert to read it')}</ul>
      ${S.alertsError ? `<div class="banner stop">${esc(S.alertsError)}</div>` : ''}
      ${a.permission === 'denied' && !a.on ? '<p class="fine">Notifications are blocked for Titan in this browser. Allow them in the site settings, then try again.</p>' : ''}
      <div class="bar"><button class="btn${a.on ? ' ghost' : ''}" data-action="${a.on ? 'alerts-off' : 'alerts-on'}" ${S.alertsBusy ? 'disabled' : ''}>${
        S.alertsBusy ? 'One moment…' : a.on ? 'Turn off on this device' : 'Turn on for this device'}</button>${
        a.on ? `<button class="btn ghost" data-action="alerts-test" ${S.alertsBusy ? 'disabled' : ''}>Send a test alert</button>` : ''}</div>
      ${a.on ? '<p class="fine">Alerts are on for this device. Send a test to check it shows them.</p>' : ''}`);
  }

  const alertPrefs = () => Object.assign({out: true, check: true, news: true}, S.alerts && S.alerts.prefs);

  async function alertsToggle(on) {
    if (!S.sync.api || S.alertsBusy) return;
    S.alertsBusy = true;
    S.alertsError = '';
    render();
    try {
      if (on) await S.sync.api.alertsOn(alertPrefs());
      else await S.sync.api.alertsOff();
      toast(on ? 'Alerts are on for this device.' : 'Alerts are off for this device.');
    } catch (e) {
      S.alertsError = (e && e.message) || String(e);
    } finally {
      S.alertsBusy = false;
      render();
    }
  }

  async function alertsTest() {
    if (!S.sync.api || S.alertsBusy) return;
    S.alertsBusy = true;
    S.alertsError = '';
    render();
    try {
      await S.sync.api.testAlert();
      toast('Test alert sent. It should show up in a few seconds.');
    } catch (e) {
      S.alertsError = (e && e.message) || String(e);
    } finally {
      S.alertsBusy = false;
      render();
    }
  }

  /* Titan's owner only: totals from the server (ownerStats), never anyone's details. */
  function ownerCard() {
    const o = S.owner, d = o.data;
    const rows = d ? [['Signed-in accounts', d.accounts], ['New in the last 7 days', d.newThisWeek], ['Active in the last 7 days', d.activeThisWeek],
      ['Sleeper linked', d.sleeper], ['ESPN leagues added', `${d.espnLeagues} (by ${d.espnPeople})`], ['Rankings imported', d.withRankings],
      ['Alerts turned on', d.alertsOn]] : [];
    return `<section class="card pad"><h3>Titan stats</h3>
      <p class="fine">Only you see this. Totals for people who signed in with Google (anyone using Titan without signing in isn't counted), and nothing about anyone in particular.</p>
      ${o.error ? `<div class="banner stop">${esc(o.error)}</div>` : ''}
      ${rows.length ? `<ul class="stats">${rows.map(r => `<li><span>${esc(r[0])}</span><b>${esc(r[1])}</b></li>`).join('')}</ul>` : ''}
      <button class="btn ghost small" data-action="owner-stats" ${o.busy ? 'disabled' : ''}>${o.busy ? 'Counting…' : d ? 'Count again' : 'Show the numbers'}</button></section>`;
  }

  async function loadOwnerStats() {
    if (!S.sync.api || S.owner.busy) return;
    S.owner.busy = true;
    S.owner.error = '';
    render();
    try {
      S.owner.data = await S.sync.api.ownerStats();
    } catch (e) {
      S.owner.error = 'Could not count: ' + ((e && (e.code || e.message)) || e);
    } finally {
      S.owner.busy = false;
      render();
    }
  }

  function syncSettings() {
    const s = S.sync;
    const head = '<h3>Sync across your devices</h3>';
    if (!s.ready) {
      return head + `<p class="fine">${location.protocol === 'file:'
        ? 'Sync works in the online app.' : 'Sync is loading. It needs an internet connection.'}</p>`;
    }
    if (!s.user) {
      return head + `<p class="fine">Sign in with Google to keep your linked leagues, league switches and rankings the same on your phone and computer. Only you can see them.</p>
        ${s.error ? `<div class="banner stop">${esc(s.error)}</div>` : ''}
        <div class="bar"><button class="btn" data-action="sync-in">Sign in with Google</button></div>`;
    }
    const status = s.state === 'syncing' ? 'Syncing…' : s.state === 'error' ? s.error : s.at ? `Synced · ${when(s.at)}` : 'Synced';
    const photo = s.user.photo
      ? `<img class="avatar" src="${esc(s.user.photo)}" alt="" width="44" height="44" referrerpolicy="no-referrer">` : avatar('', 44);
    return head + `<div class="account">${photo}<div><b>${esc(s.user.name || s.user.email)}</b><small>${esc(s.user.email)}</small></div>
        <button class="btn ghost small" data-action="sync-out">Sign out</button></div>
      <p class="fine${s.state === 'error' ? ' bad-text' : ''}">${esc(status)}</p>
      <details class="help"><summary>Delete my Titan account</summary>
        <p>Removes your synced Sleeper link and rankings from Titan's database and deletes your Titan sign-in. This device keeps its own copy until you unlink it.</p>
        <p><button class="btn ghost small" data-action="sync-delete">Delete my Titan account</button></p></details>`;
  }

  function syncWelcome() {
    const s = S.sync;
    if (!s.ready) return '';
    if (!s.user) {
      return `<p class="fine">Used Titan on another device? <button class="link" data-action="sync-in">Sign in with Google</button> to bring your account and rankings here.</p>`;
    }
    return `<p class="fine">Signed in as ${esc(s.user.email)}. ${s.state === 'syncing'
      ? 'Loading your Titan account…' : 'Link your Sleeper username above and it will sync to your other devices.'}</p>`;
  }

  // Sync state changes repaint only the sync panels, so nothing being typed is lost.
  function paintSync() {
    view.querySelectorAll('[data-sync-slot]').forEach(el => {
      el.innerHTML = el.dataset.syncSlot === 'welcome' ? syncWelcome() : syncSettings();
    });
    const login = view.querySelector('[data-espn-login]');
    if (login) login.innerHTML = espnLoginHtml();
    paintAccount();
  }

  /* Computers: the signed-in person at the top right with a small menu
     (Settings, Sign out), or a Sign in button. Phones use Settings. */
  function paintAccount() {
    const el = $('acct');
    if (!el) return;
    const u = S.sync.user;
    el.hidden = DEMO || !S.account || !S.sync.ready;
    if (el.hidden) return;
    el.innerHTML = u
      ? `<button type="button" class="acct-btn" data-acct="menu" aria-haspopup="menu" aria-expanded="false">${u.photo
          ? `<img src="${esc(u.photo)}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : avatar('', 28)}<span>${esc(u.name || 'Account')}</span></button>
        <div class="acct-menu" role="menu" hidden><p>${esc(u.email || '')}</p>
          <button type="button" role="menuitem" data-acct="settings">Settings</button>
          <button type="button" role="menuitem" data-acct="signout">Sign out</button></div>`
      : '<button type="button" class="btn ghost small" data-acct="signin">Sign in</button>';
  }

  function acctMenu(open) {
    const btn = document.querySelector('#acct [data-acct="menu"]'), menu = document.querySelector('#acct .acct-menu');
    if (!btn || !menu) return;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  $('acct').addEventListener('click', e => {
    const t = e.target.closest('[data-acct]');
    if (!t) return;
    const a = t.dataset.acct;
    if (a === 'menu') return acctMenu(document.querySelector('#acct .acct-menu').hidden);
    acctMenu(false);
    if (a === 'settings') go('settings');
    else if (a === 'signin' && S.sync.api) {
      S.sync.api.signIn().catch(err => window.TitanApp.setSync({state: 'error', error: 'Sign-in failed: ' + (err.code || err.message)}));
    } else if (a === 'signout' && S.sync.api && confirm('Sign out of sync on this device? Your data stays here and in your account.')) {
      S.sync.api.signOut();
    }
  });
  document.addEventListener('click', e => { if (!e.target.closest('#acct')) acctMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') acctMenu(false); });

  // The bridge sync.js talks to. The app never depends on it being there.
  window.TitanApp = {
    local: () => ({account: S.account, ranks: S.ranks}),
    setOwner(is) {
      if (S.owner.is === !!is) return;
      S.owner = {is: !!is, busy: false, data: null, error: ''};
      if (S.ui.tab === 'settings') render();
    },
    setAlerts(a) {
      S.alerts = a;
      if (S.ui.tab === 'settings') render();
    },
    applyAccount(account) {
      const newUser = !S.account || S.account.userId !== account.userId;
      const newPrefs = !newUser && (JSON.stringify(S.account.prefs || {}) !== JSON.stringify(account.prefs || {}) ||
        JSON.stringify(S.account.espn || {}) !== JSON.stringify(account.espn || {}));
      S.account = Object.assign({}, account);
      store.set(KEY.account, S.account);
      if (newUser) { S.snap = null; S.A = null; store.del(KEY.snap); }
      render();
      if (newUser || newPrefs) refresh();
    },
    applyRanks(changes) {
      Object.keys(changes).forEach(w => {
        if (changes[w]) S.ranks.weeks[w] = changes[w];
        else delete S.ranks.weeks[w];
        if (S.score.week === Number(w)) S.score.data = null;
      });
      store.set(KEY.ranks, S.ranks);
      analyze();
      render();
      toast('Rankings updated from your account.');
    },
    setSync(patch) {
      Object.assign(S.sync, patch);
      paintSync();
      // Signing in makes the week's saved record readable: score again with it.
      if (patch.state === 'on' && S.ui.tab === 'score' && S.score.data && !S.score.data.history && !S.score.busy) loadScore(S.score.week);
    },
    syncReady(api) { S.sync.api = api; S.sync.ready = true; paintSync(); },
    // Whether this person has an ESPN login saved (never the login itself).
    setEspnLogin(login) { S.espn.login = login; paintSync(); }
  };

  /* ---- Transactions */

  /* Every trade, waiver claim, free-agent move and commissioner move in the person's Sleeper
     leagues over the last three weeks, newest first (API.leagueTransactions), with filters.
     Each league loads on its own, again after five minutes. ESPN leagues aren't read yet.
     Loaders never draw synchronously, so screenMoves can start them. */
  const MOVES_EVERY = 5 * 60000;
  async function loadMoves(d) {
    const id = d.cfg.id, had = S.moves[id];
    S.moves[id] = Object.assign({}, had, {busy: true});
    try { S.moves[id] = {list: await API.leagueTransactions(d.cfg, d.rosterId, S.snap.week, 3), at: Date.now()}; }
    catch (e) { S.moves[id] = Object.assign({}, had, {busy: false, error: (e && e.message) || String(e), at: Date.now()}); }
    if (S.ui.tab === 'moves') render();
  }

  const MOVE_KIND = {trade: 'Trade', waiver: 'Waiver claim', free_agent: 'Free agent', commissioner: 'Commissioner'};
  function moveRow(x) {
    const pl = p => `${esc(p.name)} <small>${esc([p.pos, p.team].filter(Boolean).join(' '))}</small>`;
    const line = s => {
      if (x.kind === 'trade') {
        const got = s.adds.map(pl).concat(s.picks.map(esc), s.budgetIn ? [`$${s.budgetIn} of waiver budget`] : []);
        return `<div class="txside"><b>${esc(s.name)}</b> gets ${got.length ? got.join(', ') : 'nothing'}</div>`;
      }
      const parts = [];
      if (s.adds.length) parts.push(`added ${s.adds.map(pl).join(', ')}${x.bid ? ` <span class="wbid">$${x.bid}</span>` : ''}`);
      if (s.drops.length) parts.push(`dropped ${s.drops.map(pl).join(', ')}`);
      return parts.length ? `<div class="txside"><b>${esc(s.name)}</b> ${parts.join(' and ')}</div>` : '';
    };
    return `<li class="tx${x.mine ? ' mine' : ''}"><div class="tx-h"><b>${leagueIcon(x.cfg, 'xs')}${esc(x.cfg.key)}</b>
      <span class="txkind k-${esc(x.kind)}">${esc(MOVE_KIND[x.kind] || x.kind)}</span><span class="wmeta">${esc(ago(x.at))}</span></div>${x.sides.map(line).join('')}</li>`;
  }

  function screenMoves() {
    if (DEMO) return demoOnly('Transactions', 'The Transactions tab lists every trade, pickup and drop in your real leagues.');
    if (!S.snap) return emptyState();
    const leagues = S.snap.leagues || [], sleeper = leagues.filter(d => d.cfg.platform !== 'espn');
    sleeper.forEach(d => {
      const M = S.moves[d.cfg.id];
      if (!M || (!M.busy && Date.now() - (M.at || 0) > MOVES_EVERY)) loadMoves(d);
    });
    const all = [];
    sleeper.forEach(d => ((S.moves[d.cfg.id] || {}).list || []).forEach(x => all.push(Object.assign({cfg: d.cfg}, x))));
    all.sort((a, b) => b.at - a.at);
    // One league, or all of them; then the kind of move. Both filters are remembered.
    const lg = sleeper.some(d => d.cfg.id === S.ui.movesLeague) ? S.ui.movesLeague : 'all';
    const pool = lg === 'all' ? all : all.filter(x => x.cfg.id === lg);
    const tests = {all: () => true, trade: x => x.kind === 'trade', adds: x => x.kind !== 'trade', mine: x => x.mine};
    const f = tests[S.ui.movesFilter] ? S.ui.movesFilter : 'all', shown = pool.filter(tests[f]).slice(0, 150);
    const loading = sleeper.some(d => { const M = S.moves[d.cfg.id]; return !M || (M.busy && !M.list); });
    const failed = sleeper.filter(d => (S.moves[d.cfg.id] || {}).error && !(S.moves[d.cfg.id] || {}).list);
    let h = `<p class="lede">Every trade, waiver claim and free-agent move in your leagues over the last three weeks, newest first.
      Moves involving your team are marked.</p>
      <div class="bar"><label class="field"><span>League</span><select data-ui="movesLeague"><option value="all">All leagues</option>${
        sleeper.map(d => `<option value="${esc(d.cfg.id)}"${d.cfg.id === lg ? ' selected' : ''}>${esc(d.cfg.key)}</option>`).join('')}</select></label></div>
      <div class="chips" role="group" aria-label="Filter transactions">${[['all', 'All'], ['trade', 'Trades'], ['adds', 'Adds & drops'], ['mine', 'Yours']].map(([k, label]) =>
        `<button class="chip" data-moves="${k}" aria-pressed="${f === k}">${label} ${pool.filter(tests[k]).length}</button>`).join('')}</div>`;
    if (leagues.length > sleeper.length) h += '<p class="fine">ESPN leagues aren\'t in this list yet: it reads Sleeper\'s transaction history.</p>';
    if (failed.length) h += `<div class="banner stop">Couldn't load the moves in ${esc(failed.map(d => d.cfg.key).join(', '))}. Tap Refresh to try again.</div>`;
    if (!shown.length) {
      h += loading ? '<div class="empty-note">Loading your leagues\' transactions…</div>'
        : `<div class="empty-note">${sleeper.length ? (f === 'all' ? 'No moves in your leagues over the last three weeks.' : 'Nothing like that over the last three weeks.') : 'Link a Sleeper account to see your leagues\' moves.'}</div>`;
    } else {
      h += `<ul class="card txlist">${shown.map(moveRow).join('')}</ul>`;
      const total = pool.filter(tests[f]).length;
      if (total > shown.length) h += `<p class="fine">Showing the newest ${shown.length} of ${total}. Filter to Trades or Yours to see further back.</p>`;
      if (loading) h += '<p class="fine">Still loading some leagues…</p>';
    }
    return h;
  }

  /* ---- Waivers */

  /* Pickups for every league: the rankings' waiver targets, free backups for hurt starters,
     Sleeper's most-added players (where each is free in your leagues), a search for where
     anyone is available, and bids to suggest where a league bids for players (SCC.faabBid,
     from each Sleeper league's recent winning bids; ESPN's aren't read). Loaders never draw
     synchronously, so screenWaivers can start them. */
  async function loadTrending() {
    S.waiv.busy = true;
    try { Object.assign(S.waiv, {trend: await API.trendingAdds(40), error: ''}); }
    catch (e) { S.waiv.error = 'Could not load Sleeper\'s trending players.'; }
    S.waiv.busy = false;
    if (S.ui.tab === 'waivers') render();
  }

  async function loadFaab(cfg, rosterId) {
    S.waiv.faab[cfg.id] = {busy: true};
    try { S.waiv.faab[cfg.id] = {data: await API.leagueWaivers(cfg, rosterId, S.snap.week)}; }
    catch (e) { S.waiv.faab[cfg.id] = {error: true}; }
    if (S.ui.tab === 'waivers') render();
  }

  // Where a player stands in a league: on your team, rostered by someone else, or free.
  function wStatus(L, p) {
    const n = SCC.norm(p.name);
    if (L.roster.some(r => String(r.id) === String(p.id) || SCC.norm(r.name) === n)) return 'mine';
    const taken = p.pos === 'DEF' ? (L.takenAbbr || {})[SCC.teamAbbr(p.team)] : (L.takenNorm || {})[n];
    return taken ? 'taken' : 'free';
  }

  // Sleeper ids by name, for headshots of players the rankings name (built once per player list).
  let nameIdx = {for: null, map: {}};
  function idByName(players, name) {
    if (nameIdx.for !== players) {
      const map = {};
      for (const id in players) { const n = SCC.norm(players[id][0]); if (!(n in map)) map[n] = id; }
      nameIdx = {for: players, map};
    }
    return nameIdx.map[SCC.norm(name)] || '';
  }

  // Up to six players matching the search, and where each stands in every league.
  function waiverSearchResults() {
    const q = SCC.norm(S.waiv.q || '').trim();
    if (q.length < 3 || !S.A) return '';
    const players = playerList(), leagues = S.A.leagues, found = [];
    for (const id in players) {
      const e = players[id];
      if (!e || !e[2] || SCC.norm(e[0]).indexOf(q) < 0) continue;
      found.push({id, name: e[0], pos: e[1], team: e[2]});
      if (found.length >= 40) break;
    }
    if (!found.length) return '<p class="fine">No player on an NFL team by that name.</p>';
    const proj = p => SCC.projFor(S.proj, p.id, 1) || 0;
    found.sort((a, b) => proj(b) - proj(a) || a.name.localeCompare(b.name));
    return `<ul class="wlist">${found.slice(0, 6).map(p => {
      const st = leagues.map(L => ({L, s: wStatus(L, p)})), free = st.filter(x => x.s === 'free').length;
      return `<li class="wrow">${headshot(p, true)}<span class="who"><b>${esc(p.name)}</b><small>${esc(p.pos + ' · ' + p.team)} · free in ${free} of ${leagues.length}</small>
        <span class="wchips">${st.map(x => `<span class="wst ${x.s}">${esc(x.L.cfg.key)}${x.s === 'mine' ? ' · yours' : x.s === 'taken' ? ' · taken' : ''}</span>`).join('')}</span></span></li>`;
    }).join('')}</ul>`;
  }

  function screenWaivers() {
    if (!S.snap || !S.A) return emptyState();
    const W = S.waiv, players = playerList(), leagues = S.A.leagues;
    if (!W.trend && !W.busy && !W.error) loadTrending();
    leagues.forEach(L => {
      if (!L.cfg.faab || L.cfg.platform === 'espn' || W.faab[L.cfg.id]) return;
      const d = (S.snap.leagues || []).find(x => x.cfg.id === L.cfg.id);
      if (d) loadFaab(L.cfg, d.rosterId);
    });
    // How hot a pickup is: among Sleeper's 10 most added, the next 15, or neither.
    const trendAt = {};
    (W.trend || []).forEach((t, i) => { trendAt[SCC.norm(SCC.playerInfo(players, t.id).name)] = i; });
    const heat = name => { const r = trendAt[SCC.norm(name)]; return r === undefined ? 'cold' : r < 10 ? 'hot' : r < 25 ? 'warm' : 'cold'; };
    const bid = (L, name) => {
      const F = W.faab[L.cfg.id];
      if (!L.cfg.faab || !F || !F.data) return '';
      const b = SCC.faabBid({budget: F.data.budget, left: F.data.left, bids: F.data.bids, heat: heat(name)});
      return b.bid ? ` <span class="wbid" title="${b.basis === 'league' ? 'From this league\'s recent winning bids' : 'A share of the budget, until this league has more bids to go on'}">bid about $${b.bid}</span>` : '';
    };
    const budget = L => { const F = W.faab[L.cfg.id]; return F && F.data ? ` <span class="wmeta">$${F.data.left} of $${F.data.budget} left</span>` : ''; };

    const targets = leagues.filter(L => L.wire && L.wire.length).map(L => `<li class="wlg"><div class="wlg-h">${leagueIcon(L.cfg, 'xs')}<b>${esc(L.cfg.key)}</b>${budget(L)}</div>
      ${L.wire.map(w => `<div class="wline"><b>${esc(w.pos)}:</b> ${w.list.map(x => `${esc(x.name)} <small>${esc(rl(x))}</small>`).join(', ')}${
        w.cur ? ` <small class="wmeta">for ${esc(w.cur.name)}</small>` : ''}${bid(L, w.list[0].name)}</div>`).join('')}</li>`);

    const charts = SCC.depthCharts(players), cuffs = [];
    leagues.forEach(L => L.roster.filter(p => p.start && p.inj).forEach(p => {
      const b = SCC.backupOf(players, p, charts);
      if (b && wStatus(L, {id: b.id, name: b.name, pos: p.pos, team: p.team}) === 'free') cuffs.push({L, p, b});
    }));

    const trend = (W.trend || []).slice(0, 25).map(t => {
      const info = SCC.playerInfo(players, t.id), p = {id: t.id, name: info.name, pos: info.pos, team: info.team};
      const st = leagues.map(L => ({L, s: wStatus(L, p)})), free = st.filter(x => x.s === 'free'), mine = st.filter(x => x.s === 'mine').length;
      return `<li class="wrow">${headshot(p, true)}<span class="who"><b>${esc(p.name)}</b><small>${esc([p.pos, p.team].filter(Boolean).join(' · '))} · ${thousands(t.count)} adds in the last day</small>
        ${free.length ? `<details class="wfree"><summary>Free in ${free.length} of ${leagues.length}</summary><span class="wchips">${
          free.map(x => `<span class="wst free">${esc(x.L.cfg.key)}${bid(x.L, p.name)}</span>`).join('')}</span></details>`
          : `<small class="wmeta">Not free in any of your leagues${mine ? ` (yours in ${mine})` : ''}.</small>`}</span></li>`;
    });

    const anyFaab = leagues.some(L => L.cfg.faab && L.cfg.platform !== 'espn');
    let h = `<p class="lede">Pickups for every league: your rankings' waiver targets, backups for hurt starters, what Sleeper players are
      adding, and where anyone is available.${anyFaab ? ' Where a league bids for players, Titan suggests a bid from its recent winning bids.' : ''}</p>
      <section class="card pad wsec"><h3>Where is he available?</h3>
        <label class="field"><span>A player's name</span><input type="search" data-waiver-search placeholder="At least three letters" value="${esc(W.q)}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label><div id="wsearch">${waiverSearchResults()}</div></section>
      <section class="card pad wsec"><h3>Your waiver targets</h3>${targets.length ? `<ul class="wlist">${targets.join('')}</ul>`
        : '<p class="fine">No free agent your rankings rate above one of your starters right now.</p>'}</section>`;
    if (cuffs.length) {
      h += `<section class="card pad wsec"><h3>Backups for your hurt starters</h3><ul class="wlist">${cuffs.map(c => `<li class="wline wcuff">
        ${leagueIcon(c.L.cfg, 'xs')}<span><b>${esc(c.p.name)}</b> <span class="bad-text">(${esc(c.p.inj)})</span>: his backup <b>${esc(c.b.name)}</b> is free in
        ${esc(c.L.cfg.key)}.${bid(c.L, c.b.name)}</span></li>`).join('')}</ul></section>`;
    }
    h += `<section class="card pad wsec"><h3>Trending pickups</h3><p class="fine">Sleeper's most-added players in the last day, and where each is free in your leagues.</p>${
      W.error ? `<div class="banner stop">${esc(W.error)}</div>` : !W.trend ? '<p class="fine">Loading…</p>' : `<ul class="wlist">${trend.join('')}</ul>`}</section>`;
    return h;
  }

  /* ---- Standings */

  /* Each league's standings, all-play records, luck, power rankings and playoff odds
     (SCC.standings). The schedule and scores load per league (API.leagueSchedule); every
     team's roster (loadTradeTeams, shared with the Trade tab) gives its projected points
     this week. Loaders never draw synchronously, so screenStandings can start them. */
  async function loadStandings(d) {
    const id = d.cfg.id;
    S.stand[id] = {busy: true};
    try {
      S.stand[id] = {sched: await API.leagueSchedule(d.cfg, S.snap.season, S.snap.week)};
    } catch (e) {
      const why = e && /private|permission/i.test(e.message || e.code || '') ? 'it\'s private, so it needs your ESPN login (Settings)' : (e && e.message) || e;
      S.stand[id] = {error: `Could not load the schedule for ${d.cfg.key}: ${why}.`};
    }
    if (S.ui.tab === 'standings') render();
  }

  const pct = x => x >= 0.995 && x < 1 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : Math.round(x * 100) + '%';
  const nth = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const recordOf = t => `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}`;

  function screenStandings() {
    if (DEMO) return demoOnly('Standings', 'Standings show your real leagues: records, power rankings, luck and each team\'s playoff odds.');
    if (!S.snap) return emptyState();
    const leagues = S.snap.leagues || [];
    if (!leagues.length) return '<div class="empty-note">No leagues yet.</div>';
    const d = leagues.find(x => x.cfg.id === S.ui.standLeague) || leagues[0], cfg = d.cfg;
    if (!S.stand[cfg.id]) loadStandings(d);
    if (!S.trade.teams[cfg.id]) loadTradeTeams(d);
    const St = S.stand[cfg.id], Tm = S.trade.teams[cfg.id];
    let h = `<div class="bar"><label class="field"><span>League</span><select data-ui="standLeague">${leagues.map(x =>
      `<option value="${esc(x.cfg.id)}"${x === d ? ' selected' : ''}>${esc(x.cfg.key)}</option>`).join('')}</select></label></div>`;
    const err = (St && St.error) || (Tm && Tm.error);
    if (err) return h + `<div class="banner stop">${esc(err)} <button class="link" data-action="stand-retry">Try again</button></div>`;
    if (!St || St.busy || !Tm || Tm.busy) return h + '<div class="empty-note">Loading the schedule and every team\'s roster…</div>';
    const sched = St.sched;
    if (!sched.teams.length || !sched.games.length) return h + '<div class="empty-note">This league has no regular-season schedule yet.</div>';
    // This week's projected points for each team's best lineup.
    const proj = {};
    (Tm.list || []).forEach(t => { proj[t.id] = SCC.lineupPoints(t.roster, cfg.lineup, p => SCC.projFor(S.proj, p.id, cfg.ppr) || 0); });
    const key = [sched.games.filter(g => g.done).length, Object.keys(S.proj).length, S.snap.week].join('|');
    if (!St.result || St.key !== key) {
      Object.assign(St, {key, result: SCC.standings(sched.teams, sched.games, proj, {playoffTeams: cfg.playoffTeams || sched.playoffTeams, sims: 5000, seed: 7})});
    }
    const R = St.result, mineId = String(cfg.platform === 'espn' ? cfg.teamId : d.rosterId), me = R.teams.find(t => t.id === mineId);
    if (me) {
      h += `<div class="banner ok"><b>Your playoff chances in ${esc(cfg.key)}: ${pct(me.playoffs)}.</b> ${me.games
        ? `You're ${nth(me.seed)} at ${recordOf(me)}, power-ranked ${nth(me.powerRank)} of ${R.teams.length},`
        : `No games played yet, so this comes from this week's projected lineups. You're power-ranked ${nth(me.powerRank)} of ${R.teams.length},`}
        with about ${fmt(me.projWins)} wins expected by the end of the regular season.</div>`;
    }
    const cell = t => `<tr class="${t.id === mineId ? 'mine' : ''}${t.seed === R.spots ? ' cut' : ''}"><td class="tnum">${t.seed}</td>
      <td class="st-team">${esc(t.name)}</td><td>${recordOf(t)}</td><td class="st-opt tnum">${fmt(t.pf)}</td>
      <td class="st-opt">${t.allPlay.w}-${t.allPlay.l}${t.allPlay.t ? '-' + t.allPlay.t : ''}</td>
      <td class="tnum st-opt${t.luck > 0.5 ? ' good' : t.luck < -0.5 ? ' amber' : ''}">${t.games ? signed(t.luck) : '–'}</td>
      <td class="tnum st-opt">${t.powerRank}</td>
      <td><span class="st-odds"><span class="odds-bar"><i style="width:${Math.round(t.playoffs * 100)}%"></i></span><b>${pct(t.playoffs)}</b></span></td></tr>`;
    return h + `<div class="card table-wrap"><table class="stand"><thead><tr><th>#</th><th class="st-team">Team</th><th>Record</th>
        <th class="st-opt">Points</th><th class="st-opt">All-play</th><th class="st-opt">Luck</th><th class="st-opt">Power</th><th>Playoffs</th></tr></thead>
        <tbody>${R.teams.map(cell).join('')}</tbody></table></div>
      <p class="fine">${R.spots} teams make the playoffs; the dashed line is the cut. The odds come from ${thousands(R.sims)} simulations of the
        ${R.left} games left: each team scores around its average so far, blended with this week's projected lineup, give or take the
        league's usual swings. Division winners aren't modeled. All-play is a team's record if it had played every team every week, and
        luck is how many more (or fewer) wins it has than that record would give. Power ranks all-play, points per game and projected
        strength together.</p>`;
  }

  /* ---- Trade */

  /* Trade values are FantasyCalc's (fantasycalc.com), read through Titan's server
     (/api/trade-values), which asks FantasyCalc for each league format at most once a
     day, as FantasyCalc asks. FantasyCalc must be credited, with a link, wherever its
     values show. Loaders never draw synchronously, so screenTrade can start them. */
  const tradeKey = f => [f.dynasty ? 1 : 0, f.qbs, f.teams, f.ppr].join('-');
  const thousands = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const formatName = f => [f.dynasty ? 'dynasty' : 'redraft', f.qbs === 2 ? 'superflex' : '1 QB', f.teams + ' teams',
    f.ppr === 1 ? 'PPR' : f.ppr === 0.5 ? 'half PPR' : 'standard scoring'].join(', ');

  async function loadTradeValues(f) {
    const k = tradeKey(f);
    S.trade.values[k] = {busy: true};
    try {
      const q = new URLSearchParams({dynasty: f.dynasty ? 1 : 0, qbs: f.qbs, teams: f.teams, ppr: f.ppr});
      const res = await fetch('/api/trade-values?' + q);
      if (!res.ok) throw new Error('answered ' + res.status);
      const j = await res.json();
      S.trade.values[k] = {at: j.at, idx: SCC.valueIndex(j.values), waiver: SCC.waiverValue(j.values)};
    } catch (e) {
      S.trade.values[k] = {error: 'Could not load the trade values.'};
    }
    if (S.ui.tab === 'trade') render();
  }

  async function loadTradeTeams(d) {
    const id = d.cfg.id;
    S.trade.teams[id] = {busy: true};
    try {
      S.trade.teams[id] = {list: await API.leagueTeams(d.cfg, d.rosterId, S.snap.season)};
    } catch (e) {
      S.trade.teams[id] = {error: `Could not load the teams in ${d.cfg.key}: ${e && e.message ? e.message : e}.`};
    }
    if (S.ui.tab === 'trade' || S.ui.tab === 'standings') render();
  }

  function screenTrade() {
    if (DEMO) return demoOnly('Trades', 'The Trade tab weighs trades with the other teams in your real leagues, using FantasyCalc\'s trade values.');
    if (!S.snap) return emptyState();
    const leagues = S.snap.leagues || [];
    if (!leagues.length) return '<div class="empty-note">No leagues to trade in yet.</div>';
    const d = leagues.find(x => x.cfg.id === S.ui.tradeLeague) || leagues[0];
    const f = SCC.tradeFormat(d.cfg), k = tradeKey(f);
    if (!S.trade.values[k]) loadTradeValues(f);
    if (!S.trade.teams[d.cfg.id]) loadTradeTeams(d);
    const V = S.trade.values[k], T = S.trade.teams[d.cfg.id];
    const teams = (T && T.list) || [], me = teams.find(t => t.mine);
    const partner = teams.find(t => !t.mine && t.id === S.ui.tradePartner) || null;
    const P = S.trade.pick;
    if (P.league !== d.cfg.id || P.partner !== (partner ? partner.id : '')) Object.assign(P, {league: d.cfg.id, partner: partner ? partner.id : '', give: [], get: []});

    let h = `<p class="credit">Trade values by <a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a>${
      V && V.at ? `, updated ${esc(when(V.at))}` : ''}. Titan isn't affiliated with FantasyCalc.</p>
      <div class="bar">
        <label class="field"><span>League</span><select data-ui="tradeLeague">${leagues.map(x =>
          `<option value="${esc(x.cfg.id)}"${x === d ? ' selected' : ''}>${esc(x.cfg.key)}</option>`).join('')}</select></label>
        <label class="field"><span>Trade partner</span><select data-ui="tradePartner"${teams.length ? '' : ' disabled'}>
          <option value="">Pick a team</option>${teams.filter(t => !t.mine).map(t => `<option value="${esc(t.id)}"${t === partner ? ' selected' : ''}>${
            esc(t.name)}${t.manager && t.manager !== t.name ? ' (' + esc(t.manager) + ')' : ''}</option>`).join('')}</select></label>
      </div>
      <p class="fine">Values for ${esc(formatName(f))}: what players like these go for in real trades.</p>`;
    const retry = '<button class="link" data-action="trade-retry">Try again</button>';
    if (T && T.error) return h + `<div class="banner stop">${esc(T.error)} ${retry}</div>`;
    if (V && V.error) return h + `<div class="banner stop">${esc(V.error)} ${retry}</div>`;
    if (!T || T.busy || !V || V.busy) return h + '<div class="empty-note">Loading the teams and their trade values…</div>';
    if (!me) return h + `<div class="empty-note">Titan couldn't find your team in ${esc(d.cfg.key)}.</div>`;

    const val = p => SCC.playerValue(V.idx, p), worth = p => (val(p) || {}).v || 0;
    // Players and, in dynasty leagues, draft picks.
    const assets = t => t.roster.concat(t.picks || []);
    const give = P.give.map(id => assets(me).find(p => p.id === id)).filter(Boolean);
    const get = partner ? P.get.map(id => assets(partner).find(p => p.id === id)).filter(Boolean) : [];
    h += `<section class="card pad tsearch"><label class="field"><span>Who has him? Search for a player in ${esc(d.cfg.key)}</span>
        <input type="search" data-trade-search placeholder="At least three letters" value="${esc(S.trade.q || '')}" autocomplete="off"
          autocapitalize="off" autocorrect="off" spellcheck="false"></label><div id="tsearch">${tradeSearchResults()}</div></section>`;
    h += tradeIdeasCard(d.cfg, worth);
    if (partner) h += tradeSummary(d.cfg, me, partner, give, get, worth, V.waiver);
    return h + `<div class="trade-teams">${tradeRoster(d.cfg, me, 'give', val)}${partner ? tradeRoster(d.cfg, partner, 'get', val)
      : '<div class="card pad"><p class="lede">Pick a trade partner to see their roster.</p></div>'}</div>`;
  }

  /* Trade ideas (SCC.tradeIdeas) for the league on screen, found when asked (Find trades)
     and kept until the league's teams reload. Open puts one in the trade builder. */
  function findTrades() {
    const d = ((S.snap && S.snap.leagues) || []).find(x => x.cfg.id === S.trade.pick.league);
    const Tm = d && S.trade.teams[d.cfg.id], V = d && S.trade.values[tradeKey(SCC.tradeFormat(d.cfg))];
    const me = Tm && Tm.list && Tm.list.find(t => t.mine);
    if (!me || !V || !V.idx) return;
    const value = p => (SCC.playerValue(V.idx, p) || {}).v || 0;
    S.trade.ideas[d.cfg.id] = {list: SCC.tradeIdeas(me, Tm.list.filter(t => !t.mine), {value, slots: d.cfg.lineup, waiver: V.waiver, max: 6})};
    render();
  }

  // Until asked (or after Clear), just a line with Find trades, so your own trade has the room.
  function tradeIdeasCard(cfg, worth) {
    const I = S.trade.ideas[cfg.id];
    if (!I) {
      return `<section class="card pad tideas min"><div class="tideas-h"><h3>Trade ideas</h3>
        <button type="button" class="btn small" data-action="trade-find">Find trades</button></div></section>`;
    }
    const head = `<div class="tideas-h"><h3>Trade ideas</h3><div class="tideas-b">
        <button type="button" class="btn small ghost" data-action="trade-ideas-clear">Clear</button>
        <button type="button" class="btn small ghost" data-action="trade-find">Look again</button></div></div>
      <p class="fine">Fair trades (FantasyCalc's values within 5%) of one or two players each way that make your starting lineup
        stronger, and theirs too where possible. Strength is the value of each team's best starters.</p>`;
    if (!I.list.length) return `<section class="card pad tideas">${head}<p class="empty-note">No fair trade in this league makes your starting lineup stronger right now.</p></section>`;
    const names = list => list.map(p => `${esc(p.name)} <small>${thousands(worth(p))}</small>`).join(' + ');
    const change = n => `<span class="${n > 0 ? 'good' : n < 0 ? 'amber' : ''}">${(n > 0 ? '+' : n < 0 ? '−' : '') + thousands(Math.abs(n))}</span>`;
    return `<section class="card pad tideas">${head}<ol class="idea-list">${I.list.map((x, i) => `<li class="idea">
        <div class="idea-t"><b>With ${esc(x.partner.name)}</b><span>You give ${names(x.give)} · you get ${names(x.get)}</span>
          <small>Your starters ${change(x.myGain)} · theirs ${change(x.theirGain)}</small></div>
        <button type="button" class="btn small ghost" data-idea="${i}">Open</button></li>`).join('')}</ol></section>`;
  }

  /* Who has him? Players in the league on screen whose name matches the search (at least
     three letters): rostered players first, most valuable first, then free agents from the
     player list. Another team's player can go straight into a trade. */
  function tradeSearchResults() {
    const q = SCC.norm(S.trade.q || '').trim();
    const d = ((S.snap && S.snap.leagues) || []).find(x => x.cfg.id === S.trade.pick.league);
    const Tm = d && S.trade.teams[d.cfg.id];
    if (q.length < 3 || !Tm || !Tm.list) return '';
    const V = S.trade.values[tradeKey(SCC.tradeFormat(d.cfg))];
    const worth = p => (V && V.idx ? (SCC.playerValue(V.idx, p) || {}).v : 0) || 0;
    const found = [], seen = new Set(), players = playerList();
    Tm.list.forEach(t => t.roster.forEach(p => {
      const n = SCC.norm(p.name);
      if (n.includes(q)) { found.push({p, team: t}); seen.add(n); }
    }));
    for (const id in players) {
      if (found.length >= 16) break;
      const e = players[id], n = SCC.norm(e[0]);
      if (e[2] && n.includes(q) && !seen.has(n)) { found.push({p: {id, name: e[0], pos: e[1], team: e[2]}, team: null}); seen.add(n); }
    }
    if (!found.length) return '<p class="fine">Nobody by that name in this league or on an NFL team.</p>';
    found.sort((a, b) => (!!b.team - !!a.team) || worth(b.p) - worth(a.p) || a.p.name.localeCompare(b.p.name));
    return `<ul class="wlist">${found.slice(0, 8).map(({p, team}) => `<li class="wrow">${headshot(p, true)}<span class="who"><b>${esc(p.name)}</b>
      <small>${esc([p.pos, p.team].filter(Boolean).join(' · '))}${worth(p) ? ' · value ' + thousands(worth(p)) : ''}</small>
      <span class="wchips">${!team ? '<span class="wst free">free agent</span>' : team.mine ? '<span class="wst mine">on your team</span>'
        : `<span class="wst">on ${esc(team.name)}</span><button type="button" class="btn small ghost" data-tsearch="${esc(team.id)}|${esc(p.id)}">Trade for him</button>`}</span></span></li>`).join('')}</ul>`;
  }

  // A team's draft picks in a dynasty league: Sleeper says who owns which, ESPN doesn't.
  function tradePicks(cfg, team, which, val, picked) {
    if (cfg.kind !== 'Dynasty') return '';
    if (!team.picks) return '<p class="fine tnote">ESPN doesn\'t share who owns which draft picks, so picks can\'t be added here.</p>';
    if (!team.picks.length) return '';
    return '<div class="rdiv">Draft picks</div>' + team.picks.map(p => {
      const x = val(p);
      return `<button type="button" class="trow" data-trade="${which}" data-pid="${esc(p.id)}" aria-pressed="${picked.includes(p.id)}">
        <span class="pphoto sm"><span class="hs tpick">R${p.round}</span></span><span class="who"><b>${esc(p.name)}</b><small>${
          p.via ? 'from ' + esc(p.via) : 'own pick'}</small></span><span class="tval">${x ? thousands(x.v) : '–'}</span></button>`;
    }).join('');
  }

  // One team's players, most valuable first, then its draft picks. Tapping one puts it in the trade, or takes it out.
  function tradeRoster(cfg, team, which, val) {
    const picked = S.trade.pick[which], picks = tradePicks(cfg, team, which, val, picked);
    const rows = team.roster.map(p => ({p, x: val(p)}))
      .sort((a, b) => ((b.x || {}).v || 0) - ((a.x || {}).v || 0) || a.p.name.localeCompare(b.p.name));
    return `<section class="card tteam"><header class="card-h"><div><h3>${esc(which === 'give' ? 'Your team' : team.name)}</h3>
      <p>${which === 'give' ? esc(team.name) + ' · tap the players you\'d give' : 'Tap the players you\'d get'}</p></div></header>
      <div class="trows">${rows.map(({p, x}) => `<button type="button" class="trow" data-trade="${which}" data-pid="${esc(p.id)}" aria-pressed="${picked.includes(p.id)}">
        ${headshot(p, true)}<span class="who"><b>${esc(p.name)}</b><small>${esc([p.pos, p.team].filter(Boolean).join(' · '))}${
          x && x.pr ? ' · ' + esc(p.pos + x.pr) : ''}</small></span>
        <span class="tval">${x ? thousands(x.v) : '–'}${x && x.tr ? `<small class="${x.tr > 0 ? 'good' : 'amber'}" title="Change over the last 30 days">${
          x.tr > 0 ? '▲' : '▼'} ${thousands(Math.abs(x.tr))}</small>` : ''}</span></button>`).join('')}${picks}</div></section>`;
  }

  /* Each team's best starting lineup by this week's projections (Sleeper's, in the
     league's scoring), before and after the trade. Draft picks don't play. */
  function lineupImpact(cfg, me, partner, give, get) {
    if (!Object.keys(S.proj).length || !give.length || !get.length) return '';
    const pts = p => SCC.projFor(S.proj, p.id, cfg.ppr) || 0;
    const line = (team, out, inn) => {
      const gone = new Set(out.map(p => p.id));
      const before = SCC.lineupPoints(team.roster, cfg.lineup, pts);
      const after = SCC.lineupPoints(team.roster.filter(p => !gone.has(p.id)).concat(inn), cfg.lineup, pts);
      const d = Math.round((after - before) * 10) / 10;
      return `<b>${fmt(before)}</b> → <b>${fmt(after)}</b> <span class="${d > 0 ? 'good' : d < 0 ? 'amber' : 'fine'}">(${d ? signed(d) : 'no change'})</span>`;
    };
    return `<div class="tlineup"><p><span class="tl-who">Your starters</span> ${line(me, give, get)}</p>
      <p><span class="tl-who">${esc(partner.name)}'s starters</span> ${line(partner, get, give)}</p>
      <p class="fine">Projected points for each team's best lineup this week, before and after the trade.</p></div>`;
  }

  // The trade so far: both sides, the verdict, a balance bar, what would even it out, and the lineups.
  function tradeSummary(cfg, me, partner, give, get, worth, waiver) {
    const items = list => list.map(p => ({v: worth(p), pick: p.pos === 'PICK'}));
    const R = SCC.tradeVerdict(items(give), items(get), waiver), any = give.length || get.length;
    const chips = (list, which) => list.length ? list.map(p => `<button type="button" class="chip tchip" data-trade="${which}" data-pid="${esc(p.id)}" title="Take out of the trade">${
      esc(p.name)} <small>${worth(p) ? thousands(worth(p)) : '–'}</small> ✕</button>`).join('') : '<span class="fine">Nobody yet</span>';
    const total = (R.give.adj + R.get.adj) || 1, pg = Math.round(R.get.adj / total * 100);
    // A side's total, with the roster-spot value in it spelled out.
    const tot = (s, whose) => {
      const n = waiver ? Math.round(s.spot / waiver) : 0;
      return `<p class="ttot">${thousands(s.adj)}${n ? `<small>includes ${thousands(s.spot)} for ${whose} open roster spot${n > 1 ? 's' : ''}</small>` : ''}</p>`;
    };
    let verdict;
    if (!any) verdict = 'Tap players below to build a trade: yours to give, theirs to get.';
    else if (!give.length || !get.length) verdict = `Add players from ${!give.length ? 'your team' : esc(partner.name)} too.`;
    else if (R.fair) verdict = '<b class="good">Fair trade.</b> The two sides are within 5% of each other.';
    else if (R.winner === 'you') verdict = `<b class="good">You win this trade</b> by ${thousands(R.diff)}.`;
    else verdict = `<b class="amber">${esc(partner.name)} wins this trade</b> by ${thousands(-R.diff)}.`;
    let even = '';
    if (give.length && get.length && !R.fair) {
      // One more player from the side giving less, worth about R.even, would even it out.
      const from = R.winner === 'you' ? me : partner, which = R.winner === 'you' ? 'give' : 'get', taken = S.trade.pick[which];
      const near = from.roster.filter(p => !taken.includes(p.id) && worth(p) > 0)
        .sort((a, b) => Math.abs(worth(a) - R.even) - Math.abs(worth(b) - R.even)).slice(0, 3);
      even = `<p class="fine">To even it out, ${R.winner === 'you' ? 'you\'d add' : 'they\'d add'} a player worth about ${thousands(R.even)}${near.length ? ', like:' : '.'}</p>${
        near.length ? `<div class="chips">${near.map(p => `<button type="button" class="chip" data-trade="${which}" data-pid="${esc(p.id)}">+ ${
          esc(p.name)} <small>${thousands(worth(p))}</small></button>`).join('')}</div>` : ''}`;
    }
    return `<section class="card pad trade-sum">
      <div class="tsides">
        <div><h3>You give</h3><div class="chips">${chips(give, 'give')}</div>${tot(R.give, 'their')}</div>
        <div><h3>You get</h3><div class="chips">${chips(get, 'get')}</div>${tot(R.get, 'your')}</div>
      </div>
      ${any ? `<div class="winbar" title="Each side's share of the trade"><span class="wp me${pg <= 50 ? ' up' : ''}">${100 - pg}%</span>
        <span class="wbar"><i class="wopp" style="width:${100 - pg}%"></i><i class="wme" style="width:${pg}%"></i></span><span class="wp opp${pg >= 50 ? ' up' : ''}">${pg}%</span></div>` : ''}
      <p class="tverdict">${verdict}</p>${even}${lineupImpact(cfg, me, partner, give, get)}
      <p class="fine">Values add up as they are, since FantasyCalc's values already count stars for more. In an uneven trade, the side getting fewer players also gets a waiver pickup's value (about the 300th-best player) for each roster spot it frees, as FantasyCalc's own calculator does.${
        any ? ' <button class="link" data-action="trade-clear">Clear the trade</button>' : ''}</p>
    </section>`;
  }

  const SCREENS = {
    lineups: screenLineups, matchup: screenMatchup, standings: screenStandings, waivers: screenWaivers, news: screenNews, rosters: screenRosters, exposure: screenExposure, byes: screenByes,
    score: screenScore, ranks: screenRanks, trade: screenTrade, moves: screenMoves, settings: screenSettings
  };

  /* ------------------------------------------------------------- events */

  function go(tab, fromHistory) {
    if (!TABS.includes(tab)) return;
    S.ui.tab = tab;
    saveUi();
    if (!fromHistory) syncUrl(true);
    render();
    window.scrollTo(0, 0);
    if (tab === 'score' && S.snap && !S.score.data && !S.score.busy && !S.score.error) loadScore(S.score.week || S.snap.week);
    if (tab === 'matchup' && S.snap && (!S.match.data || S.match.week !== S.snap.week)) loadMatchups();
  }

  // Back and Forward move between screens, as on any website.
  window.addEventListener('popstate', () => {
    const t = tabFromPath();
    if (t && t !== S.ui.tab) go(t, true);
  });

  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  $('refresh').addEventListener('click', refresh);

  view.addEventListener('submit', e => {
    const form = e.target.dataset.form, el = e.target.elements;
    if (!form) return;
    e.preventDefault();
    if (form === 'link') linkAccount(el.username.value);
    else if (form === 'espn-add') addEspn(el.league.value);
    else if (form === 'espn-login') saveEspnLogin(el.s2.value, el.swid.value);
  });

  view.addEventListener('click', e => {
    // A tap on a league's header folds or unfolds it; the toggle listener remembers it.
    const head = e.target.closest('details[data-fold] > summary');
    if (head) { tapped = head.parentElement; return; }
    const t = e.target.closest('[data-go],[data-filter],[data-view-pos],[data-link-tab],[data-jump],[data-trade],[data-news],[data-idea],[data-moves],[data-tsearch],[data-action]');
    if (!t) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.tsearch) {
      // A searched-for player goes into the trade: his team becomes the partner, he goes on the get side.
      const [team, pid] = t.dataset.tsearch.split('|'), P = S.trade.pick;
      if (P.partner !== team) Object.assign(P, {partner: team, give: [], get: []});
      if (!P.get.includes(pid)) P.get.push(pid);
      S.ui.tradePartner = team;
      saveUi();
      render();
      const sum = view.querySelector('.trade-sum');
      if (sum) sum.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    if (t.dataset.moves) { S.ui.movesFilter = t.dataset.moves; saveUi(); return render(); }
    if (t.dataset.news) { S.ui.newsMine = t.dataset.news === 'mine'; saveUi(); return render(); }
    if (t.dataset.idea) {
      // A trade idea goes into the builder: its partner, and both sides.
      const x = ((S.trade.ideas[S.trade.pick.league] || {}).list || [])[Number(t.dataset.idea)];
      if (!x) return;
      S.ui.tradePartner = x.partner.id;
      Object.assign(S.trade.pick, {partner: x.partner.id, give: x.give.map(p => p.id), get: x.get.map(p => p.id)});
      saveUi();
      render();
      const sum = view.querySelector('.trade-sum');
      if (sum) sum.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    if (t.dataset.trade) {
      const list = S.trade.pick[t.dataset.trade], i = list.indexOf(t.dataset.pid);
      if (i >= 0) list.splice(i, 1);
      else list.push(t.dataset.pid);
      return render();
    }
    if (t.dataset.jump) {
      const card = document.getElementById(t.dataset.jump);
      if (card && card.tagName === 'DETAILS' && !card.open) { tapped = card; card.open = true; }
      if (card) card.scrollIntoView({behavior: 'smooth', block: 'start'});
      return;
    }
    if (t.dataset.linkTab) { S.ui.linkTab = t.dataset.linkTab; saveUi(); return render(); }
    if (t.dataset.filter) { S.ui.filter = t.dataset.filter; saveUi(); return render(); }
    if (t.dataset.viewPos) { S.view.pos = t.dataset.viewPos; return render(); }
    const a = t.dataset.action;
    if (a === 'score') loadScore(S.score.week || S.snap.week);
    else if (a === 'ranks-view') viewRanks(Number(t.dataset.week));
    else if (a === 'matchups') loadMatchups();
    else if (a === 'news-retry') { S.news.error = ''; loadNews(); }
    else if (a === 'stand-retry') {
      [S.stand, S.trade.teams].forEach(m => Object.keys(m).forEach(k => { if (m[k].error) delete m[k]; }));
      render();
    }
    else if (a === 'trade-find') findTrades();
    else if (a === 'trade-ideas-clear') { delete S.trade.ideas[S.trade.pick.league]; render(); }
    else if (a === 'trade-clear') { S.trade.pick.give = []; S.trade.pick.get = []; render(); }
    else if (a === 'trade-retry') {
      [S.trade.teams, S.trade.values].forEach(m => Object.keys(m).forEach(k => { if (m[k].error) delete m[k]; }));
      render();
    }
    else if (a === 'fold-all' || a === 'fold-none') foldAll(t.dataset.kind, a === 'fold-all');
    else if (a === 'espn-start') startEspnOnly();
    else if (a === 'espn-team') pickEspnTeam(t.dataset.team);
    else if (a === 'espn-cancel') { S.espn.pick = null; render(); }
    else if (a === 'espn-remove') removeEspn(t.dataset.id);
    else if (a === 'espn-login-del') deleteEspnLogin();
    else if (a === 'ranks-save') saveRanks();
    else if (a === 'ranks-del') deleteRanks(Number(t.dataset.week));
    else if (a === 'leagues-save') saveLeagues();
    else if (a === 'unlink') unlink();
    else if (a === 'players-reload') { API.clearPlayers(); refresh(); }
    else if (a === 'owner-stats') loadOwnerStats();
    else if (a === 'alerts-on') alertsToggle(true);
    else if (a === 'alerts-off') alertsToggle(false);
    else if (a === 'alerts-test') alertsTest();
    else if (a === 'ios-hint-close') { store.set(IOS_HINT_KEY, 1); render(); }
    else if (a === 'sync-in' && S.sync.api) {
      S.sync.api.signIn().catch(e => window.TitanApp.setSync({state: 'error', error: 'Sign-in failed: ' + (e.code || e.message)}));
    } else if (a === 'sync-out' && S.sync.api) {
      if (confirm('Sign out of sync on this device? Your data stays here and in your account.')) S.sync.api.signOut();
    } else if (a === 'sync-delete' && S.sync.api) {
      if (!confirm('Delete your Titan account and everything synced to it? This cannot be undone.')) return;
      S.sync.api.deleteAccount().then(() => toast('Your Titan account was deleted.'),
        e => window.TitanApp.setSync({state: 'error', error: 'Could not delete: ' + (e.code || e.message)}));
    }
  });

  view.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.ui === 'league') { S.ui.league = t.value; saveUi(); render(); }
    else if (t.dataset.ui === 'standLeague') { S.ui.standLeague = t.value; saveUi(); render(); }
    else if (t.dataset.ui === 'movesLeague') { S.ui.movesLeague = t.value; saveUi(); render(); }
    else if (t.dataset.ui === 'tradeLeague') { S.ui.tradeLeague = t.value; S.ui.tradePartner = ''; saveUi(); render(); }
    else if (t.dataset.ui === 'tradePartner') { S.ui.tradePartner = t.value; saveUi(); render(); }
    else if (t.dataset.alert) {
      if (S.alerts) S.alerts.prefs[t.dataset.alert] = t.checked;
      if (S.sync.api && S.sync.user) S.sync.api.alertPrefs(alertPrefs()).catch(() => toast('Could not save that choice. Try again.'));
    }
    else if (t.dataset.draft === 'pos') { S.draft.pos = t.value; S.draft.parsed = parseDraft(); paintDraft(); }
    else if (t.dataset.ui === 'scoreWeek') loadScore(Number(t.value));
    else if (t.dataset.draft === 'file' && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then(txt => {
        S.draft.text = txt;
        S.draft.file = f.name;
        S.draft.pos = SCC.positionHint(f.name);
        S.draft.parsed = parseDraft();
        const ta = view.querySelector('textarea[data-draft="text"]');
        if (ta) ta.value = txt;
        paintDraft();
      });
    }
  });

  /* Folding a league is remembered only when the person tapped it, not when the
     Rosters search opens or closes one ('toggle' doesn't bubble, so this listens
     on the way down). */
  let tapped = null;
  view.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches || !d.matches('details[data-fold]') || d !== tapped) return;
    tapped = null;
    setFold(d.dataset.fold, d.dataset.id, d.open);
  }, true);

  view.addEventListener('input', e => {
    const t = e.target;
    if ('tradeSearch' in t.dataset) {
      // Only the results redraw, so the box keeps its cursor.
      S.trade.q = t.value;
      const box = view.querySelector('#tsearch');
      if (box) box.innerHTML = tradeSearchResults();
    } else if ('waiverSearch' in t.dataset) {
      // Only the results redraw, so the box keeps its cursor.
      S.waiv.q = t.value;
      const box = view.querySelector('#wsearch');
      if (box) box.innerHTML = waiverSearchResults();
    } else if ('rosterSearch' in t.dataset) {
      S.rosterQuery = t.value;
      applyRosterSearch();
    } else if (t.dataset.draft === 'text') {
      S.draft.text = t.value;
      S.draft.file = '';
      S.draft.parsed = parseDraft();
      paintDraft();
    } else if (t.dataset.draft === 'week') {
      const n = parseInt(t.value, 10);
      if (n >= 1 && n <= 18) { S.draft.week = n; paintDraft(); }
    }
  });

  // Coming back to the app on game day should never show stale lineups.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.account && S.snap && Date.now() - S.snap.at > STALE_MS) refresh();
  });

  // Offline shell + installable app. Needs https (or localhost).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  /* --------------------------------------------------------------- boot */

  // The footer's Feedback link opens an email with the device and screen filled in,
  // so a bug report says where it happened. Nothing is sent unless the person sends it.
  const fb = document.getElementById('feedback');
  if (fb) {
    fb.addEventListener('click', () => {
      fb.href = 'mailto:gainalphatrading@gmail.com?subject=' + encodeURIComponent('Titan feedback') + '&body=' +
        encodeURIComponent('What happened, or what would you like to see?\n\n\n---\nScreen: ' + S.ui.tab + (DEMO ? ' (demo)' : '') +
          '\nDevice: ' + navigator.userAgent);
    });
  }

  // Google sign-in and sync (sync.js), except in the demo: its leagues never reach an account.
  if (!DEMO) {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/sync.js';
    document.body.appendChild(s);
  }
  // Rosters switch between tables and the phone list as the window crosses the website-look width,
  // and Lineups, Matchup, Rosters and Results gain or lose the league sidebar at 1100px.
  const relayout = () => { if (['lineups', 'matchup', 'rosters', 'score'].includes(S.ui.tab)) render(); };
  if (WIDE && WIDE.addEventListener) WIDE.addEventListener('change', relayout);
  if (SIDE && SIDE.addEventListener) SIDE.addEventListener('change', relayout);
  // The Appearance card shows which theme is on (theme.js tells us when it changes).
  document.addEventListener('titan-theme', () => { if (S.ui.tab === 'settings') render(); });
  if (IN_PLAY_APP) document.querySelectorAll('[data-tip]').forEach(el => { el.hidden = true; });
  analyze();
  render();
  // A snapshot saved by an older version lacks what live scores and kickoff times need, so it's refreshed.
  if (S.account && (!S.snap || Date.now() - S.snap.at > STALE_MS || (S.snap.v || 0) < 3)) refresh();
  else { loadProj(); scheduleLive(); }
})();
