/* Titan Fantasy Football Manager — server job.
 *
 * Every 15 minutes on NFL game days, for each person who signed in to sync,
 * saves Titan's calls for the week: each player's rank, Titan's call and his
 * projected points (Sleeper's projections). A player's entry keeps updating
 * until his game kicks off, then stays frozen, so the Results tab can compare
 * what was expected at lock with what actually happened.
 * Stored at users/{uid}/history/{week}, readable only by that person.
 */
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {onCall, onRequest, HttpsError} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const crypto = require('crypto');
const zlib = require('zlib');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getAuth} = require('firebase-admin/auth');
const {getMessaging} = require('firebase-admin/messaging');
const SCC = require('./shared/engine.js');
const API = require('./shared/sleeper.js');
const ESPN = require('./shared/espn.js');
const YAHOO = require('./shared/yahoo.js');

initializeApp();
const db = getFirestore();
db.settings({ignoreUndefinedProperties: true});

const SLEEPER = 'https://api.sleeper.app';
const PROJ_POS = '&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF';
const PLAYERS_TTL = 3 * 24 * 3600 * 1000;
const PLAYERS_V = 2; // raised when trimPlayers keeps more (2: depth chart order), so the saved copy is rebuilt
let warm = null; // the trimmed player list, kept between runs on a warm instance
// Sends one alert to many devices (Firebase Cloud Messaging); tests swap it out.
let sendPush = msg => getMessaging().sendEachForMulticast(msg);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return res.json();
}

/* Sleeper's full player list is ~14 MB, so the trimmed copy (~140 KB) is kept
   in memory and in Firestore, and rebuilt every few days. Firestore gets it
   gzipped in one bytes field: as a map, every player would be an indexed field
   and the document would be rejected. */
const pack = map => zlib.gzipSync(JSON.stringify(map));
const unpack = buf => JSON.parse(zlib.gunzipSync(buf).toString('utf8'));

async function playerMap() {
  if (warm && Date.now() - warm.ts < PLAYERS_TTL) return warm.map;
  const ref = db.doc('meta/players');
  try {
    const saved = await ref.get();
    if (saved.exists && saved.get('gz') && saved.get('v') === PLAYERS_V && Date.now() - saved.get('ts') < PLAYERS_TTL) {
      warm = {ts: saved.get('ts'), map: unpack(saved.get('gz'))};
      return warm.map;
    }
  } catch (e) {
    logger.warn('saved player list unreadable: ' + e.message);
  }
  warm = {ts: Date.now(), map: SCC.trimPlayers(await getJson(SLEEPER + '/v1/players/nfl'))};
  // Best effort: failing to cache the list must not stop anyone's calls being saved.
  await ref.set({ts: warm.ts, gz: pack(warm.map), v: PLAYERS_V}).catch(e => logger.warn('could not cache the player list: ' + e.message));
  return warm.map;
}

/* The rankings for a week, or the latest earlier week: the app's fallback when
   there are no projections for the default rankings. */
function ranksFor(weeks, week) {
  const have = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  if (!have.length) return [];
  if (weeks[week]) return weeks[week];
  const earlier = have.filter(w => w < week);
  return weeks[earlier.length ? earlier[earlier.length - 1] : have[have.length - 1]];
}

/* One person's week: their live Sleeper and ESPN rosters under their rankings
   (Titan's defaults from the projections for any position they leave out, or
   all of them when none are imported, as in the app), merged into what was
   already frozen. */
async function freezeForUser(userRef, account, ctx) {
  const rankDocs = await userRef.collection('ranks').get();
  const weeks = {};
  rankDocs.forEach(d => { weeks[d.id] = d.get('rows') || []; });
  // A saved ESPN login opens the person's private ESPN leagues.
  const login = (await userRef.collection('private').doc('espn').get()).data() || null;
  const snap = await API.collect(account, null, null, {espnCreds: login});
  // The server's refresh skips kickoff times; the FLEX order and the lineup check use them.
  snap.kickoffs = ctx.kickoffs || {};
  const hasProj = Object.keys(ctx.proj || {}).length > 0;
  const rows = hasProj ? weeks[ctx.week] || [] : ranksFor(weeks, ctx.week);
  const analysis = SCC.analyzeAll(snap, SCC.rankingsBy(rows, hasProj ? ctx.proj : null, ctx.players));
  let record = null;
  if (ctx.freeze !== false) {
    const ref = userRef.collection('history').doc(String(ctx.week));
    const prev = (await ref.get()).data() || null;
    record = SCC.freezeWeek(prev, analysis, ctx.proj, ctx.season, ctx.week);
    await ref.set(record);
  }
  const alerts = await alertUser(userRef, analysis, ctx).catch(e => { logger.warn('could not send one user\'s alerts: ' + e.message); return 0; });
  return {record, alerts};
}

