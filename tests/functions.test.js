// The server job (functions/index.js) run locally against a stand-in for
// Firestore: an ESPN-only account on the test league, a private ESPN league
// opened with a saved login, and the compressed player-list cache. Nothing is
// written anywhere real. Needs `npm install` in functions/ once.
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');
const T = require('./lib');
const {check, section} = T;

const FN = path.join(T.ROOT, 'functions');
if (!fs.existsSync(path.join(FN, 'node_modules', 'firebase-functions'))) {
  T.skip('functions/node_modules is missing (run npm install in functions/)');
  process.exit(0);
}
execSync('node copy-shared.js', {cwd: FN, stdio: 'ignore'});
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'titan-fantasy-football';
const job = require(path.join(FN, 'index.js'))._test;
const SCC = require(path.join(FN, 'shared', 'engine.js'));
const API = require(path.join(FN, 'shared', 'sleeper.js'));

// users/{uid} with its ranks, history and private collections, in memory.
function fakeUser(db) {
  return {
    collection: name => ({
      get: async () => ({forEach: cb => Object.entries(db[name]).forEach(([id, data]) => cb({id, get: k => data[k]}))}),
      doc: id => ({
        get: async () => ({data: () => db[name][id]}),
        set: async v => { db[name][id] = JSON.parse(JSON.stringify(v)); }
      })
    })
  };
}

