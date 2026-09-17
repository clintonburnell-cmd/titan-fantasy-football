// Titan for Sleeper, the service worker: holds the extension's own Firebase session (handed over from Titan's site by
// ext/connect.html), reads the owner's reports (Firestore lab/value-latest and lab/dump-latest, owner-only by the
// rules) over REST into chrome.storage.local for the content script, fetches a league's waiver-budget facts from
// Sleeper's public API for the bids, and runs Titan's own lineup engine on the owner's Sleeper leagues under his
// synced weekly rankings (users/{uid}/ranks), the way Titan's server job does. Nothing here writes to Sleeper.
importScripts('dist/firebase.js', 'engine.js', 'sleeper.js');
const {initializeApp, getAuth, signInWithCredential, signOut, onAuthStateChanged, GoogleAuthProvider} = FB;

const SITE = 'https://titanfantasyfootball.com';
const PROJECT = 'titan-fantasy-football';
const SLEEPER = 'https://api.sleeper.app';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const REFRESH_HOURS = 6;          // the reports
const LINEUP_MINUTES = 20;        // the lineup analysis: rosters, injuries and rankings move through the week
const PROJ_POS = '&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF';
// Web app identifiers from the Firebase console: public by design (the rules decide who reads what).
const CONFIG = {
  apiKey: 'AIzaSyDjOaXVvwa9JxSjrLe3Ihnmlbd0Te4jS4Q',
  authDomain: 'titan-fantasy-football.firebaseapp.com',
  projectId: PROJECT,
  appId: '1:544453683345:web:567b48f38a839e321b7730'
};

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const state = {busy: false, error: null, lineupBusy: null, lineupError: null};
const ready = new Promise(resolve => { const off = onAuthStateChanged(auth, () => { off(); resolve(); }); });

async function currentUser() { await ready; return auth.currentUser; }

// ---------------------------------------------------------------- Firestore over REST
async function fsGet(path, user) {
  const token = await user.getIdToken();
  const res = await fetch(`${FS}/${path}`, {headers: {Authorization: 'Bearer ' + token}});
  if (res.status === 404) return null;
  if (res.status === 403) throw new Error('this account is not Titan\'s owner');
  if (!res.ok) throw new Error(`Titan's database answered ${res.status}`);
  return res.json();
}
// A Firestore REST value into a plain one.
function fsv(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsv);
  if ('mapValue' in v) return fsDoc(v.mapValue.fields || {});
  return null;
}
function fsDoc(fields) { const o = {}; for (const k in fields) o[k] = fsv(fields[k]); return o; }

async function labDoc(id, user) {
  const d = await fsGet(`lab/${id}`, user);
  const f = d && d.fields || {};
  return f.json && f.json.stringValue ? JSON.parse(f.json.stringValue) : null;
}

async function refresh() {
  const user = await currentUser();
  if (!user || state.busy) return;
  state.busy = true; state.error = null;
  try {
    const [value, dump] = await Promise.all([labDoc('value-latest', user), labDoc('dump-latest', user)]);
    await chrome.storage.local.set({value, dump, fetched: Date.now()});
  } catch (e) {
    state.error = e && e.message ? e.message : String(e);
  }
  state.busy = false;
}

async function status() {
  const user = await currentUser();
  const o = await chrome.storage.local.get(['value', 'dump', 'fetched', 'analysis']);
  const v = o.value, d = o.dump, a = o.analysis;
  return {
    user: user ? {email: user.email, uid: user.uid} : null, busy: state.busy, error: state.error, fetched: o.fetched || 0,
    value: v ? {week: v.week, through: v.through, at: v.at, leagues: (v.leagues || []).length} : null,
    dump: d ? {week: d.week, at: d.at} : null,
    lineup: a ? {at: a.at, week: a.week, leagues: Object.keys(a.leagues || {}).length, ranked: a.rankedCount,
      // Per league: the changes the rankings want and the hurt starters, for the popup's list.
      todo: Object.values(a.leagues || {}).map(L => {
        const lbl = p => (p && p.rank !== null && p.rank !== undefined ? ` (${SCC.rankLabel(p.pos, p.rank)})` : '');
        const hurt = (L.hurt || []).filter(p => !(L.moves || []).some(m => m.out && m.out.id === p.id));
        const claims = ((v && v.leagues) || []).filter(x => String(x.id) === String(L.id)).flatMap(x => (x.add || []).map(m => `Claim ${m.n}${m.d ? `, drop ${m.d}` : ''}`));
        // The lines the popup lists: lineup changes with both ranks, hurt starters, waiver upgrades, the report's claims.
        const lines = (L.moves || []).map(m => (m.from ? `Move ${m.inn.name}${lbl(m.inn)} to ${m.slot}` : `Start ${m.inn.name}${lbl(m.inn)}${m.out ? ` over ${m.out.name}${lbl(m.out)}` : ''}`))
          .concat(hurt.map(p => `${p.name} is ${p.inj} and in your lineup`))
          .concat((L.wire || []).map(w => `${w.pos}: ${w.list.map(f => `${f.name}${lbl(f)}`).join(', ')}${w.cur ? ` over ${w.cur.name}${lbl(w.cur)}` : ''}`))
          .concat(claims);
        return {id: L.id, name: L.name, changes: (L.moves || []).length, hurt: hurt.length, lines};
      }).filter(x => x.lines.length)} : null,
    lineupBusy: !!state.lineupBusy, lineupError: state.lineupError
  };
}