/* Whether someone has game-day alerts on for at least one device. */
async function hasAlerts(userRef) {
  const d = (await userRef.collection('private').doc('alerts').get()).data();
  return !!(d && d.tokens && Object.keys(d.tokens).length);
}

/* A person's new game-day alerts (SCC.alertsFor), sent to every device they
   turned alerts on for. Only this week's sent alerts are remembered. Returns
   how many went out. */
async function alertUser(userRef, analysis, ctx) {
  const ref = userRef.collection('private').doc('alerts');
  const doc = (await ref.get()).data();
  if (!doc || !doc.tokens || !Object.keys(doc.tokens).length) return 0;
  const sent = {};
  for (const k in doc.sent || {}) if (k.split('|')[1] === String(ctx.week)) sent[k] = 1;
  const kicks = ctx.kickoffs || {};
  const list = SCC.alertsFor(analysis, {week: ctx.week, now: Date.now(), sent,
    kickoffs: [...new Set(Object.values(kicks).map(k => Number(k[0])))],
    kickAt: p => { const k = kicks[SCC.teamAbbr(p.team)]; return k ? Number(k[0]) : 0; },
    players: ctx.players, // depth charts, to name a ruled-out starter's free backup
    want: Object.assign({out: true, check: true}, doc.prefs || {})});
  // The starters the news check watches until the next alert check (newsAlerts).
  const watch = SCC.newsWatch(analysis);
  if (list.length) return deliver(ref, list, sent, {watch});
  if (JSON.stringify(doc.watch || []) !== JSON.stringify(watch)) {
    const latest = (await ref.get()).data() || {};
    await ref.set(Object.assign({}, latest, {watch}));
  }
  return 0;
}

/* News about people's starters, checked on every run (every 15 minutes, every day of
   the season). ESPN's latest stories are read once; only when one has come in since the
   last check (with half an hour's overlap, since ESPN can post a story a little late)
   and tags a player are people's saved starters (the watch list from their last alert
   check) looked through. Returns how many alerts went out. */
const NEWS_OVERLAP = 30 * 60000, NEWS_MAX_AGE = 3 * 3600 * 1000;
async function newsAlerts(week, deps = {}) {
  const now = deps.now || Date.now();
  const metaRef = deps.metaRef || db.doc('meta/news');
  const meta = (await metaRef.get()).data() || {};
  let stories;
  try { stories = await (deps.fetchNews || ESPN.fetchNews)(); }
  catch (e) { logger.warn('ESPN news unavailable: ' + e.message); return 0; }
  const since = Math.max((meta.checkedAt || 0) - NEWS_OVERLAP, now - NEWS_MAX_AGE);
  await metaRef.set({checkedAt: now});
  const fresh = stories.filter(s => s.at > since && s.athletes.length);
  if (!fresh.length) return 0;
  const docs = deps.userDocs ? await deps.userDocs() : (await db.collection('users').get()).docs;
  let n = 0;
  for (const u of docs) {
    const ref = u.ref.collection('private').doc('alerts');
    const doc = (await ref.get()).data();
    if (!doc || !doc.tokens || !Object.keys(doc.tokens).length || !doc.watch || (doc.prefs && doc.prefs.news === false)) continue;
    const sent = {};
    for (const k in doc.sent || {}) if (k.split('|')[1] === String(week)) sent[k] = 1;
    const list = SCC.newsAlertsFor(fresh, doc.watch, {week, sent});
    if (list.length) n += await deliver(ref, list, sent).catch(e => { logger.warn('could not send one user\'s news: ' + e.message); return 0; });
  }
  return n;
}

/* Sends each alert to every device on file, forgets devices that no longer
   accept alerts, and saves what was sent. The document is read again just
   before writing, so a device added meanwhile isn't lost. */
async function deliver(ref, list, sent, extra) {
  const doc = (await ref.get()).data() || {};
  let tokens = Object.keys(doc.tokens || {});
  const dead = new Set();
  let n = 0;
  for (const a of list) {
    if (!tokens.length) break;
    // A news alert opens its story; the others open Titan.
    const res = await sendPush({tokens, data: {title: a.title, body: a.body, url: a.url || '/app/', tag: a.key},
      webpush: {headers: {Urgency: 'high', TTL: '7200'}}});
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.add(tokens[i]);
    });
    if (res.successCount) n++;
    tokens = tokens.filter(t => !dead.has(t));
  }
  const latest = (await ref.get()).data() || {};
  const keep = {};
  for (const t in latest.tokens || {}) if (!dead.has(t)) keep[t] = latest.tokens[t];
  await ref.set(Object.assign({}, latest, extra || {}, {tokens: keep, sent}));
  return n;
}

