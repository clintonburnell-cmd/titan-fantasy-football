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
    ? {account: 'titan.demo.account.v1', ranks: 'titan.demo.ranks.v1', snap: 'titan.demo.snapshot.v1', ui: 'titan.demo.ui.v1', multi: 'titan.demo.multi.v1', season: 'titan.demo.season.v1', lab: 'titan.demo.lab.v1', seasonRanks: 'titan.demo.seasonranks.v1'}
    : {account: 'titan.account.v1', ranks: 'titan.ranks.v1', snap: 'titan.snapshot.v1', ui: 'titan.ui.v1', multi: 'titan.multi.v1', season: 'titan.season.v1', lab: 'titan.lab.v1', seasonRanks: 'titan.seasonranks.v1'};
  const STALE_MS = 5 * 60 * 1000;
  const TABS = ['lineups', 'matchup', 'standings', 'rosters', 'waivers', 'exposure', 'byes', 'sos', 'score', 'news', 'trade', 'moves', 'ranks', 'season', 'multi', 'lab', 'value', 'dump', 'settings'];
  // Each screen's name, as a heading for screen readers (the tabs show it visually).
  const TAB_NAMES = {lineups: 'Lineups', matchup: 'Matchup', standings: 'Standings', rosters: 'Rosters', waivers: 'Waivers', exposure: 'Exposure', byes: 'Byes',
    sos: 'Schedule strength', score: 'Results', news: 'News', ranks: 'Rankings', season: 'Season rankings', multi: 'Import multiple sources', lab: 'Compare rankings', value: 'Value report', dump: 'Data dump',
    trade: 'Trade', moves: 'Transactions', settings: 'Settings'};
  // Each screen's address under /app/ (the Results tab's id is still 'score').
  const SLUG = {lineups: 'lineups', matchup: 'matchup', standings: 'standings', rosters: 'rosters', waivers: 'waivers', exposure: 'exposure', byes: 'byes', sos: 'schedule',
    score: 'results', news: 'news', ranks: 'rankings', season: 'season', multi: 'multiple', lab: 'compare', value: 'value', dump: 'data-dump', trade: 'trade', moves: 'transactions',
    settings: 'settings'};
  const tabFromPath = () => {
    const m = location.pathname.match(/^\/app\/([a-z-]+)\/?$/);
    return (m && Object.keys(SLUG).find(t => SLUG[t] === m[1])) || '';
  };
  /* Titan's five sections: a bar along the bottom on phones and in the apps, a menu with dropdowns
     on computers (app/index.html). League, Players and Rankings hold several screens, shown as
     sub-tabs at the top of the screen (screenBar); each opens on the one used there last. Settings
     is the gear in the header. */
  const SECTIONS = [
    {id: 'lineups', name: 'Lineups', tabs: ['lineups']},
    {id: 'matchup', name: 'Matchup', tabs: ['matchup']},
    {id: 'league', name: 'League', tabs: ['standings', 'rosters', 'trade', 'moves']},
    {id: 'players', name: 'Players', tabs: ['waivers', 'news', 'exposure', 'byes', 'sos']},
    // Compare (lab), Value and Data dump are Titan's owner's only: they show only on the owner's account.
    {id: 'rankings', name: 'Rankings', tabs: ['ranks', 'season', 'multi', 'lab', 'value', 'dump']},
    {id: 'results', name: 'Results', tabs: ['score']}
  ];
  const SUB_NAMES = {ranks: 'Weekly import', season: 'Season import', multi: 'Import multiple', lab: 'Compare', value: 'Value', dump: 'Data dump', score: 'Results', sos: 'Schedule'};
  const OWNER_TABS = ['lab', 'value', 'dump']; // screens only Titan's owner sees (their menu buttons and sub-tabs hide for everyone else)
  // ... except Compare rankings, which an account with the titanLab claim sees too (S.owner.lab; nothing else of the owner's).
  const canSee = t => (t === 'lab' ? S.owner.is || S.owner.lab : S.owner.is);
  const sectionOf = tab => SECTIONS.find(s => s.tabs.includes(tab)) || null;
  // The screens the league dropdown steers (Standings and Trade show one league at a time).
  const LEAGUE_SCREENS = {lineups: 1, matchup: 1, standings: 1, rosters: 1, trade: 1, moves: 1, byes: 1, value: 1, dump: 1};
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

  // Lineups' later week while Lineups draws it (screenLineups), and the regular season's last week.
  let LV = null;
  const LAST_WEEK = 18;

  const S = {
    account: store.get(KEY.account),
    ranks: store.get(KEY.ranks) || {weeks: {}},
    // Season rankings, one list per kind of league (SCC.SEASON_FORMATS, each with a TE Premium list): the Season screen.
    seasonRanks: Object.assign({formats: {}}, store.get(KEY.seasonRanks) || {}),
    sdraft: {base: '', tep: false, text: '', file: '', parsed: null}, // the Season screen's unsaved import
    sview: '', // the season list open for viewing
    seasonMemo: {}, // season values already worked out (seasonIn), by list and market
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
    owner: {is: false, lab: false, busy: false, data: null, error: ''}, // Titan's owner: the stats card in Settings; lab: the titanLab role (Compare rankings only)
    alerts: null, // game-day alerts on this device: {supported, permission, on, prefs}, once signed in
    alertsBusy: false,
    alertsError: '',
    proj: {}, // Sleeper's projections for the snapshot's week
    projAt: 0, // when they were last fetched (0: not yet this visit)
    view: {week: 0, pos: 'QB'}, // the saved rankings open on the Rankings tab
    // The Trade tab: each league's teams, FantasyCalc's values by league format, and the trade being built.
    trade: {teams: {}, values: {}, pick: {league: '', partner: '', give: [], get: []}, ideas: {}},
    draftRes: {}, draftFor: '', // draft results (the Trade tab's pop-up): each league's draft ({busy, error, data}), and the one showing
    // Import multiple sources: the week being combined and its sources (kept on this device until saved), the file being added, and
    // Sleeper's projections for a week other than this one (for Titan's default rankings as a source).
    multi: store.get(KEY.multi) || {week: 0, sources: [], defaults: false, dirty: false},
    mdraft: {text: '', file: '', pos: '', parsed: null, name: '', into: ''},
    mproj: null,
    // Lineups' week dropdown: a later week to plan (0: this week), Sleeper's schedule, each later week's projections, and the plan worked out.
    look: {week: 0, season: '', sched: null, proj: {}, none: {}, A: null, busy: false, error: ''},
    // Results' season so far: each week's totals, kept on this device once its games are all played (loadSeason).
    season: store.get(KEY.season) || null, seasonBusy: false,
    // Compare rankings (Titan's owner only): each week's test, kept on this device once its games are over (loadLab).
    lab: store.get(KEY.lab) || null, labBusy: false, labAt: 0, labError: '',
    value: {busy: false, data: null, error: '', at: 0, q: ''}, // the value report (Titan's owner only), from the owner's PC; q: its player search
    dump: {busy: false, data: null, error: '', at: 0}, // the data dump (Titan's owner only), from the owner's PC; it shares the value report's search
    news: {busy: false, at: 0, list: null, error: ''}, // ESPN's latest stories, on the News tab
    sos: {sched: null, busy: false, error: ''}, // the NFL schedule, for Schedule strength
    stand: {}, // the Standings tab: each league's schedule ({busy, error, sched, result})
    // The Waivers tab: Sleeper's trending adds, each FAAB league's budget and bids, and the search.
    waiv: {trend: null, busy: false, error: '', faab: {}, q: '', usage: null, usageBusy: false}, // usage: the last few weeks' stats (loadUsage)
    pcard: {id: '', cache: {}}, // the player card: who's showing, and each player's season week by week
    ctx: {busy: false, at: 0, data: null}, // game context on Lineups rows (/api/game-context)
    moves: {}, // the Transactions tab: each Sleeper league's recent moves ({busy, error, list, at})
    yahoo: {busy: false, error: '', data: null, note: ''}, // linking Yahoo (Titan's owner only while it's being built)
    scores: null // the scores ticker: this week's NFL games from /api/scores, once loaded
  };
  if (!TABS.includes(S.ui.tab)) S.ui.tab = 'lineups';
  // An address like /app/matchup opens that screen.
  if (tabFromPath()) S.ui.tab = tabFromPath();
  // Back from Yahoo's sign-in: Titan's server sends people to /app/settings?yahoo=<result>.
  const yahooBack = new URLSearchParams(location.search).get('yahoo');
  if (yahooBack) {
    Object.assign(S.ui, {tab: 'settings', linkTab: 'yahoo'});
    S.yahoo.note = yahooBack;
    const q = new URLSearchParams(location.search);
    q.delete('yahoo');
    if (location.protocol !== 'file:') history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
  /* A trade sent in from outside (the Titan for Sleeper extension's trade check): /app/trade?trade=<league id>:<give
     ids>:<get ids>, player ids comma-separated. It waits in S.trade.pending until the Trade tab has that league's
     teams, then fills the builder: the partner is whichever team has the players you'd get. */
  const tradeIn = new URLSearchParams(location.search).get('trade');
  // ?league=<id> opens the screen with that league picked in the dropdown (the extension's Lineups and Waivers links).
  const leagueIn = new URLSearchParams(location.search).get('league');
  if (leagueIn) {
    S.ui.league = leagueIn;
    const q = new URLSearchParams(location.search);
    q.delete('league');
    if (location.protocol !== 'file:') history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
  if (tradeIn) {
    // The last two fields are the sides; the rest is the league id (ESPN's own carry a colon: espn:<id>).
    const parts = tradeIn.split(':'), get = parts.length > 2 ? parts.pop() : '', give = parts.length > 1 ? parts.pop() : '', lg = parts.join(':');
    const ids = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
    if (lg) {
      S.trade.pending = {league: lg, give: ids(give), get: ids(get)};
      Object.assign(S.ui, {tab: 'trade', tradeLeague: lg});
      if (pickedLeague() !== 'all') S.ui.league = lg;
    }
    const q = new URLSearchParams(location.search);
    q.delete('trade');
    if (location.protocol !== 'file:') history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
  if (S.snap && S.account && S.snap.userId !== S.account.userId) { S.snap = null; store.del(KEY.snap); }
  // Yahoo's terms: its data is kept a day at most, so an older saved refresh loses its Yahoo
  // leagues (the next refresh brings them back).
  if (S.snap && Date.now() - (S.snap.at || 0) > 24 * 3600 * 1000 && (S.snap.available || []).some(l => l.platform === 'yahoo')) {
    S.snap.leagues = (S.snap.leagues || []).filter(d => d.cfg.platform !== 'yahoo');
    S.snap.available = S.snap.available.filter(l => l.platform !== 'yahoo');
    store.set(KEY.snap, S.snap);
  }
  if (DEMO && !S.account) {
    S.account = {demo: true, userId: '', username: '', displayName: 'Demo leagues', avatar: '', prefs: {}, espn: {leagues: []}, updatedAt: Date.now()};
    store.set(KEY.account, S.account);
  }

  const $ = id => document.getElementById(id);
  const view = $('view');
  // Draft results' pop-up (made on first use), what it last showed, whether Back closed it, and the teams open in it.
  let DLG = null, dlgHtml = '', dlgBack = false, dlgOpener = null;
  let PC = null, pcBack = false, pcOpener = null; // the player card's <dialog>, closed by Back like the draft results'; focus returns to what opened each
  const dOpen = new Set();

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

  /* The matchup tilt on close calls (SCC.analyzeLeague's opts.tilt): a player's projection in the league's scoring
     moved by how soft his opponent is to his position (the game context's points-allowed ranks: the softest eight
     up to +8%, the toughest eight down to -8%) and by the game itself (SCC.impliedTilt: his team's expected points
     from the betting line against the average side this week, up to 10% either way). Null until the projections
     and the context are in, so the server's frozen record (no tilt) and the app agree except on these close calls. */
  const TILT = 0.08;
  function tiltFor() {
    if (!S.ctx.data || !S.ctx.data.teams || !Object.keys(S.proj).length) return null;
    return cfg => p => {
      const proj = SCC.projFor(S.proj, p.id, cfg);
      if (proj === null || proj === undefined) return null;
      const r = dvpRank(p);
      return proj * (1 + (r && r <= 8 ? TILT : r && r >= 25 ? -TILT : 0) + SCC.impliedTilt(S.ctx.data, p.team));
    };
  }

  function analyze() {
    S.look.A = null; // a planned later week is worked out again when next drawn (lookAnalysis)
    if (!S.snap) { S.A = null; return; }
    const r = ranksFor(S.snap.week, S.proj), tilt = tiltFor();
    S.A = SCC.analyzeAll(S.snap, rankingsOf(r, S.proj, playerList()), tilt ? {tilt: (p, cfg) => tilt(cfg)(p)} : undefined);
    S.A.ranks = r;
  }

  /* ------------------------------------------------------------ refresh */

  function setProgress(msg) {
    const el = $('progress');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* The saved refresh (KEY.snap): every full refresh, and at most every five minutes from the live tick (it's the
     whole snapshot, serialised). A device with full or blocked storage is told once, rather than opening on old
     data next time with no explanation. */
  const STORAGE_FULL = 'Titan couldn\'t save your leagues on this device: browser storage is full or blocked, so the next open may show old data. Deleting old rankings on the Rankings screen frees room.';
  let snapSavedAt = 0;
  function saveSnap(always) {
    if (!always && Date.now() - snapSavedAt < 5 * 60000) return true;
    const ok = store.set(KEY.snap, S.snap);
    if (ok) { snapSavedAt = Date.now(); if (S.error === STORAGE_FULL) S.error = ''; }
    else if (!S.error) S.error = STORAGE_FULL;
    return ok;
  }

  // Storage that outlives its use: projections and kickoffs for other seasons, and projections for weeks well past.
  function pruneStorage() {
    let s;
    try { s = window.localStorage; } catch (e) { return; }
    if (!s || !S.snap) return;
    const season = String(S.snap.season), week = Number(S.snap.week) || 1, gone = [];
    for (let i = 0; i < s.length; i++) {
      const m = /^titan\.(proj|kickoffs|sproj)\.v(\d)\.(\d{4})(?:\.(\d+))?$/.exec(s.key(i) || '');
      // Other seasons, weeks well past, and the older shape (v1, without the stat line) all go.
      if (m && (m[3] !== season || (m[1] !== 'kickoffs' && m[2] === '1') || (m[1] === 'proj' && Number(m[4]) < week - 2))) gone.push(m[0]);
    }
    gone.forEach(k => store.del(k));
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
      saveSnap(true);
      S.proj = await API.fetchProjections(snap.season, snap.week);
      S.projAt = Date.now();
      S.look.proj = {}; // later weeks' projections are fetched again when shown (loadLook)
      S.look.none = {};
      pruneStorage();
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
      if (S.ui.tab === 'score' && S.snap && !S.score.data && !S.score.busy) loadScore(S.score.week || S.snap.week, !S.score.week);
      sendLabFormats(); // the owner's league formats, for the server's weekly FantasyCalc snapshot
      paintTicker(); // the person's starters in each game may have changed
      if (S.again) { S.again = false; refresh(); }
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
          saveSnap();
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
  // One week scored (SCC.scoreWeek), or null before its first kickoff.
  async function scoreFor(week) {
    const leagues = S.snap.leagues.map(d => d.cfg);
    const [res, hist, proj] = await Promise.all([
      API.collectScores(S.account, leagues, week, S.snap.season),
      S.sync.api && S.sync.user ? S.sync.api.getHistory(week).catch(() => null) : null,
      API.fetchProjections(S.snap.season, week)
    ]);
    if (!res.started) return null;
    const r = ranksFor(week, proj);
    const D = SCC.scoreWeek(res, rankingsOf(r, proj, res.players), hist, proj);
    D.ranks = r;
    D.history = hist ? hist.updatedAt || 1 : 0;
    D.provisional = res.done < res.total;
    return D;
  }

  // `latest`: no week picked, so a week that hasn't kicked off yet (Tuesday until its first game) opens the week before.
  async function loadScore(week, latest) {
    if (DEMO) return;
    if (S.score.busy && S.score.week === week) return;
    const prev = S.score;
    S.score = {week, busy: true, data: null, error: ''};
    if (S.ui.tab === 'score') render();
    try {
      const D = await scoreFor(week);
      if (S.score.week !== week) return; // another week was picked meanwhile
      if (!D && latest && week > 1) return loadScore(week - 1, true);
      // A week that hasn't kicked off: the week that was showing stays, with a note.
      if (!D) S.score = Object.assign({}, prev, {busy: false, error: `Week ${week} hasn't kicked off yet, so there's nothing to score.`, errorAt: Date.now()});
      else { S.score.data = D; keepWeek(D); }
    } catch (e) {
      if (S.score.week !== week) return;
      S.score.error = `Could not load week ${week}: ${e && e.message ? e.message : e}`;
      S.score.errorAt = Date.now();
    }
    S.score.busy = false;
    if (S.ui.tab === 'score') render();
    loadSeason();
  }

  /* Season so far (Results): each week's totals, kept on this device (KEY.season) and read again
     while its games are still on. Tied to the account and season, and each week to the leagues and
     that week's rankings, so a new league or new rankings for a week reads it again. */
  const weekSig = w => S.snap.leagues.map(d => d.cfg.id).sort().join(',') + '|' + ((S.ranks.weeks[w] || {}).savedAt || 0);
  function seasonStore() {
    const s = S.season, user = String(S.account.userId || S.account.username || '');
    if (!s || s.season !== S.snap.season || s.user !== user) S.season = {season: S.snap.season, user, weeks: {}};
    return S.season;
  }
  function keepWeek(D) {
    const T = D.totals;
    seasonStore().weeks[D.week] = {week: D.week, actual: T.actual, proj: T.projActual, byRank: T.byRank, perfect: T.perfect,
      wins: T.wins, losses: T.losses, ties: T.ties, done: !D.provisional, sig: weekSig(D.week)};
    store.set(KEY.season, S.season);
  }
  // Scores the weeks before this one that aren't kept yet (or have changed), one at a time.
  async function loadSeason() {
    if (DEMO || !S.snap || S.seasonBusy) return;
    const s = seasonStore(), need = [];
    for (let w = 1; w < S.snap.week; w++) { const x = s.weeks[w]; if (!x || !x.done || x.sig !== weekSig(w)) need.push(w); }
    if (!need.length) return;
    S.seasonBusy = true;
    if (S.ui.tab === 'score') render();
    for (const w of need) {
      try { const D = await scoreFor(w); if (D) keepWeek(D); } catch (e) { /* that week stays out for now */ }
    }
    S.seasonBusy = false;
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
    $('gear').hidden = !a;
    $('psearch-btn').hidden = !a || !S.snap;
    const sec = sectionOf(S.ui.tab);
    document.querySelectorAll('#tabs [data-tab], #gear').forEach(t =>
      t.setAttribute('aria-current', t.dataset.tab === S.ui.tab ? 'page' : 'false'));
    document.querySelectorAll('#tabs [data-section]').forEach(t =>
      t.setAttribute('aria-current', sec && sec.id === t.dataset.section ? 'page' : 'false'));
    // Compare rankings and the value report are on the menu only for Titan's owner.
    OWNER_TABS.forEach(t => { const b = document.querySelector(`#tabs [data-tab="${t}"]`); if (b) b.hidden = !canSee(t); });
    // Badges: the lineup changes to make, and a dot on Players for waiver pickups not yet seen on Waivers.
    const changes = S.A ? S.A.changes.length : 0, fresh = newWire();
    const badge = $('badge-lineups'), dot = $('dot-players');
    badge.hidden = !changes;
    badge.textContent = changes ? String(changes) : '';
    badge.title = plural(changes, 'lineup change');
    dot.hidden = !fresh;
    dot.title = plural(fresh, 'new waiver pickup');
    paintAccount();
  }

  /* The Players dot: waiver pickups that would beat a starter which you haven't seen on
     Waivers yet, each known by league and player. Opening Waivers marks what's there as seen,
     so the dot comes back only for a new one (or one that went away and came back).
     Remembered on the device with the other screen settings. */
  const wireKeys = () => [...new Set(((S.A && S.A.wireLines) || []).flatMap(x =>
    (x.w.list || []).map(p => x.league.id + '|' + (p.id || SCC.norm(p.name)))))];
  const newWire = () => { const seen = new Set(S.ui.seenWire || []); return wireKeys().filter(k => !seen.has(k)).length; };
  function markWireSeen() {
    const keys = wireKeys();
    if (keys.join() !== (S.ui.seenWire || []).join()) { S.ui.seenWire = keys; saveUi(); }
  }

  /* Repaints a screen by patching the page in place rather than replacing it wholesale, so what the person
     has (keyboard focus, a table scrolled sideways, an open menu, decoded photos, a half-typed search) survives
     each repaint: the live tick repaints every minute during games. Elements pair up by position, or by id when
     both sides have one; attributes and text are set only where they differ. A field being typed in keeps its
     value. */
  const tpl = document.createElement('template');
  function paint(root, html) {
    tpl.innerHTML = html;
    morphChildren(root, tpl.content);
  }
  function morph(from, to) {
    for (const a of [...from.attributes]) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
    for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    const tag = from.tagName;
    if ((tag === 'INPUT' && from.type !== 'file') || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (document.activeElement !== from && from.value !== to.value) from.value = to.value;
    }
    morphChildren(from, to);
  }
  function morphChildren(from, to) {
    const want = [...to.childNodes];
    for (let i = 0; i < want.length; i++) {
      const w = want[i];
      let have = from.childNodes[i];
      if (w.nodeType === 1 && w.id) {
        // The same element by id, wherever it is now, moves into place (a league card, say, when one before it went).
        for (let j = i + 1; j < from.childNodes.length; j++) {
          const c = from.childNodes[j];
          if (c.nodeType === 1 && c.id === w.id) { from.insertBefore(c, have || null); have = c; break; }
        }
      }
      if (!have) { from.appendChild(w); continue; }
      if (have.nodeType !== w.nodeType || (w.nodeType === 1 && have.tagName !== w.tagName)) { from.replaceChild(w, have); continue; }
      if (w.nodeType === 1) morph(have, w);
      else if (have.nodeValue !== w.nodeValue) have.nodeValue = w.nodeValue;
    }
    while (from.childNodes.length > want.length) from.removeChild(from.lastChild);
  }

  function render() {
    // On Waivers, what's there counts as seen (only once the leagues are analysed, so nothing is lost before then).
    if (S.ui.tab === 'waivers' && S.A) markWireSeen();
    paintHeader();
    view.dataset.tab = S.account ? S.ui.tab : 'welcome'; // lets wide screens lay out each screen
    if (!S.account) { document.title = 'Titan Fantasy Football Manager'; view.innerHTML = iosHint() + screenWelcome(); return; }
    const err = S.error ? `<div class="banner stop">${esc(S.error)}</div>` : '';
    sideItems = null;
    const body = `<h2 class="sr-only">${SUB_NAMES[S.ui.tab] || TAB_NAMES[S.ui.tab]}</h2>` + iosHint() + demoBanner() + err + screenBar() + SCREENS[S.ui.tab]();
    // On a wide computer window Lineups, Matchup, Rosters and Results put their leagues down the left side.
    paint(view, sideItems ? `<div class="with-side">${sideNav(sideItems)}<div class="side-main">${body + yahooCredit()}</div></div>` : body + yahooCredit());
    if (S.ui.tab === 'rosters' && S.rosterQuery) applyRosterSearch();
    if (S.ui.tab === 'value' || S.ui.tab === 'dump') applyValueFilter();
    // A sub-tab row too wide for a phone (the owner's Rankings) scrolls sideways to show the screen that's open.
    const subNav = view.querySelector('.subtabs'), subCur = subNav && subNav.querySelector('[aria-current="page"]');
    if (subCur) {
      const n = subNav.getBoundingClientRect(), b = subCur.getBoundingClientRect();
      if (b.right > n.right || b.left < n.left) subNav.scrollLeft += b.left - n.left - (n.width - b.width) / 2;
    }
    spySide();
    syncUrl(false);
    // Values or teams that arrive while draft results are open show there too.
    if (DLG && DLG.open) paintDraftResults();
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

  // The league chosen in the league dropdown: 'all', or one league's id while that league is loaded.
  function pickedLeague() {
    const id = S.ui.league;
    return id && id !== 'all' && S.snap && (S.snap.leagues || []).some(d => d.cfg.id === id) ? id : 'all';
  }
  const inPick = cfg => { const p = pickedLeague(); return p === 'all' || cfg.id === p; };

  // Standings and Trade show one league at a time: under All leagues, the one shown is named, and the dropdown at the top picks another.
  const onePick = (d, leagues) => (pickedLeague() === 'all' && leagues.length > 1
    ? `<p class="fine one-pick">Showing <b>${esc(d.cfg.key)}</b>. Pick another league at the top.</p>` : '');

  /* The top of each screen: its section's screens as sub-tabs, and on the screens that show leagues
     (LEAGUE_SCREENS) the one league dropdown that steers them all. A screen that always shows every league
     says so in the dropdown's place while a league is picked, so the filter never seems to vanish. */
  function screenBar() {
    const sec = sectionOf(S.ui.tab), leagues = (S.snap && S.snap.leagues) || [], pick = pickedLeague();
    const subTabs = sec ? sec.tabs.filter(t => !OWNER_TABS.includes(t) || canSee(t)) : [];
    const subs = subTabs.length > 1 ? `<nav class="subtabs" aria-label="${esc(sec.name)}">${subTabs.map(t =>
      `<button type="button" data-go="${t}"${t === S.ui.tab ? ' aria-current="page"' : ''}>${esc(SUB_NAMES[t] || TAB_NAMES[t])}</button>`).join('')}</nav>` : '';
    const drop = LEAGUE_SCREENS[S.ui.tab] && leagues.length > 1 ? `<label class="lpick"><span class="sr-only">Which leagues</span><select data-ui="league">
      <option value="all">All leagues</option>${leagues.map(d => `<option value="${esc(d.cfg.id)}"${d.cfg.id === pick ? ' selected' : ''}>${esc(d.cfg.key)}</option>`).join('')}
      </select></label>` : leagues.length > 1 && pick !== 'all' && S.account && !S.account.demo
      ? '<span class="lpick lpick-off" title="This screen shows every league">All leagues</span>' : '';
    // Lineups: which week, this one or a later one to plan (lookWeek).
    const wk = S.ui.tab === 'lineups' && S.snap && S.snap.week < LAST_WEEK ? `<label class="lpick wpick"><span class="sr-only">Which week</span><select data-ui="lineWeek">
      <option value="0">This week (${esc(S.snap.week)})</option>${Array.from({length: LAST_WEEK - S.snap.week}, (_, i) => S.snap.week + 1 + i)
        .map(n => `<option value="${n}"${n === lookWeek() ? ' selected' : ''}>Week ${n}</option>`).join('')}</select></label>` : '';
    return subs || drop || wk ? `<div class="screenbar">${subs}${wk}${drop}</div>` : '';
  }

  // A section opens on the screen used there last.
  function goSection(id) {
    const sec = SECTIONS.find(s => s.id === id);
    if (!sec) return;
    const last = S.ui.last && S.ui.last[id];
    go(sec.tabs.includes(last) ? last : sec.tabs[0]);
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
        <button class="link" data-go="ranks" data-rweek="${week}">Import week ${week} →</button></div>`;
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
        <button class="link" data-go="ranks" data-rweek="${week}">Import week ${week} →</button></div>`;
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
      S.account = Object.assign(u, {prefs: prev.prefs || {}, updatedAt: Date.now()}, prev.espn ? {espn: prev.espn} : {}, prev.yahoo ? {yahoo: prev.yahoo} : {});
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
      x.flag ? '<i class="dot" role="img" aria-label="Needs action" title="Needs action"></i>' : ''}${leagueIcon(x.cfg, 'xs')}${esc(x.cfg.key)}</button>`).join('')}</nav>`;
  }
  function sideNav(items) {
    // When some leagues have a needs-action dot, the others keep an empty slot so the names line up.
    const dots = items.some(x => x.flag);
    return `<nav class="side" aria-label="Your leagues"><p class="side-h">${plural(items.length, 'league')}</p>${items.map(x =>
      `<button type="button" class="side-link" data-jump="${anchor(x.cfg)}">${x.flag ? '<i class="dot" role="img" aria-label="Needs action" title="Needs action"></i>'
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

  /* Lineups' week dropdown (screenBar): this week, or a later one to plan. A later week is worked out from
     Sleeper's schedule (SCC.planWeek: that week's game days, opponents and byes, nothing locked) and that
     week's rankings: imported for it, else Sleeper's projections for it (ranksFor). S.A stays this week's for
     everything else (the nav dot, Waivers, alerts). While Lineups draws a later week, LV holds it, and
     kickText, teamKick, projOf and ctxLine read it. */
  const lookWeek = () => (S.snap && S.look.week > S.snap.week && S.look.week <= LAST_WEEK ? S.look.week : 0);
  const lookReady = w => !!(S.look.sched && S.look.season === S.snap.season && S.look.proj[w]);
  async function loadLook(w) {
    if (S.look.busy || !S.snap) return;
    const season = S.snap.season;
    S.look.busy = true;
    try {
      const [sched, proj] = await Promise.all([
        S.look.sched && S.look.season === season ? S.look.sched : API.nflSchedule(season),
        S.look.proj[w] || API.fetchProjections(season, w)]);
      if (!sched || !sched.length) throw new Error('Sleeper\'s NFL schedule didn\'t load');
      Object.assign(S.look, {sched, season});
      S.look.proj[w] = proj || {};
      S.look.none[w] = !Object.keys(proj || {}).length; // Sleeper hasn't published that week's projections yet
    } catch (e) {
      S.look.error = `Week ${w} couldn't be loaded (${e && e.message ? e.message : e}). Pick it again to retry.`;
    }
    S.look.busy = false;
    if (S.ui.tab === 'lineups') render();
  }
  function lookAnalysis(w) {
    if (S.look.A && S.look.A.week === w) return S.look.A;
    const proj = S.look.proj[w], r = ranksFor(w, proj), snap = SCC.planWeek(S.snap, S.look.sched, w);
    const A = SCC.analyzeAll(snap, rankingsOf(r, proj, playerList()));
    return (S.look.A = Object.assign(A, {ranks: r, week: w, snap, proj}));
  }
  const planNote = w => `<div class="banner ok plan-note"><b>Planning week ${w}.</b> Your lineups as they're set now, checked against
    week ${w}'s byes, matchups and rankings.</div>`;

  function screenLineups() {
    if (!S.snap) return emptyState();
    const w = lookWeek();
    if (!w) return lineupsFor(S.A, 0);
    if (!lookReady(w)) {
      if (!S.look.busy && !S.look.error) loadLook(w);
      return planNote(w) + (S.look.error ? `<div class="banner stop">${esc(S.look.error)}</div>` : `<p class="fine">Loading week ${w}…</p>`);
    }
    const A = lookAnalysis(w);
    LV = {week: w, games: A.snap.games, proj: A.proj};
    try { return lineupsFor(A, w); } finally { LV = null; }
  }

  // Lineups for this week (w 0, S.A) or a later week being planned (w, lookAnalysis).
  function lineupsFor(A, w) {
    // The league dropdown narrows the leagues first; the filters then count and pick within them.
    const mine = A.leagues.filter(L => inPick(L.cfg));
    const filters = LEAGUE_FILTERS.map(f => Object.assign({n: mine.filter(f.test).length}, f));
    const pickF = filters.find(f => f.id === S.ui.filter) || filters[0];
    const list = mine.filter(pickF.test);
    let h = (w ? planNote(w) : '') + (w && S.look.none[w] ? `<div class="banner swap">Sleeper hasn't published week ${w}'s projections yet, so this plan
      checks byes, injuries and opponents against your latest rankings.</div>` : '') + ranksBanner(A.ranks, w || S.snap.week);
    if (!w && gamesLive()) {
      h += `<p class="fine live-note">Games are on: scores update about every minute while Lineups is open${
        S.snap.pointsAt ? ` (last ${esc(when(S.snap.pointsAt))})` : ''}.</p>`;
    }
    const G = gameCounts(A.leagues);
    h += `<section class="tiles three">
      ${tile(A.changes.length, A.changes.length === 1 ? 'lineup change' : 'lineup changes', A.changes.length ? 'swap' : 'ok')}
      ${tile(A.hurtStarters.length, A.hurtStarters.length === 1 ? 'injured starter' : 'injured starters', A.hurtStarters.length ? 'stop' : 'ok')}
      ${tile(A.wireLines.length, A.wireLines.length === 1 ? 'wire upgrade' : 'wire upgrades', A.wireLines.length ? 'wire' : 'ok')}
    </section>${w ? '' : `
    <section class="tiles tiles-games" aria-label="This week's games">
      ${tile(G.startLocked, 'starters locked', 'muted')}
      ${tile(G.startLeft, 'starters yet to play', G.startLeft ? 'ok' : 'muted')}
      ${tile(G.benchLocked, 'bench locked', 'muted')}
      ${tile(G.benchLeft, 'bench yet to play', 'muted')}
    </section>`}`;
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
    if (!w && !S.ctx.busy && Date.now() - S.ctx.at > CONTEXT_EVERY) loadContext();
    // A later week: its own projections, and no game lines or weather (those are this week's).
    const projN = Object.keys(w ? A.proj : S.proj).length, C = w ? null : S.ctx.data;
    const credit = (w ? '<p class="fine">Injury tags are as they stand today. For a later week, only IR, PUP and suspensions bench a player.</p>' : '') +
      (projN || C ? `<p class="fine">${projN ? 'Projections via Sleeper. A close call\'s floor and ceiling are the projection give or take the player\'s usual swing (his recent weeks, steadied by his position\'s). ' : ''}${C
      ? `Game lines from ESPN, forecasts from the <a href="https://www.weather.gov" target="_blank" rel="noopener">National Weather Service</a>, and points
        allowed by position from <a href="https://github.com/nflverse" target="_blank" rel="noopener">nflverse</a> (CC BY 4.0${C.dvpSeason ? ', ' + esc(C.dvpSeason) + ' season' : ''}).` : ''}</p>` : '');
    // Leagues sit two across on wide screens (.league-grid).
    return h + (list.length ? `<div class="league-grid">${list.map(leagueCard).join('')}</div>` : '') + credit;
  }

  const projOf = (p, cfg) => SCC.projFor(LV ? LV.proj : S.proj, p.id, cfg);

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
  // Sleeper's own leagues carry no platform; ESPN's and Yahoo's do.
  const onSleeper = cfg => !cfg.platform || cfg.platform === 'sleeper';
  // Yahoo's terms: credit Yahoo wherever its data shows.
  const YAHOO_TABS = {lineups: 1, rosters: 1, exposure: 1, byes: 1, waivers: 1};
  const yahooCredit = () => YAHOO_TABS[S.ui.tab] && S.snap && (S.snap.leagues || []).some(d => d.cfg.platform === 'yahoo')
    ? '<p class="fine yahoo-credit">Fantasy data provided by <a href="https://sports.yahoo.com/fantasy/" target="_blank" rel="noopener">Yahoo Fantasy</a>.</p>' : '';
  /* A league's own picture (its Sleeper avatar, or your team's logo in an ESPN league) with a
     small badge for its site in the corner, like the team logo on a player's headshot. With no
     picture, or one that fails to load, a plain football shows (as Sleeper shows its default).
     size 'xs' is smaller, without the badge. */
  const SITE_LETTER = {sleeper: 'S', espn: 'E', yahoo: 'Y'};
  // A league without a picture of its own shows the Titan icon; the site's badge stays in the corner.
  const NO_PIC = '<img src="/icon.svg" alt="" width="26" height="26">';
  function leagueIcon(cfg, size = '') {
    const site = SITE_LETTER[cfg.platform] ? cfg.platform : 'sleeper';
    return `<span class="licon${size ? ' ' + size : ''}" aria-hidden="true"><span class="lini">${NO_PIC}</span>${
      cfg.pic ? `<img src="${esc(cfg.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${
      size === 'xs' ? '' : `<i class="lsite s-${site}" title="${siteName(cfg)}">${SITE_LETTER[site]}</i>`}</span>`;
  }
  function lineupUrl(cfg) {
    if (cfg.platform === 'yahoo') return cfg.url || 'https://football.fantasysports.yahoo.com/';
    if (cfg.platform !== 'espn') return SCC.sleeperTeamUrl(cfg.id);
    const team = cfg.teamId !== null && cfg.teamId !== undefined ? `&teamId=${encodeURIComponent(cfg.teamId)}` : '';
    return `https://fantasy.espn.com/football/team?leagueId=${encodeURIComponent(cfg.espnId)}${team}&seasonId=${encodeURIComponent(S.snap ? S.snap.season : '')}`;
  }
  // Demo leagues have no team page to open.
  // Each league site opens in a new tab, leaving Titan where it was.
  const newTab = () => ' target="_blank" rel="noopener"';
  const openSite = cfg => {
    if (cfg.demo) return '';
    const url = lineupUrl(cfg);
    return `<a class="btn ghost small open-site" href="${esc(url)}"${newTab(url)}>Open in ${siteName(cfg)} ↗</a>`;
  };
  const kickOf = p => kickText(p) ? ', ' + kickText(p) : '';

  function leagueCard(L) {
    const st = L.stops ? ['stop', plural(L.stops, 'problem')]
      : L.moves.length ? ['swap', plural(L.moves.length, 'change')]
      : ['ok', 'Set'];
    let h = `<details class="card league fold" ${foldAttrs('lineup', L.cfg)}>
      <summary class="card-h"><div><h3>${leagueIcon(L.cfg)}${esc(L.cfg.key)}</h3><p>${esc(SCC.describeLeague(L.cfg)) + projLine(L)}</p></div><span class="pill p-${st[0]}">${st[1]}</span></summary>${
      leagueAdvice(L.cfg)}`;
    if (L.moves.length) {
      // The changes as text, for the clipboard (Copy changes): one line a spot.
      const copyText = `${L.cfg.key}, week ${LV ? LV.week : S.snap.week} lineup changes:\n` + L.moves.map(m =>
        `${slotName(m.slot)}: ${m.out ? `out ${m.out.name}${m.to ? ` (to ${slotName(m.to)})` : ''}` : 'empty'} → in ${m.inn.name}${m.from ? ` (from ${slotName(m.from)})` : ''}`).join('\n');
      // A starter changing spots shows where he goes or comes from, and when he plays.
      h += `<div class="moves"><div class="moves-h"><h4>${LV ? `For week ${LV.week}, make these changes in ${siteName(L.cfg)}` : `Make these changes in ${siteName(L.cfg)}`}</h4><span class="moves-b">${
        L.cfg.demo ? '' : `<button type="button" class="btn small ghost" data-copy="${esc(copyText)}">Copy changes</button>`}${openSite(L.cfg)}</span></div>${L.moves.map(m => `
        <div class="move"><span class="slot">${esc(slotName(m.slot))}</span>
          <span class="mv out${m.to ? ' to' : ''}">${m.out ? `${esc(m.out.name)} <em>${m.to ? `to ${esc(slotName(m.to))}${esc(kickOf(m.out))}` : esc(rl(m.out))}</em>` : '<em>nobody</em>'}</span>
          <span class="mv in">${esc(m.inn.name)} <em>${m.from ? `from ${esc(slotName(m.from))}${esc(kickOf(m.inn))}` : esc(rl(m.inn)) + (m.inn.opp ? ' vs ' + esc(m.inn.opp) : '')}</em></span>
        </div>`).join('')}${L.moves.some(m => m.from || m.to) ? '<p class="fine">Later kickoffs go in FLEX, so a late scratch can still be covered from your bench.</p>' : ''}</div>`;
    }
    const rec = recLineup(L);
    h += `<h4 class="lu-h">${LV ? `Recommended lineup for week ${LV.week}` : 'Recommended lineup'}</h4><ol class="lineup lineup-rec">${
      rec.map((o, i) => recRow(o, (L.rows[i] || {}).p, L.cfg)).join('')}</ol>${compareLineups(L, rec)}${LV ? '' : closeNotes(L)}`;
    (L.tilts || []).forEach(t => {
      h += `<p class="note tilt"><b>Matchup tilt:</b> ${esc(t.inn.name)} starts over ${esc(t.out.name)}, who ranks higher (${esc(rl(t.out))} vs ${esc(rl(t.inn))}):
        with the matchups counted, ${esc(t.inn.name)} projects ${fmt(t.by)} more.</p>`;
    });
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

  /* The weeks of Sleeper's stats behind floors and ceilings (the same three finished weeks Waivers' usage lines read,
     loadUsage), and a player's floor and ceiling this week (SCC.spreadOf) in the league's scoring. */
  function statWeeks() {
    const U = S.waiv.usage;
    if (!U || U.week !== S.snap.week) { if (!S.waiv.usageBusy && !DEMO) loadUsage(); return []; }
    return U.list || [];
  }
  const spreadFor = (p, cfg) => SCC.spreadOf(statWeeks(), p.id, p.pos, SCC.projFor(S.proj, p.id, cfg));
  // The points a player's team is expected to score this week (the betting line, from the game context), or null.
  function impliedOf(p) {
    const C = S.ctx.data, t = C && C.teams && C.teams[SCC.teamAbbr(p.team)];
    return t && t.implied ? t.implied : null;
  }
  // How soft a player's matchup is: his opponent's rank for points given up to his position (1 gives up the most), from the game context.
  function dvpRank(p) {
    const C = S.ctx.data, t = C && C.teams && C.teams[SCC.teamAbbr(p.team)];
    const d = t && C.dvp && C.dvp[t.opp] && C.dvp[t.opp][p.pos];
    return d ? d.rank : null;
  }
  // Your chance to win this week in a league, from the Matchup tab's data when it's in (0 to 100), else null.
  function winChance(cfg) {
    const M = S.match;
    if (!M.data || M.week !== S.snap.week) { if (!M.busy && !DEMO) loadMatchups(true); return null; }
    const m = M.data.find(x => x.cfg.id === cfg.id);
    return m && !m.error && !m.none ? matchState(m).pa : null;
  }

  /* The close calls in a league's lineup (SCC.closeCallPairs: a starter and a bench player at his position within
     CLOSE ranks of each other), each with both players' floor and ceiling, the softer matchup, and a lean: when
     you're the favorite this week (60% or more) the higher floor is the safer start; as the underdog (40% or less)
     the higher ceiling gives the better shot. The recommended lineup itself follows the rankings; this is the
     second opinion for the spots where they're nearly even. */
  const FAV = 60, DOG = 40;
  function closeNotes(L) {
    const pairs = SCC.closeCallPairs(L.opt, L.roster);
    if (!pairs.length) return '';
    const pa = winChance(L.cfg), notes = [];
    pairs.forEach(({starter, bench}) => {
      const a = spreadFor(starter, L.cfg), b = spreadFor(bench, L.cfg);
      if (!a || !b) return;
      const floorer = a.floor >= b.floor ? starter : bench, ceiler = a.ceiling >= b.ceiling ? starter : bench;
      const fl = floorer === starter ? a : b, ce = ceiler === starter ? a : b;
      let s = `<b>${esc(starter.name)}</b> over <b>${esc(bench.name)}</b> is a close call (${esc(rl(starter))} vs ${esc(rl(bench))}). `;
      if (floorer === ceiler) s += `${esc(floorer.name)} has both the higher floor (${fmt(fl.floor)}) and the higher ceiling (${fmt(ce.ceiling)}).`;
      else s += `${esc(floorer.name)} has the higher floor (${fmt(fl.floor)} to ${fmt(fl.ceiling)}), ${esc(ceiler.name)} the higher ceiling (${fmt(ce.floor)} to ${fmt(ce.ceiling)}).`;
      const ra = dvpRank(starter), rb = dvpRank(bench);
      if (ra && rb && ra !== rb) s += ` ${esc((ra < rb ? starter : bench).name)} has the softer matchup (${nth(Math.min(ra, rb))} most given up to ${esc(starter.pos)}s, against ${nth(Math.max(ra, rb))}).`;
      const ia = impliedOf(starter), ib = impliedOf(bench);
      if (ia && ib && Math.abs(ia - ib) >= 4) s += ` ${esc((ia > ib ? starter : bench).name)}'s team is expected to score more (${Math.max(ia, ib)} points to ${Math.min(ia, ib)}).`;
      if (pa !== null && floorer !== ceiler) {
        if (pa >= FAV) s += ` <em>You're the favorite this week (${pa}%), so the higher floor is the safer start.</em>`;
        else if (pa <= DOG) s += ` <em>You're the underdog this week (${pa}%), so the higher ceiling gives you the better shot.</em>`;
      }
      notes.push(`<p class="note close-call">${s}</p>`);
    });
    return notes.join('');
  }

  // A started player's points: LIVE while his game is on, FINAL once it's over.
  const scored = p => p.locked && typeof p.pts === 'number';
  const playDay = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', {weekday: 'short', timeZone: 'UTC'});

  // When a team plays this week, in the viewer's own time zone ("Sun 1:00 PM"):
  // ESPN's kickoff time, else the day from Sleeper's schedule, else "Bye".
  function teamKick(team) {
    if (!S.snap) return '';
    // A later week on Lineups (LV): that week's game days (ESPN's kickoff times are this week's).
    const t = SCC.teamAbbr(team), games = (LV ? LV.games : S.snap.games) || {};
    const k = !LV && S.snap.kickoffs && S.snap.kickoffs[t];
    if (k) {
      const d = new Date(k[0]), day = d.toLocaleDateString([], {weekday: 'short'});
      return k[1] ? day + ', time TBD' : day + ' ' + d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    }
    if (games[t] && games[t].kick) return playDay(games[t].kick);
    return t && Object.keys(games).length ? 'Bye' : '';
  }

  function kickText(p) {
    if (!S.snap) return '';
    if (p.bye && Number(p.bye) === Number(LV ? LV.week : S.snap.week)) return 'Bye';
    return teamKick(p.team) || (p.kick ? playDay(p.kick) : '');
  }

  // A player's name opens his card when tapped (openPlayerCard); players without a Sleeper id (unmatched ESPN ones) have none.
  const pcAttr = p => (p && /^\d+$/.test(String(p.id || '')) ? ` data-pcard="${esc(p.id)}" role="button" tabindex="0"` : '');

  // The player's name with his kickoff beside it; a long name shortens, the time never does.
  function nameLine(p) {
    const k = kickText(p);
    return `<span class="name-line"><b${pcAttr(p)}>${esc(p.name)}</b>${k ? `<em class="kick">${esc(k)}</em>` : ''}</span>`;
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
    if (S.ctx.data && S.snap) analyze(); // the matchup tilt on close calls reads it
    if (S.ui.tab === 'lineups' || S.ui.tab === 'sos') render();
  }

  // A player's game context under his name (SCC.gameTags); who he plays only when his rankings don't say.
  function ctxLine(p) {
    if (LV) return ''; // game lines and weather are this week's
    const tags = SCC.gameTags(S.ctx.data, p, {opp: !p.opp});
    return tags.length ? `<small class="gctx">${tags.map(t => `<span class="${t.tone}">${esc(t.text)}</span>`).join(' · ')}</small>` : '';
  }

  /* A line of advice at the top of a league's card (Lineups and Rosters): where the roster is deep or thin against the
     rest of the league (SCC.positionStrength, this season's projections, the same numbers Standings shows) and its
     playoff odds from the standings simulation, then what the two together suggest. Each piece loads quietly and the
     line fills in as it arrives, so nothing here holds up the screen; a league with nothing to say yet gets nothing.
     The demo and Yahoo leagues sit it out. */
  const ADVICE_AT_ONCE = 2; // leagues whose schedule (every week's matchups, the heavy read) load at a time
  const ADVICE_POS = {QB: 1, RB: 1, WR: 1, TE: 1};
  let adviceLoads = 0;
  function leagueAdvice(cfg) {
    if (DEMO || cfg.platform === 'yahoo' || !S.snap) return '';
    const d = (S.snap.leagues || []).find(x => x.cfg.id === cfg.id);
    if (!d) return '';
    if (!S.trade.season) loadSeasonProj();
    if (!S.trade.teams[cfg.id]) loadTradeTeams(d, true);
    if (!S.stand[cfg.id] && !S.busy && adviceLoads < ADVICE_AT_ONCE) {
      adviceLoads++;
      loadStandings(d).then(() => { adviceLoads--; }, () => { adviceLoads--; });
    }
    const teams = ((S.trade.teams[cfg.id] || {}).list) || [], me = teams.find(t => t.mine);
    const PS = me ? strengthOf(cfg, teams) : null, cell = PS && PS.teams.find(t => t.id === String(me.id));
    // Only the positions worth acting on: nobody trades for a kicker or a defense.
    const at = grade => (PS && cell ? PS.positions.filter(p => ADVICE_POS[p] && (cell.byPos[p] || {}).grade === grade) : []);
    const thin = at('thin'), deep = at('deep');
    const R = standingsResult(d), mineId = String(cfg.platform === 'espn' ? cfg.teamId : d.rosterId);
    const row = R ? R.teams.find(t => t.id === mineId) : null;
    if (!thin.length && !deep.length && !row) return '';
    const bits = [thin.length ? 'thin at ' + andList(thin) : '', deep.length ? 'deep at ' + andList(deep) : ''].filter(Boolean);
    let shape = bits.join(', ');
    if (PS && cell && !bits.length) shape = 'in the middle of the league everywhere that matters';
    shape = shape ? `<b>${shape[0].toUpperCase() + shape.slice(1)}.</b>` : '';
    const odds = row ? `${pct(row.playoffs)} to make the playoffs, ${nth(row.seed)} of ${R.teams.length}${row.divWinner ? ' and leading your division' : ''}${
      row.games ? '' : ' (from projections, no games played yet)'}.` : '';
    // What the shape and the odds together say to do next.
    const contender = row && row.playoffs >= 0.6, longShot = row && row.playoffs <= 0.25;
    let move = '';
    if (thin.length && deep.length) move = `Trade from your ${andList(deep)} depth for help at ${andList(thin)}.`;
    else if (thin.length) move = `Waivers are the place to fix ${andList(thin)}.`;
    else if (deep.length) move = `You can trade from ${andList(deep)} depth for what you need later.`;
    if (longShot) {
      move = cfg.kind === 'Dynasty' || cfg.kind === 'Keeper'
        ? 'Long odds this year, which is the time to sell veterans for picks and young players.'
        : 'Long odds this year, so take swings on upside rather than safe benches.';
    } else if (contender && thin.length) move = `You're in good shape, so patch ${andList(thin)} before the playoffs.`;
    else if (contender && !thin.length) move = 'In good shape: check the playoff weeks on Schedule strength before the trade deadline.';
    return `<p class="lg-advice">${[shape, odds].filter(Boolean).join(' ')}${move ? ` <span class="lg-move">${move}</span>` : ''}</p>`;
  }

  /* Each league card leads with the lineup Titan recommends, spot by spot in the league's own order, then yours beside
     it (compareLineups). With no changes to make, the recommended lineup is yours as it stands (the engine's optimal
     lineup can differ only in how equal players sit, which isn't a change). */
  const recLineup = L => (L.moves.length ? L.opt || [] : L.rows.map(r => ({slot: r.slot, p: r.p})));
  const sameIn = (a, b) => ((a && a.id) || '') === ((b && b.id) || '');

  // One spot of the recommended lineup; NEW where he isn't in that spot now.
  function recRow(o, cur, cfg) {
    if (!o.p) {
      return `<li class="row r-stop"><span class="slot">${esc(slotName(o.slot))}</span><span class="pphoto"><span class="hs"></span></span>
        <span class="who"><b>Nobody to start</b><small>No one on your roster fits this spot: see the wire below.</small></span>
        <span class="right"><span class="verdict v-stop">FILL SLOT</span></span></li>`;
    }
    const p = o.p, fresh = !sameIn(p, cur), proj = projOf(p, cfg);
    const sub = [p.pos, p.team, p.opp && 'vs ' + p.opp, p.bye && 'bye ' + p.bye, proj !== null && 'proj ' + fmt(proj)].filter(Boolean).join(' · ');
    // Only when nobody better is left: a player on bye or ruled out still takes the spot, and says so.
    const tag = scored(p) ? scoreChip(p) : p.locked ? '<span class="verdict v-locked">LOCKED</span>'
      : p.onBye ? '<span class="verdict v-stop">ON BYE</span>' : p.outish ? '<span class="verdict v-stop">OUT</span>'
      : fresh ? '<span class="verdict v-new">NEW</span>' : '';
    return `<li class="row${fresh ? ' r-new' : ''}${p.locked ? ' r-locked' : ''}"><span class="slot" data-pos="${esc(p.pos)}">${esc(slotName(o.slot))}</span>${headshot(p)}
      <span class="who">${nameLine(p)}<small>${esc(sub)}${statusText(p)}</small>${ctxLine(p)}</span>
      <span class="right">${rankCell(p)}${tag}</span></li>`;
  }

  // Your lineup and the recommended one side by side, spot by spot, the spots that differ highlighted; your side keeps
  // each call (swap out, on bye, do not start). A lineup that already matches gets one line instead.
  function compareLineups(L, rec) {
    const diff = L.rows.filter((r, i) => !sameIn(r.p, (rec[i] || {}).p)).length;
    if (!diff) return '<p class="fine lu-same">Your lineup matches the recommended one: nothing to change.</p>';
    const who = p => (p ? `<b${pcAttr(p)}>${esc(p.name)}</b><small>${esc([p.pos, p.team].filter(Boolean).join(' · '))}</small>` : '<b class="lu-empty">Empty</b>');
    return `<h4 class="lu-h">Yours vs recommended <small>${plural(diff, 'spot')} different</small></h4><div class="lu-cmp-wrap"><table class="lu-cmp">
      <thead><tr><th>Spot</th><th>Yours</th><th>Recommended</th></tr></thead><tbody>${L.rows.map((r, i) => {
        const o = rec[i] || {}, same = sameIn(r.p, o.p);
        const call = r.verdict && r.verdict !== 'OK' && !same ? `<span class="verdict v-${VERDICT[r.verdict] || 'ok'}">${esc(r.verdict)}</span>` : '';
        return `<tr${same ? '' : ' class="lu-diff"'}><td class="slot" data-pos="${esc((r.p || o.p || {}).pos || '')}">${esc(slotName(r.slot))}</td>
          <td>${who(r.p)}${call}</td><td>${who(o.p)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /* ---- News */

  /* ESPN's latest NFL news, read through Titan's server (/api/news: ESPN turns some
     browsers away), refreshed every couple of minutes while the tab is open. Stories that tag someone on your rosters are marked, with a filter for them.
     The loader never draws synchronously, so screenNews can start it. */
  /* ---- NFL scores: a ticker under the header with this week's games from ESPN's scoreboard,
     read by Titan's server for everyone (/api/scores). While a game is live or about to kick
     off it updates every 30 seconds, otherwise every 10 minutes, and only while the page is in
     view. Each game shows how many of the person's starters play in it, and opens on ESPN. */
  const SCORES_LIVE = 30000, SCORES_IDLE = 10 * 60000;
  let scoresTimer = null;
  // ESPN's scoreboard read by the browser itself, trimmed the way Titan's server trims it: the ticker's fallback.
  async function scoresFromEspn() {
    const b = await ESPN.fetchScoreboard();
    return {at: Date.now(), season: b.season, week: b.week,
      games: b.games.map(g => ({id: g.id, kickoff: g.kickoff, home: g.home, away: g.away, state: g.state, hs: g.hs, as: g.as, detail: g.detail}))};
  }
  async function loadScores() {
    clearTimeout(scoresTimer);
    if (document.visibilityState === 'visible') {
      let d = null;
      try {
        const res = await fetch('/api/scores');
        if (res.ok) d = await res.json();
      } catch (e) { /* Titan's server out of reach: ESPN directly, below */ }
      // ESPN turns Titan's server away at times but lets any site read its scoreboard, so the browser asks it directly.
      if (!d || d.unavailable) d = await scoresFromEspn().catch(() => null);
      if (d) S.scores = d; // else the ticker keeps its last scores, or stays hidden
      paintTicker();
    }
    const games = (S.scores && S.scores.games) || [];
    const busy = games.some(g => g.state === 'in' || (g.state === 'pre' && g.kickoff - Date.now() < SCORES_IDLE));
    scoresTimer = setTimeout(loadScores, busy ? SCORES_LIVE : SCORES_IDLE);
  }

  // How many of the person's starters play for each NFL team (a player started in two leagues counts once).
  function startersByTeam() {
    const seen = {}, n = {};
    ((S.snap && S.snap.leagues) || []).forEach(d => d.roster.forEach(p => {
      if (!p.start || !p.team || seen[p.id]) return;
      seen[p.id] = 1;
      const t = SCC.teamAbbr(p.team);
      n[t] = (n[t] || 0) + 1;
    }));
    return n;
  }

  const tickTime = ms => {
    const d = new Date(ms);
    return d.toLocaleDateString([], {weekday: 'short'}) + ' ' + d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  };

  function paintTicker() {
    const el = $('ticker'), games = (S.scores && S.scores.games) || [];
    el.hidden = DEMO || !S.account || !games.length;
    if (el.hidden) return;
    const old = el.querySelector('.tk-list'), x = old ? old.scrollLeft : null;
    const mine = startersByTeam();
    const logo = t => `<img src="https://sleepercdn.com/images/team_logos/nfl/${esc(t.toLowerCase())}.png" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
    const item = g => {
      const pre = g.state === 'pre', n = (mine[g.home] || 0) + (mine[g.away] || 0);
      const status = pre ? tickTime(g.kickoff) : g.detail || (g.state === 'post' ? 'Final' : 'Live');
      const side = (t, pts, other) => `<span class="tk-side${g.state === 'post' && pts < other ? ' tk-lost' : ''}">${logo(t)}<b>${esc(t)}</b>${
        pre || pts === null ? '' : `<span class="tk-pts">${pts}</span>`}</span>`;
      const label = `${g.away}${pre ? '' : ' ' + g.as} at ${g.home}${pre ? '' : ' ' + g.hs}, ${status}${n ? `, ${n} of your starter${n === 1 ? '' : 's'}` : ''}`;
      return `<li><a class="tk-game tk-${esc(g.state || 'pre')}" href="https://www.espn.com/nfl/game/_/gameId/${encodeURIComponent(g.id)}" target="_blank" rel="noopener"
        aria-label="${esc(label)}">${side(g.away, g.as, g.hs)}${side(g.home, g.hs, g.as)}<span class="tk-foot"><span class="tk-when">${esc(status)}</span>${
        n ? `<span class="tk-mine" title="Your starters in this game">${n}</span>` : ''}</span></a></li>`;
    };
    el.innerHTML = `<div class="ticker-in"><ol class="tk-list">${games.map(item).join('')}</ol>
      <a class="tk-credit" href="https://www.espn.com/nfl/scoreboard" target="_blank" rel="noopener">Scores: ESPN</a></div>`;
    const list = el.querySelector('.tk-list');
    // The first time, it starts at the first game still to finish, as ESPN's ticker does.
    if (x !== null) list.scrollLeft = x;
    else {
      const first = list.querySelector('.tk-in, .tk-pre');
      if (first) list.scrollLeft = first.parentElement.offsetLeft;
    }
  }

  // A feed older than NEWS_OLD is the server's saved copy, served while ESPN turns Titan's server away.
  const NEWS_EVERY = 2 * 60000, NEWS_OLD = 15 * 60000;
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
    if (PC && PC.open) PC.innerHTML = playerCardHtml(); // the card's news
  }

  // A player's latest news on his card: ESPN's stories that tag him (the News tab's feed, loaded if it isn't yet), newest first.
  function playerNews(p) {
    const N = S.news;
    if (!N.list) { if (!N.busy && !N.error && !DEMO) loadNews(); return ''; }
    const n = SCC.norm(p.name), list = N.list.filter(s => (s.athletes || []).some(a => SCC.norm(a.name) === n)).slice(0, 3);
    if (!list.length) return '';
    return `<div class="pc-news"><h3>In the news</h3><ul>${list.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(s.headline)}</b>
      <small>${esc(ago(s.at))} · ESPN</small></a></li>`).join('')}</ul></div>`;
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
    else if (N.list && Date.now() - N.from > NEWS_OLD) {
      h += `<div class="banner swap">ESPN isn't letting Titan in right now, so these are its stories as of ${esc(when(N.from))}. Titan keeps trying.</div>`;
    }
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
    if (S.ui.tab === 'matchup' || S.ui.tab === 'lineups') render(); // Lineups: the close calls' lean rests on the win chance
  }

  // A player's game this week: 'pre', 'in_game' or 'complete' (or nothing on a bye).
  const gameOf = team => ((S.snap && S.snap.games) || {})[SCC.teamAbbr(team)] || null;

  // Points so far (players whose game has started) and projection, for one side's starters.
  function sideTotals(side, cfg) {
    let pts = 0, proj = 0, live = false, done = true, started = false, left = 0;
    side.players.forEach(p => {
      if (!p || p.empty) return;
      const g = gameOf(p.team);
      if (g && g.state !== 'pre') { pts += p.pts || 0; started = true; }
      if (g && g.state === 'pre') left++;
      if (g && g.state === 'in_game') live = true;
      if (g && g.state !== 'complete') done = false;
      proj += SCC.projFor(S.proj, p.id, cfg) || 0;
    });
    return {pts, proj, live, done: done && started, started, left};
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
    // Players still to play are greyed.
    return `<div class="minfo ${side}${g && g.state === 'pre' ? ' yet' : ''}">${headshot(p, true)}<div class="mtext"><b${pcAttr(p)}>${esc(shortName(p))}</b>
      <small>${esc([p.pos, p.team].filter(Boolean).join(' · '))}</small><small>${when}</small></div></div>`;
  }

  /* Points once his game starts, his projection underneath; green when he's outscoring the
     player opposite (`other`) in that spot. Before his game, his projection in grey italics. */
  function matchPts(p, cfg, side, other) {
    if (!p || p.empty) return `<div class="mpts-col ${side}"></div>`;
    const g = gameOf(p.team), started = g && g.state !== 'pre', proj = SCC.projFor(S.proj, p.id, cfg);
    if (!started) {
      return g ? `<div class="mpts-col ${side} yet"><b>${proj !== null ? fmt(proj) : '–'}</b><small>proj</small></div>`
        : `<div class="mpts-col ${side}"><b class="muted">${fmt(0)}</b></div>`;
    }
    const og = other && !other.empty ? gameOf(other.team) : null;
    const theirs = og && og.state !== 'pre' ? other.pts || 0 : 0;
    return `<div class="mpts-col ${side}"><b${(p.pts || 0) > theirs ? ' class="win"' : ''}>${fmt(p.pts)}</b>${proj !== null ? `<small>${fmt(proj)}</small>` : ''}</div>`;
  }

  /* Each side's range this week: points so far plus the floors, and plus the ceilings, of the starters yet to play
     (SCC.spreadOf), so a lead reads with its risk. Nothing before the projections are in. */
  function rangeLine(m) {
    const side = s => {
      let lo = 0, hi = 0, any = false;
      s.players.forEach(p => {
        if (!p || p.empty) return;
        const g = gameOf(p.team);
        if (g && g.state !== 'pre') { lo += p.pts || 0; hi += p.pts || 0; return; }
        const sp = spreadFor(p, m.cfg);
        if (!sp) return;
        any = true; lo += sp.floor; hi += sp.ceiling;
      });
      return any ? [lo, hi] : null;
    };
    const a = side(m.me), b = side(m.opp);
    if (!a || !b) return '';
    return `<p class="fine mrange">Range: you ${fmt(a[0])} to ${fmt(a[1])}, them ${fmt(b[0])} to ${fmt(b[1])}<small> (each starter's floor to ceiling)</small></p>`;
  }

  function matchCard(m) {
    const head = `<header class="card-h"><div><h3>${leagueIcon(m.cfg)}${esc(m.cfg.key)}</h3><p>${esc(SCC.describeLeague(m.cfg))}</p></div></header>`;
    if (m.error) return `<article class="card league">${head}<p class="note">Couldn't load this matchup: ${esc(m.error)}</p></article>`;
    if (m.none) return `<article class="card league">${head}<p class="note">No matchup this week.</p></article>`;
    const {a, b, st, pa} = matchState(m), pb = 100 - pa, live = a.live || b.live, final = st.phase === 'final';
    const status = live ? '<span class="vs live">LIVE</span>' : final ? '<span class="vs">FINAL</span>' : '';
    /* Once games start, the leading score is green. Behind, your score is red, or purple while Titan still has you
       projected to win (over a 50% chance); their trailing score is grey (x: 1 for you, -1 for them). */
    const favored = st.phase === 'live' && st.lead < 0 && pa > 50;
    const tone = x => st.phase === 'pre' || !st.lead ? '' : st.lead * x > 0 ? ' lead' : x > 0 ? (favored ? ' fav' : ' losing') : ' trail';
    const pic = (s, size) => (s.avatar ? avatar(s.avatar, size)
      : `<span class="avatar blank initials" style="width:${size}px;height:${size}px">${esc(initials(s.name))}</span>`);
    const toPlay = t => t.left ? `${t.left} to play` : t.started ? 'all played' : '';
    // The scoreboard when a league is open, like Sleeper's: picture, full name, record, players left, the score and the projection.
    const side = (s, t, cls, x) => `<div class="sb-side ${cls}">${pic(s, 44)}<b class="bname">${esc(s.name)}</b>
      <small>${esc([s.record, toPlay(t)].filter(Boolean).join(' · '))}</small>
      <span class="sb-pts${tone(x)}">${fmt(t.pts)}</span><small>${t.started && !final ? 'projected final ' + fmt(t.final) : 'projected ' + fmt(t.proj)}</small></div>`;
    const say = `<p class="mh-status ${st.phase === 'pre' ? 'pre' : st.lead > 0 ? 'ahead' : st.lead < 0 ? (favored ? 'fav' : 'behind') : ''}">${esc(st.text)}${
      favored ? ', still projected to win' : ''}${
      st.phase === 'live' ? ` <small>· ${a.left} of yours to play, ${b.left} of theirs</small>` : ''}</p>${final ? '' : rangeLine(m)}`;
    const rows = m.cfg.lineup.map((slot, i) => {
      const x = m.me.players[i], y = m.opp.players[i];
      return `<li class="mrow">${matchInfo(x, 'me')}${matchPts(x, m.cfg, 'me', y)}
        <span class="mslot">${esc(slotName(slot))}</span>${matchPts(y, m.cfg, 'opp', x)}${matchInfo(y, 'opp')}</li>`;
    }).join('');
    // The header, shown folded or open: league, score, where you stand, and each side's chance to win.
    const bar = a.proj || b.proj || a.started || b.started ? `<div class="winbar" title="Chance to win">
        <span class="wp me${pa >= pb ? ' up' : ''}">${pa}%</span><span class="wbar"><i class="wme" style="width:${pa}%"></i><i class="wopp" style="width:${pb}%"></i></span>
        <span class="wp opp${pb > pa ? ' up' : ''}">${pb}%</span></div>` : '';
    return `<details class="card match" ${foldAttrs('match', m.cfg)}>
      <summary class="mhead"><div class="mh-top"><span class="sname">${leagueIcon(m.cfg)}${esc(m.cfg.key)}</span>${status}</div>
        <div class="mh-score"><span class="mh-name">${esc(m.me.name)}</span><b class="mh-pts${tone(1)}">${fmt(a.pts)}</b>
          <b class="mh-pts${tone(-1)}">${fmt(b.pts)}</b><span class="mh-name opp">${esc(m.opp.name)}</span></div>${say}${bar}</summary>
      <div class="board">${side(m.me, a, 'me', 1)}<span class="vs${live ? ' live' : ''}">${live ? 'LIVE' : final ? 'FINAL' : 'VS'}</span>${side(m.opp, b, 'opp', -1)}</div>
      <ol class="mlist">${rows}</ol></details>`;
  }

  // One side's starters as the win-chance model reads them.
  const winList = (side, cfg) => side.players.map(p => (!p || p.empty ? null : {pts: p.pts, proj: SCC.projFor(S.proj, p.id, cfg), state: (gameOf(p.team) || {}).state || ''}));
  // A matchup's totals, where you stand (SCC.matchStatus) and your chance to win, for its card and the summary.
  function matchState(m) {
    const a = sideTotals(m.me, m.cfg), b = sideTotals(m.opp, m.cfg);
    const wp = SCC.winProbability(winList(m.me, m.cfg), winList(m.opp, m.cfg));
    // Once games start, each side's projected final (points so far plus what's left) is the number the win chance rests on.
    return {a: Object.assign(a, {final: wp.expA}), b: Object.assign(b, {final: wp.expB}), st: SCC.matchStatus(a, b), pa: Math.round(wp.a * 100)};
  }
  // The summary's filters: winning, losing, and close (a chance to win between 35% and 65%, until it's final).
  const MATCH_KINDS = {win: x => x.s.st.lead > 0, lose: x => x.s.st.lead < 0, close: x => x.s.st.phase !== 'final' && x.s.pa >= 35 && x.s.pa <= 65};

  function screenMatchup() {
    if (DEMO) return demoOnly('Matchups', 'Matchups show your real opponent in every league, week by week.');
    if (!S.snap) return emptyState();
    const M = S.match;
    let h = `<div class="bar match-bar"><p class="lede">Your lineup against this week's opponent in every league, as both are set right now.</p>
      <button class="btn ghost small" data-action="matchups" ${M.busy ? 'disabled' : ''}>${M.busy ? 'Loading…' : 'Reload'}</button></div>`;
    if (gamesLive()) {
      h += `<p class="fine live-note">Games are on: scores update every couple of minutes while Matchup is open${M.at ? ` (last ${esc(when(M.at))})` : ''}.</p>`;
    }
    // Where you stand in every league (winning, losing, close), each a filter.
    const list = (M.data || []).filter(x => inPick(x.cfg));
    const games = list.filter(m => !m.error && !m.none).map(m => ({m, s: matchState(m)}));
    const pick = MATCH_KINDS[S.ui.matchFilter] ? S.ui.matchFilter : 'all';
    const shown = pick === 'all' ? list : games.filter(MATCH_KINDS[pick]).map(x => x.m);
    // The leagues down the left side on a wide computer window (Matchup has no chips).
    jumpBar((M.data && M.data.length ? shown : S.A.leagues.filter(x => inPick(x.cfg))).map(x => ({cfg: x.cfg})), false);
    if (M.error) h += `<div class="banner stop">${esc(M.error)}</div>`;
    if (!M.data) return h + (M.busy ? '<div class="empty-note">Loading this week\'s matchups…</div>' : '');
    if (!M.data.length) return h + '<div class="empty-note">No leagues to show.</div>';
    const n = k => games.filter(MATCH_KINDS[k]).length;
    if (games.length) {
      h += `<section class="tiles three match-sum" aria-label="Where you stand">${tile(n('win'), 'winning', n('win') ? 'ok' : 'muted')}${
        tile(n('lose'), 'losing', n('lose') ? 'stop' : 'muted')}${tile(n('close'), 'close', n('close') ? 'swap' : 'muted')}</section>
        <div class="chips" role="group" aria-label="Filter matchups">${[['all', 'All', list.length], ['win', 'Winning', n('win')], ['lose', 'Losing', n('lose')],
          ['close', 'Close', n('close')]].map(([k, label, c]) => `<button type="button" class="chip" data-mfilter="${k}" aria-pressed="${pick === k}">${label} ${c}</button>`).join('')}</div>`;
    }
    const none = {win: 'No matchups you\'re winning right now.', lose: 'No matchups you\'re losing right now.', close: 'No close matchups right now.'};
    return h + foldTools('match') + (shown.length ? '<div class="league-grid">' + shown.map(matchCard).join('') + '</div>' : `<div class="empty-note">${none[pick]}</div>`) +
      (Object.keys(S.proj).length ? `<p class="fine">Projections via Sleeper. Chance to win is Titan's estimate from them and the points so far. Close means a
        chance to win between 35% and 65%; before any game starts, winning and losing go by projections.</p>` : '');
  }

  /* ---- Rosters */

  function screenRosters() {
    if (!S.snap) return emptyState();
    const leagues = S.A.leagues;
    // The league dropdown at the top of the screen picks one league or all of them.
    const shown = leagues.filter(L => inPick(L.cfg));
    let h = `<div class="bar"><label class="field grow"><span>Find a player</span><input type="search" data-roster-search
        placeholder="Name, team or position" value="${esc(S.rosterQuery)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
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
        <p>${plural(L.roster.length, 'player')} · ${L.roster.filter(p => p.start).length} starting</p></div></summary>${leagueAdvice(L.cfg)}
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
        <td class="tplayer"><span class="tp">${headshot(p, true)}<span><b${pcAttr(p)}>${esc(p.name)}</b><small>${esc(p.pos)}${statusText(p)}</small></span></span></td>
        <td>${esc(p.team || '')}</td>${hasOpp ? `<td>${esc(p.opp || '')}</td>` : ''}<td class="tkick">${esc(kickText(p))}</td>
        <td class="tnum">${rankCell(p)}</td><td class="tnum">${proj !== null ? fmt(proj) : ''}</td><td class="tnum">${scored(p) ? scoreChip(p) : ''}</td></tr>`;
    };
    const divider = label => `<tr class="rdiv"><td colspan="${cols}">${label}</td></tr>`;
    const starters = L.rows.map(r => (r.p ? cell(r.p, slotName(r.slot))
      : `<tr class="r-stop" data-find=" "><td><span class="slot">${esc(slotName(r.slot))}</span></td><td colspan="${cols - 1}"><b>Empty</b></td></tr>`)).join('');
    return `<details class="card roster-card fold" ${foldAttrs('roster', L.cfg)}><summary class="card-h"><div><h3>${leagueIcon(L.cfg)}${esc(L.cfg.key)}</h3>
      <p>${plural(L.roster.length, 'player')} · ${L.roster.filter(p => p.start).length} starting</p></div></summary>${leagueAdvice(L.cfg)}
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
    let h = `<p class="lede">How many of your ${E.active} teams own each player (anyone on two or more), the players you lean on most first: by
      how many of your lineups start him, then how many teams own him.</p>`;
    if (!E.rows.length) return h + '<div class="empty-note">No player is on more than one of your teams.</div>';
    h += `<ul class="card list">${E.rows.map(r => `
      <li class="row xrow${r.starts >= 4 || r.count >= 5 ? ' x-hi' : r.starts === 3 || r.count === 4 ? ' x-mid' : ''}">${pos(r.pos)}
        <span class="who"><b>${esc(r.name)}</b>
          <small>${esc([r.team, r.bye && 'bye ' + r.bye, `starting in ${r.starts} of ${r.count}`].filter(Boolean).join(' · '))}</small>
          <small class="leagues">${esc(r.leagues.join(', '))}</small></span>
        <span class="right"><span class="count">${r.count}<small>/${E.active}</small></span>
          <span class="meter" title="${r.starts} starting"><i style="width:${Math.round(100 * r.count / Math.max(E.active, 1))}%"></i><b style="width:${
            Math.round(100 * r.starts / Math.max(E.active, 1))}%"></b></span></span>
      </li>`).join('')}</ul>`;
    return h;
  }

  /* ---- Schedule strength (Players → Schedule, for everyone): each NFL team's remaining opponents ranked by the
     points they give up to a position (the game context's nflverse numbers, the same ones behind the matchup tags),
     averaged over the next four weeks, the rest of the regular season and the fantasy-playoff weeks. */
  const SOS_POS = ['QB', 'RB', 'WR', 'TE'];
  async function loadSos() {
    S.sos.busy = true;
    try { S.sos.sched = await API.nflSchedule(S.snap.season); }
    catch (e) { S.sos.error = 'Could not load the NFL schedule.'; }
    S.sos.busy = false;
    if (S.ui.tab === 'sos') render();
  }
  function screenSos() {
    if (!S.snap) return emptyState();
    if (!S.sos.sched && !S.sos.busy && !S.sos.error) loadSos();
    if (!S.ctx.busy && Date.now() - S.ctx.at > CONTEXT_EVERY) loadContext();
    const pos = SOS_POS.includes(S.ui.sosPos) ? S.ui.sosPos : 'RB', wk = S.snap.week, C = S.ctx.data;
    let h = `<p class="lede">Which teams' players have the easiest road ahead: each NFL team's remaining opponents, ranked by the points they give up
      to a position (1 gives up the most), averaged over the next four weeks, the rest of the regular season and the fantasy playoffs (weeks 15 to 17).</p>
      <div class="chips" role="group" aria-label="Position">${SOS_POS.map(p => `<button type="button" class="chip" data-sos-pos="${p}" aria-pressed="${p === pos}">${p}</button>`).join('')}</div>`;
    if (S.sos.error) h += `<div class="banner stop">${esc(S.sos.error)} <button class="link" data-action="sos-retry">Try again</button></div>`;
    if (!S.sos.sched || !C || !C.dvp) return h + `<div class="empty-note">${S.sos.error ? '' : 'Loading the schedule and the points allowed by position…'}</div>`;
    const rows = SCC.scheduleStrength(S.sos.sched, C.dvp, pos, wk, {next4: [wk, wk + 3], ros: [wk, LAST_REG_WEEK], playoffs: [15, 17]});
    // Your players on each team at this position, across your leagues (starters counted).
    const mine = {};
    ((S.A && S.A.leagues) || []).forEach(L => L.roster.forEach(p => { if (p.pos === pos && p.team) (mine[SCC.teamAbbr(p.team)] = mine[SCC.teamAbbr(p.team)] || new Set()).add(p.name); }));
    const ease = v => (v === null || v === undefined ? '–' : `<span class="${v <= 12 ? 'good' : v >= 21 ? 'amber' : ''}">${fmt(v)}</span>`);
    const next = r => r.opps.filter(o => o.week >= wk).slice(0, 3).map(o => `${o.home ? 'vs' : 'at'} ${esc(o.opp)}${o.rank ? ` <small>${o.rank}</small>` : ''}`).join(', ') || 'Bye';
    h += `<div class="card table-wrap"><table class="rtable sos-t"><thead><tr><th>Team</th><th>Next games</th><th class="tnum">Next 4</th><th class="tnum">Rest of season</th>
      <th class="tnum">Playoffs</th><th>Your ${esc(pos)}s</th></tr></thead><tbody>${rows.map(r => `<tr${mine[r.team] ? ' class="mine"' : ''}><td><b>${esc(r.team)}</b></td>
      <td class="sos-next">${next(r)}</td><td class="tnum">${ease(r.spans.next4)}</td><td class="tnum">${ease(r.spans.ros)}</td><td class="tnum">${ease(r.spans.playoffs)}</td>
      <td class="sos-mine">${mine[r.team] ? esc([...mine[r.team]].join(', ')) : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="fine">Easiest rest of season first. Green is an average opponent rank of 12 or better (soft), amber 21 or worse (tough); the small number
      beside each opponent is its rank against ${esc(pos)}s. Points allowed by position from <a href="https://github.com/nflverse" target="_blank" rel="noopener">nflverse</a>
      (CC BY 4.0${C.dvpSeason ? ', ' + esc(C.dvpSeason) + ' season' : ''}); schedule via Sleeper.</p>`;
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
    // The league dropdown narrows everything here: the table, the banners and the totals.
    const mine = S.A.leagues.filter(L => inPick(L.cfg));
    const B = SCC.byeMap(mine, S.snap.byes);
    const N = SCC.byeNeeds(mine, S.snap.week);
    const short = N.filter(n => n.needs.length).length;
    const cell = n => (n ? `<td style="--heat:${(Math.min(n, 6) / 6).toFixed(2)}">${n}</td>` : '<td class="zero">·</td>');
    let h = `<p class="lede">Players on your current rosters who are off each week. Under a league, each upcoming week where byes
      leave a starting spot you can't fill, and who's off.</p>
      ${short ? `<div class="banner swap">${plural(short, 'league')} will need a pickup for a bye week.</div>`
        : '<div class="banner ok">Every lineup is covered through the byes.</div>'}
      <div class="card table-wrap"><table class="byes">
      <thead><tr><th>Week</th>${B.weeks.map(w => `<th>${w}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${B.rows.map((r, i) => !inPick(cfgByKey(r.key) || {}) ? '' : `<tr${N[i].needs.length ? ' class="has-needs"' : ''}><th title="${esc(r.name)}">${leagueIcon(cfgByKey(r.key), 'xs')}${esc(r.key)}</th>${
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

  /* Results, its own section: a week at a time (arrows step through the weeks played, loading on
     their own), led by a summary (points, record, what your rankings would have scored, points left
     on the bench), then the bench's biggest misses (SCC.benchMistakes), the season so far with a
     chart, and every league with won or lost and its lineup. The explanations sit in one fold. */
  const gap = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  // Whether any of this week's games has kicked off (before that there's nothing to score).
  const weekStarted = () => Object.values((S.snap && S.snap.games) || {}).some(g => g && g.state !== 'pre');
  function screenScore() {
    if (DEMO) return demoOnly('Results', 'Results score your real teams week by week, against what your rankings would have started.');
    if (!S.snap) return emptyState();
    const cur = S.snap.week, wk = S.score.week || cur, D = S.score.data, busy = S.score.busy;
    let h = `<div class="wstep">
      <button type="button" class="btn ghost small" data-sweek="${wk - 1}"${wk <= 1 || busy ? ' disabled' : ''} aria-label="Week ${wk - 1}">‹</button>
      <h3>Week ${wk}${wk === cur ? ' <small>this week</small>' : ''}</h3>
      <button type="button" class="btn ghost small" data-sweek="${wk + 1}"${wk >= cur || busy || (wk + 1 === cur && !weekStarted()) ? ' disabled' : ''} aria-label="Week ${wk + 1}">›</button>
      ${busy ? '<span class="fine">Loading…</span>' : '<button type="button" class="link" data-action="score">Reload</button>'}</div>`;
    if (S.score.error) h += `<div class="banner swap">${esc(S.score.error)}</div>`;
    // The leagues down the left side on a wide computer window, as on Lineups (Results has no chips).
    jumpBar(D && D.rows.length ? D.rows.map(r => ({cfg: cfgByKey(r.key)})) : S.A.leagues.map(L => ({cfg: L.cfg})), false);
    if (!D) return h + (busy ? '<div class="empty-note">Scoring your leagues…</div>' : '');

    const T = D.totals, live = D.provisional, games = T.wins + T.losses + T.ties;
    const byRank = Math.round((T.byRank - T.actual) * 10) / 10, bench = Math.round((T.perfect - T.actual) * 10) / 10;
    h += `<section class="card pad wsum">
      <div class="wsum-top"><div><p class="fine">${live ? 'So far this week' : 'Week ' + D.week}</p>
          <p class="wsum-pts"><b>${fmt(T.actual)}</b> points</p>
          <p class="fine">${!T.projActual ? '' : live ? `of ${fmt(T.projActual)} projected for the whole week`
            : `${T.vsProj >= 0 ? 'Beat' : 'Missed'} the projection (${fmt(T.projActual)}) by <b class="${T.vsProj >= 0 ? 'good' : 'amber'}">${fmt(Math.abs(T.vsProj))}</b>`}</p></div>
        ${games ? `<div class="wsum-rec"><b>${T.wins}–${T.losses}${T.ties ? '–' + T.ties : ''}</b><small>${live ? 'if it ended now' : 'this week'}</small></div>` : ''}</div>
      <div class="wsum-stats">
        <div><b class="${byRank > 0 ? 'amber' : byRank < 0 ? 'good' : ''}">${gap(byRank)}</b><span>${byRank > 0 ? 'more by your rankings'
          : byRank < 0 ? 'your lineups beat your rankings' : 'your lineups matched your rankings'}</span></div>
        <div><b>${live ? '–' : fmt(bench)}</b><span>${live ? 'left on the bench, once the games are over' : 'left on the bench, in hindsight'}</span></div>
        <div><b>${T.ct ? `${T.cw} of ${T.ct}` : '–'}</b><span>close calls right</span></div>
      </div>
      ${live ? '<p class="fine"><b class="bad">Live:</b> games are still on, so these numbers will move.</p>' : ''}</section>`;
    // The bench's biggest misses: the part to fix next week. Only once the week is over: before then a
    // starter still to play shows 0 and would look like a miss.
    const BM = live ? [] : SCC.benchMistakes(D.rows).slice(0, 3);
    if (BM.length) {
      h += `<section class="card pad bmist"><h3>Points left on your bench</h3><ul class="bm-list">${BM.map(m => `<li>
        <span class="bm-lg">${leagueIcon(cfgByKey(m.key), 'xs')}${esc(m.key)}</span>
        <span><b>${esc(m.sat.name)}</b> (${fmt(m.sat.pts)}) sat while <b>${esc(m.started.name)}</b> (${fmt(m.started.pts)}) started at ${esc(slotName(m.slot))}</span>
        <b class="bm-lost amber">−${fmt(m.lost)}</b></li>`).join('')}</ul></section>`;
    }
    h += seasonCard();
    if (D.skipped.length) h += `<p class="fine">Skipped: ${esc(D.skipped.join('; '))}</p>`;
    if (D.rows.length) h += foldTools('score');
    const result = r => {
      if (r.result === null || r.result === undefined) return '<span class="sres none">No opponent</span>';
      const score = `${fmt(r.actual)}–${fmt(r.opp)}`;
      const word = live ? {W: 'Winning', L: 'Losing', T: 'Tied'}[r.result] : r.result;
      return `<span class="sres ${r.result === 'W' ? 'w' : r.result === 'L' ? 'l' : 't'}">${word} ${score}</span>`;
    };
    h += D.rows.map(r => {
      const left = Math.round((r.perfect - r.actual) * 10) / 10;
      return `<details class="card score" ${foldAttrs('score', cfgByKey(r.key))}><summary>
        <span class="sname">${leagueIcon(cfgByKey(r.key))}${esc(r.key)}</span>${result(r)}
        <span class="sline"><b>${fmt(r.actual)}</b> points${r.projActual ? ` · ${live ? `${fmt(r.projActual)} projected`
          : `<span class="${r.vsProj >= 0 ? 'good' : 'amber'}">${gap(r.vsProj)}</span> vs projection`}` : ''}${!live && left > 0 ? ` · ${fmt(left)} left on the bench` : ''}</span>
      </summary>
      <p class="sub">By rank ${fmt(r.byRank)} · perfect ${fmt(r.perfect)} · close calls ${r.close.total ? `${r.close.wins} of ${r.close.total}` : 'none'}</p>
      <ul class="detail">${r.detail.map(d => detailRow(d, live)).join('')}</ul>
    </details>`;
    }).join('');
    // The explanations, in one fold.
    const saved = D.history ? 'Ranks, Titan\'s calls and projections are as they stood at each player\'s kickoff, saved automatically.'
      : `Nothing was saved at kickoff for week ${D.week}, so ranks and calls use your rankings as they are now, with Sleeper's latest projections.${
        S.sync.user ? '' : ' Sign in with Google (Settings) and Titan saves them at every kickoff.'}`;
    const ranksNote = D.history ? '' : D.ranks.defaults ? `No rankings were saved for week ${D.week}, so "by rank" uses Titan's default rankings (Sleeper's projections).`
      : !D.ranks.exact ? `No rankings were saved for week ${D.week}${D.ranks.week ? `, so "by rank" uses week ${D.ranks.week}'s.` : ', so "by rank" has nothing to order by.'}` : '';
    h += `<details class="help results-help"><summary>How Results works</summary>
      <p><b>Projected</b> is Sleeper's projection for the players you started. <b>By rank</b> is what your rankings would have started from the same
        bench, and <b>perfect</b> is the best that roster could have done in hindsight: the difference is what "left on the bench" counts. A close call is
        a starter picked over a bench player at his position ranked within a few spots; it's right when the starter scored more.</p>
      <p>${esc(saved)}${S.sync.user || D.history ? '' : ' <button class="link" data-go="settings">Open Settings</button>'}</p>
      ${ranksNote ? `<p>${esc(ranksNote)}</p>` : ''}
      <p>Won or lost compares your points with your opponent's that week. While games are on, it says who's ahead.</p></details>
      <p class="fine">Projections via Sleeper.${D.ranks.week
        ? ` <button class="link" data-action="ranks-view" data-week="${D.ranks.week}">See your week ${D.ranks.week} rankings</button>` : ''}</p>`;
    return h;
  }

  /* Season so far: the record, points and how the rankings did across every week kept (loadSeason),
     once there are two, with a column for each week's points (its projection a tick across it) and
     every number in the table below. Each column shows its week on hover or keyboard focus. */
  function seasonCard() {
    const s = S.season, cur = S.snap.week;
    const weeks = s && s.season === S.snap.season ? Object.values(s.weeks).filter(x => x.week <= cur).sort((a, b) => a.week - b.week) : [];
    if (weeks.length < 2) return S.seasonBusy ? '<p class="fine">Reading your earlier weeks for Season so far…</p>' : '';
    // The numbers count finished weeks only (a week still being played would sit against its whole projection);
    // its column still shows the points so far.
    const done = weeks.filter(x => x.done), counted = done.length ? done : weeks;
    const sum = k => counted.reduce((t, x) => t + (Number(x[k]) || 0), 0);
    const W = sum('wins'), L = sum('losses'), Tn = sum('ties'), pts = sum('actual');
    const vsProj = (pts - sum('proj')) / counted.length, byRank = sum('byRank') - pts;
    const liveNote = done.length && done.length < weeks.length ? '<p class="fine">This week counts here once its games are over; its column shows the points so far.</p>' : '';
    const rec = x => x.wins + x.losses + x.ties ? `${x.wins}–${x.losses}${x.ties ? '–' + x.ties : ''}` : '';
    // A clean top for the scale: 1, 2 or 5 times a power of ten.
    const top = Math.max(1, ...weeks.map(x => Math.max(x.actual, x.proj || 0)));
    const p10 = Math.pow(10, Math.floor(Math.log10(top))), m = top / p10;
    const max = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p10;
    const H = 120, PAD = 8, LEFT = 44, BAND = 44, BAR = 22, width = LEFT + weeks.length * BAND + 8;
    const y = v => PAD + H - Math.max(0, v) / max * H;
    const cols = weeks.map((x, i) => {
      const x0 = LEFT + i * BAND + (BAND - BAR) / 2, yt = y(x.actual), r = Math.min(4, PAD + H - yt);
      const tip = `${fmt(x.actual)} points\nWeek ${x.week}${rec(x) ? ' · ' + rec(x) : ''}${x.done ? '' : ' · so far'}\nProjected ${fmt(x.proj || 0)} · by rank ${fmt(x.byRank)}`;
      return `<g class="sc-col" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip.replace(/\n/g, ', '))}">
        <rect class="sc-hit" x="${LEFT + i * BAND}" y="0" width="${BAND}" height="${PAD + H + 18}"/>
        <path class="sc-bar${x.done ? '' : ' live'}" d="M${x0},${PAD + H}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + BAR - r}Q${x0 + BAR},${yt} ${x0 + BAR},${yt + r}V${PAD + H}Z"/>
        ${x.proj ? `<line class="sc-proj" x1="${x0 - 4}" x2="${x0 + BAR + 4}" y1="${y(x.proj)}" y2="${y(x.proj)}"/>` : ''}
        <text class="sc-x" x="${x0 + BAR / 2}" y="${PAD + H + 14}">W${x.week}</text></g>`;
    }).join('');
    const grid = [0, max / 2, max].map(v => `<line class="sc-grid" x1="${LEFT}" x2="${width - 4}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="sc-y" x="${LEFT - 6}" y="${y(v) + 4}">${thousands(v)}</text>`).join('');
    return `<section class="card pad season"><h3>Season so far</h3>
      <div class="wsum-stats">
        <div><b>${W}–${L}${Tn ? '–' + Tn : ''}</b><span>record in your leagues</span></div>
        <div><b>${thousands(pts)}</b><span>points, ${gap(Math.round(vsProj * 10) / 10)} a week vs projection</span></div>
        <div><b class="${byRank > 0 ? 'amber' : byRank < 0 ? 'good' : ''}">${gap(Math.round(byRank * 10) / 10)}</b><span>${byRank > 0 ? 'more by your rankings' : 'your lineups vs your rankings'}</span></div>
      </div>
      <div class="sc-legend"><span><i class="sw-bar"></i>Points you scored</span><span><i class="sw-proj"></i>Projected</span></div>
      <div class="table-wrap"><svg class="sc-chart" width="${width}" height="${PAD + H + 20}" viewBox="0 0 ${width} ${PAD + H + 20}" role="img"
        aria-label="Points you scored each week, with each week's projection">${grid}${cols}</svg></div>
      <details class="help"><summary>Every week</summary><div class="table-wrap"><table class="season-t"><thead><tr><th>Week</th><th>Record</th><th>Points</th><th>Projected</th><th>By rank</th></tr></thead>
        <tbody>${weeks.map(x => `<tr><td>${x.week}${x.done ? '' : ' (so far)'}</td><td>${rec(x) || '–'}</td><td>${fmt(x.actual)}</td><td>${fmt(x.proj || 0)}</td><td>${fmt(x.byRank)}</td></tr>`).join('')}</tbody></table></div></details>
      ${liveNote}${S.seasonBusy ? '<p class="fine">Reading more of your earlier weeks…</p>' : ''}</section>`;
  }

  // The season chart's tooltip: a column's numbers on hover or keyboard focus (the table has them too).
  let tipEl = null;
  function showTip(el) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.textContent = '';
    el.dataset.tip.split('\n').forEach((line, i) => { const n = document.createElement(i ? 'span' : 'b'); n.textContent = line; tipEl.appendChild(n); });
    tipEl.hidden = false;
    const r = el.getBoundingClientRect();
    tipEl.style.left = Math.min(innerWidth - tipEl.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tipEl.offsetWidth / 2)) + 'px';
    tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight - 6) + 'px';
  }
  const hideTip = () => { if (tipEl) tipEl.hidden = true; };

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
      <p class="fine">Rankings from several places? <button class="link" data-go="multi">Import multiple sources</button> combines them into one list.</p>
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

  /* The Season screen (Rankings → Season): four kinds of league, each with a TE Premium list, the leagues each list serves,
     what's saved, and an import like the weekly one. A file needs each player's position; an overall rank or a rank within
     each position both work (SCC.seasonValues tells them apart). */
  function parseSeason(text) {
    if (!String(text || '').trim()) return null;
    const P = SCC.parseRanks(text, {});
    if (P.needsPosition) return Object.assign({}, P, {rows: [], error: 'This file has no position column. Season rankings need each player\'s position, so export the overall list, or add a Pos column.'});
    return P;
  }
  function seasonDraftPreview() {
    const D = S.sdraft, key = D.base + (D.tep ? '-tep' : ''), P = D.parsed, saved = seasonEntry(key);
    const label = `Save as your ${seasonLabel(key)} rankings${saved ? ' (replaces saved)' : ''}`;
    const save = `<button class="btn" data-action="season-save" ${P && P.rows && P.rows.length ? '' : 'disabled'}>${esc(label)}</button>`;
    if (!P) return save;
    if (P.error) return `<div class="banner stop">${esc(P.error)}</div>${save}`;
    const ranks = P.rows.map(r => Number(r.rank)).filter(x => isFinite(x)), distinct = new Set(ranks).size;
    const how = distinct < ranks.length * 0.9 ? 'ranked within each position' : 'ranked overall';
    return `<div class="banner ok"><b>${P.rows.length} players read</b> · ${esc(countsText(P.rows))} · ${how}</div>${save}`;
  }
  function paintSeasonDraft() {
    const el = $('sdraft-preview');
    if (el) el.innerHTML = seasonDraftPreview();
  }
  function saveSeason() {
    const D = S.sdraft, P = D.parsed, key = D.base + (D.tep ? '-tep' : '');
    if (!P || !P.rows || !P.rows.length) return;
    S.seasonRanks.formats[key] = {rows: P.rows.map(r => ({name: r.name, pos: r.pos, team: r.team || '', rank: r.rank, tier: has(r.tier) ? r.tier : ''})),
      savedAt: Date.now(), source: D.file || 'paste'};
    if (!store.set(KEY.seasonRanks, S.seasonRanks)) { delete S.seasonRanks.formats[key]; toast('Could not save. Browser storage is full or blocked.'); return; }
    pushSeason(key);
    S.seasonMemo = {};
    S.trade.ideas = {}; // found with the old values
    Object.assign(S.sdraft, {text: '', file: '', parsed: null});
    const users = seasonUsers(key);
    render();
    toast(`Your ${seasonLabel(key)} rankings are saved (${plural(P.rows.length, 'player')}).${users.length ? ` ${plural(users.length, 'league')} use${users.length === 1 ? 's' : ''} them.` : ''}`);
  }
  function deleteSeason(key) {
    if (!seasonEntry(key) || !confirm(`Delete your ${seasonLabel(key)} season rankings?`)) return;
    delete S.seasonRanks.formats[key];
    store.set(KEY.seasonRanks, S.seasonRanks);
    pushSeason(key);
    S.seasonMemo = {};
    S.trade.ideas = {};
    if (S.sview === key) S.sview = '';
    render();
  }
  // The status dot on a Season chip: green with a list saved, amber when your leagues use this kind and there's no list
  // yet (they follow the market until there is), grey when none of your leagues is this kind.
  const seasonDot = (saved, needed) => `<span class="sdot ${saved ? 'good' : needed ? 'amber' : 'none'}" title="${
    saved ? 'A list is saved' : needed ? 'Your leagues use this kind; no list saved yet' : 'None of your leagues is this kind'}"></span>`;

  function screenSeason() {
    const leagues = (S.snap && S.snap.leagues) || [];
    const D = S.sdraft;
    // Opens on the kind of league most of the person's leagues are.
    if (!D.base) {
      const n = {};
      leagues.forEach(d => { const f = SCC.seasonFormat(d.cfg); n[f.base] = (n[f.base] || 0) + 1; });
      D.base = Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'redraft-1qb';
    }
    const key = D.base + (D.tep ? '-tep' : ''), E = seasonEntry(key), users = seasonUsers(key);
    const inBase = base => leagues.filter(d => SCC.seasonFormat(d.cfg).base === base).length;
    const tepLeagues = leagues.filter(d => { const f = SCC.seasonFormat(d.cfg); return f.base === D.base && f.tep; });
    let h = `<p class="lede">Season rankings set your own trade values. Save a list for each kind of league you play, and every league uses the one
        that matches it: one QB or superflex, redraft or dynasty, and TE Premium when it pays tight ends extra per catch. Your rankings decide who's worth
        more to you; the market still decides what's a fair offer, so trade ideas look for players you rank above their price.</p>
      <p class="fine">They're used for trades (your values beside players, the edge on each trade, Find trades), the waiver plan's drops, draft grades and
        Position strength. ${S.sync.user ? 'They sync to your devices through your Google sign-in, and only you can see them.'
          : 'They\'re kept on this device. Sign in on Settings to sync them to your other devices.'}</p>
      <div class="chips" role="group" aria-label="Kind of league">${SCC.SEASON_FORMATS.map(f => {
        const have = seasonEntry(f.base) || seasonEntry(f.base + '-tep'), n = inBase(f.base);
        return `<button type="button" class="chip" data-sfmt="${f.base}" aria-pressed="${f.base === D.base}">${seasonDot(!!have, n > 0)}${esc(f.label)}${n ? ` · ${n}` : ''}</button>`;
      }).join('')}</div>
      <div class="chips" role="group" aria-label="TE Premium"><button type="button" class="chip" data-step="0" aria-pressed="${!D.tep}">${
        seasonDot(!!seasonEntry(D.base), inBase(D.base) > 0)}Standard</button><button type="button" class="chip" data-step="1" aria-pressed="${D.tep}">${
        seasonDot(!!seasonEntry(D.base + '-tep'), tepLeagues.length > 0)}TE Premium</button></div>
      <p class="fine season-legend"><span class="sdot good"></span> list saved &nbsp; <span class="sdot amber"></span> your leagues use this kind, no list yet
        &nbsp; <span class="sdot none"></span> none of your leagues is this kind</p>`;
    const names = list => andList(list.map(c => esc(c.key)));
    let used;
    if (D.tep) {
      used = !tepLeagues.length ? 'None of your leagues of this kind pays a TE premium, so a list here waits until one does.'
        : E ? `Used by ${names(tepLeagues.map(d => d.cfg))}.`
        : `Your TE-premium ${esc(seasonLabel(D.base))} ${tepLeagues.length === 1 ? 'league' : 'leagues'} (${names(tepLeagues.map(d => d.cfg))}) use${
          tepLeagues.length === 1 ? 's' : ''} the Standard list until you save one here.`;
    } else {
      used = users.length ? `Used by ${names(users)}.` : 'None of your leagues is this kind yet, so a list here waits until one is.';
    }
    h += `<section class="card pad season-slot"><h3>${esc(seasonLabel(key))}</h3><p class="fine">${used}</p>`;
    if (E) {
      h += `<div class="saved-row"><span><b>${plural(E.rows.length, 'player')}</b><small>${esc(countsText(E.rows))} · saved ${esc(when(E.savedAt))}${
        E.source ? ' from ' + esc(E.source) : ''}</small></span><span class="saved-btns"><button class="btn ghost small" data-action="season-view" data-key="${key}">${
        S.sview === key ? 'Hide' : 'View'}</button><button class="btn ghost small" data-action="season-del" data-key="${key}">Delete</button></span></div>`;
      if (S.sview === key) {
        const top = E.rows.slice().sort((a, b) => (Number(a.rank) || 1e9) - (Number(b.rank) || 1e9));
        h += `<ol class="roster season-list">${top.map(r => `<li class="row"><span class="slot">${esc(r.rank)}</span>${pos(r.pos)}<span class="who"><b>${esc(r.name)}</b><small>${
          esc([r.team, has(r.tier) && 'tier ' + r.tier].filter(Boolean).join(' · '))}</small></span></li>`).join('')}</ol>`;
      }
    }
    h += `<div class="bar"><label class="btn ghost file">Choose CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" data-sdraft="file" hidden></label></div>
      <label class="field block"><span>…or paste them as CSV, or copied straight out of a spreadsheet</span>
        <textarea data-sdraft="text" rows="6" spellcheck="false" placeholder="Overall,Player,Position,Team&#10;1,Jahmyr Gibbs,RB,DET">${esc(D.text)}</textarea></label>
      <div id="sdraft-preview" class="draft">${seasonDraftPreview()}</div></section>
      <details class="card pad help"><summary>How it works</summary>
        <p>Any rankings list with each player's position works: a rest-of-season list for redraft, a dynasty list for dynasty. An overall rank
          (like an Overall column) or a rank within each position both read.</p>
        <p>Titan turns your ranks into values on the market's own scale: your 1st player takes the market's highest value, your 2nd the next, and so
          on. A player you rank above the market is worth more to you than his price, one you rank below is worth less, and a trade's edge is the
          difference. Players your list leaves out keep their market value, so they add no edge either way. What's a fair offer still comes from the
          market, so the trades Titan suggests are ones the other manager can accept.</p>
        <p>Tiers count, when your list has a Tier column: players in the same tier are pulled three quarters of the way to their tier's average value
          (and rest-of-season points), so two tier-mates trade about even and the real cliffs sit between tiers. A trade only reads as an upgrade
          when it crosses a tier up on your list. On your weekly rankings, tiers decide the close calls on Lineups the same way: two players in the
          same tier are a close call whatever their rank gap; different tiers never are.</p>
        <p>Each league uses the list for its kind: one QB or superflex (superflex and true 2QB value players almost alike), redraft or dynasty (keeper
          leagues count as redraft), and its TE Premium list when it pays tight ends extra per catch, else the Standard list of its kind.</p>
      </details>`;
    return h;
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

  // The position a file without a position column ranks (the Import screen's data-draft, or Import multiple's data-multi).
  function posPicker(val = S.draft.pos, attr = 'data-draft') {
    return `<label class="field narrow-select"><span>Which position does this file rank?</span><select ${attr}="pos">
      <option value="">Choose…</option>${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p =>
        `<option ${val === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>`;
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

  /* ---- Import multiple sources (Rankings): several rankings combined into one list for a week
     (SCC.combineRanks) and saved as that week's rankings, so every call uses it. The sources are
     saved with it (the week's `multi`) so one can be added or re-weighted later; until then they
     stay on this device (KEY.multi). A source can be several files (FantasyPros' per-position
     files), each replacing its own positions. Weights are remembered by source name. */
  const DEFAULTS_SOURCE = 'Titan defaults';
  const saveMulti = () => store.set(KEY.multi, S.multi);
  const noMdraft = into => ({text: '', file: '', pos: '', parsed: null, name: '', into: into || ''});
  const parseMdraft = () => (S.mdraft.text.trim() ? SCC.parseRanks(S.mdraft.text, {pos: S.mdraft.pos}) : null);
  // A new source's name: typed, else the format's (FantasyPros, The Hall), else the file's.
  const mdraftName = () => (S.mdraft.name.trim() || (S.mdraft.parsed && S.mdraft.parsed.source) || S.mdraft.file.replace(/\.[a-z0-9]+$/i, '')).slice(0, 40);

  // Opens a week: its saved sources if it was combined before, else none.
  function multiWeek(w) {
    const saved = S.ranks.weeks[w] && S.ranks.weeks[w].multi;
    // A source whose rows were pruned (an old week) can't be recombined: it's left out, to add again from its file.
    S.multi = {week: w, sources: saved ? JSON.parse(JSON.stringify((saved.sources || []).filter(s => s.rows))) : [], defaults: !!(saved && saved.defaults), dirty: false};
    S.mdraft = noMdraft();
    saveMulti();
  }

  // Sleeper's projections for a week, for Titan's default rankings: this week's are loaded already, another week's are fetched once.
  function multiProj(w) {
    if (S.snap && w === S.snap.week && Object.keys(S.proj).length) return S.proj;
    if (S.mproj && S.mproj.w === w) return S.mproj.map;
    if (S.snap && !(S.mproj && S.mproj.busy)) {
      S.mproj = {w, busy: true, map: null};
      API.fetchProjections(S.snap.season, w).catch(() => ({})).then(map => {
        S.mproj = {w, map: map || {}};
        if (S.ui.tab === 'multi') render();
      });
    }
    return null;
  }

  // The week's sources combined, with Titan's default rankings when chosen (they also fit RB/WR/TE together when no source can).
  function combined() {
    const M = S.multi, proj = multiProj(M.week);
    const dflt = proj && Object.keys(proj).length ? SCC.defaultRanks(proj, playerList(), 0.5) : null;
    const srcs = M.sources.map(s => ({name: s.name, rows: s.rows, weight: Number(s.weight) || 1}));
    if (M.defaults && dflt) srcs.push({name: DEFAULTS_SOURCE, rows: dflt, weight: 1});
    return srcs.length ? SCC.combineRanks(srcs, {curve: dflt, curveName: DEFAULTS_SOURCE}) : null;
  }

  function screenMulti() {
    if (!S.multi.week) multiWeek(S.snap ? S.snap.week : 1);
    const M = S.multi, w = M.week, saved = S.ranks.weeks[w], C = combined();
    const weightPick = (s, i) => `<select class="mweight" data-mweight="${i}" aria-label="Weight for ${esc(s.name)}">${[1, 2, 3].map(x =>
      `<option value="${x}"${x === (Number(s.weight) || 1) ? ' selected' : ''}>${x}x</option>`).join('')}</select>`;
    let h = `<p class="lede">Combine rankings from several places into one list for a week. Each player's rank is averaged across your sources,
      position by position (a source that leaves him out counts him just below its last player there), and the combined list is saved as
      that week's rankings, so every call uses it.</p>
      <section class="card pad"><div class="bar"><label class="field narrow"><span>Week</span><input type="number" min="1" max="18" data-multi="week" value="${w}"></label></div>
        ${saved && !saved.multi ? `<p class="fine">Week ${w} already has rankings (${esc(saved.source || 'an import')}). Saving a combined list replaces them.</p>` : ''}
        <h3>Sources for week ${w}</h3>
        ${M.sources.length ? `<ul class="saved msources">${M.sources.map((s, i) => `<li><span><b>${esc(s.name)}</b><small>${esc(countsText(s.rows))}${
          s.files && s.files.length ? ' · ' + esc(s.files.join(', ')) : ''}</small></span>
          <span class="saved-btns">${weightPick(s, i)}<button class="btn ghost small" data-action="multi-remove" data-i="${i}">Remove</button></span></li>`).join('')}</ul>`
          : '<p class="muted">None yet. Add your first source below.</p>'}
        <label class="check"><input type="checkbox" data-multi="defaults"${M.defaults ? ' checked' : ''}> Also count Titan's default rankings (Sleeper's projections) as a source</label>
        ${M.defaults && !multiProj(w) ? `<p class="fine">Loading Sleeper's projections for week ${w}…</p>` : ''}
      </section>
      <section class="card pad"><h3>Add a source</h3>
        <div class="bar">
          <label class="field"><span>Add to</span><select data-multi="into"><option value="">A new source</option>${M.sources.map(s =>
            `<option value="${esc(s.name)}"${S.mdraft.into === s.name ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          ${S.mdraft.into ? '' : `<label class="field"><span>Name</span><input type="text" data-multi="name" maxlength="40" value="${esc(S.mdraft.name)}"
            placeholder="Late-Round, FantasyPros…" autocomplete="off"></label>`}
          <label class="btn ghost file">Choose CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" data-multi="file" hidden></label>
        </div>
        <label class="field block"><span>…or paste them as CSV, or copied straight out of a spreadsheet</span>
          <textarea data-multi="text" rows="6" spellcheck="false">${esc(S.mdraft.text)}</textarea></label>
        <div id="multi-preview" class="draft">${multiPreview()}</div>
        <p class="fine">Every format the Import screen reads works here. A source can be several files, like FantasyPros' QB, FLEX, K and DST files:
          add the first as a new source, then add the others to it. A file that ranks one position is fine here: its order counts for that position.</p>
      </section>`;
    return h + multiCombined(C, saved);
  }

  function multiPreview() {
    const P = S.mdraft.parsed, into = S.mdraft.into, name = into || mdraftName();
    const taken = !into && name && S.multi.sources.some(s => s.name.toLowerCase() === name.toLowerCase());
    const ok = P && P.rows.length && !P.error && name && !taken;
    const btn = `<button class="btn" data-action="multi-add"${ok ? '' : ' disabled'}>${into ? 'Add to ' + esc(into) : name ? 'Add ' + esc(name) : 'Add source'}</button>`;
    if (!P) return btn;
    if (P.needsPosition) return `<div class="banner swap">${esc(P.error)}</div>${posPicker(S.mdraft.pos, 'data-multi')}${btn}`;
    if (P.error) return `<div class="banner stop">${esc(P.error)}</div>${btn}`;
    const note = taken ? `<div class="banner swap">There's already a source called ${esc(name)}. Choose it under Add to, or give this one another name.</div>`
      : !name ? '<p class="fine">Give this source a name to add it.</p>' : '';
    return `<div class="banner ok"><b>${P.rows.length} players read${P.source ? ' from ' + esc(P.source) : ''}</b> · ${esc(countsText(P.rows))}</div>${
      P.position ? posPicker(S.mdraft.pos, 'data-multi') : ''}${note}${btn}`;
  }

  function paintMulti() {
    const el = $('multi-preview');
    if (el) el.innerHTML = multiPreview();
  }

  // The combined list: Save first, then a position at a time with each source's place for every player.
  function multiCombined(C, saved) {
    const w = S.multi.week, n = C ? C.sources.length : 0;
    if (!C) return '<section class="card pad"><h3>Combined rankings</h3><p class="muted">Add two or more sources to combine them.</p></section>';
    const counts = SCC.rankCounts(C.rows), shown = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(p => counts[p]);
    const pick = shown.includes(S.view.pos) ? S.view.pos : shown[0], flex = pick === 'RB' || pick === 'WR' || pick === 'TE';
    // Sources 8 or more spots apart on a player are marked.
    const split = p => { const v = C.sources.map(s => p.ranks[s]).filter(Boolean); return v.length > 1 && Math.max(...v) - Math.min(...v) >= 8; };
    const places = p => C.sources.map(s => `${esc(s)} ${p.ranks[s] ? esc(pick) + p.ranks[s] : 'unranked'}`).join(' · ');
    return `<section class="card pad"><h3>Combined rankings</h3>
      <div class="banner ok"><b>${C.rows.length} players from ${plural(n, 'source')}</b> · ${esc(countsText(C.rows))}</div>
      ${C.warning ? `<div class="banner swap">${esc(C.warning)}</div>`
        : C.fitted.length ? `<p class="fine">RB, WR and TE are fitted onto one FLEX list the way ${esc(andList(C.fitted))} ${C.fitted.length === 1 ? 'does' : 'do'}.</p>` : ''}
      ${n < 2 ? '<p class="fine">Add another source to combine them. For a single file, the Import screen is simpler.</p>' : ''}
      <button class="btn" data-action="multi-save"${n >= 2 ? '' : ' disabled'}>Save as week ${w} rankings${saved ? ' (replaces saved)' : ''}</button>
      <div class="chips" role="group" aria-label="Position">${shown.map(p => `<button class="chip" data-view-pos="${p}" aria-pressed="${p === pick}">${p} ${counts[p]}</button>`).join('')}</div>
      <ol class="roster mcombined">${C.players.filter(p => p.pos === pick).map(p => `<li class="row"><span class="slot">${esc(pick)}${p.posRank}</span>${pos(p.pos)}
        <span class="who"><b>${esc(p.name)}</b><small>${p.team ? esc(p.team) + ' · ' : ''}${places(p)}</small></span>
        <span class="right">${split(p) ? '<span class="mspread" title="The sources are 8 or more spots apart on him">split</span>' : ''}<span class="rank">${
          flex && p.rank < 1000 ? 'FLEX ' + p.rank : ''}</span></span></li>`).join('')}</ol></section>`;
  }

  function multiAdd() {
    const P = S.mdraft.parsed, M = S.multi, into = S.mdraft.into;
    if (!P || !P.rows.length || P.error) return;
    const file = S.mdraft.file || 'paste';
    if (into) {
      const s = M.sources.find(x => x.name === into);
      if (!s) return;
      s.rows = SCC.mergeRanks(s.rows, P.rows).rows;
      s.files = (s.files || []).concat(file);
    } else {
      const name = mdraftName();
      if (!name || M.sources.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
      M.sources.push({name, rows: P.rows, files: [file], weight: Number((S.ui.multiWeights || {})[name.toLowerCase()]) || 1});
    }
    M.dirty = true;
    S.mdraft = noMdraft(into);
    if (!saveMulti()) toast('Could not keep these sources on this device. Browser storage is full or blocked.');
    render();
  }

  function multiSave() {
    const M = S.multi, w = M.week, C = combined();
    if (!C || C.sources.length < 2) return;
    const kept = keepStarted(C.rows, w);
    const label = C.sources.map(n => { const s = M.sources.find(x => x.name === n); return n + (s && s.weight > 1 ? ' ' + s.weight + 'x' : ''); }).join(' + ');
    S.ranks.weeks[w] = {rows: C.rows.concat(kept), savedAt: Date.now(), source: 'combined: ' + label,
      multi: {sources: M.sources.map(s => ({name: s.name, weight: Number(s.weight) || 1, files: s.files || [], rows: s.rows})), defaults: !!M.defaults}};
    // Only the last few combined weeks keep their sources' full rows (they're the biggest thing stored): older
    // weeks keep the names and weights, and would need their files again to be recombined.
    Object.keys(S.ranks.weeks).forEach(k => {
      const e = S.ranks.weeks[k];
      if (Number(k) < w - 2 && e && e.multi && e.multi.sources) e.multi.sources.forEach(src => { delete src.rows; });
    });
    if (!store.set(KEY.ranks, S.ranks)) { toast('Could not save. Browser storage is full or blocked.'); return; }
    pushWeek(w);
    M.dirty = false;
    saveMulti();
    if (S.score.week === w) S.score.data = null;
    analyze();
    render();
    toast(`Week ${w} rankings saved, combined from ${plural(C.sources.length, 'source')}. Lineups re-scored.` +
      (kept.length ? ` Kept the ranks of ${plural(kept.length, 'player')} whose games have started.` : ''));
  }

  /* ---- Compare rankings (Titan's owner only, under Rankings): each week, three rankings tested
     against what happened (SCC.labWeek): Sleeper's projections (Titan's default), FantasyCalc's values
     as the server saved them before the games (lab/{season}-{week}), and the owner's imported
     rankings. Each finished week is kept on the device (KEY.lab). The owner's app tells the server
     which league formats to save (lab/config, sendLabFormats). The plan: switch the default only if
     FantasyCalc clearly wins over about four weeks. */
  const labKey = f => `${f.dynasty ? 'dynasty' : 'redraft'}-${f.qbs}qb-${f.teams}teams-${f.ppr}ppr`;
  const LAB_NAMES = {sleeper: 'Sleeper projections', fc: 'FantasyCalc', imports: 'Your rankings'};
  const LAB_SOURCES = ['sleeper', 'fc', 'imports'];
  let labSent = '';
  function sendLabFormats() {
    if (DEMO || !S.owner.is || !S.snap || !S.sync.api || !S.sync.api.labFormats) return;
    const keys = [...new Set(S.snap.leagues.filter(d => d.cfg.platform !== 'yahoo').map(d => labKey(SCC.tradeFormat(d.cfg))))].sort();
    if (!keys.length || keys.join() === labSent) return;
    labSent = keys.join();
    S.sync.api.labFormats(keys).catch(() => { labSent = ''; });
  }
  const labSig = w => S.snap.leagues.map(d => d.cfg.id).sort().join(',') + '|' + ((S.ranks.weeks[w] || {}).savedAt || 0);

  async function labFor(week) {
    const season = S.snap.season, leagues = S.snap.leagues.map(d => d.cfg).filter(c => c.platform !== 'yahoo');
    const [res, proj, stats, snap] = await Promise.all([
      API.collectScores(S.account, leagues, week, season), API.fetchProjections(season, week), API.fetchStats(season, week),
      S.sync.api && S.sync.api.labWeek ? S.sync.api.labWeek(season, week).catch(() => null) : null]);
    if (!res.started) return null;
    // A snapshot saved after the week's first kickoff isn't a fair test, so FantasyCalc sits that week out.
    const fair = snap && !snap.late ? snap.formats || {} : {};
    const counts = {};
    leagues.forEach(c => { const k = labKey(SCC.tradeFormat(c)); if (fair[k]) counts[k] = (counts[k] || 0) + 1; });
    // The order test uses the format most of the leagues play.
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const imp = S.ranks.weeks[week];
    const out = SCC.labWeek({res, proj, stats, players: res.players, imports: imp ? imp.rows : null,
      fcFor: cfg => fair[labKey(SCC.tradeFormat(cfg))] || null, fcOrder: top ? fair[top] : null});
    return Object.assign(out, {week, done: res.done >= res.total, late: !!(snap && snap.late), sig: labSig(week)});
  }

  async function loadLab() {
    if (DEMO || !(S.owner.is || S.owner.lab) || !S.snap || S.labBusy) return;
    if (!S.lab || S.lab.season !== S.snap.season) S.lab = {season: S.snap.season, weeks: {}};
    S.labBusy = true;
    S.labError = '';
    for (let w = 1; w <= S.snap.week; w++) {
      const x = S.lab.weeks[w];
      // A finished week is kept; one without FantasyCalc is tested again in case its snapshot turns up.
      if (x && x.done && x.sig === labSig(w) && (x.sources.includes('fc') || x.late)) continue;
      try {
        const r = await labFor(w);
        if (r) { S.lab.weeks[w] = r; store.set(KEY.lab, S.lab); }
      } catch (e) { S.labError = `Could not test week ${w}: ${e && e.message ? e.message : e}`; }
      if (S.ui.tab === 'lab') render();
    }
    S.labBusy = false;
    S.labAt = Date.now();
    if (S.ui.tab === 'lab') render();
  }

  /* ---- Data dump (Titan's owner only) */

  /* The weekly data dump from Titan's owner's PC (titan-analytics' data_dump.py, outside this repo): the spreadsheet of
     usage, matchup and schedule numbers the owner downloads each Tuesday, turned into ideas for each Sleeper league
     (start/sit leans, pickups, buys, sells, playoff schedules) and league-wide lists, posted to lab/dump-latest, which
     only the owner can read. It shares the value report's look, player search and position chips (applyValueFilter),
     and follows the league dropdown. */
  async function loadDump() {
    if (DEMO || !S.owner.is || !S.sync.api || !S.sync.api.dumpReport || S.dump.busy) return;
    S.dump.busy = true;
    S.dump.error = '';
    try {
      const d = await S.sync.api.dumpReport();
      S.dump.data = d && d.json ? JSON.parse(d.json) : null;
    } catch (e) { S.dump.error = `Couldn't load the data dump: ${e && e.message ? e.message : e}`; }
    S.dump.busy = false;
    S.dump.at = Date.now();
    if (S.ui.tab === 'dump' || S.ui.tab === 'trade') render(); // Trade: the playoff-weeks tilt on a trade's impact
  }

  // A rank where 1 is the easiest (a matchup, a schedule): green in the easiest quarter, amber in the toughest.
  const easeRank = r => (r === null || r === undefined ? '–' : `<span class="${r <= 8 ? 'good' : r >= 25 ? 'amber' : ''}">${r}</span>`);

  /* The Value report's and Data dump's tables share one builder: a pinned player column (his call as a pill, his name
     and a line under it, `sub`), a Where column when a league is picked, then the report's own columns ([header,
     cell(row)]). `filtered` marks the table of everyone (the position chips filter it in place). */
  const rt = {
    n: (v, d = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(d)),
    share: v => (v === null || v === undefined ? '–' : Math.round(v * 100) + '%'),
    sgn: (v, d = 1) => (v === null || v === undefined ? '–'
      : `<span class="${v > 0 ? 'good' : v < 0 ? 'amber' : ''}">${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}</span>`),
    rank: (p, r) => (r === null || r === undefined ? '–' : esc(p) + r)
  };
  function reportTable(rows, cols, sub, filtered, where) {
    const vp = VALUE_POS.includes(S.ui.valuePos) ? S.ui.valuePos : 'ALL';
    return `<div class="table-wrap vr-scroll"><table class="season-t vr-t"><thead><tr><th>Player</th>${where ? '<th class="vr-w">Where</th>' : ''}${
      cols.map(c => `<th${c[2] ? ` class="${c[2]}"` : ''}>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
      `<tr data-find=" ${esc(SCC.norm(r.n))} ${esc(String(r.t || '').toLowerCase())} ${esc(String(r.p || '').toLowerCase())} "${filtered ? ` data-vp="${esc(r.p)}"${
        vp !== 'ALL' && r.p !== vp ? ' hidden' : ''}` : ''}><td class="vr-p">${callPill(r, filtered)}<b>${esc(r.n)}</b><small>${esc(sub(r))}</small></td>${
        where ? `<td class="vr-w">${where(r)}</td>` : ''}${cols.map(c => `<td${c[2] ? ` class="${c[2]}"` : ''}>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  // where(row): who has him in the picked league (a Where column), or null under All leagues.
  function dumpTable(rows, filtered, where) {
    const next = r => (r.o === 'BYE' ? 'Bye' : `${r.h ? 'vs' : 'at'} ${esc(r.o || '')}`);
    return reportTable(rows, [['Guide', r => guidePill(r.dg)], ['Points', r => rt.n(r.fp)], ['Expected', r => rt.n(r.x)], ['Over expected', r => rt.sgn(r.oe)], ['Targets', r => rt.share(r.sh)],
      ['Carries', r => rt.share(r.rs)], ['Next', next, 'vr-w'], ['Matchup', r => easeRank(r.mu)], ['Team pts', r => rt.n(r.imp)], ['Adjusted', r => rt.n(r.adj)], ['Next 4', r => easeRank(r.n4)],
      ['Playoffs', r => easeRank(r.po)]], r => [(r.p || '') + (r.xr || ''), r.t].filter(Boolean).join(' · '), filtered, where);
  }

  function dumpTeams(teams) {
    const pct = v => (v === null || v === undefined ? '–' : Math.round(v * 100) + '%');
    const n = v => (v === null || v === undefined ? '–' : Number(v).toFixed(1));
    const whole = v => (v === null || v === undefined ? '–' : String(Math.round(v)));
    return `<div class="table-wrap vr-scroll"><table class="season-t vr-t"><thead><tr><th>Team</th><th>Pass rate</th><th>Neutral</th><th>Inside 10</th>
      <th>Inside 5</th><th>Targets a game</th><th>RB targets</th><th>WR targets</th><th>TE targets</th><th>RB expected</th><th>WR expected</th><th>TE expected</th>
      <th>Pass TD</th><th>Rush TD</th></tr></thead><tbody>${teams.map(t => `<tr data-find=" ${esc(String(t.t).toLowerCase())} "><td class="vr-p"><b>${esc(t.t)}</b></td>
      <td>${pct(t.pr)}</td><td>${pct(t.npr)}</td><td>${pct(t.i10)}</td><td>${pct(t.i5)}</td><td>${n(t.tpg)}</td><td>${pct(t.rbt)}</td><td>${pct(t.wrt)}</td>
      <td>${pct(t.tet)}</td><td>${n(t.rbx)}</td><td>${n(t.wrx)}</td><td>${n(t.tex)}</td><td>${whole(t.ptd)}</td><td>${whole(t.rtd)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // Leagues in the order every other tab shows them (the snapshot's); any the snapshot doesn't have come after, by name.
  function snapOrder(list) {
    const at = {};
    ((S.snap && S.snap.leagues) || []).forEach((d, i) => { at[d.cfg.id] = i; });
    const place = L => (L.id in at ? at[L.id] : Infinity);
    return [...list].sort((a, b) => place(a) - place(b) || String(a.name).localeCompare(String(b.name)));
  }

  // Each league's ideas, in the order they're acted on: this week's lineup, then the wire, trades and the playoffs.
  const DUMP_KINDS = [['start', 'Start this week', 'add'], ['add', 'Pick up', 'add'], ['buy', 'Buy from a rival', 'buy'],
    ['sell', 'Sell high or keep', 'sell'], ['watch', 'Playoff schedule', 'watch']];

  function screenDump() {
    if (!S.owner.is) return '<div class="empty-note">Only Titan\'s owner sees this screen.</div>';
    const D = S.dump;
    if (!D.at && !D.busy) loadDump();
    let h = `<div class="bar match-bar"><p class="lede">Only you see this. The data dump you download each Tuesday (usage, matchups, schedules and team
      tendencies) turned into ideas for each of your leagues: who to start, who to pick up, who to buy and who to sell.</p>
      <button class="btn ghost small" data-action="dump-reload"${D.busy ? ' disabled' : ''}>${D.busy ? 'Loading…' : 'Reload'}</button></div>`;
    if (D.error) h += `<div class="banner stop">${esc(D.error)}</div>`;
    const R = D.data;
    if (!R) {
      return h + `<div class="empty-note">${D.busy || !D.at ? 'Loading the data dump…'
        : 'No data dump yet. Save this week\'s file to Downloads and your PC posts it here within the hour.'}</div>`;
    }
    const pick = pickedLeague(), one = (R.leagues || []).find(L => L.id === pick) || null;
    h += `<p class="fine">Ideas for week ${esc(R.week)} · from ${esc(R.file || 'the data dump')}${R.updated ? `, its data updated ${esc(R.updated)}` : ''} · posted ${esc(when(R.at))}</p>`;
    if (pick !== 'all' && !one) h += '<div class="banner swap">That league isn\'t in the data dump, which covers your Sleeper leagues. Here are all of them.</div>';
    (R.notes || []).forEach(t => { h += `<div class="banner swap">${esc(t)}</div>`; });
    const count = L => DUMP_KINDS.reduce((s, [k]) => s + (L[k] || []).length, 0);
    const tiles = one ? DUMP_KINDS.slice(0, 4).map(([k, t]) => [t.toLowerCase(), (one[k] || []).length]) : R.tiles || [];
    h += `<section class="tiles">${tiles.map(t => tile(t[1], t[0], 'muted')).join('')}</section>`;
    h += `<div class="bar"><label class="field grow vr-search"><span>Find a player or team</span><input type="search" data-value-search
        placeholder="Name, team or position" value="${esc(S.value.q || '')}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
      <p class="empty-note" data-value-none hidden>Nothing in the data dump matches that.</p>`;

    // A claim carries the drop it suggests (d): the bench player worth the least, shown as a pill beside the name.
    const move = m => `<li data-find=" ${esc(SCC.norm(m.n))} ">${moveTag(m)}<b>${esc(m.n)}</b> <small class="vr-x">${esc(m.x)}</small>${
      m.d ? ` <span class="pill p-stop vr-drop">drop ${esc(m.d)}</span>` : ''}<p>${esc(m.why)}</p></li>`;
    const group = (list, title, cls) => (list && list.length ? `<h4 class="vr-k ${cls}">${title}</h4><ul class="vr-moves">${list.map(move).join('')}</ul>` : '');
    const cfgOf = id => (((S.snap && S.snap.leagues) || []).find(d => d.cfg.id === id) || {}).cfg;
    h += `<h3 class="vr-h">${one ? 'Your ideas' : 'Your ideas, league by league'}</h3><div class="league-grid">${(one ? [one] : snapOrder(R.leagues || [])).map(L => {
      const c = count(L), cfg = cfgOf(L.id);
      return `<details class="card vr-lg"${c ? ' open' : ''}><summary class="card-h"><div><h3>${cfg ? leagueIcon(cfg) : ''}${esc(L.name)}</h3>
        <p>${esc(L.format)} · ${plural(c, 'idea')}</p></div></summary><div class="vr-body">${DUMP_KINDS.map(([k, t, cls]) => group(L[k], t, cls)).join('')}${
        c ? '' : '<p class="fine">Nothing stands out this week.</p>'}</div></details>`;
    }).join('')}</div>`;

    // With a league picked, who has each player there.
    const where = one && one.own ? r => {
      const o = r.s ? one.own[r.s] : undefined;
      return !r.s ? '–' : o === undefined ? '<span class="good">Free agent</span>' : o === 'me' ? '<b>Yours</b>' : esc((one.teams || [])[o] || 'Taken');
    } : null;
    const Ls = R.lists || {}, wk = esc(R.week);
    const section = (title, sub, rows) => `<section class="card pad vr-sec"><h3>${title}</h3><p class="fine">${sub}</p>${
      rows && rows.length ? dumpTable(rows, false, where) : '<p class="fine">None this week.</p>'}</section>`;
    h += '<h3 class="vr-h">Buy and sell from expected points</h3>';
    h += section('Buy low: the work without the points', 'A real role by expected points, scoring 3 or more a game under it. That usually evens out.', Ls.buys);
    h += section('Sell high or keep: points above the work', 'Scoring 5 or more a game over expected. <b>Sell</b> when the role behind it is thin; <b>keep</b> when it\'s a real starter\'s: the points settle, the work stays.', Ls.sells);
    h += '<h3 class="vr-h">This week\'s matchups</h3>';
    h += section(`Soft matchups in week ${wk}`, 'Real roles facing one of the 8 softest defenses at their position: start them with confidence.', Ls.soft);
    h += section(`Tough matchups in week ${wk}`, 'Real roles facing one of the 8 toughest defenses at their position: temper expectations.', Ls.tough);
    h += '<h3 class="vr-h">Schedule outlook</h3>';
    h += section('Easiest next four weeks', 'Real roles whose next four games are among the 6 easiest at their position: buy or hold.', Ls.next4easy);
    h += section('Toughest next four weeks', 'Real roles whose next four games are among the 6 toughest at their position: sell or plan around them.', Ls.next4hard);
    h += section('Easiest fantasy playoffs', 'Weeks 15 to 17 among the 6 easiest at their position.', Ls.playoffEasy);
    h += section('Toughest fantasy playoffs', 'Weeks 15 to 17 among the 6 toughest at their position.', Ls.playoffHard);
    const vp = VALUE_POS.includes(S.ui.valuePos) ? S.ui.valuePos : 'ALL';
    h += `<section class="card pad vr-sec"><h3>Every player, by expected points</h3><p class="fine">Everyone in the file${one ? `, and who has him in ${esc(one.name)}` : ''}.</p>
      <div class="chips" role="group" aria-label="Position">${VALUE_POS.map(p =>
        `<button type="button" class="chip" data-vpos="${p}" aria-pressed="${vp === p}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>${dumpTable(R.players || [], true, where)}</section>`;
    h += `<h3 class="vr-h">Team tendencies</h3><section class="card pad vr-sec"><ul class="dd-hl">${(R.highlights || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${
      dumpTeams(R.teams || [])}</section>`;
    h += `<details class="card pad vr-how"><summary>How it works</summary><p class="fine"><b>Expected</b> is what a player's usage (targets, carries, throws and
      where on the field) usually scores a game, and <b>over expected</b> is his points a game minus that: big positives tend to fall back and big negatives to
      recover. <b>Matchup</b> ranks next week's opponent by the adjusted points it allows a game at his position (1 is the softest). <b>Adjusted</b> starts from
      his expected points, steadied by your value report's projection while the season is young, and moves toward the matchup, less while the defense's sample
      is small, and by position: a defense's record against running backs moves the number most, against quarterbacks and tight ends least. Then the game
      itself (<b>team pts</b>, the points his team is expected to score from the betting line): a team expected to score more than the average side this
      week lifts its players (quarterbacks most, backs least), a back on a team favored by a touchdown or more gets a little more, and on a big underdog a
      little less. <b>Next 4</b> and <b>playoffs</b> rank his schedule ahead at his position (1 is the easiest; the fantasy playoffs are weeks 15 to 17). A real role
      is a top-24 QB, top-40 RB, top-60 WR or top-20 TE by expected points. Start ideas swap in a bench player 2 or more adjusted points ahead of a starter,
      and pickups are free agents 1 or more ahead of the weakest starter they could replace, with a bigger margin while the season is young (4 and 3
      after one game). Players Sleeper lists as out, doubtful or on IR get no start or pickup
      calls.</p></details>
      <p class="credit">Numbers from your weekly data dump. Schedules, rosters and injuries from Sleeper.</p>`;
    return h;
  }

  /* ---- Value report (Titan's owner only) */

  /* The weekly value report from Titan's owner's PC (D:\Claude\titan-analytics, outside this repo). Each Tuesday a Python
     job compares every player's projection (nflverse's usage-based expected points, plus the skill he's shown) with
     FantasyCalc's trade value, finds buy-lows, sell-highs and claims in each of the owner's Sleeper leagues, and posts the
     report as JSON to lab/value-latest, which only the owner can read (firestore.rules). This screen shows it. */
  async function loadValue() {
    if (DEMO || !S.owner.is || !S.sync.api || !S.sync.api.valueReport || S.value.busy) return;
    S.value.busy = true;
    S.value.error = '';
    try {
      const d = await S.sync.api.valueReport();
      S.value.data = d && d.json ? JSON.parse(d.json) : null;
      S.value.rows = {}; // the Trade tab's per-league row index (valueRowsFor), rebuilt from the new report
    } catch (e) { S.value.error = `Couldn't load the value report: ${e && e.message ? e.message : e}`; }
    S.value.busy = false;
    S.value.at = Date.now();
    if (S.ui.tab === 'value' || S.ui.tab === 'trade') render();
  }

  const VALUE_POS = ['ALL', 'QB', 'RB', 'WR', 'TE'];
  /* The value report's filters, applied in place (no redraw, so the search box keeps its cursor and open leagues stay
     open; render re-applies them): the player search (name, team or position) over the leagues' moves and every table,
     and the position chips over the table of every player. A league or table with nothing matching hides. */
  function applyValueFilter() {
    const q = SCC.norm(S.value.q || '').trim(), vp = VALUE_POS.includes(S.ui.valuePos) ? S.ui.valuePos : 'ALL';
    const hit = el => !q || el.dataset.find.indexOf(q) >= 0;
    let any = !q;
    view.querySelectorAll('.vr-lg').forEach(card => {
      let n = 0;
      card.querySelectorAll('li[data-find]').forEach(li => { li.hidden = !hit(li); if (!li.hidden) n++; });
      card.querySelectorAll('.vr-moves').forEach(ul => {
        const show = [...ul.children].some(li => !li.hidden);
        ul.hidden = !show;
        if (ul.previousElementSibling) ul.previousElementSibling.hidden = !show;
      });
      card.hidden = !!q && !n;
      if (q && n) any = true;
    });
    view.querySelectorAll('.vr-sec').forEach(sec => {
      const rows = sec.querySelectorAll('tr[data-find]');
      let n = 0;
      rows.forEach(r => { r.hidden = !(hit(r) && (!r.dataset.vp || vp === 'ALL' || r.dataset.vp === vp)); if (!r.hidden) n++; });
      sec.hidden = !!q && !n;
      if (q && n) any = true;
    });
    const none = view.querySelector('[data-value-none]');
    if (none) none.hidden = any;
    pinValueHeads();
  }

  /* The value report's header rows follow the page. Each table sits in a box that scrolls sideways (phones), so
     position: sticky can't pin its header to the page; instead, as the page scrolls past a table, its header row is
     moved down (translateY) to sit just under Titan's header, and stops at the table's end. */
  let pinFrame = 0;
  function pinValueHeads() {
    pinFrame = 0;
    if (S.ui.tab !== 'value' && S.ui.tab !== 'dump') return;
    const bar = document.querySelector('.top'), top = bar ? bar.getBoundingClientRect().bottom : 0;
    view.querySelectorAll('.vr-scroll').forEach(box => {
      const cells = box.querySelectorAll('thead th');
      if (!cells.length) return;
      const shift = Math.max(0, Math.min(top - box.getBoundingClientRect().top, box.clientHeight - cells[0].offsetHeight));
      cells.forEach(th => { th.style.transform = shift > 0 ? `translateY(${Math.round(shift)}px)` : ''; });
    });
  }
  const pinSoon = () => { if (!pinFrame) pinFrame = requestAnimationFrame(pinValueHeads); };
  window.addEventListener('scroll', pinSoon, {passive: true});
  window.addEventListener('resize', pinSoon);

  /* A row's call as a pill: buy, or for a sell-high, keep (a real role: sell only for a strong offer) or sell. In the
     lists that are all one call (the buys, the sells) only the keep/sell verdict shows; the table of everyone shows all. */
  function callPill(r, all) {
    if (r.sell && r.keep) return '<span class="pill p-swap" title="Sell high, or keep: his role is real">keep</span>';
    if (r.sell) return '<span class="pill p-stop">sell</span>';
    if (r.buy && all) return '<span class="pill p-ok">buy</span>';
    return '';
  }
  // A league move's verdict (k: keep, or sell), when it has one.
  const moveTag = m => ('k' in m ? `<span class="pill ${m.k ? 'p-swap' : 'p-stop'}">${m.k ? 'keep' : 'sell'}</span> ` : '');
  /* The draft guide's take on a player (dg on the owner's Value and Data dump rows: k target | avoid | dart, c confidence
     out of 10, a still on the list, n the thesis, w what to watch this season), as a pill; hollow once he's off the list. */
  function guidePill(dg) {
    if (!dg || !dg.k) return '';
    const from = dg.s && !/^draft guide/.test(dg.s) ? `for JJ (${dg.s})` : 'in the draft guide';
    const title = `${dg.a ? 'A' : 'Was a'}${dg.k === 'target' ? ' player to target' : dg.k === 'avoid' ? ' player to avoid' : ' late-round dart'} ${from}, confidence ${dg.c}/10${
      dg.a ? '' : ' (since taken off the list)'}: ${dg.n}${dg.w ? ` Watch: ${dg.w}.` : ''}`;
    return `<span class="pill p-guide g-${esc(dg.k)}${dg.a ? '' : ' g-off'}" title="${esc(title)}">${esc(dg.k)} ${dg.c}</span>`;
  }

  // where(row): who has him in the picked league (a Where column), or null under All leagues.
  function valueTable(rows, filtered, where) {
    // Garbage time: his share of touches with the game decided, shown once it's a fifth or more (those count a quarter toward usage).
    const gt = r => (r.gt === null || r.gt === undefined ? '–' : r.gt >= 0.2 ? `<span class="amber">${Math.round(r.gt * 100)}%</span>` : Math.round(r.gt * 100) + '%');
    // Goal line: a back's share of his team's carries inside the 10; a pass catcher's end-zone targets a game.
    const goal = r => (r.p === 'RB' ? rt.share(r.gl) : r.p === 'QB' ? '' : rt.n(r.ez));
    // Routes: his share of his team's dropbacks he ran a route on (this season's, or last season's in grey until
    // nflverse publishes this season's), and per route: targets and yards.
    const routes = r => (r.p === 'QB' ? '' : r.rt !== null && r.rt !== undefined ? rt.share(r.rt)
      : r.prt !== null && r.prt !== undefined ? `<span class="muted" title="Last season">${rt.share(r.prt)}</span>` : '–');
    const perRoute = r => {
      if (r.p === 'QB' || r.p === 'RB') return '';
      const now = r.tprr !== null && r.tprr !== undefined, t = now ? r.tprr : r.ptprr, y = now ? r.yprr : r.pyprr;
      if (t === null || t === undefined || y === null || y === undefined) return '–';
      const s = `${Math.round(t * 100)}% tgt · ${y.toFixed(1)} yds`;
      return now ? s : `<span class="muted" title="Last season">${s}</span>`;
    };
    // Workload (the Late-Round playbook's counting stats): a back's carries and targets a game and his archetype; a passer's
    // rushing points a game and touchdown rate; a receiver's yards a target. Late-Round: the playbook's note on him, as a pill.
    const has = v => v !== null && v !== undefined;
    const workload = r => {
      if (r.p === 'RB') return has(r.car) && has(r.tg) ? `<span title="Opportunity a game: carries plus targets at what a target is worth in this scoring${has(r.opp) ? ` (${r.opp})` : ''}">${r.car.toFixed(1)} car · ${r.tg.toFixed(1)} tgt</span>${
        r.rbk ? ` <span class="pill p-rbk" title="His archetype by his workload">${esc(r.rbk)}</span>` : ''}` : '–';
      if (r.p === 'QB') return has(r.rp) ? `${r.rp.toFixed(1)} rush pts${has(r.tdr) ? ` · ${(r.tdr * 100).toFixed(1)}% TD` : ''}` : '–';
      return has(r.ypt) ? `${r.ypt.toFixed(1)} yds/tgt` : '–';
    };
    const playbook = r => (r.pb ? `<span class="pill p-pb" title="${esc(r.pb)}">JJ</span>` : '');
    return reportTable(rows, [['Guide', r => guidePill(r.dg)], ['Late-Round', playbook], ['Projection', r => rt.n(r.proj)], ['Points', r => rt.n(r.fp)], ['Over usage', r => rt.sgn(r.fpoe)], ['Snaps', r => rt.share(r.snap)],
      ['Routes', routes], ['Per route', perRoute], ['Workload', workload],
      ['Target share', r => rt.share(r.tgt)], ['Rush share', r => (r.p === 'RB' ? rt.share(r.rs) : '')], ['Red zone', r => rt.n(r.rz)], ['Goal line', goal], ['Garbage time', gt],
      ['By projection', r => rt.rank(r.p, r.ur)], ['Market', r => rt.rank(r.p, r.mr)],
      ['Gap', r => rt.sgn(r.gap, 0)], ['Rank change', r => rt.sgn(r.ch, 0)]], r => [r.p, r.t].filter(Boolean).join(' · '), filtered, where);
  }

  function screenValue() {
    if (!S.owner.is) return '<div class="empty-note">Only Titan\'s owner sees this screen.</div>';
    const V = S.value;
    if (!V.at && !V.busy) loadValue();
    let h = `<div class="bar match-bar"><p class="lede">Only you see this. Each Tuesday your PC compares every player's projection (his usage from
      nflverse, plus the skill he's shown) with his trade value, then finds buy-lows, sell-highs and claims in each of your leagues.</p>
      <button class="btn ghost small" data-action="value-reload"${V.busy ? ' disabled' : ''}>${V.busy ? 'Loading…' : 'Reload'}</button></div>`;
    if (V.error) h += `<div class="banner stop">${esc(V.error)}</div>`;
    const R = V.data;
    if (!R) return h + `<div class="empty-note">${V.busy || !V.at ? 'Loading the value report…' : 'No report yet. Your PC posts one every Tuesday morning.'}</div>`;
    // A league picked in the dropdown at the top: its moves, its own format's lists, and who has each player there.
    // Under All leagues, the format chips pick which format's lists show (S.ui.valueFmt). A first-version report
    // (one format's lists at the top level) still shows.
    const fmts = R.formats || {main: {name: R.format, buys: R.buys || [], sells: R.sells || [], risers: R.risers || [], all: R.all || []}};
    const keys = Object.keys(fmts), pick = pickedLeague(), one = (R.leagues || []).find(L => L.id === pick) || null;
    const fkey = one && fmts[one.fmt] ? one.fmt : fmts[S.ui.valueFmt] ? S.ui.valueFmt : fmts[R.main] ? R.main : keys[0];
    const F = fmts[fkey];
    h += `<p class="fine">Week ${esc(R.week)} · ${esc(R.through)} · made ${esc(when(R.at))}</p>`;
    if (pick !== 'all' && !one) h += '<div class="banner swap">That league isn\'t in this report, which covers your Sleeper leagues. Here are all of them.</div>';
    (R.notes || []).forEach(t => { h += `<div class="banner swap">${esc(t)}</div>`; });
    const tiles = one ? [['sell high or keep', one.sell.length], ['buy-low targets', one.buy.length], ['claims', one.add.length], ['players valued', (F.all || []).length]]
      : (R.tiles || []).filter(t => t[0] !== 'leagues').map(t => [t[0] === 'sell-high moves' ? 'sell high or keep' : t[0], t[1]]);
    h += `<section class="tiles">${tiles.map(t => tile(t[1], t[0], 'muted')).join('')}</section>`;
    const inFmt = k => (R.leagues || []).filter(L => L.fmt === k).length;
    if (!one && keys.length > 1) {
      h += `<div class="chips vr-fmts" role="group" aria-label="League format">${keys.map(k => `<button type="button" class="chip" data-vfmt="${esc(k)}" aria-pressed="${
        k === fkey}">${esc(fmts[k].name)} · ${plural(inFmt(k), 'league')}</button>`).join('')}</div>`;
    }

    // League by league: sells from depth, buys where thin, claims that would start.
    // A claim carries the drop it suggests (d): the bench player worth the least, shown as a pill beside the name.
    const move = m => `<li data-find=" ${esc(SCC.norm(m.n))} ">${moveTag(m)}<b>${esc(m.n)}</b> <small class="vr-x">${esc(m.x)}</small>${
      m.d ? ` <span class="pill p-stop vr-drop">drop ${esc(m.d)}</span>` : ''}<p>${esc(m.why)}</p></li>`;
    const group = (list, title, cls) => (list.length ? `<h4 class="vr-k ${cls}">${title}</h4><ul class="vr-moves">${list.map(move).join('')}</ul>` : '');
    const cfgOf = id => (((S.snap && S.snap.leagues) || []).find(d => d.cfg.id === id) || {}).cfg;
    // The player search filters the leagues' moves and every table in place (applyValueFilter), so the box keeps its cursor.
    h += `<div class="bar"><label class="field grow vr-search"><span>Find a player</span><input type="search" data-value-search
        placeholder="Name, team or position" value="${esc(V.q || '')}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
      <p class="empty-note" data-value-none hidden>No player in this report matches that.</p>`;
    // Where you stand at each position among the league's teams, in the position's colors: by projection, and by your
    // own season list when one is saved (L.ranks, titan-analytics v1.8.0); thin and deep are what the calls go by.
    // Older reports carry only the sentence (L.need).
    const needPills = L => {
      if (!L.ranks) return `<p class="fine">${esc(L.need)}</p>`;
      const pills = ['QB', 'RB', 'WR', 'TE'].filter(p => L.ranks[p]).map(p => {
        const r = L.ranks[p], tone = r.thin ? 'thin' : r.deep ? 'deep' : '';
        return `<span class="vr-np ${tone}" title="${esc(L.need)}"><span class="pos" data-pos="${p}">${p}</span><b>${nth(r.p)}</b><small>projection</small>${
          r.m ? `<b>${nth(r.m)}</b><small>your list</small>` : ''}${tone ? `<em>${tone}</em>` : ''}</span>`;
      }).join('');
      return `<div class="vr-need">${pills}<small class="vr-nn">Where your starters rank among the league's ${L.n} teams at each position: by this report's
        projections, and by your ${L.list ? esc(seasonLabel(L.list)) + ' list (Rankings, Season import)' : 'season list, once you save one'}. ${
        L.list ? 'Thin and deep follow your list, and so do the buys and sells.' : 'Thin and deep decide where the buys and sells look.'}</small></div>`;
    };
    // Leagues in the same order as every other tab (snapOrder); the format chips pick the lists below, not the order.
    const shown = one ? [one] : snapOrder(R.leagues || []);
    h += `<h3 class="vr-h">${one ? 'Your moves' : 'Your moves, league by league'}</h3><div class="league-grid">${shown.map(L => {
      const count = L.sell.length + L.buy.length + L.add.length, cfg = cfgOf(L.id);
      return `<details class="card vr-lg"${count ? ' open' : ''}><summary class="card-h"><div><h3>${cfg ? leagueIcon(cfg) : ''}${esc(L.name)}</h3>
        <p>${esc(L.format)} · ${plural(count, 'move')}</p></div></summary><div class="vr-body">${needPills(L)}${
        L.caveat ? `<p class="fine">${esc(L.caveat)}</p>` : ''}${group(L.sell, 'Sell high or keep, from your roster', 'sell')}${
        group(L.buy, 'Buy low from a rival', 'buy')}${group(L.add, 'Claim', 'add')}${count ? '' : '<p class="fine">Nothing stands out this week.</p>'}</div></details>`;
    }).join('')}</div>`;

    // The lists in the chosen format; with a league picked, who has each player there.
    const where = one && one.own ? r => {
      const o = one.own[r.s];
      return o === undefined ? '<span class="good">Free agent</span>' : o === 'me' ? '<b>Yours</b>' : esc((one.teams || [])[o] || 'Taken');
    } : null;
    const fname = esc(F.name || '') + (one ? ` (${esc(one.name)})` : '');
    const section = (title, sub, rows) => `<section class="card pad vr-sec"><h3>${title}</h3><p class="fine">${sub}</p>${
      rows.length ? valueTable(rows, false, where) : '<p class="fine">None this week.</p>'}</section>`;
    h += section('Buy low', `${fname}: the projection well ahead of the market, and not already scoring above his usage.`, F.buys || []);
    h += section('Sell high or keep', `${fname}: the market well ahead of the projection, often on touchdowns that don't last. <b>Sell</b> when the role
      behind the points is thin; <b>keep</b> when it's a solid starter's, unless the offer is strong.`, F.sells || []);
    h += section('Role risers', 'The biggest jumps in snap share over last season, among players with a real role.', F.risers || []);
    const vp = VALUE_POS.includes(S.ui.valuePos) ? S.ui.valuePos : 'ALL';
    h += `<section class="card pad vr-sec"><h3>Every valued player</h3><p class="fine">${fname}, by projection.</p>
      <div class="chips" role="group" aria-label="Position">${VALUE_POS.map(p =>
        `<button type="button" class="chip" data-vpos="${p}" aria-pressed="${vp === p}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>${valueTable(F.all || [], true, where)}</section>`;
    h += `<details class="card pad vr-how"><summary>How it works</summary><p class="fine"><b>Projection</b> is expected fantasy points a game from a player's
      usage (targets, carries, throws, field position and depth, from nflverse's ffopportunity model), blended with last season's while this season's
      sample is small (most for receivers and quarterbacks, least for backs: one week says the most about a back's role and the least about a
      receiver's), plus the part of what he's scored above or below his usage over the last two seasons that carries. A touch in <b>garbage time</b>
      (the fourth quarter with the game decided) counts a quarter toward his usage, and a player with 40% or more of his touches there is never a
      buy-low, and a week's usage is steadied halfway toward a normal play count, so a team that ran 86 plays doesn't make a role look bigger than
      it is. <b>Routes</b> is his route share: the share of his team's dropbacks he was on the field for (nflverse's participation data; grey means
      last season's, until this season's is published), and <b>per route</b> how often he's targeted and the yards he gains on each. A receiver's or
      tight end's role is read by route share when it's in, a receiver or tight end running routes on under 40% of dropbacks is never a buy-low, and
      the points tend to follow the routes. <b>Rush share</b> is a back's share of his team's carries. <b>Goal line</b> is a back's share of his team's carries inside the 10, or a
      pass catcher's end-zone targets a game: touchdowns that come with that work hold up, so a sell-high on touchdowns reads keep when it's there.
      <b>Guide</b> is the draft guide's take on him (a player to target, to avoid, or a late-round dart, with its confidence out of 10; hollow once
      the market caught up and he came off the list): hover for the thesis and what to watch this season. A buy the guide agrees with (a target)
      or a sell it agrees with (an avoid) ranks higher by its confidence; a call it argued against still stands, since the usage is the evidence,
      but ranks lower and says so. <b>Late-Round</b> is the playbook's note on him (hover: what JJ Zachariason's studies say about a player like
      this, from 42 of his research episodes): each reason ranks a call it agrees with higher, ranks one it argues with lower, or blocks it.
      <b>Workload</b> is the number behind it: a back's carries and targets a game and his archetype (a bell cow, a mini bell cow with 10-15
      carries and 2+ targets, the workload that produces now; a two-down back; a pass-game specialist, a role that rarely holds a season now),
      a passer's rushing points a game (the stickiest part of his line) and touchdown rate (6% or more falls back; 4.4% is normal), and a
      receiver's yards a target (10.5 or more falls). <b>Over usage</b> is this season's points a game
      minus expected: big positives tend to fall back and big negatives to recover. <b>By projection</b> and <b>market</b> are his place at his position by
      projection and by FantasyCalc's trade value; a <b>gap</b> of +10 means the market ranks him ten spots lower. A call needs that gap in value
      terms too (what the market pays at his projected rank against what it pays for him, a quarter apart at least), so a few spots at the top of a
      position, worth far more, count for more than the same spots deep in it. Last season's usage weighs more for positions whose roles settle
      slowly (tight ends most) and less the more a player's snap share has moved; past scoring above usage carries over more when it came from yards
      and catches than from touchdowns. No calls on players who missed their team's latest game, rookies before three games, young players as
      sells before four, or elite starters as sells. A sell-high with a solid starter's role, or with points from yards on a proven skill, reads
      <b>keep</b>. Buys start where your roster is thin; sells come only from where you aren't. Claims are free agents whose projection beats one of
      your starters. <b>Rank change</b> is since last week's report.</p></details>
      <p class="credit">Stats from <a href="https://github.com/nflverse" target="_blank" rel="noopener">nflverse</a> (CC BY 4.0) and ffopportunity. Values by
      <a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a>. Titan isn't affiliated with FantasyCalc.</p>`;
    return h;
  }

  function screenLab() {
    if (!S.owner.is && !S.owner.lab) return '<div class="empty-note">Only Titan\'s owner, and anyone he\'s given the rankings lab, sees this screen.</div>';
    if (!S.snap) return emptyState();
    if (!S.labAt && !S.labBusy) loadLab();
    const weeks = S.lab && S.lab.season === S.snap.season ? Object.values(S.lab.weeks).sort((a, b) => a.week - b.week) : [];
    const done = weeks.filter(x => x.done);
    const orderOf = (x, k) => Object.keys(x.order).map(P => x.order[P][k]).filter(n => n !== null && n !== undefined);
    const avg = list => list.length ? Math.round(list.reduce((t, n) => t + n, 0) / list.length) : null;
    let h = `<p class="lede">Only you see this. After each week's games, Titan tests three rankings against what happened: <b>Sleeper's projections</b>
      (Titan's default today), <b>FantasyCalc</b>'s values as they stood before kickoff, and <b>your rankings</b>. The plan: switch the default
      only if FantasyCalc clearly wins over about four weeks.</p>
      <div class="bar"><button class="btn ghost small" data-action="lab-run"${S.labBusy ? ' disabled' : ''}>${S.labBusy ? 'Testing…' : 'Test again'}</button></div>`;
    if (S.labError) h += `<div class="banner stop">${esc(S.labError)}</div>`;
    if (!weeks.length) return h + `<div class="empty-note">${S.labBusy ? 'Testing the rankings…' : 'No week has kicked off yet.'}</div>`;
    // So far: each source against Sleeper's projections, over the finished weeks both were tested.
    const line = k => {
      const both = done.filter(x => x.sources.includes(k));
      if (!both.length) {
        return `<li><b>${LAB_NAMES[k]}</b>: no finished week to compare yet${k === 'fc'
          ? '. Its first fair week is the first one whose snapshot is saved before kickoff (week 2).' : '. Import rankings for a week to include them.'}</li>`;
      }
      const pts = Math.round(both.reduce((t, x) => t + x.lineups[k] - x.lineups.sleeper, 0) / both.length * 10) / 10;
      const ord = Math.round(both.reduce((t, x) => t + (avg(orderOf(x, k)) || 0) - (avg(orderOf(x, 'sleeper')) || 0), 0) / both.length);
      return `<li><b>${LAB_NAMES[k]}</b>: <b class="${pts > 0 ? 'good' : pts < 0 ? 'amber' : ''}">${gap(pts)}</b> lineup points a week against Sleeper's
        projections, and order <b class="${ord > 0 ? 'good' : ord < 0 ? 'amber' : ''}">${ord > 0 ? '+' : ord < 0 ? '−' : '±'}${Math.abs(ord)}</b> (${plural(both.length, 'finished week')})</li>`;
    };
    h += `<section class="card pad"><h3>So far</h3><ul class="lab-sum">${line('fc')}${line('imports')}</ul></section>`;
    const cell = (x, k, best) => !x.sources.includes(k) ? '<small>not tested</small>'
      : `<span class="${x.sources.length > 1 && x.lineups[k] === best ? 'best' : ''}">${fmt(x.lineups[k])}</span><small>order ${avg(orderOf(x, k)) === null ? '–' : avg(orderOf(x, k))}</small>`;
    h += `<section class="card pad"><h3>Week by week</h3><div class="table-wrap"><table class="season-t lab-t"><thead><tr><th>Week</th>${
        LAB_SOURCES.map(k => `<th>${LAB_NAMES[k]}</th>`).join('')}<th>You started</th></tr></thead><tbody>${weeks.map(x => {
          const best = Math.max(...x.sources.map(k => x.lineups[k]));
          return `<tr><td>${x.week}${x.done ? '' : '<small>so far</small>'}${x.late ? '<small>FantasyCalc saved late</small>' : ''}</td>${
            LAB_SOURCES.map(k => `<td>${cell(x, k, best)}</td>`).join('')}<td>${fmt(x.lineups.actual)}<small>${x.lineups.leagues} of ${x.lineups.of} leagues</small></td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="fine">Lineup points: what each source's lineup would have scored, from your rosters, in the leagues every source covers that week. Order:
        how closely each source ranked QBs, RBs, WRs and TEs against their actual PPR points, from −100 to 100, averaged over the positions.
        A week counts once its games are over.</p></section>`;
    const last = done[done.length - 1];
    if (last) {
      h += `<section class="card pad"><h3>Week ${last.week} by position</h3><div class="table-wrap"><table class="season-t lab-t"><thead><tr><th>Order</th>${
          last.sources.map(k => `<th>${LAB_NAMES[k]}</th>`).join('')}</tr></thead><tbody>${Object.keys(last.order).map(P => `<tr><td>${P}</td>${
          last.sources.map(k => `<td>${last.order[P][k] === null || last.order[P][k] === undefined ? '–' : last.order[P][k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="fine">Among each source's top 24 QBs, 48 RBs, 60 WRs and 24 TEs; a player a source leaves out counts after its last.</p></section>`;
    }
    return h;
  }

  /* ---- Link more leagues: one tab per platform */

  const LINK_TABS = [{id: 'sleeper', name: 'Sleeper'}, {id: 'espn', name: 'ESPN'}, {id: 'yahoo', name: 'Yahoo'}];

  function linkLeagues(sleeperHtml) {
    const n = espnLinks().length;
    const status = {sleeper: S.account.userId ? 'Linked' : '', espn: n ? plural(n, 'league') : '',
      yahoo: !S.owner.is ? 'Soon' : S.yahoo.data && S.yahoo.data.linked ? 'Linked' : ''};
    const tab = LINK_TABS.some(t => t.id === S.ui.linkTab) ? S.ui.linkTab : S.account.userId ? 'espn' : 'sleeper';
    return `<h3>Link more leagues?</h3>
      <p class="fine">Every league you link is managed together: one set of rankings, one lineup check.</p>
      <div class="chips" role="group" aria-label="Fantasy sites">${LINK_TABS.map(t =>
        `<button class="chip" data-link-tab="${t.id}" aria-pressed="${t.id === tab}">${t.name}${
          status[t.id] ? ` <small>${esc(status[t.id])}</small>` : ''}</button>`).join('')}</div>
      <div class="link-pane">${tab === 'sleeper' ? sleeperHtml : tab === 'espn' ? espnSettings() : yahooLink()}</div>`;
  }

  /* Yahoo leagues are being built: Titan's owner can link Yahoo to try it (the
     server refuses everyone else too), and everyone else sees what's coming. */
  const YAHOO_NOTES = {
    linked: ['ok', 'Yahoo is linked.'],
    declined: ['stop', 'Yahoo sign-in was cancelled, so nothing was linked.'],
    expired: ['stop', 'That Yahoo sign-in took too long. Try again.'],
    failed: ['stop', 'Yahoo sign-in didn\'t finish. Try again in a minute.'],
    noaccess: ['stop', 'Yahoo signed you in, but turned Titan away when it asked for your leagues. Yahoo is probably still reviewing Titan\'s access request.']
  };

  function yahooLink() {
    if (S.owner.is) return yahooOwnerPane();
    return `<p>Yahoo leagues are next. Yahoo reviews every app before it can read fantasy leagues, and Titan's request is with Yahoo now.
        Once it's approved, you'll sign in with Yahoo here and your leagues will load on their own.</p>
      <div class="bar"><button class="btn" type="button" disabled>Sign in with Yahoo</button></div>`;
  }

  function yahooOwnerPane() {
    const Y = S.yahoo, d = Y.data, note = YAHOO_NOTES[Y.note];
    let h = `<p class="fine">Only you see this while Yahoo leagues are being built.</p>`;
    if (note) h += `<div class="banner ${note[0]}">${esc(note[1])}</div>`;
    if (!S.sync.user || !S.sync.api) {
      return h + `<p>Linking Yahoo needs your Titan sign-in. <button class="link" data-action="sync-in">Sign in with Google</button> first.</p>`;
    }
    if (!d && !Y.error) {
      if (!Y.busy) { Y.busy = true; setTimeout(loadYahoo, 0); }
      return h + '<p class="fine" role="status">Checking Yahoo…</p>';
    }
    if (Y.error) h += `<div class="banner stop">${esc(Y.error)}</div>`;
    if (!d || !d.linked) {
      return h + `<p>Sign in with Yahoo and Titan's server keeps the link, so your Yahoo leagues can load here. Titan only reads them.</p>
        <div class="bar"><button class="btn" type="button" data-action="yahoo-link"${Y.busy ? ' disabled' : ''}>Sign in with Yahoo</button></div>`;
    }
    if (d.noaccess) { if (Y.note !== 'noaccess') h += `<div class="banner stop">${esc(YAHOO_NOTES.noaccess[1])}</div>`; }
    else if (d.leagues && d.leagues.length) {
      h += `<p>Titan can see your Yahoo leagues:</p><ul class="saved">${d.leagues.map(l => `<li><span><b>${esc(l.name)}</b><small>${
        esc([l.teams ? plural(l.teams, 'team') : '', l.team ? 'your team: ' + l.team.name : ''].filter(Boolean).join(' · '))}</small></span></li>`).join('')}</ul>
        <p class="fine">They load with every refresh: on Lineups, Rosters, Exposure, Byes and Waivers now, and on Matchup, Standings, Trade and Results next.</p>`;
    } else h += `<p>Yahoo is linked, but it lists no football leagues for you this season.</p>`;
    return h + `<div class="bar"><button class="btn ghost small" type="button" data-action="yahoo-refresh"${Y.busy ? ' disabled' : ''}>Check again</button>
        <button class="btn ghost small" type="button" data-action="yahoo-unlink"${Y.busy ? ' disabled' : ''}>Unlink Yahoo</button></div>
      <p class="fine">Fantasy data provided by <a href="https://sports.yahoo.com/fantasy/" target="_blank" rel="noopener">Yahoo Fantasy</a>.</p>`;
  }

  async function loadYahoo() {
    Object.assign(S.yahoo, {busy: true, error: ''});
    try {
      S.yahoo.data = await S.sync.api.yahooLeagues(espnSeason());
      setYahooLinked(!!S.yahoo.data.linked);
    } catch (e) { S.yahoo.error = 'Could not check Yahoo: ' + ((e && (e.message || e.code)) || e); }
    S.yahoo.busy = false;
    if (S.ui.tab === 'settings') render();
  }

  /* Whether this account has Yahoo linked (never the link itself, which stays on Titan's
     server). Each refresh reads Yahoo leagues only when it's set. */
  function setYahooLinked(on) {
    if (!S.account || S.account.demo || !!(S.account.yahoo && S.account.yahoo.linked) === on) return;
    S.account.yahoo = {linked: on};
    S.account.updatedAt = Date.now();
    store.set(KEY.account, S.account);
    pushAccount();
    tipJar();
    refresh();
  }

  /* The Ko-fi tip jar hides inside the Play app (tips there must go through Google Play
     billing) and for anyone who links Yahoo (the owner's call, given Yahoo's terms on
     earning from its data). The website's pages read titan.noTip (theme.js). */
  function tipJar() {
    const yahoo = !!(S.account && S.account.yahoo && S.account.yahoo.linked);
    document.querySelectorAll('[data-tip]').forEach(el => { el.hidden = IN_PLAY_APP || yahoo; });
    if (DEMO) return;
    try { if (yahoo) localStorage.setItem('titan.noTip', '1'); else localStorage.removeItem('titan.noTip'); } catch (e) { /* storage blocked */ }
  }

  async function yahooSignIn() {
    Object.assign(S.yahoo, {busy: true, error: '', note: ''});
    render();
    try { await S.sync.api.yahooLink(); }
    catch (e) {
      Object.assign(S.yahoo, {busy: false, error: 'Could not start Yahoo sign-in: ' + ((e && (e.message || e.code)) || e)});
      render();
    }
  }

  async function yahooForget() {
    Object.assign(S.yahoo, {busy: true, error: '', note: ''});
    render();
    try {
      S.yahoo.data = await S.sync.api.yahooUnlink();
      setYahooLinked(false);
      toast('Yahoo unlinked.');
    } catch (e) { S.yahoo.error = 'Could not unlink Yahoo: ' + ((e && (e.message || e.code)) || e); }
    S.yahoo.busy = false;
    render();
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
    let h = `<section class="card pad" data-sync-slot="settings">${syncSettings()}</section>${alertsCard()}${newsletterCard('settings')}${appearanceCard()}${S.owner.is ? ownerCard() : ''}
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

  function pushSeason(key) {
    if (S.sync.api && S.sync.user && S.sync.api.pushSeason) S.sync.api.pushSeason(key, S.seasonRanks.formats[key] || null);
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
    const head = `<h3>Game-day alerts</h3><p class="fine">Titan can tell you when a starter is ruled out or in the news, check
      your lineups about 75 minutes before each kickoff, once inactives are out, and remind you the evening before waivers run.</p>`;
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
        ${box('news', 'News about your starters', 'When ESPN posts a story about someone in your lineup, checked every 15 minutes. Tap the alert to read it')}
        ${box('waivers', 'Waiver reminder', 'At 8 PM Eastern the evening before your Sleeper leagues\' waivers run, a reminder to go over Titan\'s waiver plan')}</ul>
      ${S.alertsError ? `<div class="banner stop">${esc(S.alertsError)}</div>` : ''}
      ${a.permission === 'denied' && !a.on ? '<p class="fine">Notifications are blocked for Titan in this browser. Allow them in the site settings, then try again.</p>' : ''}
      <div class="bar"><button class="btn${a.on ? ' ghost' : ''}" data-action="${a.on ? 'alerts-off' : 'alerts-on'}" ${S.alertsBusy ? 'disabled' : ''}>${
        S.alertsBusy ? 'One moment…' : a.on ? 'Turn off on this device' : 'Turn on for this device'}</button>${
        a.on ? `<button class="btn ghost" data-action="alerts-test" ${S.alertsBusy ? 'disabled' : ''}>Send a test alert</button>` : ''}</div>
      ${a.on ? '<p class="fine">Alerts are on for this device. Send a test to check it shows them.</p>' : ''}`);
  }

  const alertPrefs = () => Object.assign({out: true, check: true, news: true, waivers: true}, S.alerts && S.alerts.prefs);

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
     (Settings, Guides, Sign out), or a Sign in button. Phones use Settings. */
  function paintAccount() {
    const el = $('acct');
    if (!el) return;
    const u = S.sync.user;
    el.hidden = DEMO || !S.account || !S.sync.ready;
    if (el.hidden) return;
    const html = u
      ? `<button type="button" class="acct-btn" data-acct="menu" aria-haspopup="menu" aria-expanded="false">${u.photo
          ? `<img src="${esc(u.photo)}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : avatar('', 28)}<span>${esc(u.name || 'Account')}</span></button>
        <div class="acct-menu" role="menu" hidden><p>${esc(u.email || '')}</p>
          <button type="button" role="menuitem" data-acct="settings">Settings</button>
          <a role="menuitem" href="/guides/">Guides</a>
          <button type="button" role="menuitem" data-acct="signout">Sign out</button></div>`
      : '<button type="button" class="btn ghost small" data-acct="signin">Sign in</button>';
    // Only when it changed: a repaint mid-game would otherwise close the open menu.
    if (html !== acctHtml) el.innerHTML = acctHtml = html;
  }
  let acctHtml = '';

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
    local: () => ({account: S.account, ranks: S.ranks, seasonRanks: S.seasonRanks}),
    setOwner(is, lab) {
      is = !!is; lab = !!lab;
      if (S.owner.is === is && !!S.owner.lab === lab) return;
      S.owner = {is, lab, busy: false, data: null, error: ''};
      Object.assign(S.yahoo, {busy: false, error: '', data: null});
      if (is) sendLabFormats();
      paintHeader();
      if (['settings', 'ranks', 'multi', 'lab', 'value', 'dump'].includes(S.ui.tab)) render();
    },
    setAlerts(a) {
      S.alerts = a;
      if (S.ui.tab === 'settings') render();
    },
    applyAccount(account) {
      const newUser = !S.account || S.account.userId !== account.userId;
      const newPrefs = !newUser && (JSON.stringify(S.account.prefs || {}) !== JSON.stringify(account.prefs || {}) ||
        JSON.stringify(S.account.espn || {}) !== JSON.stringify(account.espn || {}) ||
        JSON.stringify(S.account.yahoo || {}) !== JSON.stringify(account.yahoo || {}));
      S.account = Object.assign({}, account);
      store.set(KEY.account, S.account);
      tipJar();
      if (newUser) { S.snap = null; S.A = null; store.del(KEY.snap); }
      render();
      if (newUser || newPrefs) refresh();
    },
    applySeasonRanks(changes) {
      Object.keys(changes).forEach(k => {
        if (changes[k]) S.seasonRanks.formats[k] = changes[k];
        else delete S.seasonRanks.formats[k];
      });
      store.set(KEY.seasonRanks, S.seasonRanks);
      S.seasonMemo = {};
      S.trade.ideas = {};
      render();
      toast('Season rankings updated from your account.');
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
      // Signing in opens Yahoo (read through Titan's server), so a refresh brings Yahoo leagues in;
      // one already running without it goes again when it's done.
      if (patch.state === 'on' && S.account && S.account.yahoo && S.account.yahoo.linked &&
          !(S.snap && (S.snap.leagues || []).some(d => d.cfg.platform === 'yahoo'))) {
        if (S.busy) S.again = true;
        else refresh();
      }
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
    try { S.moves[id] = {list: await API.leagueTransactions(d.cfg, d.rosterId, S.snap.week, 3, S.snap.season), at: Date.now()}; }
    catch (e) { S.moves[id] = Object.assign({}, had, {busy: false, error: (e && e.message) || String(e), at: Date.now()}); }
    if (S.ui.tab === 'moves') render();
  }
  // While the tab is open, each league's list reloads once it's five minutes old.
  setInterval(() => {
    if (DEMO || S.ui.tab !== 'moves' || document.hidden || !S.snap || S.busy) return;
    (S.snap.leagues || []).filter(d => d.cfg.platform !== 'yahoo').forEach(d => {
      const M = S.moves[d.cfg.id];
      if (M && !M.busy && Date.now() - (M.at || 0) > MOVES_EVERY) loadMoves(d);
    });
  }, 30000);

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
    // Sleeper's and ESPN's leagues (Yahoo's transactions come next).
    const leagues = S.snap.leagues || [], sleeper = leagues.filter(d => d.cfg.platform !== 'yahoo');
    sleeper.forEach(d => {
      const M = S.moves[d.cfg.id];
      if (!M || (!M.busy && Date.now() - (M.at || 0) > MOVES_EVERY)) loadMoves(d);
    });
    const all = [];
    sleeper.forEach(d => ((S.moves[d.cfg.id] || {}).list || []).forEach(x => all.push(Object.assign({cfg: d.cfg}, x))));
    all.sort((a, b) => b.at - a.at);
    // The league dropdown picks one league or all of them; then the kind of move (remembered).
    const lg = pickedLeague();
    const pool = lg === 'all' ? all : all.filter(x => x.cfg.id === lg);
    const tests = {all: () => true, trade: x => x.kind === 'trade', adds: x => x.kind !== 'trade', mine: x => x.mine};
    const f = tests[S.ui.movesFilter] ? S.ui.movesFilter : 'all', shown = pool.filter(tests[f]).slice(0, 150);
    const loading = sleeper.some(d => { const M = S.moves[d.cfg.id]; return !M || (M.busy && !M.list); });
    const failed = sleeper.filter(d => (S.moves[d.cfg.id] || {}).error && !(S.moves[d.cfg.id] || {}).list);
    let h = `<p class="lede">Every trade, waiver claim and free-agent move in your leagues over the last three weeks, newest first.
      Moves involving your team are marked.</p>
      <div class="chips" role="group" aria-label="Filter transactions">${[['all', 'All'], ['trade', 'Trades'], ['adds', 'Adds & drops'], ['mine', 'Yours']].map(([k, label]) =>
        `<button class="chip" data-moves="${k}" aria-pressed="${f === k}">${label} ${pool.filter(tests[k]).length}</button>`).join('')}</div>`;
    if (leagues.length > sleeper.length) h += '<p class="fine">Yahoo leagues aren\'t in this list yet.</p>';
    if (failed.length) h += `<div class="banner stop">Couldn't load the moves in ${esc(failed.map(d => d.cfg.key).join(', '))}. Tap Refresh to try again.</div>`;
    if (!shown.length) {
      h += loading ? '<div class="empty-note">Loading your leagues\' transactions…</div>'
        : `<div class="empty-note">${sleeper.length ? (f === 'all' ? 'No moves in your leagues over the last three weeks.' : 'Nothing like that over the last three weeks.') : 'Link a Sleeper account or add an ESPN league to see your leagues\' moves.'}</div>`;
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
  /* The player list indexed once per list: each name normalised (SCC.norm is a few regexes, too slow to run over
     every player on every keystroke), by name for lookups and as a list of players on a team for the searches. */
  let nameIdx = {for: null, map: {}, list: []};
  function indexOf(players) {
    if (nameIdx.for !== players) {
      const map = {}, list = [];
      for (const id in players) {
        const e = players[id];
        if (!e) continue;
        const n = SCC.norm(e[0]);
        if (!(n in map)) map[n] = id;
        if (e[2]) list.push({id, n, name: e[0], pos: e[1], team: e[2]});
      }
      nameIdx = {for: players, map, list};
    }
    return nameIdx;
  }
  const idByName = (players, name) => indexOf(players).map[SCC.norm(name)] || '';
  // Players whose name contains the (normalised) search, at most `max`.
  function searchPlayers(players, q, max) {
    const found = [];
    for (const e of indexOf(players).list) {
      if (e.n.indexOf(q) < 0) continue;
      found.push({id: e.id, name: e.name, pos: e.pos, team: e.team});
      if (found.length >= max) break;
    }
    return found;
  }

  // Up to six players matching the search, and where each stands in every league.
  function waiverSearchResults() {
    const q = SCC.norm(S.waiv.q || '').trim();
    if (q.length < 3 || !S.A) return '';
    const leagues = S.A.leagues, found = searchPlayers(playerList(), q, 40);
    if (!found.length) return '<p class="fine">No player on an NFL team by that name.</p>';
    const proj = p => SCC.projFor(S.proj, p.id, 1) || 0;
    found.sort((a, b) => proj(b) - proj(a) || a.name.localeCompare(b.name));
    return `<ul class="wlist">${found.slice(0, 6).map(p => {
      const st = leagues.map(L => ({L, s: wStatus(L, p)})), free = st.filter(x => x.s === 'free').length;
      return `<li class="wrow">${headshot(p, true)}<span class="who"><b${pcAttr(p)}>${esc(p.name)}</b><small>${esc(p.pos + ' · ' + p.team)} · free in ${free} of ${leagues.length}</small>${usageLine(p.id, p.pos)}
        <span class="wchips">${st.map(x => `<span class="wst ${x.s}">${esc(x.L.cfg.key)}${x.s === 'mine' ? ' · yours' : x.s === 'taken' ? ' · taken' : ''}</span>`).join('')}</span></span></li>`;
    }).join('')}</ul>`;
  }

  /* The Titan Waiver Wire, Titan's free weekly email: a signup card on Waivers and in Settings. newsletter.js posts
     it to Kit and remembers a device that joined; until Kit's form is set up, or once this device has joined, no card. */
  function newsletterCard(where) {
    const N = window.TitanNewsletter;
    if (!N || !N.ready() || N.joined()) return '';
    const id = 'nl-app-' + where;
    return `<section class="card pad nl-card"><h3>Free weekly waiver guide</h3>
      <p class="fine">Every Tuesday before waivers run: who to grab, who to buy low and who to sell high, from each player's real usage.
        One email a week, free.</p>
      <form class="nl-form" data-newsletter="app-${where}"><label class="sr-only" for="${id}">Email address</label>
        <input id="${id}" type="email" name="email_address" required placeholder="you@example.com" autocomplete="email">
        <button class="btn" type="submit">Get it free</button>
        <p class="fine nl-note" data-newsletter-note>Unsubscribe any time. Sent by Kit, an email service.</p></form></section>`;
  }

  // The last three finished weeks of Sleeper's stats, for each pickup's usage (SCC.usageOf). Loaded once a week per visit.
  const USAGE_WEEKS = 3;
  async function loadUsage() {
    const W = S.waiv, wk = S.snap.week, weeks = [];
    W.usageBusy = true;
    for (let w = Math.max(1, wk - USAGE_WEEKS); w < wk; w++) weeks.push(w);
    try { W.usage = {week: wk, list: await Promise.all(weeks.map(w => API.fetchStats(S.snap.season, w)))}; }
    catch (e) { W.usage = {week: wk, list: [], error: true}; }
    W.usageBusy = false;
    if (['waivers', 'lineups', 'matchup'].includes(S.ui.tab)) render(); // Lineups and Matchup: floors and ceilings
  }

  // One line of a player's recent usage: his share of the snaps (and whether it's rising), then per game what matters at his position.
  function usageLine(id, pos) {
    const U = S.waiv.usage;
    if (!id || !U || !U.list.length || pos === 'K' || pos === 'DEF') return '';
    const u = SCC.usageOf(U.list, id);
    if (!u) return `<small class="wuse">No games in the last ${plural(U.list.length, 'week')}.</small>`;
    const trend = u.trend === 'up' ? ' <span class="good" title="His snap share is rising">▲</span>'
      : u.trend === 'down' ? ' <span class="amber" title="His snap share is falling">▼</span>' : '';
    const bits = [u.snapPct !== null && `${u.snapPct}% snaps${trend}`, pos === 'RB' && `${u.car} car/g`, pos !== 'QB' && `${u.tgt} tgt/g`,
      pos !== 'QB' && u.rz && `${u.rz} red zone/g`, `${u.pts} pts/g`].filter(Boolean);
    return `<small class="wuse"><b>Last ${u.games === 1 ? 'game' : u.games + ' games'}:</b> ${bits.join(' · ')}</small>`;
  }

  // A season-long value for the plan's drops (SCC.waiverPlan): Titan's value (points above a replacement starter), then season projected points.
  function planValue(cfg, p) {
    // On the person's season list for this kind of league: kept over anyone who isn't, and the better his rank the longer.
    const at = seasonRankOf(cfg, p);
    if (at !== null) return 1e9 - at;
    const sp = S.trade.season && S.trade.season.map;
    if (!sp || !Object.keys(sp).length) return 0;
    const id = p.id || idByName(playerList(), p.name);
    return id ? (titanValueFor(cfg)({id, pos: p.pos}) || 0) * 1000 + (SCC.projFor(sp, id, cfg) || 0) : 0;
  }

  // This week's plan choices: claims marked done and drops changed (S.ui.wplan, started over when the week turns).
  function wPlan() {
    const wk = S.snap ? S.snap.week : 0;
    if (!S.ui.wplan || S.ui.wplan.week !== wk) S.ui.wplan = {week: wk, done: {}, drop: {}};
    return S.ui.wplan;
  }

  // When a Sleeper league's waivers run: they process about 3 AM Eastern on its waiver day (Sleeper counts from Monday).
  const WAIVER_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const waiverWhen = cfg => (cfg.platform || cfg.waiverDay === undefined ? '' : cfg.dailyWaivers ? 'waivers run daily'
    : `waivers run early ${WAIVER_DAYS[cfg.waiverDay] || 'Wednesday'} morning`);

  /* The week's waiver plan (SCC.waiverPlan): each league's claims with their usage and a bid, the drop Titan picks
     for each (a dropdown to swap him), and a Done check per claim. */
  function planCard(leagues, players, bid, budget) {
    const plan = SCC.waiverPlan(leagues, {value: planValue}), P = wPlan();
    if (!plan.length) {
      return '<section class="card pad wsec"><h3>Your waiver plan</h3><p class="fine">No free agent your rankings rate above one of your starters right now.</p></section>';
    }
    let total = 0, ticked = 0;
    const cards = plan.map(x => {
      const cfg = x.cfg, bench = x.league.roster.filter(p => !p.start && !p.held);
      const rows = x.claims.map(c => {
        const key = cfg.id + '|' + SCC.norm(c.add.name), done = !!P.done[key];
        total++;
        if (done) ticked++;
        const id = c.add.pos === 'DEF' ? '' : idByName(players, c.add.name), add = {id, name: c.add.name, pos: c.add.pos, team: c.add.team};
        const opts = [c.drop, ...c.dropAlts].filter(Boolean);
        bench.forEach(p => { if (!opts.includes(p)) opts.push(p); });
        const picked = key in P.drop ? P.drop[key] : c.drop ? c.drop.id : '';
        const nobody = x.open > 0 || !opts.length;
        const sel = `<select data-wdrop="${esc(key)}" aria-label="Who to drop for ${esc(c.add.name)}">${nobody
          ? `<option value=""${picked === '' ? ' selected' : ''}>Nobody (you have an open spot)</option>` : ''}${opts.map(p =>
          `<option value="${esc(p.id)}"${p.id === picked ? ' selected' : ''}>${esc(p.name)} (${esc(rl(p) || p.pos)})${p === c.drop ? ', Titan\'s pick' : ''}</option>`).join('')}</select>`;
        const notes = [c.thin && `${c.drop.name} is your only backup ${c.drop.pos}, but so is everyone else you could spare.`,
          c.keep && `${seasonListFor(cfg) ? 'Your season rankings value' : 'Titan values'} ${c.drop.name} more over the season than ${c.add.name}. Worth a second look.`].filter(Boolean);
        const alts = c.alts.length ? ` · or ${c.alts.map(a => `${esc(a.name)} <small>${esc(rl(a))}</small>`).join(', ')}` : '';
        return `<li class="wclaim${done ? ' done' : ''}">${headshot(add, true)}<div class="wc-main">
          <div class="wc-add"><b${pcAttr(add)}>${esc(c.add.name)}</b> <small>${esc([c.add.pos, c.add.team, rl(c.add)].filter(Boolean).join(' · '))}</small>${bid(x.league, c.add.name, add, c.over)}</div>
          ${usageLine(id, c.add.pos)}
          <small class="wmeta">${c.over ? `For ${esc(c.over.name)} (${esc(rl(c.over))}) at ${esc(c.pos)}` : `At ${esc(c.pos)}`}${alts}</small>
          <label class="wc-drop"><span>Drop</span>${sel}</label>${notes.map(n => `<small class="wnote">${esc(n)}</small>`).join('')}</div>
          <button type="button" class="chip wc-done" data-wdone="${esc(key)}" aria-pressed="${done}">${done ? '✓ Done' : 'Done'}</button></li>`;
      }).join('');
      const whenRun = waiverWhen(cfg);
      return `<li class="wlg"><div class="wlg-h">${leagueIcon(cfg, 'xs')}<b>${esc(cfg.key)}</b>${budget(x.league)}${
        whenRun ? `<span class="wmeta">· ${esc(whenRun)}</span>` : ''}<span class="wlg-open">${openSite(cfg)}</span></div><ol class="wclaims">${rows}</ol></li>`;
    });
    return `<section class="card pad wsec wplan"><div class="wplan-h"><h3>Your waiver plan</h3><span class="wmeta">${ticked} of ${plural(total, 'claim')} done</span></div>
      <p class="fine">Each claim is a free agent your rankings rate above one of your starters. The drop is the bench player valued least (by your season rankings where you've saved them, else Titan's values) over the
        season that you can spare: never someone on IR, and never your only backup at a position you start. Change it if you like, and tick Done once
        the claim is in. Tap a name for his stats.</p><ul class="wlist">${cards.join('')}</ul></section>`;
  }

  function screenWaivers() {
    if (!S.snap || !S.A) return emptyState();
    const W = S.waiv, players = playerList(), leagues = S.A.leagues;
    if (!W.trend && !W.busy && !W.error) loadTrending();
    if (!W.usageBusy && (!W.usage || W.usage.week !== S.snap.week)) loadUsage();
    if (!S.trade.season) loadSeasonProj(); // season values, for the plan's drops
    leagues.forEach(L => {
      if (!L.cfg.faab || !onSleeper(L.cfg) || W.faab[L.cfg.id]) return;
      const d = (S.snap.leagues || []).find(x => x.cfg.id === L.cfg.id);
      if (d) loadFaab(L.cfg, d.rosterId);
    });
    // How hot a pickup is: among Sleeper's 10 most added, the next 15, or neither.
    const trendAt = {};
    (W.trend || []).forEach((t, i) => { trendAt[SCC.norm(SCC.playerInfo(players, t.id).name)] = i; });
    const heat = name => { const r = trendAt[SCC.norm(name)]; return r === undefined ? 'cold' : r < 10 ? 'hot' : r < 25 ? 'warm' : 'cold'; };
    // Every league's teams, quietly, so a bid can count how many rivals would start the pickup (SCC.rivalsFor).
    leagues.forEach(L => {
      const d = (S.snap.leagues || []).find(x => x.cfg.id === L.cfg.id);
      if (d && L.cfg.faab && !S.trade.teams[L.cfg.id] && d.cfg.platform !== 'yahoo') loadTradeTeams(d, true);
    });
    /* A bid: the league's own bids or a share of the budget by how hot the pickup is, then scaled by what he adds
       over the starter he'd replace (`over`, the plan's claim) and how many other teams would start him. */
    const bid = (L, name, add, over) => {
      const F = W.faab[L.cfg.id];
      if (!L.cfg.faab || !F || !F.data) return '';
      const cfg = L.cfg, pts = p => SCC.projFor(S.proj, p.id, cfg) || 0, o = {budget: F.data.budget, left: F.data.left, bids: F.data.bids, heat: heat(name),
        pos: add && add.pos}; // a kicker or defense is a stream: the bid is capped
      if (add && add.id && over && Object.keys(S.proj).length) o.gain = Math.round((pts(add) - pts(over)) * 10) / 10;
      const Tm = S.trade.teams[cfg.id];
      if (add && add.id && Tm && Tm.list && Object.keys(S.proj).length) {
        o.rivals = SCC.rivalsFor(Tm.list, cfg.lineup, pts, add, (Tm.list.find(t => t.mine) || {}).id);
        o.teams = Tm.list.length;
      }
      const b = SCC.faabBid(o);
      const why = [b.basis === 'league' ? 'From this league\'s recent winning bids' : 'A share of the budget, until this league has more bids to go on'].concat(b.why || []);
      return b.bid ? ` <span class="wbid" title="${esc(why.join('; '))}">bid about $${b.bid}</span>${(b.why || []).length ? `<small class="wbid-why">${esc(b.why.join(' · '))}</small>` : ''}` : '';
    };
    const budget = L => { const F = W.faab[L.cfg.id]; return F && F.data ? ` <span class="wmeta">$${F.data.left} of $${F.data.budget} left</span>` : ''; };

    const charts = SCC.depthCharts(players), cuffs = [];
    leagues.forEach(L => L.roster.filter(p => p.start && p.inj).forEach(p => {
      const b = SCC.backupOf(players, p, charts);
      if (b && wStatus(L, {id: b.id, name: b.name, pos: p.pos, team: p.team}) === 'free') cuffs.push({L, p, b});
    }));

    const trend = (W.trend || []).slice(0, 25).map(t => {
      const info = SCC.playerInfo(players, t.id), p = {id: t.id, name: info.name, pos: info.pos, team: info.team};
      const st = leagues.map(L => ({L, s: wStatus(L, p)})), free = st.filter(x => x.s === 'free'), mine = st.filter(x => x.s === 'mine').length;
      return `<li class="wrow">${headshot(p, true)}<span class="who"><b${pcAttr(p)}>${esc(p.name)}</b><small>${esc([p.pos, p.team].filter(Boolean).join(' · '))} · ${thousands(t.count)} adds in the last day</small>${usageLine(p.id, p.pos)}
        ${free.length ? `<details class="wfree"><summary>Free in ${free.length} of ${leagues.length}</summary><span class="wchips">${
          free.map(x => `<span class="wst free">${esc(x.L.cfg.key)}${bid(x.L, p.name)}</span>`).join('')}</span></details>`
          : `<small class="wmeta">Not free in any of your leagues${mine ? ` (yours in ${mine})` : ''}.</small>`}</span></li>`;
    });

    const anyFaab = leagues.some(L => L.cfg.faab && onSleeper(L.cfg));
    let h = `<p class="lede">Your waiver plan for every league, then backups for hurt starters, what Sleeper players are adding, and where anyone
      is available.${anyFaab ? ' Where a league bids for players, Titan suggests a bid from its recent winning bids.' : ''}</p>
      ${planCard(leagues, players, bid, budget)}${newsletterCard('waivers')}
      <section class="card pad wsec"><h3>Where is he available?</h3>
        <label class="field"><span>A player's name</span><input type="search" data-waiver-search placeholder="At least three letters" value="${esc(W.q)}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label><div id="wsearch">${waiverSearchResults()}</div></section>`;
    if (cuffs.length) {
      h += `<section class="card pad wsec"><h3>Backups for your hurt starters</h3><ul class="wlist">${cuffs.map(c => `<li class="wline wcuff">
        ${leagueIcon(c.L.cfg, 'xs')}<span><b>${esc(c.p.name)}</b> <span class="bad-text">(${esc(c.p.inj)})</span>: his backup <b${pcAttr(c.b)}>${esc(c.b.name)}</b> is free in
        ${esc(c.L.cfg.key)}.${bid(c.L, c.b.name)}${usageLine(c.b.id, c.p.pos)}</span></li>`).join('')}</ul></section>`;
    }
    h += `<section class="card pad wsec"><h3>Trending pickups</h3><p class="fine">Sleeper's most-added players in the last day, and where each is free in your leagues.</p>${
      W.error ? `<div class="banner stop">${esc(W.error)}</div>` : !W.trend ? '<p class="fine">Loading…</p>' : `<ul class="wlist">${trend.join('')}</ul>`}</section>`;
    return h;
  }

  /* ---- The player card */

  /* Tap a player's name (Lineups, Rosters, Matchup, Waivers) for his card: this week's game, his last four weeks and his
     season so far from Sleeper's stats (API.fetchPlayerStats: snaps, targets, catches, carries, red-zone looks, air yards,
     PPR points), and where he's free in your leagues. A <dialog> like the draft results': Back closes it. */
  function playerDialog() {
    if (PC) return PC;
    PC = document.createElement('dialog');
    PC.className = 'dlg pcard';
    PC.setAttribute('aria-labelledby', 'pc-title');
    document.body.appendChild(PC);
    PC.addEventListener('click', e => {
      if (e.target === PC || e.target.closest('[data-action="pcard-close"]')) PC.close(); // the ✕, or a tap outside the panel
      else if (e.target.closest('[data-action="pcard-retry"]')) loadPlayerCard(S.pcard.id);
    });
    // Closing takes back the history entry opening added, unless Back is what closed it.
    PC.addEventListener('close', () => {
      if (!pcBack && history.state && history.state.pcard) history.back();
      pcBack = false;
      if (pcOpener && pcOpener.isConnected) pcOpener.focus(); // back to the name that opened it
    });
    return PC;
  }

  function openPlayerCard(id) {
    if (!id || !S.snap) return;
    playerDialog();
    S.pcard.id = id;
    const C = S.pcard.cache[id];
    if (!C || C.error) loadPlayerCard(id);
    PC.innerHTML = playerCardHtml();
    if (PC.open) return;
    pcOpener = document.activeElement;
    PC.showModal();
    if (location.protocol !== 'file:') history.pushState(Object.assign({}, history.state, {pcard: 1}), '', location.href);
  }

  async function loadPlayerCard(id) {
    S.pcard.cache[id] = {busy: true};
    if (PC && PC.open && S.pcard.id === id) PC.innerHTML = playerCardHtml();
    try { S.pcard.cache[id] = {data: await API.fetchPlayerStats(id, S.snap.season)}; }
    catch (e) { S.pcard.cache[id] = {error: true}; }
    if (PC && PC.open && S.pcard.id === id) PC.innerHTML = playerCardHtml();
  }

  /* Titan's read on a player, one block on his card, so he reads the same on every screen: this week's floor and
     ceiling, his season value (Titan's own, the league picked or your first), the matchup, and for the owner the
     Value report's projection rank against the market with its buy/sell/keep call. */
  function playerRead(p) {
    if (!p.pos || p.pos === 'PICK') return '';
    const d = (S.snap.leagues || []).find(x => x.cfg.id === pickedLeague()) || (S.snap.leagues || [])[0];
    if (!d) return '';
    const cfg = d.cfg, bits = [];
    const sp = spreadFor(p, cfg);
    if (sp) bits.push(`<span><b>${fmt(sp.floor)} to ${fmt(sp.ceiling)}</b><small>floor to ceiling this week</small></span>`);
    const tv = titanValueFor(cfg)(p);
    if (tv !== null) bits.push(`<span><b>${thousands(tv)}</b><small>points above a replacement starter, rest of season</small></span>`);
    const r = dvpRank(p);
    if (r) bits.push(`<span><b>${r <= 8 ? 'Soft' : r >= 25 ? 'Tough' : 'Middling'}</b><small>matchup: ${nth(r)} most given up to ${esc(p.pos)}s</small></span>`);
    const row = (valueRowsFor(cfg) || {})[p.id];
    if (row && row.ur && row.mr) {
      bits.push(`<span><b>${esc(p.pos)}${row.ur} by usage, ${esc(p.pos)}${row.mr} by the market</b><small>${
        row.buy ? 'buy low' : row.sell ? (row.keep ? 'sell high, or keep' : 'sell high') : 'no call'}${row.vgap ? ` · value gap ${row.vgap > 0 ? '+' : ''}${Math.round(row.vgap * 100)}%` : ''}</small></span>`);
    }
    return bits.length ? `<div class="pc-read"><h3>Titan's read <small>${esc(cfg.key)}</small></h3><div class="pc-bits">${bits.join('')}</div></div>` : '';
  }

  // The card's columns by position; every table ends with PPR points. A kicker or defense shows points only.
  const snapShare = s => (s.tsnp ? Math.round(s.snp / s.tsnp * 100) + '%' : '–');
  const PC_REC = [['Snaps', snapShare], ['Tgt', 'tgt'], ['Rec', 'rec'], ['Yds', 'yd'], ['Air yds', 'ay'], ['RZ', 'rz']];
  const PC_COLS = {
    QB: [['Snaps', snapShare], ['Comp', s => s.cmp + '/' + s.att], ['Yds', 'pyd'], ['TD', 'ptd'], ['INT', 'int'], ['Rush yds', 'ryd']],
    RB: [['Snaps', snapShare], ['Car', 'car'], ['Yds', 'ryd'], ['Tgt', 'tgt'], ['Rec', 'rec'], ['Rec yds', 'yd'], ['RZ', 'rz']],
    WR: PC_REC, TE: PC_REC
  };
  const PC_SUM = ['gp', 'snp', 'tsnp', 'tgt', 'rec', 'yd', 'car', 'ryd', 'rz', 'ay', 'att', 'cmp', 'pyd', 'ptd', 'int', 'ppr'];

  function playerCardHtml() {
    const id = S.pcard.id, info = SCC.playerInfo(playerList(), id);
    const mine = S.A ? S.A.leagues.map(L => L.roster.find(r => String(r.id) === id)).find(Boolean) : null;
    const p = {id, name: info.name || (mine && mine.name) || 'Player', pos: info.pos || (mine && mine.pos) || '', team: info.team || (mine && mine.team) || ''};
    const sub = [p.pos, p.team, mine && mine.inj].filter(Boolean).join(' · ');
    const head = `<header class="dlg-h"><div class="dlg-t">${headshot(p)}<div><h2 id="pc-title">${esc(p.name)}</h2><p>${esc(sub)}</p></div></div>
      <button type="button" class="dlg-x" data-action="pcard-close" aria-label="Close">✕</button></header>`;
    // This week: his game and projection, and where he stands in each of your leagues.
    const proj = SCC.projFor(S.proj, id, 1), opp = mine && mine.opp;
    const week = [opp && 'vs ' + opp, teamKick(p.team), proj !== null && `projected ${fmt(proj)} PPR`].filter(Boolean).join(' · ');
    let h = week ? `<p class="pc-week"><b>Week ${esc(S.snap.week)}:</b> ${esc(week)}</p>` : '';
    h += playerRead(p) + playerNews(p);
    if (S.A && S.A.leagues.length) {
      h += `<div class="wchips pc-where">${S.A.leagues.map(L => { const s = wStatus(L, p); return `<span class="wst ${s}">${esc(L.cfg.key)}${
        s === 'mine' ? ' · yours' : s === 'taken' ? ' · taken' : ' · free'}</span>`; }).join('')}</div>`;
    }
    const C = S.pcard.cache[id] || {busy: true};
    if (C.busy) return `${head}<div class="dlg-body">${h}<p class="empty-note">Loading his stats…</p></div>`;
    if (C.error) return `${head}<div class="dlg-body">${h}<div class="banner stop">Titan couldn't load his stats. <button class="link" data-action="pcard-retry">Try again</button></div></div>`;
    const weeks = Object.keys(C.data).map(Number).filter(w => w <= S.snap.week && (C.data[w].gp || C.data[w].snp || C.data[w].ppr)).sort((a, b) => b - a);
    if (!weeks.length) return `${head}<div class="dlg-body">${h}<p class="empty-note">No games for him yet this season.</p><p class="credit">Stats via Sleeper.</p></div>`;
    const tot = {};
    PC_SUM.forEach(k => { tot[k] = weeks.reduce((t, w) => t + (C.data[w][k] || 0), 0); });
    const g = weeks.filter(w => C.data[w].gp || C.data[w].snp).length || weeks.length, per = n => fmt(n / g);
    // Snap counts reach Sleeper's stats a while after the games; until they do, the snaps column and tile stay out.
    const pcols = PC_COLS[p.pos] || [], snaps = tot.tsnp > 0, cols = pcols.filter(c => snaps || c[0] !== 'Snaps');
    const main = p.pos === 'QB' ? [per(tot.pyd), 'pass yds a game'] : p.pos === 'RB' ? [per(tot.car + tot.tgt), 'carries and targets a game']
      : pcols.length ? [per(tot.tgt), 'targets a game'] : null;
    const tiles = [tile(g, g === 1 ? 'game' : 'games', 'muted'), snaps && pcols.length && tile(snapShare(tot), 'of the snaps', 'muted'),
      main && tile(main[0], main[1], 'muted'), tile(per(tot.ppr), 'PPR points a game', 'muted')].filter(Boolean);
    h += `<section class="tiles${tiles.length === 3 ? ' three' : tiles.length === 2 ? ' two' : ''}" aria-label="Season so far">${tiles.join('')}</section>`;
    const cell = (c, s) => esc(typeof c[1] === 'function' ? c[1](s) : String(Math.round(s[c[1]] || 0)));
    const live = w => w === Number(S.snap.week) && (gameOf(p.team) || {}).state === 'in_game' ? ' <small class="pc-live">live</small>' : '';
    const row = (label, s, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${cols.map(c => `<td class="tnum">${cell(c, s)}</td>`).join('')}<td class="tnum"><b>${fmt(s.ppr)}</b></td></tr>`;
    h += `<div class="card table-wrap"><table class="rtable pctable"><thead><tr><th>Week</th>${cols.map(c => `<th class="tnum">${c[0]}</th>`).join('')}<th class="tnum">PPR</th></tr></thead>
      <tbody>${weeks.slice(0, 4).map(w => row(`Week ${w}${live(w)}`, C.data[w])).join('')}${weeks.length > 1 ? row('Season', tot, 'pc-season') : ''}</tbody></table></div>`;
    const n = weeks.length, notes = [n === 1 ? 'His only game so far.' : `His last ${n < 4 ? n + ' games' : 'four games'}, and the season so far.`,
      cols.some(c => c[0] === 'RZ') && 'RZ counts targets and carries inside the 20.', !snaps && pcols.length && 'Sleeper hasn\'t posted snap counts for these games yet.'];
    h += `<p class="fine">${notes.filter(Boolean).join(' ')}</p><p class="credit">Stats via Sleeper.</p>`;
    return `${head}<div class="dlg-body">${h}</div>`;
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
    // Lineups and Rosters lead each league with its playoff odds (leagueAdvice), so they repaint too.
    if (['standings', 'trade', 'lineups', 'rosters'].includes(S.ui.tab)) render();
  }

  /* The standings simulation for a league (SCC.standings), rebuilt when the games played, the projections or the
     week change; null until its schedule and teams are in. Standings and the Trade tab (each team's stance) share it. */
  function standingsResult(d) {
    const cfg = d.cfg, St = S.stand[cfg.id], Tm = S.trade.teams[cfg.id];
    if (!St || St.busy || St.error || !Tm || !Tm.list) return null;
    const sched = St.sched;
    if (!sched.teams.length || !sched.games.length) return null;
    // This week's projected points for each team's best lineup.
    const proj = {};
    Tm.list.forEach(t => { proj[t.id] = SCC.lineupPoints(t.roster, cfg.lineup, p => SCC.projFor(S.proj, p.id, cfg) || 0); });
    const key = [sched.games.filter(g => g.done).length, Object.keys(S.proj).length, S.snap.week].join('|');
    if (!St.result || St.key !== key) {
      Object.assign(St, {key, result: SCC.standings(sched.teams, sched.games, proj, simOpts(cfg, sched, 5000, 7))});
    }
    return St.result;
  }
  // The simulation's settings for a league: its playoff spots and how divisions seed them (the teams carry their divisions).
  const simOpts = (cfg, sched, sims, seed) => ({playoffTeams: cfg.playoffTeams || sched.playoffTeams, seedType: cfg.seedType || 0, sims, seed});

  /* The playoff picture: what this week's games mean for your odds. Each game still to play this week is run both
     ways through the standings simulation (fewer sims than the table's), and the difference in your playoff chance
     says who to root for. Your own game leads. Nothing once the week is played or before the schedule is in. */
  const PICTURE_SIMS = 2000;
  function playoffPicture(d, sched, R) {
    const cfg = d.cfg, Tm = S.trade.teams[cfg.id];
    if (!R || !Tm || !Tm.list) return '';
    const mineId = String(cfg.platform === 'espn' ? cfg.teamId : d.rosterId), week = S.snap.week;
    const games = sched.games.filter(g => Number(g.week) === Number(week) && !g.done && String(g.a) !== String(g.b));
    if (!games.length || R.left === 0) return '';
    const proj = {};
    Tm.list.forEach(t => { proj[t.id] = SCC.lineupPoints(t.roster, cfg.lineup, p => SCC.projFor(S.proj, p.id, cfg) || 0); });
    const opts = simOpts(cfg, sched, PICTURE_SIMS, 11);
    const odds = forced => {
      const list = sched.games.map(g => (g === forced.g ? Object.assign({}, g, {done: true, aPts: forced.aWins ? 1 : 0, bPts: forced.aWins ? 0 : 1}) : g));
      const t = SCC.standings(sched.teams, list, proj, opts).teams.find(x => x.id === mineId);
      return t ? t.playoffs : null;
    };
    const name = id => { const t = sched.teams.find(x => String(x.id) === String(id)); return t ? t.name : 'Team ' + id; };
    const rows = games.map(g => {
      const a = odds({g, aWins: true}), b = odds({g, aWins: false});
      if (a === null || b === null) return null;
      const mine = String(g.a) === mineId || String(g.b) === mineId, iAmA = String(g.a) === mineId;
      const swing = Math.round((a - b) * 100), fav = swing >= 0 ? g.a : g.b; // the winner that helps you
      return {g, mine, swing: Math.abs(swing), fav, winOdds: mine ? (iAmA ? a : b) : null, loseOdds: mine ? (iAmA ? b : a) : null};
    }).filter(Boolean).sort((x, y) => (y.mine - x.mine) || y.swing - x.swing);
    const line = r => r.mine
      ? `<li class="pp-mine"><b>Your game:</b> win it and you're at ${pct(r.winOdds)}, lose it and ${pct(r.loseOdds)}.</li>`
      : r.swing < 1 ? `<li><span class="fine">${esc(name(r.g.a))} vs ${esc(name(r.g.b))}: doesn't move your odds.</span></li>`
        : `<li>Root for <b>${esc(name(r.fav))}</b> over ${esc(name(r.fav === r.g.a ? r.g.b : r.g.a))} <span class="good">+${r.swing}%</span> for you.</li>`;
    return `<section class="card pad ppic"><h3>This week's playoff picture</h3><ul>${rows.map(line).join('')}</ul>
      <p class="fine">Each game this week run both ways through the same simulation: the difference is what that result does to your playoff chance.</p></section>`;
  }

  /* Where each team stands for trades, in a dynasty or keeper league (a redraft team out of the race has no
     future to trade for): contending at 55% playoff odds or more, rebuilding at 25% or less, from the standings
     simulation. {map: {teamId: stance}, odds: {teamId}}, or null until the schedule is in. */
  const STANCE = {contender: 0.55, rebuilder: 0.25};
  function stanceOf(d) {
    if (d.cfg.kind === 'Redraft' || d.cfg.platform === 'yahoo' || DEMO) return null;
    if (!S.stand[d.cfg.id]) loadStandings(d);
    const R = standingsResult(d);
    if (!R) return null;
    const map = {}, odds = {};
    R.teams.forEach(t => { map[t.id] = t.playoffs >= STANCE.contender ? 'contender' : t.playoffs <= STANCE.rebuilder ? 'rebuilder' : 'mid'; odds[t.id] = t.playoffs; });
    return {map, odds};
  }

  const pct = x => x >= 0.995 && x < 1 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : Math.round(x * 100) + '%';
  const nth = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const recordOf = t => `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}`;

  /* Your playoff odds in every league at once (Standings under All leagues): each league's schedule and teams load
     quietly (loadStandings, loadTradeTeams) and its simulation runs (standingsResult); the rows fill in as they
     arrive, best odds first, and a tap opens that league's full standings below. Yahoo leagues wait. */
  function oddsOverview(leagues, openId) {
    const rows = leagues.filter(d => d.cfg.platform !== 'yahoo').map(d => {
      const cfg = d.cfg;
      if (!S.stand[cfg.id]) loadStandings(d);
      if (!S.trade.teams[cfg.id]) loadTradeTeams(d, true);
      const St = S.stand[cfg.id], Tm = S.trade.teams[cfg.id];
      const err = (St && St.error) || (Tm && Tm.error);
      if (err) return {d, error: true};
      const R = standingsResult(d);
      if (!R) return {d};
      const mineId = String(cfg.platform === 'espn' ? cfg.teamId : d.rosterId), me = R.teams.find(t => t.id === mineId);
      return me ? {d, me, R} : {d, error: true};
    });
    const done = rows.filter(r => r.me).sort((a, b) => b.me.playoffs - a.me.playoffs), waiting = rows.filter(r => !r.me);
    const inN = done.filter(r => r.me.playoffs >= 0.5).length;
    const row = r => `<button type="button" class="po-row${r.d.cfg.id === openId ? ' open' : ''}" data-stand="${esc(r.d.cfg.id)}">
      <span class="po-lg">${leagueIcon(r.d.cfg, 'xs')}<b>${esc(r.d.cfg.key)}</b><small>${r.me ? `${r.me.games ? recordOf(r.me) + ', ' : ''}${nth(r.me.seed)} of ${r.R.teams.length}${
        r.me.divWinner ? ' ★' : ''} · about ${fmt(r.me.projWins)} wins` : r.error ? 'couldn\'t load' : 'loading…'}</small></span>
      ${r.me ? `<span class="st-odds"><span class="odds-bar"><i style="width:${Math.round(r.me.playoffs * 100)}%"></i></span><b>${pct(r.me.playoffs)}</b></span>` : '<span class="st-odds"><b>–</b></span>'}</button>`;
    return `<section class="card pad podds"><div class="card-h"><div><h3>Your playoff odds</h3><p>${done.length === rows.length
      ? `On track in ${inN} of ${rows.length} leagues (a 50% chance or better)` : `Working out ${plural(waiting.length, 'league')}…`}</p></div></div>
      <div class="po-list">${done.concat(waiting).map(row).join('')}</div>
      <p class="fine">Each league's odds from its own standings simulation, best first; ★ marks a division you lead. Tap a league for its full standings.</p></section>`;
  }

  function screenStandings() {
    if (DEMO) return demoOnly('Standings', 'Standings show your real leagues: records, power rankings, luck and each team\'s playoff odds.');
    if (!S.snap) return emptyState();
    const leagues = S.snap.leagues || [];
    if (!leagues.length) return '<div class="empty-note">No leagues yet.</div>';
    // One league at a time: the league dropdown's when it names one, else this screen's own pick.
    const one = pickedLeague() !== 'all' ? pickedLeague() : S.ui.standLeague;
    const d = leagues.find(x => x.cfg.id === one) || leagues[0], cfg = d.cfg;
    if (!S.stand[cfg.id]) loadStandings(d);
    if (!S.trade.teams[cfg.id]) loadTradeTeams(d);
    if (!S.trade.season) loadSeasonProj(); // for Position strength
    const St = S.stand[cfg.id], Tm = S.trade.teams[cfg.id];
    // Under All leagues, your playoff odds in every league lead, then the league shown in full.
    let h = (pickedLeague() === 'all' && leagues.length > 1 ? oddsOverview(leagues, cfg.id) : '') + onePick(d, leagues);
    const err = (St && St.error) || (Tm && Tm.error);
    if (err) return h + `<div class="banner stop">${esc(err)} <button class="link" data-action="stand-retry">Try again</button></div>`;
    if (!St || St.busy || !Tm || Tm.busy) return h + '<div class="empty-note">Loading the schedule and every team\'s roster…</div>';
    const sched = St.sched;
    if (!sched.teams.length || !sched.games.length) return h + '<div class="empty-note">This league has no regular-season schedule yet.</div>';
    const R = standingsResult(d), picture = playoffPicture(d, sched, R), mineId = String(cfg.platform === 'espn' ? cfg.teamId : d.rosterId), me = R.teams.find(t => t.id === mineId);
    if (me) {
      h += `<div class="banner ok"><b>Your playoff chances in ${esc(cfg.key)}: ${pct(me.playoffs)}.</b> ${me.games
        ? `You're ${nth(me.seed)} at ${recordOf(me)}, power-ranked ${nth(me.powerRank)} of ${R.teams.length},`
        : `No games played yet, so this comes from this week's projected lineups. You're power-ranked ${nth(me.powerRank)} of ${R.teams.length},`}
        with about ${fmt(me.projWins)} wins expected by the end of the regular season.</div>`;
    }
    h += picture;
    const cell = t => `<tr class="${t.id === mineId ? 'mine' : ''}${t.seed === R.spots ? ' cut' : ''}"><td class="tnum">${t.seed}</td>
      <td class="st-team">${esc(t.name)}${t.divWinner ? ' <span class="st-div" title="Leads its division">★</span>' : ''}</td><td>${recordOf(t)}</td><td class="st-opt tnum">${fmt(t.pf)}</td>
      <td class="st-opt">${t.allPlay.w}-${t.allPlay.l}${t.allPlay.t ? '-' + t.allPlay.t : ''}</td>
      <td class="tnum st-opt${t.luck > 0.5 ? ' good' : t.luck < -0.5 ? ' amber' : ''}">${t.games ? signed(t.luck) : '–'}</td>
      <td class="tnum st-opt">${t.powerRank}</td>
      <td><span class="st-odds"><span class="odds-bar"><i style="width:${Math.round(t.playoffs * 100)}%"></i></span><b>${pct(t.playoffs)}</b></span></td></tr>`;
    return h + `<div class="card table-wrap"><table class="stand"><thead><tr><th>#</th><th class="st-team">Team</th><th>Record</th>
        <th class="st-opt">Points</th><th class="st-opt">All-play</th><th class="st-opt">Luck</th><th class="st-opt">Power</th><th>Playoffs</th></tr></thead>
        <tbody>${R.teams.map(cell).join('')}</tbody></table></div>
      <p class="fine">${R.spots} teams make the playoffs; the dashed line is the cut. The odds come from ${thousands(R.sims)} simulations of the
        ${R.left} games left: each team scores around its average so far, blended with this week's projected lineup, give or take its own
        usual swing (steadied by the league's while few games are played). ${R.divisions ? `Each of the ${R.divisions} divisions' best record takes a playoff spot${
        cfg.seedType === 1 ? ', seeded by record' : ', seeded first'} (the ★ marks today's division leaders).` : 'This league has no divisions.'} All-play is a team's record if it had played every team every week, and
        luck is how many more (or fewer) wins it has than that record would give. Power ranks all-play, points per game and projected
        strength together.</p>` + strengthTable(strengthOf(cfg, Tm.list), R, mineId, cfg);
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

  /* FantasyCalc's own numbers show only on Titan's owner's account. FantasyCalc's terms for
     Titan (email, 2026-09-12): its values stay out of other sites' trade calculators, but who
     wins a trade, each team's value change in percent, and lines like "Your starters +988 ·
     theirs +518" are fine. So everyone else sees Titan's own value beside each player
     (SCC.titanValues, from Sleeper's season projections, never FantasyCalc's), while who wins,
     fairness and the trade ideas still come from FantasyCalc's values. */
  const fcShown = () => S.owner.is;
  // The Trade tab's roster sorts (S.ui.tradeSort).
  const TRADE_SORTS = [['value', 'Value'], ['pos', 'Position'], ['posvalue', 'Position, then value']];
  async function loadSeasonProj() {
    S.trade.season = {busy: true};
    try { S.trade.season = {map: await API.fetchSeasonProjections(S.snap.season)}; }
    catch (e) { S.trade.season = {map: {}}; }
    S.trade.tv = {};
    if (['trade', 'standings', 'waivers', 'lineups', 'rosters'].includes(S.ui.tab)) render();
  }
  // Titan's own values for a league ({k, m: {playerId: value}}), or null until this season's projections are in.
  function titanValueMap(cfg) {
    const sp = S.trade.season && S.trade.season.map;
    if (!sp || !Object.keys(sp).length) return null;
    S.trade.tv = S.trade.tv || {};
    // The rest of this season (byes out), the flex spots shared out the way this league's teams fill them once they're in.
    const teams = (S.trade.teams[cfg.id] || {}).list, week = S.snap.week, k = `${cfg.id}|${week}|${teams ? 'league' : ''}|${Object.keys(sp).length}`;
    if (!S.trade.tv[k]) {
      S.trade.tv[k] = SCC.titanValues(sp, playerList(), cfg, {from: week, to: Math.max(LAST_REG_WEEK, week), dynasty: cfg.kind === 'Dynasty',
        shares: teams ? SCC.flexShares(teams, cfg.lineup, p => SCC.projFor(sp, p.id, cfg) || 0) : undefined});
    }
    return {k, m: S.trade.tv[k]};
  }
  function titanValueFor(cfg) {
    const T = titanValueMap(cfg);
    if (!T) return () => null;
    return p => (p && p.pos !== 'PICK' && T.m[p.id] !== undefined ? T.m[p.id] : null);
  }

  /* ---- Season rankings (Rankings → Season): a person's own rest-of-season or dynasty rankings, one list for each kind
     of league (SCC.SEASON_FORMATS: 1QB or superflex, redraft or dynasty, each with a TE Premium list), turned into their
     own values on the market's scale (SCC.seasonValues: their order, the market's spacing). The market still decides
     what's fair; their values decide what they gain, so trade ideas look for players they rank above the price. The
     values also pick the waiver plan's drops, grade drafts and rank Position strength. Saved on the device and synced
     (users/{uid}/seasonRanks/{format}). */
  const seasonEntry = key => (S.seasonRanks.formats || {})[key] || null;
  const seasonLabel = key => ((SCC.SEASON_FORMATS.find(f => f.base === key.replace(/-tep$/, '')) || {}).label || key) + (/-tep$/.test(key) ? ' TE Premium' : '');
  // The list a league uses: its TE Premium list when it pays tight ends extra and one is saved, else its format's plain list.
  function seasonListFor(cfg) {
    if (!cfg) return null;
    const f = SCC.seasonFormat(cfg);
    if (f.tep && seasonEntry(f.key)) return {key: f.key, entry: seasonEntry(f.key)};
    return seasonEntry(f.base) ? {key: f.base, entry: seasonEntry(f.base)} : null;
  }
  // The leagues a slot's list serves (a TE Premium slot: the league's TE-premium leagues of that format).
  function seasonUsers(slot) {
    const tep = /-tep$/.test(slot), base = slot.replace(/-tep$/, '');
    return ((S.snap && S.snap.leagues) || []).map(d => d.cfg).filter(cfg => {
      const f = SCC.seasonFormat(cfg);
      return f.base === base && (tep ? f.tep : !f.tep || !seasonEntry(f.key));
    });
  }
  /* A league's season values in a market's scale, kept until the list or the market changes: 'fc' FantasyCalc's (the
     trade math for everyone, and what the owner sees), 'tv' Titan's own (what everyone else sees), 'tvpos' Titan's own
     ranked within each position (Position strength), 'proj' the season's projected points in the league's scoring (the
     Trade tab's rest-of-season points: your order, the projections' spacing). {byId, order, ...} (SCC.seasonValues) or null. */
  function seasonIn(cfg, scale) {
    const L = seasonListFor(cfg);
    if (!L) return null;
    let pool, sig;
    if (scale === 'fc') {
      const tk = tradeKey(SCC.tradeFormat(cfg)), V = S.trade.values[tk];
      if (!V || !V.idx) return null;
      V.pool = V.pool || Object.values(V.idx.bySleeper).filter(x => x.p !== 'PICK' && x.s).map(x => ({id: x.s, name: x.n, pos: x.p, v: x.v}));
      pool = V.pool;
      sig = `fc|${tk}|${V.at || 0}`;
    } else if (scale === 'proj') {
      const sp = S.trade.season && S.trade.season.map;
      if (!sp || !Object.keys(sp).length) return null;
      const players = playerList();
      pool = Object.keys(sp).map(id => { const i = SCC.playerInfo(players, id); return {id, name: i.name, pos: i.pos, v: SCC.projFor(sp, id, cfg) || 0}; }).filter(p => p.name);
      sig = `proj|${cfg.id}|${Object.keys(sp).length}`;
    } else {
      const T = titanValueMap(cfg);
      if (!T) return null;
      sig = `${scale}|${T.k}`;
      const players = playerList();
      pool = Object.keys(T.m).map(id => { const i = SCC.playerInfo(players, id); return {id, name: i.name, pos: i.pos, v: T.m[id]}; });
    }
    const key = `${L.key}|${L.entry.savedAt}|${sig}`;
    // Points are mapped within each position ('proj', like 'tvpos'): an overall curve would hand a back a quarterback's points.
    if (!S.seasonMemo[key]) S.seasonMemo[key] = SCC.seasonValues(L.entry.rows, pool, {byPosition: scale === 'tvpos' || scale === 'proj'});
    return S.seasonMemo[key];
  }
  // Where a player sits on the league's season list (his rank there, lower is better), by name and position; null if he isn't on it.
  function seasonRankOf(cfg, p) {
    const L = seasonListFor(cfg);
    if (!L || !p || !p.name) return null;
    const key = `rank|${L.key}|${L.entry.savedAt}`;
    if (!S.seasonMemo[key]) {
      const m = {};
      L.entry.rows.forEach(r => { const k = SCC.norm(r.name) + '|' + r.pos; if (m[k] === undefined && isFinite(Number(r.rank))) m[k] = Number(r.rank); });
      S.seasonMemo[key] = m;
    }
    const at = S.seasonMemo[key][SCC.norm(p.name) + '|' + p.pos];
    return at === undefined ? null : at;
  }
  /* Where the teams in a league are deep or thin (SCC.positionStrength), by this season's
     projections (Sleeper's, never FantasyCalc's): the Standings table and the Trade tab's
     partner card. Null until the projections are in. */
  function strengthOf(cfg, teams) {
    const sp = S.trade.season && S.trade.season.map;
    if (!sp || !Object.keys(sp).length || !teams || !teams.length) return null;
    // With season rankings for this kind of league, each player counts at his value by them (Titan's scale, within his position).
    const mine = seasonIn(cfg, 'tvpos');
    if (mine) {
      const tv = titanValueFor(cfg);
      return SCC.positionStrength(teams, cfg.lineup, p => (mine.byId[p.id] !== undefined ? mine.byId[p.id] : tv(p) || 0));
    }
    return SCC.positionStrength(teams, cfg.lineup, p => SCC.projFor(sp, p.id, cfg) || 0);
  }

  // Standings: every team's rank at each position, in the standings' order.
  function strengthTable(PS, R, mineId, cfg) {
    if (!PS) return S.trade.season && S.trade.season.busy ? '<div class="empty-note">Working out where each team is deep or thin…</div>' : '';
    if (!PS.positions.length) return '';
    const byId = {};
    PS.teams.forEach(t => { byId[t.id] = t.byPos; });
    return `<section class="card table-wrap pstrength"><div class="card-h"><div><h3>Position strength</h3>
        <p>Where each team is deep or thin: its rank among the ${PS.n} teams at each position</p></div></div>
      <table class="pstr"><thead><tr><th class="st-team">Team</th>${PS.positions.map(p => `<th>${pos(p)}</th>`).join('')}</tr></thead><tbody>${
        R.teams.map(t => `<tr class="${t.id === mineId ? 'mine' : ''}"><td class="st-team">${esc(t.name)}</td>${PS.positions.map(p => {
          const c = (byId[t.id] || {})[p] || {};
          return c.rank ? `<td class="ps g-${c.grade}">${nth(c.rank)}</td>` : '<td class="ps">–</td>';
        }).join('')}</tr>`).join('')}</tbody></table>
      <p class="fine">Each team's best lineup this season by ${seasonListFor(cfg) ? 'your season rankings (Rankings, Season import)' : 'Sleeper\'s projections'}, position by position, counting its best bench player a little.
        Green is well above the league's average at that position (deep), red well below (thin).${cfg.kind === 'Dynasty' ? ' This season only: it doesn\'t weigh age.' : ''}</p></section>`;
  }

  // The Trade tab, once a partner is picked: where they're thin and deep, where you are, and whether that fits.
  // In a dynasty or keeper league, the partner's stance from their playoff odds (stanceOf), and what to offer them.
  function stanceLine(d, partner) {
    const st = stanceOf(d);
    if (!st) return '';
    const s = st.map[String(partner.id)], o = st.odds[String(partner.id)];
    if (s === undefined) return '';
    return `<p class="tstance">${s === 'rebuilder' ? `<b>They're rebuilding</b> (${pct(o)} playoff odds): offer draft picks or young players for their veterans.`
      : s === 'contender' ? `<b>They're contending</b> (${pct(o)} playoff odds): they'll pay picks or youth for a starter now.`
      : `They're in the middle of the race (${pct(o)} playoff odds).`}</p>`;
  }

  function tradeFit(d, PS, me, partner) {
    const cell = (t, p) => ((PS.teams.find(x => x.id === String(t.id)) || {byPos: {}}).byPos[p]) || {};
    const at = (t, grade) => PS.positions.filter(p => cell(t, p).grade === grade);
    const list = (t, grade) => andList(at(t, grade).map(p => `${p} (${nth(cell(t, p).rank)})`));
    const line = (who, t, verb) => {
      const parts = [at(t, 'thin').length ? 'thin at ' + list(t, 'thin') : '', at(t, 'deep').length ? 'deep at ' + list(t, 'deep') : ''].filter(Boolean);
      return parts.length ? `${who} ${verb} ${parts.join(', and ')}.` : `${who} ${verb} in the middle of the league at every position.`;
    };
    const theyNeed = PS.positions.filter(p => cell(partner, p).grade === 'thin' && cell(me, p).grade === 'deep');
    const youNeed = PS.positions.filter(p => cell(me, p).grade === 'thin' && cell(partner, p).grade === 'deep');
    const fit = theyNeed.length || youNeed.length ? `<p class="tfit-good"><b>A good fit:</b> ${[theyNeed.length ? `they're thin at ${andList(theyNeed)}, where you're deep` : '',
      youNeed.length ? `you're thin at ${andList(youNeed)}, where they're deep` : ''].filter(Boolean).join('; ')}.</p>` : '';
    return `<section class="card pad tfit"><h3>Where you both stand</h3>
      <p>${line(`<b>${esc(partner.name)}</b>`, partner, 'is')} ${line('<b>You</b>', me, 'are')}</p>${fit}${stanceLine(d, partner)}
      <p class="fine">Ranked against the ${PS.n} teams in this league by each team's best lineup this season (Sleeper's projections),
        counting its best bench player a little. <button class="link" data-go="standings">See every team on Standings</button></p></section>`;
  }

  /* The Value report's rows for a league's format (Titan's owner only), by Sleeper id: the usage numbers behind the
     trade edge, each player's buy/sell/keep call and his momentum note. Loads the report the first time the Trade
     tab asks; null until it's in (or for anyone else). */
  function valueRowsFor(cfg) {
    if (DEMO || !S.owner.is) return null;
    const R = S.value.data;
    if (!R) { if (!S.value.at && !S.value.busy) loadValue(); return null; }
    S.value.rows = S.value.rows || {};
    if (S.value.rows[cfg.id] === undefined) {
      const L = (R.leagues || []).find(x => x.id === cfg.id), F = (R.formats || {})[L ? L.fmt : R.main], idx = {};
      ((F && F.all) || []).forEach(r => { idx[r.s] = r; });
      S.value.rows[cfg.id] = F ? idx : null;
    }
    return S.value.rows[cfg.id];
  }

  /* The usage edge on a player's market value: what the market would pay if it agreed with the Value report's usage
     numbers (SCC.impliedValue) minus what it pays. The owner's only (FantasyCalc's scale); null until both are in. */
  function edgeFor(cfg, V) {
    if (!V || !V.idx) return null;
    // Season rankings (anyone with a list for this kind of league): a player's value by them against his price.
    const mine = seasonIn(cfg, 'fc');
    if (mine) {
      const f = p => (mine.order[p.id] ? mine.byId[p.id] - ((SCC.playerValue(V.idx, p) || {}).v || 0) : 0);
      f.source = 'season';
      return f;
    }
    const rows = valueRowsFor(cfg);
    if (!rows || !fcShown()) return null;
    const f = p => {
      const r = rows[p.id], v = (SCC.playerValue(V.idx, p) || {}).v || 0;
      return r && v && r.vgap !== null && r.vgap !== undefined ? SCC.impliedValue(v, r.vgap) - v : 0;
    };
    f.source = 'value';
    return f;
  }

  /* The Value report's call on a trade row (owner): buy, keep or sell, and a momentum note pairing FantasyCalc's
     30-day trend with the usage: a rising price on touchdown-driven points is one to sell into; a falling price on a
     player whose usage ranks him above his price is one to buy. */
  function valueTag(row, x) {
    if (!row) return '';
    let h = row.buy ? '<span class="pill p-ok">buy</span>' : row.sell ? (row.keep ? '<span class="pill p-swap">keep</span>' : '<span class="pill p-stop">sell</span>') : '';
    const tr = Number(x && x.tr) || 0, tds = row.fpoe > 0 && row.td !== null && row.td !== undefined && 6 * row.td >= 0.5 * row.fpoe;
    if (tr > 0 && tds) h += '<span class="tmom">price rising on TDs</span>';
    else if (tr < 0 && row.ur && row.mr && row.ur < row.mr) h += '<span class="tmom">price falling, usage steady</span>';
    h += guidePill(row.dg); // the draft guide's take, with its thesis and what to watch on hover
    return h ? `<span class="ttags">${h}</span>` : '';
  }

  /* Projected points over a span of weeks (SCC.spanPoints: Sleeper's season projections in the league's scoring, byes
     out), for the Trade tab's rest of season and playoff weeks. `tilt(p)` scales a player's points. Null until the
     season projections are in. */
  const LAST_REG_WEEK = 17;
  /* The season's projected points the Trade tab works from: with your season rankings for this kind of league, each
     player you rank gets the points of the player the projections rank where you rank him (your order, the projections'
     spacing, within positions when your list is ranked that way; players off your list keep their projection), as a
     projection map spanPoints can read. Without a list, Sleeper's projections as they are. Null until they're in. */
  function seasonProjFor(cfg) {
    const sp = S.trade.season && S.trade.season.map;
    if (!sp || !Object.keys(sp).length) return null;
    const own = seasonIn(cfg, 'proj');
    if (!own) return sp;
    const L = seasonListFor(cfg), key = `projmap|${L.key}|${L.entry.savedAt}|${cfg.id}|${Object.keys(sp).length}`;
    if (!S.seasonMemo[key]) {
      const m = {};
      Object.keys(sp).forEach(id => { m[id] = [own.byId[id] !== undefined ? own.byId[id] : SCC.projFor(sp, id, cfg) || 0, 0]; });
      S.seasonMemo[key] = m;
    }
    return S.seasonMemo[key];
  }
  const pointsSource = cfg => (seasonIn(cfg, 'proj') ? 'season' : 'sleeper');
  // The same span by the public projections alone (what a trade partner sees), whatever your season list says.
  function spanForPublic(cfg, from, to) {
    const sp = S.trade.season && S.trade.season.map;
    if (!sp || !Object.keys(sp).length) return null;
    return p => SCC.spanPoints(sp, p.id, cfg, from + SCC.missWeeks(p.inj), to, SCC.byeOf(p.team));
  }
  function spanFor(cfg, from, to, tilt) {
    const sp = seasonProjFor(cfg);
    if (!sp) return null;
    // The map is already in this league's scoring (seasonProjFor), so it's read with a plain PPR of 0. A player's status
    // (out, IR...) pushes his first counted week back by the weeks it says he'll miss (SCC.missWeeks).
    return p => { const pts = SCC.spanPoints(sp, p.id, seasonIn(cfg, 'proj') ? 0 : cfg, from + SCC.missWeeks(p.inj), to, SCC.byeOf(p.team)); return tilt ? Math.round(pts * tilt(p) * 100) / 100 : pts; };
  }
  const playoffSpan = cfg => { const s = Number(cfg.playoffStart) || 15; return [s, Math.min(LAST_REG_WEEK, s + 2)]; };
  // The owner's Data dump ranks each player's fantasy-playoff schedule (1 the easiest of 32): a tilt of up to 10% either way.
  function playoffTilt() {
    if (DEMO || !S.owner.is) return null;
    const D = S.dump.data;
    if (!D) { if (!S.dump.at && !S.dump.busy) loadDump(); return null; }
    const po = {};
    (D.players || []).forEach(r => { if (r.s && r.po) po[r.s] = Number(r.po); });
    return p => (po[p.id] ? 1 + 0.1 * (16.5 - po[p.id]) / 15.5 : 1);
  }

  // The number beside a player on the Trade tab: FantasyCalc's for the owner, Titan's for everyone else ('' for none).
  function tradeDisplay(cfg, V) {
    const fc = fcShown(), tv = titanValueFor(cfg);
    const fcv = p => (V && V.idx ? (SCC.playerValue(V.idx, p) || {}).v : 0) || 0;
    // The person's own value (their season rankings) in the scale they see: FantasyCalc's for the owner, Titan's for everyone else.
    const mine = seasonIn(cfg, fc ? 'fc' : 'tv');
    const yours = p => (mine && p && p.pos !== 'PICK' && mine.order[p.id] ? mine.byId[p.id] : null);
    return {fc, tv, yours, season: !!mine, num: p => { const n = fc ? fcv(p) : tv(p); return n === null || (fc && !n) ? '' : thousands(n); }};
  }

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

  // `quiet`: loaded for "Who has him?", so on the Trade tab only its results redraw and the search box keeps its cursor.
  async function loadTradeTeams(d, quiet) {
    const id = d.cfg.id;
    S.trade.teams[id] = {busy: true};
    try {
      S.trade.teams[id] = {list: await API.leagueTeams(d.cfg, d.rosterId, S.snap.season)};
    } catch (e) {
      S.trade.teams[id] = {error: `Could not load the teams in ${d.cfg.key}: ${e && e.message ? e.message : e}.`};
    }
    const box = quiet && S.ui.tab === 'trade' && id !== S.trade.pick.league ? view.querySelector('#tsearch') : null;
    if (box) box.innerHTML = tradeSearchResults();
    else if (['trade', 'standings', 'lineups', 'rosters'].includes(S.ui.tab)) render(); // Lineups and Rosters: leagueAdvice
  }

  function screenTrade() {
    if (DEMO) return demoOnly('Trades', 'The Trade tab weighs trades with the other teams in your real leagues, using FantasyCalc\'s trade values.');
    if (!S.snap) return emptyState();
    const leagues = S.snap.leagues || [];
    if (!leagues.length) return '<div class="empty-note">No leagues to trade in yet.</div>';
    // One league at a time: the league dropdown's when it names one, else this screen's own pick.
    const d = leagues.find(x => x.cfg.id === (pickedLeague() !== 'all' ? pickedLeague() : S.ui.tradeLeague)) || leagues[0];
    const f = SCC.tradeFormat(d.cfg), k = tradeKey(f);
    if (!S.trade.values[k]) loadTradeValues(f);
    if (!S.trade.teams[d.cfg.id]) loadTradeTeams(d);
    if (!S.trade.season) loadSeasonProj(); // Titan's values, and where each team is deep or thin
    const V = S.trade.values[k], T = S.trade.teams[d.cfg.id];
    const teams = (T && T.list) || [], me = teams.find(t => t.mine);
    const partner = teams.find(t => !t.mine && t.id === S.ui.tradePartner) || null;
    const P = S.trade.pick;
    // A new league or partner starts the trade over. Not while the teams are (re)loading: with no team list yet the
    // partner can't be found, and a refresh (which reloads the teams) used to wipe a trade in progress that way.
    if (T && T.list && (P.league !== d.cfg.id || P.partner !== (partner ? partner.id : ''))) Object.assign(P, {league: d.cfg.id, partner: partner ? partner.id : '', give: [], get: []});

    // The league and partner pickers sit at the top and again above the trade itself (the give/get box and the rosters),
    // so a long page never means scrolling back up to switch; once a partner is picked, the partner picker heads
    // their roster card too. The league picker here mirrors the dropdown at the top when that names a league.
    const partnerOptions = `<option value="">Pick a team</option>${teams.filter(t => !t.mine).map(t =>
      `<option value="${esc(t.id)}"${t === partner ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}`;
    const leagueOptions = leagues.map(x => `<option value="${esc(x.cfg.id)}"${x === d ? ' selected' : ''}>${esc(x.cfg.key)}</option>`).join('');
    const canReset = !!(partner || P.give.length || P.get.length || S.trade.ideas[d.cfg.id] || S.trade.q);
    const pickBar = (where, extra) => `<div class="bar tpick tpick-${where}" data-league="${esc(d.cfg.id)}"${S.trade.pending ? ` data-pending="${esc(S.trade.pending.league)}"` : ''}>
        ${leagues.length > 1 ? `<label class="field"><span>League</span><select data-ui="tradeLeague">${leagueOptions}</select></label>` : ''}
        <label class="field"><span>Trade partner</span><select data-ui="tradePartner"${teams.length ? '' : ' disabled'}>${partnerOptions}</select></label>${extra || ''}
      </div>`;
    let h = `<p class="credit">${fcShown() ? 'Trade values' : 'Who wins is weighed with trade values'} by <a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a>${
      V && V.at ? `, updated ${esc(when(V.at))}` : ''}. Titan isn't affiliated with FantasyCalc.</p>
      ${pickBar('top', `<button type="button" class="btn ghost small treset" data-action="trade-reset"${canReset ? '' : ' disabled'}>Clear all</button>`)}
      ${seasonListFor(d.cfg) ? `<p class="fine tseason">Your ${esc(seasonLabel(seasonListFor(d.cfg).key))} season rankings set your own values here: "yours" beside a
        player you rank well apart from the market, and the edge on each trade. <button class="link" data-go="season">Season rankings</button></p>` : ''}
      <p class="fine">${fcShown() ? `Values for ${esc(formatName(f))}: what players like these go for in real trades.`
        : `Weighed for ${esc(formatName(f))}. The number beside each player is Titan's own value: his projected points for the rest of this season
          (byes out) above a replacement starter at his position, in this league's scoring, the flex spots shared out the way this league's teams
          fill them.`}</p>${!fcShown() && d.cfg.kind === 'Dynasty'
        // Titan's value is one season's projections: in a dynasty league that misses age and the years ahead, so say so.
        ? `<div class="banner swap tdyn"><b>Dynasty league:</b> the numbers beside players are this season's projections tilted by age (young players
          up, running backs from 27 and receivers from 30 down), a rough stand-in for the seasons ahead: a rookie's real dynasty worth can still be more.
          Who wins still comes from FantasyCalc's dynasty trade values.</div>` : ''}`;
    const retry = '<button class="link" data-action="trade-retry">Try again</button>';
    if (T && T.error) return h + `<div class="banner stop">${esc(T.error)} ${retry}</div>`;
    if (V && V.error) return h + `<div class="banner stop">${esc(V.error)} ${retry}</div>`;
    if (!T || T.busy || !V || V.busy) return h + '<div class="empty-note">Loading the teams and their trade values…</div>';
    if (!me) return h + `<div class="empty-note">Titan couldn't find your team in ${esc(d.cfg.key)}.</div>`;

    const val = p => SCC.playerValue(V.idx, p), worth = p => (val(p) || {}).v || 0, disp = tradeDisplay(d.cfg, V);
    // Players and, in dynasty leagues, draft picks.
    const assets = t => t.roster.concat(t.picks || []);
    // A trade sent in from outside (S.trade.pending, see the address handling at the top): once this league's teams are
    // here, the partner is the team holding the players you'd get, and both sides go into the builder.
    const pend = S.trade.pending;
    if (pend && pend.league === d.cfg.id) {
      S.trade.pending = null;
      const has = (t, id) => assets(t).some(p => String(p.id) === String(id));
      const other = teams.find(t => !t.mine && pend.get.some(id => has(t, id))) || (partner || null);
      if (other) {
        S.ui.tradePartner = other.id;
        Object.assign(P, {league: d.cfg.id, partner: other.id, give: pend.give.filter(id => has(me, id)), get: pend.get.filter(id => has(other, id))});
        saveUi();
        setTimeout(() => { render(); const sum = view.querySelector('.trade-sum'); if (sum) sum.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 0);
        return h + '<div class="empty-note">Setting up the trade…</div>';
      }
    }
    const give = P.give.map(id => assets(me).find(p => p.id === id)).filter(Boolean);
    const get = partner ? P.get.map(id => assets(partner).find(p => p.id === id)).filter(Boolean) : [];
    const PS = partner ? strengthOf(d.cfg, teams) : null;
    if (PS && PS.positions.length) h += tradeFit(d, PS, me, partner);
    h += `<section class="card pad tsearch"><label class="field"><span>Who has him? Search for a player in every league</span>
        <input type="search" data-trade-search placeholder="At least three letters" value="${esc(S.trade.q || '')}" autocomplete="off"
          autocapitalize="off" autocorrect="off" spellcheck="false"></label><div id="tsearch">${tradeSearchResults()}</div></section>`;
    h += tradeIdeasCard(d.cfg, disp) + draftCard(d.cfg);
    h += pickBar('trade'); // the same pickers again, right above the trade
    if (partner) h += tradeSummary(d.cfg, me, partner, give, get, worth, V.waiver, disp);
    // How both rosters sort: by value, by position, or by position then value (remembered).
    const sort = TRADE_SORTS.some(x => x[0] === S.ui.tradeSort) ? S.ui.tradeSort : 'value';
    h += `<div class="bar tsort"><span class="fine">Sort the rosters by</span><div class="chips" role="group" aria-label="Sort the rosters">${TRADE_SORTS.map(([k, label]) =>
      `<button type="button" class="chip" data-tsort="${k}" aria-pressed="${sort === k}">${label}</button>`).join('')}</div></div>`;
    return h + `<div class="trade-teams">${tradeRoster(d.cfg, me, 'give', val, disp)}${partner ? tradeRoster(d.cfg, partner, 'get', val, disp, `<select class="tp-select" data-ui="tradePartner">${partnerOptions}</select>`)
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
    // Where each partner is thin (so an idea that fills the hole ranks higher), the usage edge (owner) and rest-of-season points.
    const PS = strengthOf(d.cfg, Tm.list), thin = {}, deep = {};
    if (PS) PS.teams.forEach(t => {
      thin[t.id] = PS.positions.filter(p => (t.byPos[p] || {}).grade === 'thin');
      deep[t.id] = PS.positions.filter(p => (t.byPos[p] || {}).grade === 'deep');
    });
    const edge = edgeFor(d.cfg, V), points = spanFor(d.cfg, S.snap.week, LAST_REG_WEEK), stance = (stanceOf(d) || {}).map || {};
    // The goal is a starting lineup that scores more: with rest-of-season points in, ideas rank by the points they add to
    // your best lineup (a fair price is the constraint), and the partners whose rosters fit yours are listed first.
    const byName = {};
    Tm.list.forEach(t => { byName[String(t.id)] = t.name; });
    const partners = PS ? SCC.tradePartners(me.id, PS).map(x => Object.assign({name: byName[x.id] || 'A team'}, x)) : [];
    const weeks = Math.max(1, LAST_REG_WEEK - (S.snap.week || 1) + 1);
    // The partner's lineup is judged by the public projections (what they see); yours by your season rankings' points
    // (spanFor). An idea may not weaken a starting position you aren't deep at (guard, myDeep).
    const theirPoints = pointsSource(d.cfg) === 'season' ? spanForPublic(d.cfg, S.snap.week, LAST_REG_WEEK) : undefined;
    S.trade.ideas[d.cfg.id] = {list: SCC.tradeIdeas(me, Tm.list.filter(t => !t.mine), {value, slots: d.cfg.lineup, waiver: V.waiver, max: 8,
      edge: edge || undefined, points: points || undefined, theirPoints: theirPoints || undefined, thin, deep, stance, goal: points ? 'lineup' : undefined, weeks,
      guard: true, myDeep: deep[String(me.id)] || [], miss: p => SCC.missWeeks(p.inj),
      // Quarterbacks stay out of the ideas in a one-QB league: easy to fill, so a QB-for-QB swap isn't worth the roster churn.
      skipPos: SCC.tradeFormat(d.cfg).qbs === 1 ? ['QB'] : [],
      // This week's projections, so an idea says what it costs you now (an incoming player who's out this week).
      nowPoints: Object.keys(S.proj).length ? p => (p.inj && SCC.missWeeks(p.inj) ? 0 : SCC.projFor(S.proj, p.id, d.cfg) || 0) : undefined}), edge: !!edge,
      edgeSource: edge ? edge.source : '', points: !!points, pointsSource: points ? pointsSource(d.cfg) : '', stance: Object.keys(stance).length > 0, partners, weeks,
      noQb: SCC.tradeFormat(d.cfg).qbs === 1};
    render();
  }

  // Until asked (or after Clear), just a line with Find trades, so your own trade has the room.
  function tradeIdeasCard(cfg, disp) {
    const I = S.trade.ideas[cfg.id];
    if (!I) {
      return `<section class="card pad tideas min"><div class="tideas-h"><h3>Trade ideas</h3>
        <button type="button" class="btn small" data-action="trade-find">Find trades</button></div></section>`;
    }
    const head = `<div class="tideas-h"><h3>Trade ideas</h3><div class="tideas-b">
        <button type="button" class="btn small ghost" data-action="trade-ideas-clear">Clear</button>
        <button type="button" class="btn small ghost" data-action="trade-find">Look again</button></div></div>
      <p class="fine">${I.points
          ? `The goal is a starting lineup that scores more: fair trades (FantasyCalc's values within 5%) of one or two pieces each way that add rest-of-season points to your best lineup${
              I.pointsSource === 'season' ? ' (points by your season rankings: your order, the projections\' spacing; the other team\'s side is judged by the public projections, what they see)' : ''} and gain value by your own numbers, ranked by both (a 5% gain in value counts like a point a week). An idea never weakens a starting position you aren't deep at, and one that upgrades more than one of your positions by your numbers ranks higher: a package that reads as an even swap to them and two upgrades to you is the edge. A player's status counts: an out or IR player's points start after the weeks his status says he'll miss (out or doubtful a week, IR or PUP four, a suspension three), an idea says when a player it brings in is out, and one that costs you points this week ranks lower, so you keep winning while you improve. A two-for-one that turns your depth into a starter and adds a point a week or more counts even when it gives up a little value.`
          : 'Fair trades (FantasyCalc\'s values within 5%) of one or two pieces each way that make your starting lineup stronger by value, and theirs too where possible.'}${I.edgeSource === 'season'
          ? ' Your season rankings count on your side, so a swap of equally priced players you rank differently from the market is an idea.'
          : I.edge ? ' Your Value report\'s usage edge counts on your side, so a swap of equally priced players the market misjudges is an idea.' : ''}${I.stance
          ? ' Draft picks come in for teams that are rebuilding (their playoff odds), and from contenders when you are.' : ''}
        Ideas the other side is likelier to take (a hole of theirs filled, the best player theirs) come first.${I.noQb
          ? ' Quarterbacks stay out of the ideas here: this league starts one, and a quarterback is easy to find.' : ''}</p>`;
    // The partners whose rosters fit yours: thin where you're deep (what you can spare them), deep where you're thin (what you want).
    const partnersBlock = (I.partners || []).length ? `<div class="tpartners"><h4>Partners who fit</h4><ul>${I.partners.slice(0, 4).map(x => `<li><b>${esc(x.name)}</b>: ${[
        x.need.length ? `thin at ${x.need.join(' and ')}, where you're deep` : '', x.spare.length ? `deep at ${x.spare.join(' and ')}, where you're thin` : ''
      ].filter(Boolean).join('; ')}</li>`).join('')}</ul></div>` : '';
    if (!I.list.length) return `<section class="card pad tideas">${head}${partnersBlock}<p class="empty-note">No fair trade in this league ${I.points ? 'adds points to your starting lineup' : 'makes your starting lineup stronger'} right now.</p></section>`;
    const names = list => list.map(p => `${esc(p.name)}${disp.num(p) ? ` <small>${disp.num(p)}</small>` : ''}`).join(' + ');
    const change = n => `<span class="${n > 0 ? 'good' : n < 0 ? 'amber' : ''}">${(n > 0 ? '+' : n < 0 ? '−' : '') + thousands(Math.abs(n))}</span>`;
    const pts = n => `<span class="${n > 0 ? 'good' : n < 0 ? 'amber' : ''}">${n ? signed(n) : '±0'}</span>`;
    const weekly = n => (I.weeks ? ` (${signed(Math.round(n / I.weeks * 10) / 10)} a week)` : '');
    return `<section class="card pad tideas">${head}${partnersBlock}<ol class="idea-list">${I.list.map((x, i) => `<li class="idea">
        <div class="idea-t"><b>With ${esc(x.partner.name)}</b><span>You give ${names(x.give)} · you get ${names(x.get)}</span>
          <small>${I.points ? `Your lineup ${pts(x.myPts)} pts rest of season${weekly(x.myPts)}${x.myNow ? `, ${pts(x.myNow)} this week` : ''}, theirs ${pts(x.theirPts)} · value: your starters ${change(x.myGain)}, theirs ${change(x.theirGain)}`
            : `Your starters ${change(x.myGain)} · theirs ${change(x.theirGain)}`}${
            I.edge && disp.fc ? ` · ${I.edgeSource === 'season' ? 'season rankings edge' : 'usage edge'} ${change(x.edge)}` : ''}</small>${(x.why || []).length ? `<small class="iwhy">${x.why.map(esc).join(' · ')}</small>` : ''}</div>
        <button type="button" class="btn small ghost" data-idea="${i}">Open</button></li>`).join('')}</ol></section>`;
  }

  /* Who has him? Players whose name matches the search (at least three letters), and where each is in every
     league: the team that has him, yours, or a free agent. Each league's teams load for the search
     (loadTradeTeams, quietly: only these results redraw); until they have (or where they can't: Yahoo), a
     league says free or taken from the snapshot (takenNorm). Players someone in your leagues has come first,
     most valuable first. Tapping another team opens that trade: its league, that team, him on the get side. */
  function tradeSearchResults() {
    const q = SCC.norm(S.trade.q || '').trim(), leagues = (S.snap && S.snap.leagues) || [];
    if (q.length < 3 || !leagues.length) return '';
    leagues.forEach(d => { if (!S.trade.teams[d.cfg.id] && d.cfg.platform !== 'yahoo') loadTradeTeams(d, true); });
    const d0 = leagues.find(x => x.cfg.id === S.trade.pick.league) || leagues[0];
    const V = S.trade.values[tradeKey(SCC.tradeFormat(d0.cfg))];
    const worth = p => (V && V.idx ? (SCC.playerValue(V.idx, p) || {}).v : 0) || 0;
    const found = [], seen = new Set(), players = playerList();
    leagues.forEach(d => ((S.trade.teams[d.cfg.id] || {}).list || []).forEach(t => t.roster.forEach(p => {
      const n = SCC.norm(p.name);
      if (n.includes(q) && !seen.has(n)) { found.push({p, held: true}); seen.add(n); }
    })));
    for (const p of searchPlayers(players, q, 60)) {
      if (found.length >= 30) break;
      const n = SCC.norm(p.name);
      if (!seen.has(n)) { found.push({p, held: false}); seen.add(n); }
    }
    if (!found.length) return '<p class="fine">Nobody by that name in your leagues or on an NFL team.</p>';
    found.sort((a, b) => (b.held - a.held) || worth(b.p) - worth(a.p) || a.p.name.localeCompare(b.p.name));
    // Where he is in one league: {kind: 'mine' | 'taken' | 'free', team, r (his entry on that team), pending}.
    const where = (d, p) => {
      const n = SCC.norm(p.name), T = S.trade.teams[d.cfg.id], is = r => (p.id && r.id === p.id) || SCC.norm(r.name) === n;
      if (T && T.list) {
        for (const t of T.list) { const r = t.roster.find(is); if (r) return {kind: t.mine ? 'mine' : 'taken', team: t, r}; }
        return {kind: 'free'};
      }
      if (d.roster.some(is)) return {kind: 'mine'};
      return {kind: d.takenNorm && d.takenNorm[n] ? 'taken' : 'free', pending: !!(T && T.busy)};
    };
    const chip = (d, s) => s.team && s.kind === 'taken'
      ? `<button type="button" class="wst tfor" data-tsearch="${esc(d.cfg.id)}|${esc(s.team.id)}|${esc(s.r.id)}" title="Trade for him in ${esc(d.cfg.key)}">${
        esc(d.cfg.key)} · on ${esc(s.team.name)}</button>`
      : `<span class="wst${s.kind === 'taken' ? '' : ' ' + s.kind}">${esc(d.cfg.key)} · ${s.kind === 'free' ? 'free agent' : s.kind === 'mine' ? 'yours'
        : s.pending ? 'taken (finding who)' : 'taken'}</span>`;
    return `<p class="fine">Where each player is in every league. Tap a team to trade for him there.</p><ul class="wlist">${found.slice(0, 6).map(({p}) => {
      const st = leagues.map(d => ({d, s: where(d, p)})), free = st.filter(x => x.s.kind === 'free').length;
      return `<li class="wrow">${headshot(p, true)}<span class="who"><b${pcAttr(p)}>${esc(p.name)}</b>
        <small>${p.pos ? pos(p.pos) + ' ' : ''}${esc(p.team || '')} · free agent in ${free} of ${leagues.length}</small>
        <span class="wchips">${st.map(x => chip(x.d, x.s)).join('')}</span></span></li>`;
    }).join('')}</ul>`;
  }

  // A team's draft picks in a dynasty league: Sleeper says who owns which, ESPN doesn't.
  function tradePicks(cfg, team, which, val, picked, disp) {
    if (cfg.kind !== 'Dynasty') return '';
    if (!team.picks) return '<p class="fine tnote">ESPN doesn\'t share who owns which draft picks, so picks can\'t be added here.</p>';
    if (!team.picks.length) return '';
    return '<div class="rdiv">Draft picks</div>' + team.picks.map(p => {
      const x = val(p);
      return `<button type="button" class="trow" data-trade="${which}" data-pid="${esc(p.id)}" aria-pressed="${picked.includes(p.id)}">
        <span class="pphoto sm"><span class="hs tpick">R${p.round}</span></span><span class="who"><b>${esc(p.name)}</b><small>${
          p.via ? 'from ' + esc(p.via) : 'own pick'}</small></span><span class="tval">${disp.fc ? (x ? thousands(x.v) : '–') : ''}</span></button>`;
    }).join('');
  }

  // A player's own value by the person's season rankings, beside the market's, when the two are at least a tenth apart.
  function yoursTag(disp, p, market) {
    const y = disp.yours(p);
    if (y === null || Math.abs(y - market) < 0.1 * Math.max(y, market, 1)) return '';
    return `<small class="tyours ${y > market ? 'good' : 'amber'}" title="Your value, by your season rankings">yours ${thousands(y)}</small>`;
  }

  // One team's players, most valuable first, then its draft picks. Tapping one puts it in the trade, or takes it out.
  function tradeRoster(cfg, team, which, val, disp, partnerSel) {
    const picked = S.trade.pick[which], picks = tradePicks(cfg, team, which, val, picked, disp);
    // Value is whichever shows: FantasyCalc's for the owner, Titan's for everyone else.
    // Sorted by the person's own value where their season rankings give one.
    const order = r => { const y = disp.yours(r.p); return y !== null ? y : disp.fc ? (r.x || {}).v || 0 : r.t || 0; };
    const sort = TRADE_SORTS.some(x => x[0] === S.ui.tradeSort) ? S.ui.tradeSort : 'value';
    const byValue = (a, b) => order(b) - order(a), byName = (a, b) => a.p.name.localeCompare(b.p.name);
    const byPos = (a, b) => posOrder(a.p.pos) - posOrder(b.p.pos);
    const vrows = valueRowsFor(cfg) || {}; // the owner's Value report calls and momentum notes
    const rows = team.roster.map(p => ({p, x: val(p), t: disp.tv(p)}))
      .sort(sort === 'value' ? (a, b) => byValue(a, b) || byName(a, b)
        : sort === 'pos' ? (a, b) => byPos(a, b) || byName(a, b)
        : (a, b) => byPos(a, b) || byValue(a, b) || byName(a, b));
    // Grouped by position, each group gets a header.
    const head = (r, i) => sort !== 'value' && (i === 0 || rows[i - 1].p.pos !== r.p.pos) ? `<div class="rdiv">${esc(r.p.pos || 'Other')}</div>` : '';
    // The partner's card is headed by the partner picker, so another team is one tap from "Your team".
    const title = which === 'give' || !partnerSel ? `<h3>${esc(which === 'give' ? 'Your team' : team.name)}</h3>`
      : `<label class="tp-pick"><span class="sr-only">Trade partner</span>${partnerSel}</label>`;
    return `<section class="card tteam"><header class="card-h"><div>${title}
      <p>${which === 'give' ? esc(team.name) + ' · tap the players you\'d give' : 'Tap the players you\'d get'}</p></div></header>
      <div class="trows">${rows.map((r, i) => { const {p, x} = r; return `${head(r, i)}<button type="button" class="trow" data-trade="${which}" data-pid="${esc(p.id)}" aria-pressed="${picked.includes(p.id)}">
        ${headshot(p, true)}<span class="who"><b>${esc(p.name)}</b><small>${p.pos ? pos(p.pos) + ' ' : ''}${esc(p.team || '')}${
          disp.fc && x && x.pr ? ' · ' + esc(p.pos + x.pr) : ''}${p.inj ? ` · <span class="bad-text" title="${esc(SCC.missWeeks(p.inj) ? 'About ' + SCC.missWeeks(p.inj) + (SCC.missWeeks(p.inj) === 1 ? ' week' : ' weeks') + ' out by his status' : 'Questionable: playable')}">${esc(p.inj)}</span>` : ''}</small>${disp.fc ? valueTag(vrows[p.id], x) : ''}</span>
        <span class="tval">${disp.num(p) || '–'}${yoursTag(disp, p, disp.fc ? (x || {}).v || 0 : r.t || 0)}${disp.fc && x && x.tr ? `<small class="${x.tr > 0 ? 'good' : 'amber'}" title="Change over the last 30 days">${
          x.tr > 0 ? '▲' : '▼'} ${thousands(Math.abs(x.tr))}</small>` : ''}</span></button>`; }).join('')}${picks}</div></section>`;
  }

  /* Each team's best starting lineup before and after the trade: this week (Sleeper's weekly projections in the
     league's scoring), the rest of the regular season and the fantasy-playoff weeks (its season projections, byes
     out; for the owner the playoff weeks tilt up to 10% by each player's playoff schedule from the Data dump). A trade
     is a rest-of-season decision, so this week alone would mislead. Draft picks don't play. */
  function lineupImpact(cfg, me, partner, give, get) {
    if (!give.length || !get.length) return '';
    const po = playoffSpan(cfg), tilt = playoffTilt();
    const cols = [['This week', Object.keys(S.proj).length ? p => SCC.projFor(S.proj, p.id, cfg) || 0 : null],
      ['Rest of season', spanFor(cfg, S.snap.week, LAST_REG_WEEK)], [`Playoffs (weeks ${po[0]}-${po[1]})`, spanFor(cfg, po[0], po[1], tilt)]].filter(c => c[1]);
    if (!cols.length) return '';
    const cell = (team, out, inn, pts) => {
      const gone = new Set(out.map(p => p.id));
      const before = SCC.lineupPoints(team.roster, cfg.lineup, pts);
      const after = SCC.lineupPoints(team.roster.filter(p => !gone.has(p.id)).concat(inn), cfg.lineup, pts);
      const d = Math.round((after - before) * 10) / 10;
      return `<td><b>${fmt(before)}</b> → <b>${fmt(after)}</b> <span class="${d > 0 ? 'good' : d < 0 ? 'amber' : 'fine'}">${d ? signed(d) : '±0'}</span></td>`;
    };
    // A row per period, a column per team: three columns fit a phone.
    const row = c => `<tr><th scope="row">${esc(c[0])}</th>${cell(me, give, get, c[1])}${cell(partner, get, give, c[1])}</tr>`;
    return `<div class="tlineup"><table class="tl-t"><thead><tr><th scope="col"><span class="sr-only">Period</span></th><th scope="col">Your starters</th>
      <th scope="col">${esc(partner.name)}'s</th></tr></thead><tbody>${cols.map(row).join('')}</tbody></table>
      <p class="fine">Projected points for each team's best lineup, before and after the trade: this week, the rest of the regular season and the
        fantasy-playoff weeks (${pointsSource(cfg) === 'season' ? 'by your season rankings: each player you rank gets the points of the player the projections rank where you rank him'
          : 'season projections'}, byes out${tilt ? ', the playoff weeks tilted by each player\'s playoff schedule from your Data dump' : ''}).</p></div>`;
  }

  /* Bye cover after a trade: the weeks from now on where your roster couldn't fill a starting spot (SCC.byeNeeds, each
     player's bye from his team), before and after the trade. A week the trade opens is a warning; one it clears, good news. */
  function byeCheck(cfg, me, give, get) {
    if (!give.length || !get.length || !S.snap.week) return '';
    const withByes = roster => roster.filter(p => p.pos !== 'PICK').map(p => Object.assign({}, p, {bye: SCC.byeOf(p.team)}));
    const needs = roster => SCC.byeNeeds([{cfg, roster: withByes(roster)}], S.snap.week)[0].needs;
    const gone = new Set(give.map(p => p.id));
    const before = needs(me.roster), after = needs(me.roster.filter(p => !gone.has(p.id)).concat(get));
    const weeks = list => list.map(n => n.week);
    const opened = after.filter(n => !weeks(before).includes(n.week)), cleared = before.filter(n => !weeks(after).includes(n.week));
    if (!opened.length && !cleared.length) return '';
    const say = n => `week ${n.week} (no ${andList(n.need)}${n.off.length ? ': ' + n.off.join(', ') + ' off' : ''})`;
    return `<p class="tbye">${opened.length ? `<b class="amber">Bye check:</b> after this trade you couldn't fill a starting spot in ${andList(opened.map(say))}.` : ''}${
      cleared.length ? ` <b class="good">Bye check:</b> it clears ${andList(cleared.map(n => 'week ' + n.week))}, where you'd have had an empty spot.` : ''}</p>`;
  }

  /* The edge line under the verdict: what the numbers behind the market say. For the owner, the Value report's usage
     edge (SCC.impliedValue against FantasyCalc's price) summed over both sides; for everyone else, Titan's own values
     (projected points above a replacement starter), which never show FantasyCalc's numbers. */
  function edgeLine(cfg, give, get, R, disp) {
    if (!give.length || !get.length) return '';
    const V = S.trade.values[tradeKey(SCC.tradeFormat(cfg))], E = edgeFor(cfg, V);
    if (E && E.source === 'season') {
      // By the person's season rankings. The owner sees it in FantasyCalc's numbers; everyone else as a share of the trade, never those numbers.
      const e = Math.round(get.reduce((s, p) => s + E(p), 0) - give.reduce((s, p) => s + E(p), 0));
      const price = list => list.reduce((s, p) => s + ((SCC.playerValue(V.idx, p) || {}).v || 0), 0);
      const share = Math.round(Math.abs(e) / Math.max(price(give), price(get), 1) * 100);
      const size = disp.fc ? thousands(Math.abs(e)) : share + '%';
      return `<p class="tedge">${e > 0 && (disp.fc || share >= 1) ? `<b class="good">Season rankings edge +${size}.</b> By your season rankings you get more than you give${
          R.fair ? ': the market calls it fair, your rankings favor you.' : '.'}`
        : e < 0 && (disp.fc || share >= 1) ? `<b class="amber">Season rankings edge −${size}.</b> By your season rankings you give more than you get${
          R.fair ? ': the market calls it fair, your rankings favor them.' : '.'}`
        : 'Your season rankings see this trade about the way the market does.'}</p>`;
    }
    if (E) {
      const e = Math.round(get.reduce((s, p) => s + E(p), 0) - give.reduce((s, p) => s + E(p), 0));
      return `<p class="tedge">${e > 0 ? `<b class="good">Usage edge +${thousands(e)}.</b> By your Value report the players you get are worth more than their price, and the ones you give less: the market is paying you.`
        : e < 0 ? `<b class="amber">Usage edge −${thousands(-e)}.</b> By your Value report you'd give more usage than you get at these prices.`
        : 'No usage edge either way by your Value report.'}</p>`;
    }
    if (![...give, ...get].some(p => disp.tv(p) !== null)) return '';
    const t = list => list.reduce((s, p) => s + (disp.tv(p) || 0), 0), d = t(get) - t(give);
    return `<p class="tedge">By Titan's own values (projected points above a replacement starter for the rest of this season) ${d > 0 ? `you gain <b class="good">+${thousands(d)}</b>`
      : d < 0 ? `you give up <b class="amber">${thousands(-d)}</b>` : 'the sides are even'}${R.fair && d > 0 ? ': the market calls it fair, the projections favor you.'
      : R.fair && d < 0 ? ': the market calls it fair, the projections favor them.' : '.'}</p>`;
  }

  // The trade so far: both sides, the verdict, a balance bar, what would even it out, and the lineups.
  function tradeSummary(cfg, me, partner, give, get, worth, waiver, disp) {
    const items = list => list.map(p => ({v: worth(p), pick: p.pos === 'PICK'}));
    const R = SCC.tradeVerdict(items(give), items(get), waiver), any = give.length || get.length;
    const chips = (list, which) => list.length ? list.map(p => `<button type="button" class="chip tchip" data-trade="${which}" data-pid="${esc(p.id)}" title="Take out of the trade">${
      p.pos && p.pos !== 'PICK' ? pos(p.pos) + ' ' : ''}${esc(p.name)} <small>${disp.num(p) || '–'}</small> ✕</button>`).join('') : '<span class="fine">Nobody yet</span>';
    const total = (R.give.adj + R.get.adj) || 1, pg = Math.round(R.get.adj / total * 100);
    // A side's total, with the roster-spot value in it spelled out: FantasyCalc's numbers, so the owner's only.
    const tot = (s, whose) => {
      if (!disp.fc) return '';
      const n = waiver ? Math.round(s.spot / waiver) : 0;
      return `<p class="ttot">${thousands(s.adj)}${n ? `<small>includes ${thousands(s.spot)} for ${whose} open roster spot${n > 1 ? 's' : ''}</small>` : ''}</p>`;
    };
    // Each team's value change as a percent of everything it has (FantasyCalc's values, roster spots counted).
    const teamValue = t => t.roster.concat(t.picks || []).reduce((s, p) => s + worth(p), 0);
    const pct = (n, t) => { const v = teamValue(t), x = v ? n / v * 100 : 0; return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`; };
    const change = `Your team's value ${pct(R.diff, me)}, ${esc(partner.name)}'s ${pct(-R.diff, partner)}.`;
    let verdict;
    if (!any) verdict = 'Tap players below to build a trade: yours to give, theirs to get.';
    else if (!give.length || !get.length) verdict = `Add players from ${!give.length ? 'your team' : esc(partner.name)} too.`;
    else if (R.fair) verdict = `<b class="good">Fair trade.</b> The two sides are within 5% of each other.${disp.fc ? '' : ' ' + change}`;
    else if (R.winner === 'you') verdict = `<b class="good">You win this trade</b>${disp.fc ? ` by ${thousands(R.diff)}.` : '. ' + change}`;
    else verdict = `<b class="amber">${esc(partner.name)} wins this trade</b>${disp.fc ? ` by ${thousands(-R.diff)}.` : '. ' + change}`;
    let even = '';
    if (give.length && get.length && !R.fair) {
      // One more player from the side giving less, worth about R.even, would even it out.
      const from = R.winner === 'you' ? me : partner, to = R.winner === 'you' ? partner : me, which = R.winner === 'you' ? 'give' : 'get', taken = S.trade.pick[which];
      // The nearest in value, with a lean toward a position the side receiving him is thin at (Where you both stand).
      const PS = strengthOf(cfg, (S.trade.teams[cfg.id] || {}).list || []), toPS = PS && PS.teams.find(t => t.id === String(to.id));
      const holes = PS && toPS ? PS.positions.filter(p => (toPS.byPos[p] || {}).grade === 'thin') : [];
      const closeness = p => Math.abs(worth(p) - R.even) / Math.max(R.even, 1) - (holes.includes(p.pos) ? 0.35 : 0);
      const near = from.roster.filter(p => !taken.includes(p.id) && worth(p) > 0).sort((a, b) => closeness(a) - closeness(b)).slice(0, 3);
      even = `<p class="fine">To even it out, ${R.winner === 'you' ? 'you\'d add' : 'they\'d add'} a player${disp.fc ? ` worth about ${thousands(R.even)}` : ''}${near.length ? ', like:' : '.'}</p>${
        near.length ? `<div class="chips">${near.map(p => `<button type="button" class="chip" data-trade="${which}" data-pid="${esc(p.id)}">+ ${
          esc(p.name)}${disp.num(p) ? ` <small>${disp.num(p)}</small>` : ''}</button>`).join('')}</div>` : ''}`;
    }
    /* Neither Sleeper nor ESPN lets another app fill in a trade offer (Sleeper's API is
       read-only), so Titan copies the trade as text and opens your team on the site. */
    const names = list => list.map(p => p.name).join(' + ');
    const send = give.length && get.length && !cfg.demo ? `<div class="tsend"><a class="btn small" href="${esc(lineupUrl(cfg))}"${newTab(lineupUrl(cfg))}
        data-trade-copy="${esc(`Trade offer: my ${names(give)} for your ${names(get)}`)}">Copy and open ${siteName(cfg)} ↗</a>
      <span class="fine">${siteName(cfg)} doesn't let other apps fill in a trade, so Titan copies it for you. On ${siteName(cfg)},
        start a trade with ${esc(partner.name)}, add these players, and paste it as a note if you like.</span></div>` : '';
    return `<section class="card pad trade-sum">
      <div class="tsides">
        <div><h3>You give</h3><div class="chips">${chips(give, 'give')}</div>${tot(R.give, 'their')}</div>
        <div><h3>You get</h3><div class="chips">${chips(get, 'get')}</div>${tot(R.get, 'your')}</div>
      </div>
      ${any ? `<div class="winbar" title="Each side's share of the trade"><span class="wp me${pg <= 50 ? ' up' : ''}">${100 - pg}%</span>
        <span class="wbar"><i class="wopp" style="width:${100 - pg}%"></i><i class="wme" style="width:${pg}%"></i></span><span class="wp opp${pg >= 50 ? ' up' : ''}">${pg}%</span></div>` : ''}
      <p class="tverdict">${verdict}</p>${edgeLine(cfg, give, get, R, disp)}${even}${send}${lineupImpact(cfg, me, partner, give, get)}${byeCheck(cfg, me, give, get)}
      <p class="fine">${disp.fc ? `Values add up as they are, since FantasyCalc's values already count stars for more. In an uneven trade, the side getting fewer players also gets a waiver pickup's value (about the 300th-best player) for each roster spot it frees, as FantasyCalc's own calculator does.`
        : `Who wins, and each team's value change, come from FantasyCalc's trade values, counting a waiver pickup's value for each roster spot an uneven trade frees. The numbers beside players are Titan's own values.`}${
        any ? ' <button class="link" data-action="trade-clear">Clear the trade</button>' : ''}</p>
    </section>`;
  }

  /* ---- Draft results: "See the draft" on the Trade tab opens the league's draft this season in
     a pop-up (a <dialog> outside the screen, so redraws leave it alone). Every pick is weighed
     against its spot (SCC.draftGrades) by the value the Trade tab shows: FantasyCalc's for Titan's
     owner, Titan's own for everyone else. Team grades first (tap a team for its picks); Board
     shows the draft round by round. Back, the Android app's included, closes it. */
  const DRAFT_KIND = {snake: 'Snake draft', linear: 'Linear draft', auction: 'Auction'};
  // Where a pick went at its position against where he ranks there by value now: short on each pick's row, spelled out on the Board.
  const posSpots = (p, long) => p.keeper || !p.posTaken || p.pos === '?' ? ''
    : `${esc(p.pos)}${p.posTaken} taken, ${esc(p.pos)}${p.posNow}${long ? ' by value' : ''} now`;
  const draftCard = cfg => `<section class="card pad tdraft"><div class="tdraft-h"><div><h3>Draft results</h3>
      <p class="fine">How every team in ${esc(cfg.key)} drafted, pick by pick</p></div>
      <button type="button" class="btn small" data-action="draft-open">See the draft</button></div></section>`;

  async function loadDraftResults(d) {
    const id = d.cfg.id;
    S.draftRes[id] = {busy: true};
    paintDraftResults();
    try { S.draftRes[id] = {data: await API.leagueDraft(d.cfg, S.snap.season)}; }
    catch (e) { S.draftRes[id] = {error: `Could not load the draft in ${d.cfg.key}: ${e && e.message ? e.message : e}.`}; }
    paintDraftResults();
  }

  function draftDialog() {
    if (DLG) return DLG;
    DLG = document.createElement('dialog');
    DLG.className = 'dlg';
    DLG.setAttribute('aria-labelledby', 'dlg-title');
    document.body.appendChild(DLG);
    DLG.addEventListener('click', e => {
      if (e.target === DLG) return DLG.close(); // a tap outside the panel
      const t = e.target.closest('[data-dview],[data-action]');
      if (!t) return;
      if (t.dataset.dview) {
        S.ui.draftView = t.dataset.dview;
        saveUi();
        paintDraftResults();
        const b = DLG.querySelector('.dlg-body');
        if (b) b.scrollTop = 0;
      } else if (t.dataset.action === 'draft-close') DLG.close();
      else if (t.dataset.action === 'draft-retry') draftRetry();
    });
    // The teams opened stay open while the pop-up is, through redraws.
    DLG.addEventListener('toggle', e => {
      const x = e.target;
      if (!x.dataset || !x.dataset.dteam) return;
      if (x.open) dOpen.add(x.dataset.dteam);
      else dOpen.delete(x.dataset.dteam);
    }, true);
    // Closing takes back the history entry opening added, unless Back is what closed it.
    DLG.addEventListener('close', () => {
      if (!dlgBack && history.state && history.state.draft) history.back();
      dlgBack = false;
      if (dlgOpener && dlgOpener.isConnected) dlgOpener.focus();
    });
    return DLG;
  }

  function openDraftResults() {
    const d = ((S.snap && S.snap.leagues) || []).find(x => x.cfg.id === S.trade.pick.league);
    if (!d) return;
    draftDialog();
    if (S.draftFor !== d.cfg.id) dOpen.clear();
    S.draftFor = d.cfg.id;
    const R = S.draftRes[d.cfg.id];
    if (!R || R.error) loadDraftResults(d);
    else paintDraftResults();
    if (DLG.open) return;
    dlgOpener = document.activeElement;
    DLG.showModal();
    if (location.protocol !== 'file:') history.pushState(Object.assign({}, history.state, {draft: 1}), '', location.href);
  }

  // Try again: the draft, and the values it's graded by if they didn't load.
  function draftRetry() {
    const d = ((S.snap && S.snap.leagues) || []).find(x => x.cfg.id === S.draftFor);
    if (!d) return;
    const f = SCC.tradeFormat(d.cfg), V = S.trade.values[tradeKey(f)], sp = S.trade.season;
    if (V && V.error) loadTradeValues(f);
    if (sp && !sp.busy && !Object.keys(sp.map || {}).length) loadSeasonProj();
    const R = S.draftRes[d.cfg.id];
    if (!R || R.error) loadDraftResults(d);
    else paintDraftResults();
  }

  // Redrawn only when what it shows changes, so an open team and the scroll stay put.
  function paintDraftResults() {
    if (!DLG) return;
    const html = draftResultsHtml();
    if (html === dlgHtml) return;
    const old = DLG.querySelector('.dlg-body'), top = old ? old.scrollTop : 0;
    DLG.innerHTML = dlgHtml = html;
    const body = DLG.querySelector('.dlg-body');
    if (body) body.scrollTop = top;
  }

  function draftResultsHtml() {
    const d = ((S.snap && S.snap.leagues) || []).find(x => x.cfg.id === S.draftFor);
    const R = d ? S.draftRes[d.cfg.id] : null, D = R && R.data;
    const sub = D && D.picks.length ? [DRAFT_KIND[D.type], D.type === 'auction' ? plural(D.picks.length, 'player') : plural(D.rounds, 'round'),
      D.teams + ' teams'].join(', ') : '';
    const head = `<header class="dlg-h"><div class="dlg-t">${d ? leagueIcon(d.cfg) : ''}<div><h2 id="dlg-title">Draft results</h2>
        <p>${d ? esc(d.cfg.key) : ''}${sub ? ' · ' + esc(sub) : ''}</p></div></div>
      <button type="button" class="dlg-x" data-action="draft-close" aria-label="Close">✕</button></header>`;
    const body = inner => `${head}<div class="dlg-body">${inner}</div>`;
    const retry = '<button class="link" data-action="draft-retry">Try again</button>';
    if (!d) return body('<p class="empty-note">That league isn\'t loaded anymore.</p>');
    if (!R || R.busy) return body('<p class="empty-note">Loading the draft…</p>');
    if (R.error) return body(`<div class="banner stop">${esc(R.error)} ${retry}</div>`);
    if (!D || !D.picks.length) {
      return body(`<p class="empty-note">${D && D.status === 'pre_draft' ? esc(d.cfg.key) + ' hasn\'t drafted yet.' : 'Titan found no draft for ' + esc(d.cfg.key) + ' this season.'}</p>`);
    }
    const fc = fcShown(), V = S.trade.values[tradeKey(SCC.tradeFormat(d.cfg))], sp = S.trade.season;
    if (fc ? !V || V.busy : !sp || sp.busy) return body('<p class="empty-note">Working out what every player is worth…</p>');
    if (fc ? !V.idx : !Object.keys(sp.map || {}).length) {
      return body(`<div class="banner stop">Titan couldn't load ${fc ? 'the trade values' : 'this season\'s projections'}, so it can't grade the draft right now. ${retry}</div>`);
    }
    const base = fc ? p => (SCC.playerValue(V.idx, p) || {}).v || 0 : titanValueFor(d.cfg), mineD = seasonIn(d.cfg, fc ? 'fc' : 'tv');
    const G = SCC.draftGrades(D, mineD ? p => (mineD.order[p.id] ? mineD.byId[p.id] : base(p)) : base);
    const T = S.trade.teams[d.cfg.id], names = {};
    let mine = '';
    ((T && T.list) || []).forEach(t => { names[t.id] = t.name; if (t.mine) mine = t.id; });
    // Most players with no value this season (a dynasty rookie draft, by Titan's values) can't be graded fairly: the board shows ungraded.
    const plain = !fc && G.valued < G.graded / 2;
    const f = {
      mine, plain,
      name: id => names[id] || 'Team ' + id,
      label: p => D.type === 'auction' ? '$' + p.amount : p.round + '.' + String(p.pick).padStart(2, '0'),
      gain: n => plain ? '' : `<span class="${n > 0 ? 'good' : n < 0 ? 'amber' : 'fine'}">${n > 0 ? '+' : n < 0 ? '−' : '±'}${thousands(Math.abs(n))}</span>`
    };
    const view = plain || S.ui.draftView === 'board' ? 'board' : 'grades';
    let h = plain ? `<div class="banner swap">Not graded: most of these players aren't projected to start this season, and Titan's values count
        this season only. Here's the board.</div>`
      : `<div class="chips" role="group" aria-label="Show the draft as">${[['grades', 'Team grades'], ['board', 'Board']].map(([k, label]) =>
        `<button type="button" class="chip" data-dview="${k}" aria-pressed="${view === k}">${label}</button>`).join('')}</div>`;
    if (D.status === 'drafting') h += '<div class="banner swap">The draft is still going: these are the picks so far.</div>';
    h += view === 'board' ? draftBoard(G, D, f) : draftTeams(G, f);
    if (!plain) {
      h += `<p class="fine">Each pick is weighed against its spot: what that pick would get if this draft were held again today, with every player going
        in order of value${D.type === 'auction' ? ' (in an auction, the spots follow price)' : ''}. ${mineD
          ? 'Values follow your season rankings (Rankings, Season import), on the market\'s scale; players your list leaves out keep ' + (fc ? 'FantasyCalc\'s' : 'Titan\'s') + ' values. '
          : ''}${fc
          ? 'Values are FantasyCalc\'s trade values for this league\'s format.'
          : 'Values are Titan\'s own: a player\'s projected points this season above a replacement starter at his position, in this league\'s scoring.'}
        Grades compare each team with the rest of the league. Keepers aren't graded.</p>`;
    }
    if (!fc && !plain && d.cfg.kind === 'Dynasty') {
      h += `<div class="banner swap tdyn"><b>Dynasty league:</b> these values come from this season's projections only. They don't account for
        age or future seasons, so rookies and young players can look worth less than they are to a dynasty team.</div>`;
    }
    h += fc ? '<p class="credit">Values by <a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a>. Titan isn\'t affiliated with FantasyCalc.</p>'
      : '<p class="credit">Projections via Sleeper.</p>';
    return body(h);
  }

  // Team grades, best first, each opening to its picks.
  function draftTeams(G, f) {
    const line = (what, p) => p ? `${what}: ${esc(f.label(p))} ${esc(p.name)} ${f.gain(p.gain)}` : '';
    const row = p => `<li class="dpick${p.tag ? ' d-' + p.tag : ''}"><span class="dno">${esc(f.label(p))}</span>
      <span class="who"><b>${esc(p.name)}</b><small>${p.pos ? pos(p.pos) + ' ' : ''}${esc(p.nfl || '')}${posSpots(p) ? ' · ' + posSpots(p) : ''}</small></span>
      <span class="dval">${p.keeper ? '<small>keeper</small>' : `${f.gain(p.gain)}<small>value ${thousands(p.v)}</small>`}</span></li>`;
    return `<ol class="dgrades">${G.teams.map(t => `<li><details class="dteam${t.team === f.mine ? ' mine' : ''}" data-dteam="${esc(t.team)}"${dOpen.has(t.team) ? ' open' : ''}>
      <summary><span class="dgrade g-${t.grade[0].toLowerCase()}" title="Draft grade">${esc(t.grade)}</span>
        <span class="dsum"><b>${esc(f.name(t.team))}${t.team === f.mine ? ' <small>(you)</small>' : ''}</b>
          <small>${[line('Best pick', t.best), line('Biggest reach', t.worst)].filter(Boolean).join(' · ') || 'Every pick went about where it should'}</small></span>
        <span class="dval">${f.gain(t.total)}<small>vs. its spots</small></span></summary>
      <ul class="dpicks">${t.picks.map(row).join('')}</ul></details></li>`).join('')}</ol>`;
  }

  // The draft round by round, a column for each draft slot (an auction: every player by price).
  function draftBoard(G, D, f) {
    if (D.type === 'auction') {
      return `<ul class="card dpicks">${G.picks.slice().sort((a, b) => b.amount - a.amount || a.no - b.no).map(p => `<li class="dpick${p.tag ? ' d-' + p.tag : ''}">
        <span class="dno">${esc(f.label(p))}</span><span class="who"><b>${esc(p.name)}</b><small>${p.pos ? pos(p.pos) + ' ' : ''}${esc(f.name(p.team))}</small></span>
        <span class="dval">${p.keeper ? '<small>keeper</small>' : f.gain(p.gain)}</span></li>`).join('')}</ul>`;
    }
    const at = {}, owner = {}, slots = [], rounds = [];
    G.picks.forEach(p => { at[p.round + '|' + p.slot] = p; if (p.round === 1) owner[p.slot] = p.team; });
    for (let s = 1; s <= D.teams; s++) slots.push(s);
    for (let r = 1; r <= D.rounds; r++) rounds.push(r);
    const cell = (r, s) => {
      const p = at[r + '|' + s];
      if (!p) return '<td></td>';
      // A traded pick says which team made it.
      const by = owner[s] && p.team !== owner[s] ? ` · ${esc(f.name(p.team))}` : '';
      return `<td class="${[p.tag && !f.plain ? 'd-' + p.tag : '', p.team === f.mine ? 'mine' : ''].filter(Boolean).join(' ')}"${
        f.plain || !posSpots(p) ? '' : ` title="${posSpots(p, true)}"`}><span class="dc-h">${pos(p.pos)}<small>${esc(f.label(p))}</small></span>
        <b>${esc(shortName(p))}</b><small>${p.keeper ? 'keeper' : f.gain(p.gain)}${by}</small></td>`;
    };
    return `<div class="table-wrap dboard-wrap"><table class="dboard"><thead><tr><th class="drd" scope="col">Rd</th>${slots.map(s =>
        `<th scope="col"${owner[s] && owner[s] === f.mine ? ' class="mine"' : ''} title="${esc(owner[s] ? f.name(owner[s]) : '')}">${esc(owner[s] ? f.name(owner[s]) : 'Slot ' + s)}</th>`).join('')}</tr></thead>
      <tbody>${rounds.map(r => `<tr><th class="drd" scope="row">${r}</th>${slots.map(s => cell(r, s)).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="fine">${f.plain ? '' : 'Green picks beat their spot the most, amber ones fell furthest short. '}Scroll sideways to see every team.</p>`;
  }

  const SCREENS = {
    lineups: screenLineups, matchup: screenMatchup, standings: screenStandings, waivers: screenWaivers, news: screenNews, rosters: screenRosters, exposure: screenExposure, byes: screenByes,
    sos: screenSos, score: screenScore, ranks: screenRanks, season: screenSeason, multi: screenMulti, lab: screenLab, value: () => `<div class="vr-page">${screenValue()}</div>`,
    dump: () => `<div class="vr-page">${screenDump()}</div>`, trade: screenTrade, moves: screenMoves, settings: screenSettings
  };

  /* ------------------------------------------------------------- events */

  function go(tab, fromHistory) {
    if (!TABS.includes(tab)) return;
    S.ui.tab = tab;
    const sec = sectionOf(tab);
    if (sec && sec.tabs.length > 1) S.ui.last = Object.assign({}, S.ui.last, {[sec.id]: tab});
    saveUi();
    if (!fromHistory) syncUrl(true);
    render();
    window.scrollTo(0, 0);
    // A Results failure isn't for good: after a minute, coming back to the screen tries again.
    if (tab === 'score' && S.score.error && !S.score.data && Date.now() - (S.score.errorAt || 0) > 60000) S.score.error = '';
    if (tab === 'score' && S.snap && !S.score.data && !S.score.busy && !S.score.error) loadScore(S.score.week || S.snap.week, !S.score.week);
    if (tab === 'matchup' && S.snap && (!S.match.data || S.match.week !== S.snap.week)) loadMatchups();
  }

  // Back and Forward move between screens, as on any website.
  /* Find a player (the magnifier in the header, any screen): a dialog with a search over every NFL player
     (searchPlayers), each with where he is in your leagues; a name opens his card on top. Back closes it. */
  let PS = null, psBack = false, psOpener = null;
  function searchDialog() {
    if (PS) return PS;
    PS = document.createElement('dialog');
    PS.className = 'dlg psearch';
    PS.setAttribute('aria-labelledby', 'ps-title');
    document.body.appendChild(PS);
    PS.addEventListener('close', () => {
      if (!psBack && history.state && history.state.psearch) history.back();
      psBack = false;
      if (psOpener && psOpener.isConnected) psOpener.focus();
    });
    PS.addEventListener('input', e => {
      if (!e.target.matches('[data-psearch]')) return;
      S.ui.psq = e.target.value;
      const box = PS.querySelector('#ps-results');
      if (box) box.innerHTML = searchResults();
    });
    PS.addEventListener('click', e => {
      if (e.target.closest('[data-action="psearch-close"]')) { PS.close(); return; }
      const t = e.target.closest('[data-pcard]');
      if (t) openPlayerCard(t.dataset.pcard);
    });
    return PS;
  }
  function openSearch() {
    if (!S.snap) return;
    const d = searchDialog();
    d.innerHTML = `<header class="dlg-h"><div class="dlg-t"><div><h2 id="ps-title">Find a player</h2><p>Any NFL player: where he is in every league</p></div></div>
      <button type="button" class="dlg-x" data-action="psearch-close" aria-label="Close">✕</button></header>
      <div class="dlg-body"><label class="field"><span class="sr-only">Player name</span><input type="search" data-psearch placeholder="At least three letters"
        value="${esc(S.ui.psq || '')}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label><div id="ps-results">${searchResults()}</div></div>`;
    if (d.open) return;
    psOpener = document.activeElement;
    d.showModal();
    if (location.protocol !== 'file:') history.pushState(Object.assign({}, history.state, {psearch: 1}), '', location.href);
    const box = d.querySelector('[data-psearch]');
    if (box) box.focus();
  }
  function searchResults() {
    const q = SCC.norm(S.ui.psq || '').trim();
    if (q.length < 3) return '<p class="fine">Type three letters or more.</p>';
    const found = searchPlayers(playerList(), q, 12), leagues = (S.A && S.A.leagues) || [];
    if (!found.length) return '<p class="fine">Nobody by that name on an NFL team.</p>';
    return `<ul class="wlist">${found.map(p => `<li class="wrow">${headshot(p, true)}<span class="who"><b${pcAttr(p)}>${esc(p.name)}</b>
      <small>${p.pos ? pos(p.pos) + ' ' : ''}${esc(p.team || '')}${p.pos && p.pos !== 'DEF' ? ' · tap for his card' : ''}</small>${leagues.length
        ? `<span class="wchips">${leagues.map(L => { const s = wStatus(L, p); return `<span class="wst ${s}">${esc(L.cfg.key)} · ${s === 'mine' ? 'yours' : s === 'taken' ? 'taken' : 'free'}</span>`; }).join('')}</span>` : ''}</span></li>`).join('')}</ul>`;
  }
  $('psearch-btn').addEventListener('click', openSearch);

  window.addEventListener('popstate', () => {
    // Back with a player's card, the search or the draft results open closes them and stays on the screen.
    if (PC && PC.open) { pcBack = true; PC.close(); return; }
    if (PS && PS.open) { psBack = true; PS.close(); return; }
    if (DLG && DLG.open) { dlgBack = true; DLG.close(); return; }
    const t = tabFromPath();
    if (t && t !== S.ui.tab) go(t, true);
  });

  $('tabs').addEventListener('click', e => {
    const s = e.target.closest('[data-section]'), b = e.target.closest('[data-tab]');
    // A mouse click on a dropdown's screen closes the dropdown, which stays open while it holds focus.
    if (e.detail && document.activeElement && document.activeElement.closest('.sec-menu')) document.activeElement.blur();
    if (s) goSection(s.dataset.section);
    else if (b) go(b.dataset.tab);
  });
  $('gear').addEventListener('click', () => go('settings'));
  $('refresh').addEventListener('click', refresh);

  view.addEventListener('submit', e => {
    const form = e.target.dataset.form, el = e.target.elements;
    if (!form) return;
    e.preventDefault();
    if (form === 'link') linkAccount(el.username.value);
    else if (form === 'espn-add') addEspn(el.league.value);
    else if (form === 'espn-login') saveEspnLogin(el.s2.value, el.swid.value);
  });

  // Copy (a league's lineup changes as text): to the clipboard, with a word either way.
  view.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const done = ok => toast(ok ? 'Copied. Paste it wherever you set your lineup.' : 'Titan couldn\'t copy on this device.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b.dataset.copy).then(() => done(true), () => done(false));
    else done(false);
  });
  // The Season screen's format and TE Premium chips.
  view.addEventListener('click', e => {
    const c = e.target.closest('[data-sfmt],[data-step]');
    if (!c) return;
    if (c.dataset.sfmt) S.sdraft.base = c.dataset.sfmt;
    if (c.dataset.step) S.sdraft.tep = c.dataset.step === '1';
    Object.assign(S.sdraft, {text: '', file: '', parsed: null});
    S.sview = '';
    render();
  });
  view.addEventListener('click', e => {
    const c = e.target.closest('[data-sos-pos]');
    if (c) { S.ui.sosPos = c.dataset.sosPos; saveUi(); render(); }
    // The playoff odds overview: a league's row opens its full standings below.
    const st = e.target.closest('[data-stand]');
    if (st) { S.ui.standLeague = st.dataset.stand; saveUi(); render(); const at = view.querySelector('.stand'); if (at) at.scrollIntoView({behavior: 'smooth', block: 'start'}); }
  });

  // Copy and open: the link opens the site as usual while the trade goes to the clipboard.
  view.addEventListener('click', e => {
    const a = e.target.closest('[data-trade-copy]');
    if (!a) return;
    const done = ok => toast(ok ? 'Trade copied. Start the trade on ' + a.textContent.replace(/^Copy and open | ↗$/g, '') + ', then paste it as a note if you like.'
      : 'Opened the site. Titan couldn\'t copy the trade on this device.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(a.dataset.tradeCopy).then(() => done(true), () => done(false));
    else done(false);
  });

  view.addEventListener('click', e => {
    // A tap on a league's header folds or unfolds it; the toggle listener remembers it.
    const head = e.target.closest('details[data-fold] > summary');
    if (head) { tapped = head.parentElement; return; }
    const t = e.target.closest('[data-go],[data-filter],[data-mfilter],[data-sweek],[data-tsort],[data-view-pos],[data-link-tab],[data-jump],[data-trade],[data-news],[data-idea],[data-moves],[data-tsearch],[data-action]');
    if (!t) return;
    if (t.dataset.go) {
      // "Import week N": the import opens on that week (a later week planned on Lineups, say).
      if (t.dataset.rweek) S.draft.week = Number(t.dataset.rweek) || S.draft.week;
      return go(t.dataset.go);
    }
    if (t.dataset.sweek) {
      const w = Number(t.dataset.sweek);
      if (w >= 1 && S.snap && w <= S.snap.week) loadScore(w);
      return;
    }
    if (t.dataset.tsearch) {
      // A searched-for player goes into the trade: his league and team, he goes on the get side.
      const [lg, team, pid] = t.dataset.tsearch.split('|'), P = S.trade.pick;
      if (lg !== P.league) {
        // Another league: the Trade tab moves there (the league dropdown too, when it names one).
        S.ui.tradeLeague = lg;
        if (pickedLeague() !== 'all') S.ui.league = lg;
        Object.assign(P, {league: lg, partner: team, give: [], get: []});
      }
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
    if (t.dataset.mfilter) { S.ui.matchFilter = t.dataset.mfilter; saveUi(); return render(); }
    if (t.dataset.tsort) { S.ui.tradeSort = t.dataset.tsort; saveUi(); return render(); }
    if (t.dataset.viewPos) { S.view.pos = t.dataset.viewPos; return render(); }
    const a = t.dataset.action;
    if (a === 'score') loadScore(S.score.week || S.snap.week);
    else if (a === 'ranks-view') viewRanks(Number(t.dataset.week));
    else if (a === 'matchups') loadMatchups();
    else if (a === 'news-retry') { S.news.error = ''; loadNews(); }
    else if (a === 'sos-retry') { S.sos.error = ''; loadSos(); render(); }
    else if (a === 'stand-retry') {
      [S.stand, S.trade.teams].forEach(m => Object.keys(m).forEach(k => { if (m[k].error) delete m[k]; }));
      render();
    }
    else if (a === 'trade-find') findTrades();
    else if (a === 'trade-ideas-clear') { delete S.trade.ideas[S.trade.pick.league]; render(); }
    else if (a === 'trade-clear') { S.trade.pick.give = []; S.trade.pick.get = []; render(); }
    else if (a === 'trade-reset') {
      // Clear all: both sides, the partner, the trade ideas and the player search, for a fresh start.
      delete S.trade.ideas[S.trade.pick.league];
      Object.assign(S.trade.pick, {give: [], get: [], partner: ''});
      S.trade.q = '';
      S.ui.tradePartner = '';
      saveUi();
      render();
    }
    else if (a === 'trade-retry') {
      [S.trade.teams, S.trade.values].forEach(m => Object.keys(m).forEach(k => { if (m[k].error) delete m[k]; }));
      render();
    }
    else if (a === 'draft-open') openDraftResults();
    else if (a === 'fold-all' || a === 'fold-none') foldAll(t.dataset.kind, a === 'fold-all');
    else if (a === 'espn-start') startEspnOnly();
    else if (a === 'espn-team') pickEspnTeam(t.dataset.team);
    else if (a === 'espn-cancel') { S.espn.pick = null; render(); }
    else if (a === 'espn-remove') removeEspn(t.dataset.id);
    else if (a === 'espn-login-del') deleteEspnLogin();
    else if (a === 'yahoo-link') yahooSignIn();
    else if (a === 'yahoo-unlink') yahooForget();
    else if (a === 'yahoo-refresh') { Object.assign(S.yahoo, {data: null, error: '', note: ''}); render(); }
    else if (a === 'season-save') saveSeason();
    else if (a === 'season-del') deleteSeason(t.dataset.key);
    else if (a === 'season-view') { S.sview = S.sview === t.dataset.key ? '' : t.dataset.key; render(); }
    else if (a === 'ranks-save') saveRanks();
    else if (a === 'ranks-del') deleteRanks(Number(t.dataset.week));
    else if (a === 'lab-run') { S.labAt = 0; loadLab(); render(); }
    else if (a === 'value-reload') { S.value.at = 0; loadValue(); render(); }
    else if (a === 'dump-reload') { S.dump.at = 0; loadDump(); render(); }
    else if (a === 'multi-add') multiAdd();
    else if (a === 'multi-save') multiSave();
    else if (a === 'multi-remove') {
      const gone = S.multi.sources.splice(Number(t.dataset.i), 1)[0];
      if (gone && S.mdraft.into === gone.name) S.mdraft.into = '';
      S.multi.dirty = true;
      saveMulti();
      render();
    }
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

  // A player's name opens his card, from any screen (a tap, or Enter or Space on the keyboard).
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-pcard]');
    if (t && !t.closest('dialog')) openPlayerCard(t.dataset.pcard);
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.pcard && !e.target.closest('dialog')) {
      e.preventDefault();
      openPlayerCard(e.target.dataset.pcard);
    }
  });

  // The value report's format chips switch its lists (a redraw); its position chips filter the players table in place
  // (no redraw, so open leagues stay open).
  view.addEventListener('click', e => {
    const fb = e.target.closest('[data-vfmt]');
    if (fb) { S.ui.valueFmt = fb.dataset.vfmt; saveUi(); render(); return; }
    const t = e.target.closest('[data-vpos]');
    if (!t) return;
    S.ui.valuePos = t.dataset.vpos;
    saveUi();
    view.querySelectorAll('[data-vpos]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
    applyValueFilter();
  });

  // The waiver plan's Done check on each claim.
  view.addEventListener('click', e => {
    const t = e.target.closest('[data-wdone]');
    if (!t) return;
    const P = wPlan(), k = t.dataset.wdone;
    if (P.done[k]) delete P.done[k];
    else P.done[k] = 1;
    saveUi();
    render();
  });

  view.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.wdrop) { wPlan().drop[t.dataset.wdrop] = t.value; saveUi(); return; }
    if (t.dataset.ui === 'league') { S.ui.league = t.value; saveUi(); render(); }
    else if (t.dataset.ui === 'tradePartner') { S.ui.tradePartner = t.value; saveUi(); render(); }
    else if (t.dataset.ui === 'tradeLeague') {
      // The Trade tab's own league picker: the screen's pick, and the dropdown at the top too when that names a league.
      S.ui.tradeLeague = t.value;
      if (pickedLeague() !== 'all') S.ui.league = t.value;
      S.ui.tradePartner = '';
      saveUi(); render();
    }
    else if (t.dataset.ui === 'lineWeek') { S.look.week = Number(t.value) || 0; S.look.error = ''; render(); }
    else if (t.dataset.alert) {
      if (S.alerts) S.alerts.prefs[t.dataset.alert] = t.checked;
      if (S.sync.api && S.sync.user) S.sync.api.alertPrefs(alertPrefs()).catch(() => toast('Could not save that choice. Try again.'));
    }
    else if (t.dataset.draft === 'pos') { S.draft.pos = t.value; S.draft.parsed = parseDraft(); paintDraft(); }
    else if (t.dataset.multi === 'week') {
      const n = parseInt(t.value, 10), M = S.multi;
      if (!(n >= 1 && n <= 18) || n === M.week) return;
      if (M.dirty && M.sources.length && !confirm(`Switch to week ${n}? The sources you added for week ${M.week} haven't been saved.`)) { t.value = M.week; return; }
      multiWeek(n);
      render();
    }
    else if (t.dataset.multi === 'defaults') { S.multi.defaults = t.checked; S.multi.dirty = true; saveMulti(); render(); }
    else if (t.dataset.multi === 'into') { S.mdraft.into = t.value; render(); }
    else if (t.dataset.multi === 'pos') { S.mdraft.pos = t.value; S.mdraft.parsed = parseMdraft(); paintMulti(); }
    else if (t.dataset.mweight !== undefined) {
      const s = S.multi.sources[Number(t.dataset.mweight)];
      if (!s) return;
      s.weight = Number(t.value) || 1;
      S.ui.multiWeights = Object.assign({}, S.ui.multiWeights, {[s.name.toLowerCase()]: s.weight});
      saveUi();
      S.multi.dirty = true;
      saveMulti();
      render();
    }
    else if (t.dataset.multi === 'file' && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then(txt => {
        Object.assign(S.mdraft, {text: txt, file: f.name, pos: SCC.positionHint(f.name)});
        S.mdraft.parsed = parseMdraft();
        render();
      });
    }
    else if (t.dataset.sdraft === 'file' && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then(txt => {
        Object.assign(S.sdraft, {text: txt, file: f.name, parsed: parseSeason(txt)});
        const ta = view.querySelector('textarea[data-sdraft="text"]');
        if (ta) ta.value = txt;
        paintSeasonDraft();
      });
    }
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

  // The season chart's columns show their week on hover and on keyboard focus.
  view.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
  view.addEventListener('pointerout', e => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  view.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
  view.addEventListener('focusout', hideTip);

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
    } else if ('valueSearch' in t.dataset) {
      S.value.q = t.value;
      applyValueFilter();
    } else if ('rosterSearch' in t.dataset) {
      S.rosterQuery = t.value;
      applyRosterSearch();
    } else if (t.dataset.sdraft === 'text') {
      Object.assign(S.sdraft, {text: t.value, file: '', parsed: parseSeason(t.value)});
      paintSeasonDraft();
    } else if (t.dataset.draft === 'text') {
      S.draft.text = t.value;
      S.draft.file = '';
      S.draft.parsed = parseDraft();
      paintDraft();
    } else if (t.dataset.draft === 'week') {
      const n = parseInt(t.value, 10);
      if (n >= 1 && n <= 18) { S.draft.week = n; paintDraft(); }
    } else if (t.dataset.multi === 'text') {
      S.mdraft.text = t.value;
      S.mdraft.file = '';
      S.mdraft.parsed = parseMdraft();
      paintMulti();
    } else if (t.dataset.multi === 'name') {
      // Only the preview redraws, so the box keeps its cursor.
      S.mdraft.name = t.value;
      paintMulti();
    }
  });

  /* Coming back to the app on game day should never show stale lineups. After a few minutes away, the cheap
     update (the game clock and points, one read per league) is enough; a full refresh (rosters, injuries and one
     read per rostered player) waits for half an hour, a failed cheap update, or the Refresh button. */
  const FULL_STALE = 30 * 60 * 1000;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (S.account && S.snap && !S.busy) {
      const age = Date.now() - (S.snap.at || 0);
      if (age > FULL_STALE || DEMO) { if (age > STALE_MS) refresh(); }
      else if (age > STALE_MS) {
        try { await API.livePoints(S.snap, true); saveSnap(); analyze(); render(); scheduleLive(); }
        catch (e) { refresh(); }
      }
    }
    if (!DEMO && Date.now() - ((S.scores && S.scores.at) || 0) > SCORES_LIVE) loadScores();
  });
  if (!DEMO) loadScores();

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
  tipJar();
  analyze();
  render();
  // A snapshot saved by an older version lacks what live scores and kickoff times need, so it's refreshed.
  if (S.account && (!S.snap || Date.now() - S.snap.at > STALE_MS || (S.snap.v || 0) < 4)) refresh();
  else { loadProj(); scheduleLive(); }
  // Opened straight onto Results (its address, or the last screen used): score the week, as switching to it does.
  if (S.account && S.snap && S.ui.tab === 'score' && !S.score.busy && !S.score.data) loadScore(S.snap.week, true);
})();