/* A league's waiver facts for the bids (SCC.faabBid in the content script): the budget, what's left of it for the
   owner's team, the league's winning bids this season, and Sleeper's trending adds (how hot a pickup is). `mine` is
   any Sleeper id on the owner's roster there (the report's own map says which are his). */
async function leagueFacts(id, week, mine) {
  const get = async p => { const r = await fetch(SLEEPER + '/v1' + p); return r.ok ? r.json() : null; };
  const lg = await get(`/league/${id}`);
  if (!lg) return null;
  const s = lg.settings || {};
  const out = {faab: s.waiver_type === 2 && s.waiver_budget > 0, budget: s.waiver_budget || 0, left: null, bids: [], teams: 0, trending: []};
  const rosters = await get(`/league/${id}/rosters`) || [];
  out.teams = rosters.length;
  const my = rosters.find(r => (r.players || []).some(p => mine.includes(String(p))));
  if (my) out.left = Math.max(0, out.budget - (((my.settings || {}).waiver_budget_used) || 0));
  if (out.faab) {
    const weeks = []; for (let w = 1; w <= Math.min(18, week || 1); w++) weeks.push(w);
    const all = await Promise.all(weeks.map(w => get(`/league/${id}/transactions/${w}`)));
    all.forEach(list => (list || []).forEach(t => {
      if (t.type === 'waiver' && t.status === 'complete' && t.settings && t.settings.waiver_bid > 0) out.bids.push(t.settings.waiver_bid);
    }));
  }
  out.trending = ((await get('/players/nfl/trending/add?lookback_hours=24&limit=25')) || []).map(t => String(t.player_id));
  return out;
}

// ---------------------------------------------------------------- the lineup analysis (Titan's engine, here)
/* The owner's Sleeper leagues read the way Titan reads them (SleeperAPI.collect: rosters, injuries, byes, matchups),
   analyzed under his synced weekly rankings (users/{uid}/ranks/{week}, the week's or the latest earlier one), with
   Titan's default rankings from Sleeper's projections for any position he left out, exactly as the app and the
   server job do (SCC.rankingsBy, SCC.analyzeAll). Cached in chrome.storage.local (`analysis`) for LINEUP_MINUTES.
   Only the Sleeper side of his account is read here: no ESPN or Yahoo. */
function ranksFor(weeks, week) {
  const have = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  if (!have.length) return [];
  if (weeks[week]) return weeks[week];
  const earlier = have.filter(w => w < week);
  return weeks[earlier.length ? earlier[earlier.length - 1] : have[have.length - 1]];
}

const pick = (p, keys) => { const o = {}; keys.forEach(k => { if (p && p[k] !== undefined) o[k] = p[k]; }); return o; };
const PK = ['id', 'name', 'pos', 'team', 'rank', 'posRank', 'tier', 'inj', 'onBye', 'locked', 'outish', 'start', 'bye', 'opp'];
const slim = p => (p ? pick(p, PK) : null);