async function run() {
  const state = await getJson(SLEEPER + '/v1/state/nfl');
  const season = String(state.season);
  const week = Number(state.week);
  if (state.season_type !== 'regular' || !week) { logger.debug('not the regular season'); return 'off-season'; }

  // News about people's starters goes out as it breaks: every run, every day of the season.
  const news = await newsAlerts(week).catch(e => { logger.warn('news alerts failed: ' + e.message); return 0; });

  // Game days: each player's call freezes at his kickoff, and alerts go out.
  // Injury reports come out through the week, so on other days people with
  // alerts on are checked at noon, 4 PM and 8 PM Eastern. Sleeper's schedule
  // gives game dates (Eastern), not kickoff times.
  const sched = await getJson(SLEEPER + '/schedule/nfl/regular/' + season);
  const games = sched.filter(g => Number(g.week) === week);
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  const et = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/New_York'}));
  const gameDay = games.some(g => g.date === today || g.status === 'in_game');
  const reportTime = [12, 16, 20].includes(et.getHours()) && et.getMinutes() < 15;
  if (!gameDay && !reportTime) { logger.debug('no games today'); return news ? `no games today, ${news} news alert(s)` : 'no games today'; }

  const players = await playerMap();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const proj = SCC.trimProjections(await getJson(SLEEPER + '/projections/nfl/' + season + '/' + week + '?season_type=regular' + PROJ_POS));
  // Kickoff times from ESPN's public NFL schedule, for the lineup check and the FLEX order.
  const kicks = await ESPN.fetchKickoffs(season).catch(() => null);
  const kickoffs = {};
  for (const t in kicks || {}) if (kicks[t][week]) kickoffs[t] = kicks[t][week];
  const ctx = {season, week, proj, players, kickoffs, freeze: gameDay};

  const users = await db.collection('users').get();
  let done = 0, failed = 0, sent = 0;
  for (const u of users.docs) {
    const account = u.get('account');
    const espnLeagues = account && account.espn && account.espn.leagues;
    if (!account || !(account.userId || (espnLeagues && espnLeagues.length))) continue;
    // Away from game days only the alerts run, so only for people who turned them on.
    if (!gameDay && !(await hasAlerts(u.ref))) continue;
    try { const r = await freezeForUser(u.ref, account, ctx); done++; sent += r.alerts; }
    catch (e) { failed++; logger.warn('could not check one user: ' + e.message); }
  }
  const what = gameDay ? 'saved calls for' : 'checked alerts for';
  logger.info(`week ${week}: ${what} ${done} user(s), ${sent} alert(s) and ${news} news alert(s) sent, ${failed} failed`);
  return `week ${week}: ${what} ${done}, ${sent} alerts, ${news} news, ${failed} failed`;
}

exports.freezeCalls = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'America/New_York',
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 300,
  maxInstances: 1
}, run);

/* Reads a private ESPN league for a signed-in person, with the ESPN login they
   saved to their own account. A browser can't send ESPN's cookies itself. The
   league comes back slimmed to what Titan reads. */
exports.espnLeague = onCall({region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 30}, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const {leagueId, season, week, kind, teamId} = req.data || {};
  const points = kind === 'points', matchup = kind === 'matchup';
  if (!/^\d{1,12}$/.test(String(leagueId)) || !/^\d{4}$/.test(String(season)) || (week !== undefined && !/^\d{1,2}$/.test(String(week))) ||
      ((points || matchup) && (!/^\d{1,2}$/.test(String(week)) || !/^\d{1,3}$/.test(String(teamId))))) {
    throw new HttpsError('invalid-argument', 'Not an ESPN league.');
  }
  const login = (await db.doc(`users/${req.auth.uid}/private/espn`).get()).data();
  if (!login || !login.s2) throw new HttpsError('failed-precondition', 'No ESPN login saved.');
  // The season's schedule and scores (the Standings tab).
  if (kind === 'schedule') {
    try { return ESPN.slimSchedule(await ESPN.readSchedule(String(leagueId), String(season), {creds: login})); }
    catch (e) { throw new HttpsError(e.message === 'private' ? 'permission-denied' : 'unavailable', e.message === 'private' ? 'private' : e.message); }
  }
  // This week's head-to-head: both lineups (null when there's no matchup).
  if (matchup) return ESPN.fetchMatchup(String(leagueId), String(season), Number(week), Number(teamId), {creds: login});
  // Live scores: one team's points so far this week.
  if (points) {
    const pts = await ESPN.fetchPoints(String(leagueId), String(season), Number(week), Number(teamId), {creds: login});
    if (!pts) throw new HttpsError('unavailable', 'ESPN had no scores for that team.');
    return pts;
  }
  const r = await ESPN.fetchLeague(String(leagueId), String(season), {creds: login, week: week ? Number(week) : undefined});
  if (r.error === 'private') throw new HttpsError('permission-denied', 'private');
  if (r.error) throw new HttpsError('unavailable', r.error);
  return ESPN.slimLeague(r.json);
});