(async () => {
  const players = await T.sleeperPlayers();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const {season, league: L1} = await T.espnLeagues();
  const rows = SCC.parseRanks(T.sampleRanks()).rows;

  section('helpers');
  check(job.ranksFor({1: rows}, 1) === rows && job.ranksFor({1: rows}, 3) === rows && job.ranksFor({2: ['x']}, 1)[0] === 'x' && job.ranksFor({}, 1).length === 0,
    'ranksFor: that week, else the latest earlier week, else the only week, else none');

  section('trade values (FantasyCalc, cached by Titan\'s server)');
  const tvFormat = job.valuesFormat({dynasty: '0', qbs: '2', teams: '10', ppr: '0.5'});
  check(tvFormat && tvFormat.dynasty === false && tvFormat.qbs === 2 && tvFormat.teams === 10 && tvFormat.ppr === 0.5 &&
    job.valuesKey(tvFormat) === 'redraft-2qb-10teams-0.5ppr', 'a league format from the address: ' + (tvFormat ? job.valuesKey(tvFormat) : 'none'));
  check(job.valuesFormat({teams: '11'}) === null && job.valuesFormat({ppr: '2'}) === null && job.valuesFormat({dynasty: 'maybe'}) === null &&
    job.valuesFormat({qbs: '3'}) === null, 'formats FantasyCalc doesn\'t offer are refused');
  const fcList = [{player: {name: 'A', sleeperId: 4046, espnId: '3918298', position: 'QB', maybeTeam: 'BUF'}, value: 9000.4, overallRank: 1, positionRank: 1, trend30Day: 120},
    {player: {name: 'Gone', sleeperId: '1'}, value: 0}];
  const tvSlim = job.slimValues(fcList);
  check(tvSlim.length === 1 && tvSlim[0].s === '4046' && tvSlim[0].e === '3918298' && tvSlim[0].v === 9000 && tvSlim[0].tr === 120 && tvSlim[0].pr === 1,
    'kept small: ids, name, position, value, ranks and trend; players without a value dropped');
  const tvStore = {}, tvDoc = k => ({get: async () => ({data: () => tvStore[k]}), set: async v => { tvStore[k] = v; }});
  const tvAsked = [], tvFetch = async url => { tvAsked.push(url); return fcList; };
  const tv0 = Date.parse('2026-09-11T12:00:00Z'), hour = 3600 * 1000;
  const tvFirst = await job.tradeValues(tvFormat, tvDoc('k'), tv0, tvFetch);
  const tvAgain = await job.tradeValues(tvFormat, tvDoc('k'), tv0 + hour, tvFetch);
  check(tvAsked.length === 1 && tvFirst.values.length === 1 && tvAgain.at === tv0 &&
    tvAsked[0] === 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=10&ppr=0.5',
    'FantasyCalc is asked once, at its documented address; the saved copy serves the rest of the day');
  await job.tradeValues(tvFormat, tvDoc('k'), tv0 + 25 * hour, tvFetch);
  check(tvAsked.length === 2, 'a day later it asks again');
  const tvDown = await job.tradeValues(tvFormat, tvDoc('k'), tv0 + 50 * hour, async () => { throw new Error('down'); });
  let tvThrew = false;
  try { await job.tradeValues(tvFormat, tvDoc('none'), tv0, async () => { throw new Error('down'); }); } catch (e) { tvThrew = true; }
  check(tvDown.values.length === 1 && tvThrew, 'if FantasyCalc is down the last saved copy serves; with none saved, the failure is reported');
  const now = Date.parse('2026-09-11T12:00:00Z'), day = 24 * 3600 * 1000;
  const iso = ms => new Date(ms).toUTCString();
  const st = job.countStats(now,
    [{metadata: {creationTime: iso(now - 2 * day), lastRefreshTime: iso(now - day)}},
      {metadata: {creationTime: iso(now - 30 * day), lastSignInTime: iso(now - 20 * day)}}],
    [{userId: '1'}, {espn: {leagues: [{id: 'a'}, {id: 'b'}]}}, {}], 2, 1);
  check(st.accounts === 2 && st.newThisWeek === 1 && st.activeThisWeek === 1 && st.sleeper === 1 && st.espnPeople === 1 &&
    st.espnLeagues === 2 && st.withRankings === 2 && st.alertsOn === 1, 'owner stats: accounts, new and active this week, and what people linked');
  const gz = job.pack(players);
  check(JSON.stringify(job.unpack(new Uint8Array(gz))) === JSON.stringify(players) && gz.length < 900000,
    `the cached player list round-trips gzipped (${Math.round(gz.length / 1024)} KB, Firestore allows 1 MB)`);

  section('one account, one week');
  const sawCookie = [];
  const undo = T.stubEspn({
    99999901: L1,
    // A private league: only answers with the saved login's cookie.
    99999904: (url, opts) => {
      const cookie = (opts && opts.headers && opts.headers.Cookie) || '';
      sawCookie.push(cookie);
      return /espn_s2=test-s2/.test(cookie) && /SWID=\{0000000[1]/.test(cookie)
        ? new Response(JSON.stringify(Object.assign({}, L1, {id: 99999904, settings: Object.assign({}, L1.settings, {name: 'Private Test'})})), {status: 200})
        : new Response('{}', {status: 401});
    }
  });
  const proj = await API.fetchProjections(season, 1);
  const ctx = {season, week: 1, proj, players};
  const account = {userId: '', displayName: 'Test', prefs: {}, espn: {leagues: [{id: '99999901', teamId: 1}, {id: '99999904', teamId: 1}]}};

  const noLogin = {ranks: {1: {rows}}, history: {}, private: {}};
  await job.freezeForUser(fakeUser(noLogin), account, ctx);
  const rec1 = noLogin.history['1'];
  check(rec1 && Object.keys(rec1.leagues).join() === 'espn:99999901', 'without a login, the public league is saved and the private one skipped');

  const db = {ranks: {1: {rows}}, history: {}, private: {espn: {s2: 'test-s2', swid: '00000001-aaaa-4bbb-8ccc-dddddddddddd'}}};
  await job.freezeForUser(fakeUser(db), account, ctx);
  const rec = db.history['1'];
  const lg = rec && rec.leagues['espn:99999901'];
  check(rec && Object.keys(rec.leagues).length === 2, 'with the saved login, the private league is saved too');
  check(sawCookie.some(c => /espn_s2=test-s2; SWID=\{00000001-AAAA/.test(c)), 'the login went to ESPN as a cookie, SWID in braces');
  check(lg && Object.keys(lg.players).length === 16 && Object.values(lg.players).some(p => p.proj !== null),
    `16 players saved with ranks, calls and projections (${Object.values(lg.players).filter(p => p.proj !== null).length} projected)`);
  check(JSON.stringify(rec).indexOf('undefined') < 0, 'no undefined values (Firestore rejects them)');

  const bare = {ranks: {}, history: {}, private: {}};
  await job.freezeForUser(fakeUser(bare), account, ctx);
  const bareLg = bare.history['1'] && bare.history['1'].leagues['espn:99999901'];
  const bareRanked = bareLg ? Object.values(bareLg.players).filter(p => p.rank !== null) : [];
  const projected = bareLg ? Object.values(bareLg.players).filter(p => p.proj > 0).length : 0;
  check(bareRanked.length > 0 && bareRanked.length >= projected - 2,
    `with no rankings imported, the default rankings rank ${bareRanked.length} of 16 players (${projected} projected above 0)`);

  section('alerts');
  const pushed = [];
  job.setSend(async msg => {
    pushed.push(msg);
    return {successCount: msg.tokens.filter(t => t !== 'dead').length, responses: msg.tokens.map(t => t === 'dead'
      ? {success: false, error: {code: 'messaging/registration-token-not-registered'}} : {success: true})};
  });
  const adb = {ranks: {}, history: {}, private: {alerts: {tokens: {good: {at: 1}, dead: {at: 1}}, prefs: {out: true, check: true}}}};
  const aRef = fakeUser(adb).collection('private').doc('alerts');
  const alist = [{key: 'out|1|L|p1|Out', kind: 'out', title: 'A is out', body: 'b'}, {key: 'check|1|L|123', kind: 'check', title: 'Lineup check: L', body: 'c'}];
  const sentN = await job.deliver(aRef, alist, {'out|1|L|p1|Out': 1, 'check|1|L|123': 1});
  check(sentN === 2 && pushed.length === 2 && pushed[0].tokens.length === 2 && pushed[1].tokens.join() === 'good' &&
    pushed[0].data.title === 'A is out' && pushed[0].data.url === '/app/', 'each alert goes to every device, and a device that stops accepting them is dropped');
  check(Object.keys(adb.private.alerts.tokens).join() === 'good' && adb.private.alerts.sent['check|1|L|123'] === 1 && adb.private.alerts.prefs.out === true,
    'what was sent is remembered, the dead device forgotten, and the rest kept');
  check(await job.hasAlerts(fakeUser(adb)) && !(await job.hasAlerts(fakeUser({private: {}}))), 'who has alerts on is known');
  pushed.length = 0;
  const tdb = {private: {alerts: {tokens: {good: {at: 1}, dead: {at: 1}}}}};
  const tRef = fakeUser(tdb).collection('private').doc('alerts');
  const ok = await job.sendTest(tRef, 'good');
  const why = async t => { try { await job.sendTest(tRef, t); return 'sent'; } catch (e) { return e.code; } };
  const notOn = await why('other'), gone = await why('dead');
  check(ok.sent && pushed.length === 2 && pushed[0].tokens.join() === 'good' && pushed[0].data.title === 'Titan test alert' &&
    notOn === 'failed-precondition' && gone === 'not-found' && Object.keys(tdb.private.alerts.tokens).join() === 'good',
    `a test alert goes only to the asking device; one without alerts on is told (${notOn}); a dead one is forgotten (${gone})`);

  section('news alerts');
  pushed.length = 0;
  const story = (id, at, names) => ({id, at, headline: 'Story ' + id, text: '', url: 'https://www.espn.com/nfl/story/_/id/' + id,
    athletes: names.map(n => ({id: '', name: n})), teams: []});
  const nNow = Date.parse('2026-09-12T15:00:00Z');
  const watching = [{n: SCC.norm('Rome Odunze'), name: 'Rome Odunze', leagues: ['L1']}];
  const ndb = {private: {alerts: {tokens: {good: {at: 1}}, prefs: {news: true}, watch: watching, sent: {}}}};
  const offdb = {private: {alerts: {tokens: {good: {at: 1}}, prefs: {news: false}, watch: watching}}};
  let nMeta = {checkedAt: nNow - 15 * 60000};
  const nDeps = stories => ({now: nNow, fetchNews: async () => stories,
    metaRef: {get: async () => ({data: () => nMeta}), set: async v => { nMeta = v; }},
    userDocs: async () => [{ref: fakeUser(ndb)}, {ref: fakeUser(offdb)}]});
  const nFeed = [story('1', nNow - 5 * 60000, ['Rome Odunze']), story('2', nNow - 5 * 60000, ['Somebody Else']), story('3', nNow - 5 * 3600 * 1000, ['Rome Odunze'])];
  const n1 = await job.newsAlerts(1, nDeps(nFeed));
  const n2 = await job.newsAlerts(1, nDeps(nFeed));
  check(n1 === 1 && n2 === 0 && pushed.length === 1 && pushed[0].data.url === 'https://www.espn.com/nfl/story/_/id/1' &&
    pushed[0].data.title === 'News: Rome Odunze' && pushed[0].tokens.join() === 'good',
    'a new story about a starter goes out once and opens the story; old stories, other players and people who turned news off are skipped');
  check(nMeta.checkedAt === nNow && JSON.stringify(ndb.private.alerts.watch) === JSON.stringify(watching) && ndb.private.alerts.sent['news|1|1|' + watching[0].n] === 1,
    'the check time is saved for next time; the watch list is kept and the story remembered');
  check(await job.newsAlerts(1, nDeps([story('4', nNow - 60000, ['Somebody Else'])])) === 0, 'no story about a starter, no alert');
  let nReads = 0;
  const nRead = async () => { nReads++; return [story('9', 1, [])]; };
  const t0n = 2e12, l1 = await job.latestNews(t0n, nRead), l2 = await job.latestNews(t0n + 60000, nRead), l3 = await job.latestNews(t0n + 100000, nRead);
  const l4 = await job.latestNews(t0n + 300000, async () => { throw new Error('down'); });
  check(nReads === 2 && l1.stories.length === 1 && l2.at === t0n && l3.at === t0n + 100000 && l4.at === l3.at,
    'the News tab\'s feed: one read of ESPN is shared for 90 seconds, and the last copy serves if ESPN is down');

  const pid = Object.keys(lg.players)[0], wasLocked = lg.players[pid].locked;
  db.history['1'].leagues['espn:99999901'].players[pid].rank = -7;
  await job.freezeForUser(fakeUser(db), account, ctx);
  const again = db.history['1'].leagues['espn:99999901'].players[pid];
  check(wasLocked ? again.rank === -7 : again.rank !== -7,
    wasLocked ? 'a player whose game has started keeps his saved entry' : 'a player whose game hasn\'t started is updated');
  undo();
  T.done();
})().catch(T.crash);