function trimLeague(L, week, proj, games) {
  const cfg = L.cfg, pj = p => (p && proj ? SCC.projFor(proj, p.id, cfg) : null);
  const withProj = p => (p ? Object.assign(slim(p), {proj: pj(p)}) : null);
  // The close calls (a starter and a bench player at his position within a few ranks): both players' projections
  // and rank notes, the second opinion for the spots the rankings call nearly even.
  let close = [];
  try { close = SCC.closeCallPairs(L.opt, L.roster).slice(0, 4).map(x => ({starter: withProj(x.starter), bench: withProj(x.bench)})); } catch (e) { close = []; }
  return {
    id: cfg.id, name: cfg.name || cfg.key, lineup: cfg.lineup, week,
    rows: (L.rows || []).map(r => ({slot: r.slot, verdict: r.verdict, p: withProj(r.p)})),
    opt: (L.opt || []).map(o => ({slot: o.slot, p: withProj(o.p)})),
    moves: (L.moves || []).map(m => ({slot: m.slot, from: m.from || null, inn: withProj(m.inn), out: withProj(m.out)})),
    wire: (L.wire || []).map(w => ({pos: w.pos, cur: slim(w.cur), anyUnranked: !!w.anyUnranked, list: (w.list || []).slice(0, 3).map(slim)})),
    hurt: (L.hurt || []).map(slim), stops: L.stops || 0, close
  };
}

/* This week's head-to-head for a league (SleeperAPI.collectMatchups), the way Titan's Matchup tab reads it: each side's
   points so far and projections, and the chance to win (SCC.winProbability: points in the books, half of what a player
   on the field still expects, the projection for everyone yet to play). */
function trimMatchup(m, proj, games) {
  if (!m || m.error || m.none) return m && m.error ? {error: m.error} : null;
  const state = p => ((games || {})[SCC.teamAbbr(p.team)] || {}).state || 'pre';
  const side = s => {
    const players = (s.players || []).map(p => (!p || p.empty ? {slot: p && p.slot, empty: true}
      : {id: p.id, name: p.name, pos: p.pos, team: p.team, slot: p.slot, pts: Number(p.pts) || 0, proj: proj ? SCC.projFor(proj, p.id, m.cfg) : null, state: state(p)}));
    const list = players.map(p => (p.empty ? null : {pts: p.pts, proj: p.proj, state: p.state}));
    return {name: s.name, record: s.record || '', players, list, pts: players.reduce((a, p) => a + (p.empty || p.state === 'pre' ? 0 : p.pts), 0),
      proj: players.reduce((a, p) => a + (p.empty ? 0 : (p.proj || 0)), 0)};
  };
  const me = side(m.me), opp = side(m.opp), wp = SCC.winProbability(me.list, opp.list);
  delete me.list; delete opp.list;
  return {me: Object.assign(me, {final: wp.expA}), opp: Object.assign(opp, {final: wp.expB}), pa: Math.round(wp.a * 100)};
}

/* The icon's badge: lineup changes the rankings want plus hurt starters, across every league, so game day shows a
   number before anything is opened. */
async function setBadge(analysis) {
  const a = analysis || (await chrome.storage.local.get('analysis')).analysis;
  let n = 0;
  if (a) Object.values(a.leagues || {}).forEach(L => {
    n += (L.moves || []).length;
    n += (L.hurt || []).filter(p => !(L.moves || []).some(m => m.out && m.out.id === p.id)).length;
  });
  await chrome.action.setBadgeBackgroundColor({color: '#b91c1c'});
  await chrome.action.setBadgeText({text: n ? String(n) : ''});
  return n;
}