/* Totals for Titan's owner (the one account with the titanOwner custom
   claim): sign-ins, what people linked, who imported rankings or turned on
   alerts. Only counts leave the database, never anyone's details. */
function countStats(now, authUsers, accounts, withRankings, alertsOn) {
  const WEEK = 7 * 24 * 3600 * 1000;
  const s = {accounts: authUsers.length, newThisWeek: 0, activeThisWeek: 0, sleeper: 0, espnPeople: 0, espnLeagues: 0,
    withRankings, alertsOn, at: now};
  authUsers.forEach(u => {
    const m = u.metadata || {};
    if (now - Date.parse(m.creationTime) < WEEK) s.newThisWeek++;
    if (now - Date.parse(m.lastRefreshTime || m.lastSignInTime || 0) < WEEK) s.activeThisWeek++;
  });
  accounts.forEach(a => {
    if (a.userId) s.sleeper++;
    const n = ((a.espn && a.espn.leagues) || []).length;
    if (n) { s.espnPeople++; s.espnLeagues += n; }
  });
  return s;
}

exports.ownerStats = onCall({region: 'us-central1', memory: '256MiB', maxInstances: 2, timeoutSeconds: 60}, async req => {
  if (!req.auth || req.auth.token.titanOwner !== true) throw new HttpsError('permission-denied', 'Only Titan\'s owner can see these totals.');
  const authUsers = [];
  let page = null;
  do {
    page = await getAuth().listUsers(1000, page ? page.pageToken : undefined);
    authUsers.push(...page.users);
  } while (page.pageToken);
  const users = await db.collection('users').get();
  const accounts = users.docs.map(d => d.get('account') || {});
  const withRankings = new Set((await db.collectionGroup('ranks').select().get()).docs.map(d => d.ref.parent.parent.id)).size;
  const alertRefs = users.docs.map(d => d.ref.collection('private').doc('alerts'));
  const alertDocs = alertRefs.length ? await db.getAll(...alertRefs) : [];
  const alertsOn = alertDocs.filter(d => d.exists && Object.keys(d.get('tokens') || {}).length).length;
  return countStats(Date.now(), authUsers, accounts, withRankings, alertsOn);
});

/* "Send a test alert" in Settings: one alert to the device asking, if it's a
   device the person turned alerts on for. A device that no longer accepts
   alerts is forgotten. */
async function sendTest(ref, token) {
  const doc = (await ref.get()).data() || {};
  if (!token || !(doc.tokens || {})[token]) throw new HttpsError('failed-precondition', 'Turn alerts on for this device first.');
  const res = await sendPush({tokens: [token], data: {title: 'Titan test alert', body: 'Alerts work on this device. Real ones come on game days.',
    url: '/app/', tag: 'test'}, webpush: {headers: {Urgency: 'high', TTL: '600'}}});
  const r = res.responses[0] || {};
  if (r.success) return {sent: true};
  const code = r.error && r.error.code;
  if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
    const tokens = Object.assign({}, doc.tokens);
    delete tokens[token];
    await ref.set(Object.assign({}, doc, {tokens}));
    throw new HttpsError('not-found', 'This device stopped accepting alerts. Turn them off and on again.');
  }
  throw new HttpsError('unavailable', 'The alert could not be sent. Try again in a minute.');
}

exports.testAlert = onCall({region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 30}, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return sendTest(db.doc(`users/${req.auth.uid}/private/alerts`), String((req.data || {}).token || ''));
});

/* Yahoo Fantasy: each person links their own Yahoo account (OAuth 2.0). Yahoo sends
   them back to /api/yahoo/callback with a one-time code, which Titan's server trades
   for tokens with the app's secret (Secret Manager: YAHOO_CLIENT_SECRET). The tokens
   live at yahooTokens/{uid}, outside users/{uid}, so no browser can read them
   (firestore.rules only opens users/{uid}); every Yahoo read goes through here.
   While Yahoo leagues are being built, only Titan's owner can link (YAHOO_OPEN). */
