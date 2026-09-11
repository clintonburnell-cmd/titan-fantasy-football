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
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const zlib = require('zlib');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getAuth} = require('firebase-admin/auth');
const {getMessaging} = require('firebase-admin/messaging');
const SCC = require('./shared/engine.js');
const API = require('./shared/sleeper.js');
const ESPN = require('./shared/espn.js');

initializeApp();
const db = getFirestore();
db.settings({ignoreUndefinedProperties: true});

const SLEEPER = 'https://api.sleeper.app';
const PROJ_POS = '&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF';
const PLAYERS_TTL = 3 * 24 * 3600 * 1000;
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
    if (saved.exists && saved.get('gz') && Date.now() - saved.get('ts') < PLAYERS_TTL) {
      warm = {ts: saved.get('ts'), map: unpack(saved.get('gz'))};
      return warm.map;
    }
  } catch (e) {
    logger.warn('saved player list unreadable: ' + e.message);
  }
  warm = {ts: Date.now(), map: SCC.trimPlayers(await getJson(SLEEPER + '/v1/players/nfl'))};
  // Best effort: failing to cache the list must not stop anyone's calls being saved.
  await ref.set({ts: warm.ts, gz: pack(warm.map)}).catch(e => logger.warn('could not cache the player list: ' + e.message));
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
    want: Object.assign({out: true, check: true}, doc.prefs || {})});
  return list.length ? deliver(ref, list, sent) : 0;
}

/* Sends each alert to every device on file, forgets devices that no longer
   accept alerts, and saves what was sent. The document is read again just
   before writing, so a device added meanwhile isn't lost. */
async function deliver(ref, list, sent) {
  const doc = (await ref.get()).data() || {};
  let tokens = Object.keys(doc.tokens || {});
  const dead = new Set();
  let n = 0;
  for (const a of list) {
    if (!tokens.length) break;
    const res = await sendPush({tokens, data: {title: a.title, body: a.body, url: '/app/', tag: a.key},
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
  await ref.set(Object.assign({}, latest, {tokens: keep, sent}));
  return n;
}

async function run() {
  const state = await getJson(SLEEPER + '/v1/state/nfl');
  const season = String(state.season);
  const week = Number(state.week);
  if (state.season_type !== 'regular' || !week) { logger.debug('not the regular season'); return 'off-season'; }

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
  if (!gameDay && !reportTime) { logger.debug('no games today'); return 'no games today'; }

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
  logger.info(`week ${week}: ${what} ${done} user(s), ${sent} alert(s) sent, ${failed} failed`);
  return `week ${week}: ${what} ${done}, ${sent} alerts, ${failed} failed`;
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

// For local testing without Cloud Scheduler.
exports._test = {run, freezeForUser, ranksFor, playerMap, pack, unpack, countStats, alertUser, deliver, hasAlerts, sendTest,
  setSend: fn => { sendPush = fn; }};