async function analyze() {
  const user = await currentUser();
  if (!user) return null;
  if (state.lineupBusy) return state.lineupBusy;
  state.lineupBusy = (async () => {
    state.lineupError = null;
    try {
      const me = await fsGet(`users/${user.uid}`, user);
      const account = me && me.fields ? fsDoc(me.fields).account : null;
      if (!account || !account.userId) throw new Error('no Sleeper account is linked in Titan (Settings)');
      // The weekly rankings he imported, every week saved.
      const rd = await fsGet(`users/${user.uid}/ranks?pageSize=40`, user);
      const weeks = {};
      ((rd && rd.documents) || []).forEach(d => { weeks[d.name.split('/').pop()] = (fsDoc(d.fields || {}).rows) || []; });
      // The Sleeper player list is kept between runs (the adapter's own cache, three days), not fetched each time.
      const cached = (await chrome.storage.local.get('players')).players;
      if (cached) SleeperAPI.store.set(SleeperAPI.PLAYERS_KEY, cached);
      const snap = await SleeperAPI.collect({userId: String(account.userId), prefs: account.prefs || {}}, null, null, {});
      const players = SleeperAPI.store.get(SleeperAPI.PLAYERS_KEY);
      if (players && players !== cached) await chrome.storage.local.set({players});
      const week = Number(snap.week) || 1, season = String(snap.season || new Date().getFullYear());
      let proj = null;
      try {
        const r = await fetch(`${SLEEPER}/projections/nfl/${season}/${week}?season_type=regular${PROJ_POS}`);
        if (r.ok) proj = SCC.trimProjections(await r.json());
      } catch (e) { proj = null; }
      const hasProj = !!proj && Object.keys(proj).length > 0;
      const rows = hasProj ? (weeks[week] || []) : ranksFor(weeks, week);
      const A = SCC.analyzeAll(snap, SCC.rankingsBy(rows, hasProj ? proj : null, players && players.map ? players.map : players));
      const leagues = {};
      A.leagues.forEach(L => { leagues[String(L.cfg.id)] = trimLeague(L, week, proj, snap.games); });
      // This week's matchups, best effort: a failure leaves the lineups standing.
      try {
        const ms = await SleeperAPI.collectMatchups(snap);
        ms.forEach(m => { const L = m && m.cfg && leagues[String(m.cfg.id)]; if (L) L.matchup = trimMatchup(m, proj, snap.games); });
      } catch (e) { /* no matchups this time */ }
      const analysis = {at: Date.now(), week, season, rankedCount: A.rankedCount, leagues};
      await chrome.storage.local.set({analysis});
      await setBadge(analysis);
      return analysis;
    } catch (e) {
      state.lineupError = e && e.message ? e.message : String(e);
      return null;
    } finally {
      state.lineupBusy = null;
    }
  })();
  return state.lineupBusy;
}

async function lineupFor(id, force) {
  const o = await chrome.storage.local.get('analysis');
  let a = o.analysis;
  if (force || !a || Date.now() - a.at > LINEUP_MINUTES * 60e3) a = (await analyze()) || a;
  if (!a) return {error: state.lineupError || 'no analysis yet'};
  const L = a.leagues[String(id)];
  return {at: a.at, week: a.week, rankedCount: a.rankedCount, league: L || null, error: state.lineupError};
}

// ---------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'status') return status();
    if (msg.type === 'refresh') { await Promise.all([refresh(), analyze()]); return status(); }
    if (msg.type === 'connect') { await chrome.tabs.create({url: `${SITE}/ext/connect.html?ext=${chrome.runtime.id}`}); return {ok: true}; }
    if (msg.type === 'signOut') { await signOut(auth); await chrome.storage.local.remove(['value', 'dump', 'fetched', 'analysis', 'players']); return status(); }
    if (msg.type === 'league') return leagueFacts(String(msg.id), msg.week, msg.mine || []);
    if (msg.type === 'lineup') return lineupFor(String(msg.id), !!msg.force);
    if (msg.type === 'badge') return {count: await setBadge(null)};
    return {error: 'unknown message'};
  })().then(sendResponse, e => sendResponse({error: e && e.message ? e.message : String(e)}));
  return true;
});

// The credential from Titan's connect page (externally_connectable lists the site). Google's ID token becomes the
// extension's own Firebase sign-in; the page never sees the extension's session.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!sender.url || !sender.url.startsWith(SITE + '/')) return;
  if (!msg || msg.type !== 'titan-credential' || !msg.idToken) { sendResponse({ok: false, error: 'no credential'}); return; }
  signInWithCredential(auth, GoogleAuthProvider.credential(msg.idToken, msg.accessToken || undefined))
    .then(async r => { await refresh(); analyze(); sendResponse({ok: true, email: r.user.email, error: state.error}); })
    .catch(e => sendResponse({ok: false, error: e && e.message ? e.message : String(e)}));
  return true;
});

chrome.alarms.create('titan-refresh', {periodInMinutes: REFRESH_HOURS * 60});
// The lineups and the badge, every LINEUP_MINUTES (rosters, injuries and rankings move through the week).
chrome.alarms.create('titan-lineup', {periodInMinutes: LINEUP_MINUTES});
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'titan-refresh') refresh();
  if (a.name === 'titan-lineup') analyze();
});
chrome.runtime.onStartup.addListener(async () => {
  const o = await chrome.storage.local.get(['fetched', 'analysis']);
  if (!o.fetched || Date.now() - o.fetched > REFRESH_HOURS * 3600e3) refresh();
  await setBadge(o.analysis || null);
  if (!o.analysis || Date.now() - o.analysis.at > LINEUP_MINUTES * 60e3) analyze();
});
setBadge(null);