const YAHOO_OPEN = false;
const YAHOO_ID = 'dj0yJmk9VHJJS01rOElBYVExJmQ9WVdrOVQzaFFURkJOUzBzbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTUx'; // public: it's in every sign-in address
const YAHOO_SECRET = defineSecret('YAHOO_CLIENT_SECRET');
const YAHOO_REDIRECT = 'https://titanfantasyfootball.com/api/yahoo/callback'; // as registered with Yahoo; must match exactly
const YAHOO_LOGIN = 'https://api.login.yahoo.com/oauth2/';
const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';
const YAHOO_STATE_TTL = 10 * 60 * 1000;
const yahooAllowed = auth => !!auth && (YAHOO_OPEN || auth.token.titanOwner === true);

function yahooAuthUrl(state) {
  return YAHOO_LOGIN + 'request_auth?' + new URLSearchParams({client_id: YAHOO_ID, redirect_uri: YAHOO_REDIRECT, response_type: 'code', state, language: 'en-us'});
}

// Yahoo's token endpoint: the app's id and secret as Basic auth, the grant as a form.
async function yahooToken(form, secret, post = fetch) {
  const res = await post(YAHOO_LOGIN + 'get_token', {method: 'POST', headers: {
    Authorization: 'Basic ' + Buffer.from(YAHOO_ID + ':' + secret).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(Object.assign({redirect_uri: YAHOO_REDIRECT}, form)).toString()});
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('Yahoo token ' + res.status + ': ' + (body.error_description || body.error || 'no token'));
  return body;
}
// A minute's margin, so a token never runs out mid-read.
const keepTokens = (t, now) => ({access: t.access_token, refresh: t.refresh_token, expires: now + (Number(t.expires_in) || 3600) * 1000 - 60000});

/* One read from Yahoo's Fantasy API as JSON. Yahoo answers some errors (and
   throttling) in XML or plain text, so the body is only parsed when it can be. */
async function yahooRead(access, path, get = fetch) {
  const res = await get(YAHOO_API + path + (path.includes('?') ? '&' : '?') + 'format=json', {headers: {Authorization: 'Bearer ' + access}});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok || !json) logger.warn('Yahoo answered ' + res.status + ' for ' + path.split('?')[0] + ': ' + text.slice(0, 300));
  return {ok: res.ok && !!json, status: res.status, json};
}

/* The Yahoo link's last step. The state must be one Titan made in the last ten
   minutes (it names the person) and works once. Returns what to tell them:
   linked, noaccess (Yahoo turned Titan away when it asked for their leagues,
   likely while Titan's access request is in review), expired or failed. */
async function linkYahoo(state, code, deps) {
  const {db: store, secret, now = Date.now(), post = fetch, get = fetch} = deps;
  if (!/^[a-f0-9]{48}$/.test(state) || !code) return 'failed';
  const ref = store.doc('yahooStates/' + state);
  const s = (await ref.get()).data();
  if (!s) return 'expired';
  await ref.delete();
  if (now - s.at > YAHOO_STATE_TTL) return 'expired';
  const tokens = Object.assign(keepTokens(await yahooToken({grant_type: 'authorization_code', code}, secret, post), now), {linkedAt: now});
  await store.doc('yahooTokens/' + s.uid).set(tokens);
  const probe = await yahooRead(tokens.access, '/users;use_login=1/games;game_codes=nfl', get);
  return probe.ok ? 'linked' : probe.status === 401 || probe.status === 403 ? 'noaccess' : 'failed';
}

/* A usable access token for a person (null if they haven't linked Yahoo), refreshed
   when it's within a minute of running out. Yahoo may send a new refresh token with
   it and retire the old one, so the new one is saved at once. */
async function yahooAccess(ref, secret, now = Date.now(), post = fetch) {
  const t = (await ref.get()).data();
  if (!t || !t.refresh) return null;
  if (t.access && now < t.expires) return t.access;
  const r = await yahooToken({grant_type: 'refresh_token', refresh_token: t.refresh}, secret, post);
  const next = Object.assign({}, t, keepTokens(r, now), {refresh: r.refresh_token || t.refresh});
  await ref.set(next);
  return next.access;
}

const YAHOO_FN = {region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 30, secrets: [YAHOO_SECRET]};

// "Sign in with Yahoo": a one-time sign-in address for this person.
exports.yahooStart = onCall({region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 20}, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!yahooAllowed(req.auth)) throw new HttpsError('permission-denied', 'Yahoo leagues aren\'t open yet.');
  const old = await db.collection('yahooStates').where('uid', '==', req.auth.uid).get();
  await Promise.all(old.docs.map(d => d.ref.delete()));
  const state = crypto.randomBytes(24).toString('hex');
  await db.doc('yahooStates/' + state).set({uid: req.auth.uid, at: Date.now()});
  return {url: yahooAuthUrl(state)};
});

