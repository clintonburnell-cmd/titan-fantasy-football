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
  const ctx = {season, week: 1, proj};
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

  const pid = Object.keys(lg.players)[0], wasLocked = lg.players[pid].locked;
  db.history['1'].leagues['espn:99999901'].players[pid].rank = -7;
  await job.freezeForUser(fakeUser(db), account, ctx);
  const again = db.history['1'].leagues['espn:99999901'].players[pid];
  check(wasLocked ? again.rank === -7 : again.rank !== -7,
    wasLocked ? 'a player whose game has started keeps his saved entry' : 'a player whose game hasn\'t started is updated');
  undo();
  T.done();
})().catch(T.crash);