// Where Yahoo sends people back (/api/yahoo/callback): link, then back to Settings with the result.
exports.yahooCallback = onRequest(Object.assign({invoker: 'public'}, YAHOO_FN), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let result = 'declined';
  if (!req.query.error) {
    result = await linkYahoo(String(req.query.state || ''), String(req.query.code || ''), {db, secret: YAHOO_SECRET.value()})
      .catch(e => { logger.warn('Yahoo link failed: ' + e.message); return 'failed'; });
  }
  res.redirect(302, '/app/settings?yahoo=' + result);
});

// The person's Yahoo football leagues for a season, each with their team in it.
exports.yahooLeagues = onCall(YAHOO_FN, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!yahooAllowed(req.auth)) throw new HttpsError('permission-denied', 'Yahoo leagues aren\'t open yet.');
  const ref = db.doc('yahooTokens/' + req.auth.uid);
  let access;
  try { access = await yahooAccess(ref, YAHOO_SECRET.value()); }
  catch (e) { logger.warn('Yahoo refresh failed: ' + e.message); throw new HttpsError('failed-precondition', 'Your Yahoo link stopped working. Sign in with Yahoo again.'); }
  if (!access) return {linked: false};
  const season = /^\d{4}$/.test(String((req.data || {}).season)) ? String(req.data.season) : String(new Date().getFullYear());
  const base = '/users;use_login=1/games;game_codes=nfl;seasons=' + season;
  const [lg, tm] = await Promise.all([yahooRead(access, base + '/leagues'), yahooRead(access, base + '/teams')]);
  const since = ((await ref.get()).data() || {}).linkedAt || 0;
  if (!lg.ok) {
    if (lg.status === 401 || lg.status === 403) return {linked: true, since, noaccess: true};
    throw new HttpsError('unavailable', 'Yahoo couldn\'t list your leagues right now.');
  }
  return {linked: true, since, leagues: YAHOO.yourLeagues(lg.json, tm.ok ? tm.json : null)};
});

// "Unlink Yahoo", and part of deleting a Titan account: the tokens are forgotten.
exports.yahooUnlink = onCall({region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 20}, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await db.doc('yahooTokens/' + req.auth.uid).delete();
  return {linked: false};
});

// For local testing without Cloud Scheduler.
/* FantasyCalc's trade values (fantasycalc.com) for the Trade tab, one league format
   at a time. FantasyCalc's terms: call only its documented endpoint (/values/current),
   cache on your own server (ideally a day), and credit it with a link wherever the
   values show (the app does that). Each format is kept in Firestore at
   tradeValues/{format}, which no browser can read; the app asks for it at
   /api/trade-values on Titan's own address, so browsers never call FantasyCalc. */
const FANTASYCALC = 'https://api.fantasycalc.com/values/current';
const VALUES_TTL = 24 * 3600 * 1000;

// A league format from the address, only as FantasyCalc offers them; null otherwise.
function valuesFormat(q) {
  q = q || {};
  const flag = q.dynasty === undefined ? '0' : String(q.dynasty);
  const dynasty = flag === '1' || flag === 'true' ? true : flag === '0' || flag === 'false' ? false : null;
  const qbs = Number(q.qbs === undefined ? 1 : q.qbs), teams = Number(q.teams === undefined ? 12 : q.teams);
  const ppr = Number(q.ppr === undefined ? 1 : q.ppr);
  if (dynasty === null || ![1, 2].includes(qbs) || ![8, 10, 12, 14].includes(teams) || ![0, 0.5, 1].includes(ppr)) return null;
  return {dynasty, qbs, teams, ppr};
}
const valuesKey = f => `${f.dynasty ? 'dynasty' : 'redraft'}-${f.qbs}qb-${f.teams}teams-${f.ppr}ppr`;

// Just what the app uses: ids (Sleeper, ESPN), name, position, team, value, ranks and the 30-day trend.
function slimValues(list) {
  return (Array.isArray(list) ? list : []).filter(x => x && x.player && Number(x.value) > 0).map(x => {
    const p = x.player;
    return {s: p.sleeperId ? String(p.sleeperId) : '', e: p.espnId ? String(p.espnId) : '', n: p.name || '', p: p.position || '',
      t: p.maybeTeam || '', v: Math.round(Number(x.value)), r: x.overallRank || 0, pr: x.positionRank || 0, tr: Math.round(Number(x.trend30Day) || 0)};
  });
}

/* The values for one format: the saved copy if it's under a day old, else FantasyCalc's
   latest (saved for next time). If FantasyCalc can't be reached, the last copy serves. */
async function tradeValues(f, doc, now = Date.now(), get = getJson) {
  const saved = (await doc.get()).data();
  if (saved && saved.values && now - saved.at < VALUES_TTL) return saved;
  let values;
  try {
    values = slimValues(await get(`${FANTASYCALC}?isDynasty=${f.dynasty}&numQbs=${f.qbs}&numTeams=${f.teams}&ppr=${f.ppr}`));
    if (!values.length) throw new Error('FantasyCalc sent no values');
  } catch (e) {
    if (saved && saved.values) return saved;
    throw e;
  }
  const out = {at: now, format: valuesKey(f), values};
  await doc.set(out);
  return out;
}

exports.tradeValues = onRequest({region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 30, invoker: 'public'}, async (req, res) => {
  const f = valuesFormat(req.query);
  if (req.method !== 'GET' || !f) { res.status(400).json({error: 'Not a league format.'}); return; }
  try {
    const out = await tradeValues(f, db.doc('tradeValues/' + valuesKey(f)));
    // Browsers and Firebase Hosting's CDN keep it for an hour, so most visits never reach this function.
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.json({at: out.at, values: out.values});
  } catch (e) {
    logger.warn('trade values unavailable', {format: valuesKey(f), error: String(e && e.message || e)});
    res.status(502).json({error: 'Trade values are unavailable right now.'});
  }
});

/* ESPN's latest NFL news for the News tab. Browsers can't always read ESPN's feed
   themselves (its bot protection turns some away, and it refuses the check a browser
   sometimes makes first), so Titan's server reads it and shares one copy: kept in memory
   for 90 seconds, and by browsers and Firebase Hosting's CDN for up to two minutes. If
   ESPN can't be reached, the last copy serves. */
const NEWS_KEEP = 90 * 1000;
let newsCache = null;
async function latestNews(now = Date.now(), fetchNews = () => ESPN.fetchNews()) {
  if (newsCache && now - newsCache.at < NEWS_KEEP) return newsCache;
  try { newsCache = {at: now, stories: await fetchNews()}; }
  catch (e) { if (newsCache) return newsCache; throw e; }
  return newsCache;
}

exports.espnNews = onRequest({region: 'us-central1', memory: '256MiB', maxInstances: 5, timeoutSeconds: 20, invoker: 'public'}, async (req, res) => {
  try {
    const out = await latestNews();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
    res.json(out);
  } catch (e) {
    logger.warn('ESPN news unavailable: ' + e.message);
    res.status(502).json({error: 'News is unavailable right now.'});
  }
});

/* Game context for start/sit calls (the app's Lineups rows), one copy for everyone kept 30
   minutes: each team's game this week from ESPN's scoreboard (opponent, kickoff, the betting
   line and each side's expected points), the forecast at kickoff for outdoor games in the US
   (the National Weather Service, public domain; each home stadium's spot from STADIUMS), and
   the fantasy points each defense gives up to each position (nflverse's weekly player stats,
   CC BY 4.0: last season's until three weeks of this one are played; kept 12 hours). */
const STADIUMS = {
  ARI: [33.5276, -112.2626], ATL: [33.7554, -84.4010], BAL: [39.2780, -76.6227], BUF: [42.7738, -78.7870], CAR: [35.2258, -80.8528],
  CHI: [41.8623, -87.6167], CIN: [39.0955, -84.5161], CLE: [41.5061, -81.6995], DAL: [32.7473, -97.0945], DEN: [39.7439, -105.0201],
  DET: [42.3400, -83.0456], GB: [44.5013, -88.0622], HOU: [29.6847, -95.4107], IND: [39.7601, -86.1639], JAX: [30.3239, -81.6373],
  KC: [39.0489, -94.4839], LV: [36.0909, -115.1833], LAC: [33.9535, -118.3392], LAR: [33.9535, -118.3392], MIA: [25.9580, -80.2389],
  MIN: [44.9737, -93.2575], NE: [42.0909, -71.2643], NO: [29.9511, -90.0812], NYG: [40.8135, -74.0745], NYJ: [40.8135, -74.0745],
  PHI: [39.9008, -75.1675], PIT: [40.4468, -80.0158], SF: [37.4033, -121.9694], SEA: [47.5952, -122.3316], TB: [27.9759, -82.5033],
  TEN: [36.1665, -86.7713], WAS: [38.9077, -76.8645]
};
const NWS = 'https://api.weather.gov';
const NWS_HEADERS = {'User-Agent': 'TitanFantasyFootball (gainalphatrading@gmail.com)', Accept: 'application/geo+json'};
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_';
const CONTEXT_KEEP = 30 * 60 * 1000, DVP_KEEP = 12 * 3600 * 1000;
let contextCache = null, dvpCache = null;
const hourlyAt = {}; // each stadium's hourly-forecast address, which doesn't change

async function nwsJson(url) {
  const res = await fetch(url, {headers: NWS_HEADERS});
  if (!res.ok) throw new Error('NWS answered ' + res.status);
  return res.json();
}

// The forecast hour covering a kickoff at a team's stadium: {temp (°F), wind (mph, the top of the range), precip (%), text}, or null.
async function kickoffWeather(team, at, get = nwsJson) {
  const spot = STADIUMS[team];
  if (!spot) return null;
  if (!hourlyAt[team]) hourlyAt[team] = (await get(`${NWS}/points/${spot[0]},${spot[1]}`)).properties.forecastHourly;
  const periods = (((await get(hourlyAt[team])) || {}).properties || {}).periods || [];
  const p = periods.find(x => Date.parse(x.startTime) <= at && at < Date.parse(x.endTime));
  if (!p) return null;
  const winds = (String(p.windSpeed || '').match(/\d+/g) || []).map(Number);
  return {temp: p.temperatureUnit === 'C' ? Math.round(p.temperature * 9 / 5 + 32) : p.temperature, wind: winds.length ? Math.max(...winds) : 0,
    precip: (p.probabilityOfPrecipitation || {}).value || 0, text: p.shortForecast || ''};
}

async function csvGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
}

// Points allowed by position (SCC.dvpFrom) for a season, or last season's until three weeks are in.
async function dvpFor(season, now = Date.now(), get = csvGz, doc = db.doc('meta/dvp')) {
  if (dvpCache && dvpCache.season === season && now - dvpCache.at < DVP_KEEP) return dvpCache;
  const saved = (await doc.get()).data();
  if (saved && saved.season === season && now - saved.at < DVP_KEEP) return (dvpCache = saved);
  try {
    let d = null, from = season;
    try { d = SCC.dvpFrom(SCC.splitRows(await get(`${NFLVERSE}${season}.csv.gz`))); } catch (e) { d = null; }
    if (!d || d.weeks < 3) { from = season - 1; d = SCC.dvpFrom(SCC.splitRows(await get(`${NFLVERSE}${from}.csv.gz`))); }
    const out = {season, from, weeks: d.weeks, at: now, teams: d.teams};
    await doc.set(out);
    return (dvpCache = out);
  } catch (e) {
    if (saved) return (dvpCache = saved);
    throw e;
  }
}

async function buildContext(now = Date.now(), deps = {}) {
  if (contextCache && now - contextCache.at < CONTEXT_KEEP) return contextCache;
  const board = await (deps.scoreboard || ESPN.fetchScoreboard)();
  const weather = deps.weather || kickoffWeather, teams = {};
  await Promise.all(board.games.map(async g => {
    const imp = SCC.impliedTotals(g);
    const forecast = !g.indoor && !g.neutral && g.country === 'USA' && g.state === 'pre' && g.kickoff > now && g.kickoff - now < 6 * 24 * 3600 * 1000;
    const w = forecast ? await weather(g.home, g.kickoff).catch(() => null) : null;
    const side = (opp, home) => ({opp, home, kickoff: g.kickoff, spread: g.spread === null ? null : home ? g.spread : -g.spread,
      total: g.total, implied: imp ? (home ? imp.home : imp.away) : null, indoor: g.indoor, weather: w});
    teams[g.home] = side(g.away, true);
    teams[g.away] = side(g.home, false);
  }));
  let d = null;
  try { d = await (deps.dvp || dvpFor)(board.season || new Date(now).getUTCFullYear(), now); }
  catch (e) { logger.warn('points allowed unavailable: ' + e.message); }
  return (contextCache = {at: now, season: board.season, week: board.week, teams,
    dvp: d ? d.teams : null, dvpSeason: d ? d.from : null, dvpWeeks: d ? d.weeks : 0});
}

exports.gameContext = onRequest({region: 'us-central1', memory: '1GiB', maxInstances: 3, timeoutSeconds: 120, invoker: 'public'}, async (req, res) => {
  try {
    const out = await buildContext();
    res.set('Cache-Control', 'public, max-age=900, s-maxage=1800');
    res.json(out);
  } catch (e) {
    logger.warn('game context unavailable: ' + e.message);
    res.status(502).json({error: 'Game context is unavailable right now.'});
  }
});

exports._test = {valuesFormat, valuesKey, slimValues, tradeValues, newsAlerts, latestNews, kickoffWeather, dvpFor, buildContext, run, freezeForUser, ranksFor, playerMap, pack, unpack, countStats, alertUser, deliver, hasAlerts, sendTest,
  yahooAuthUrl, yahooToken, yahooRead, linkYahoo, yahooAccess,
  setSend: fn => { sendPush = fn; }};
