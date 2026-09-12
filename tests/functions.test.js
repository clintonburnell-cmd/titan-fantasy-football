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
  let scReads = 0;
  const scRead = async () => { scReads++; return {season: 2026, week: 1, games: [{id: '9', kickoff: 1, home: 'KC', away: 'LAC', state: 'in', hs: 14, as: 7, detail: '2nd - 5:12', spread: -3, indoor: false}]}; };
  const t0s = 3e12, sc1 = await job.latestScores(t0s, scRead), sc2 = await job.latestScores(t0s + 10000, scRead), sc3 = await job.latestScores(t0s + 30000, scRead);
  const sc4 = await job.latestScores(t0s + 60000, async () => { throw new Error('down'); });
  check(scReads === 2 && sc1.games[0].hs === 14 && sc1.games[0].detail === '2nd - 5:12' && sc1.games[0].spread === undefined && sc2.at === t0s &&
    sc3.at === t0s + 30000 && sc4.at === sc3.at, 'the scores ticker: one read of ESPN shared for 20 seconds, trimmed to what it shows; the last copy serves if ESPN is down');

  section('game context');
  const nwsGet = async url => /\/points\//.test(url) ? {properties: {forecastHourly: 'https://api.weather.gov/gridpoints/BUF/1,1/forecast/hourly'}}
    : {properties: {periods: [{startTime: '2026-09-13T12:00:00-04:00', endTime: '2026-09-13T13:00:00-04:00', temperature: 48, temperatureUnit: 'F',
      windSpeed: '10 to 20 mph', shortForecast: 'Rain', probabilityOfPrecipitation: {value: 80}}]}};
  const kw = await job.kickoffWeather('BUF', Date.parse('2026-09-13T16:30:00Z'), nwsGet);
  check(kw && kw.temp === 48 && kw.wind === 20 && kw.precip === 80 && kw.text === 'Rain' && await job.kickoffWeather('XYZ', 0, nwsGet) === null,
    'the forecast hour covering kickoff: temperature, the top of the wind range, chance of rain');
  const cur = 'position,season_type,week,opponent_team,fantasy_points_ppr\nRB,REG,1,MIA,20\n';
  const prev = 'position,season_type,week,opponent_team,fantasy_points_ppr\nRB,REG,1,MIA,20\nRB,REG,2,MIA,10\nRB,REG,3,BUF,5\n';
  let dvpSaved = null;
  const dvpDoc = {get: async () => ({data: () => dvpSaved}), set: async v => { dvpSaved = v; }};
  const gcNow = Date.parse('2026-09-12T12:00:00Z');
  const d1 = await job.dvpFor(2026, gcNow, async url => /2026/.test(url) ? cur : prev, dvpDoc);
  check(d1.from === 2025 && d1.weeks === 3 && d1.teams.MIA.RB.rank === 1 && dvpSaved && dvpSaved.season === 2026,
    'with under three weeks of this season, last season\'s points allowed, saved for the next 12 hours');
  const gcBoard = {season: 2026, week: 1, games: [
    {id: '1', kickoff: Date.parse('2026-09-13T17:00:00Z'), home: 'BUF', away: 'MIA', indoor: false, country: 'USA', neutral: false, state: 'pre', spread: -6, total: 44},
    {id: '2', kickoff: Date.parse('2026-09-13T17:00:00Z'), home: 'DET', away: 'NO', indoor: true, country: 'USA', neutral: false, state: 'pre', spread: -7, total: 49.5},
    {id: '3', kickoff: Date.parse('2026-09-13T13:30:00Z'), home: 'LAR', away: 'SF', indoor: false, country: 'Australia', neutral: true, state: 'pre', spread: null, total: null}]};
  const forecasts = [];
  const gc = await job.buildContext(gcNow, {scoreboard: async () => gcBoard, weather: async team => { forecasts.push(team); return {temp: 55, wind: 22, precip: 10, text: 'Windy'}; },
    dvp: async () => ({from: 2025, weeks: 18, teams: {MIA: {RB: {avg: 25, rank: 2}}}})});
  check(gc.teams.BUF.implied === 25 && gc.teams.MIA.implied === 19 && gc.teams.BUF.spread === -6 && gc.teams.MIA.spread === 6 && gc.teams.MIA.opp === 'BUF' &&
    gc.teams.BUF.weather.wind === 22 && gc.teams.DET.weather === null && gc.teams.SF.implied === null && forecasts.join() === 'BUF' &&
    gc.dvp.MIA.RB.rank === 2 && gc.dvpSeason === 2025, 'each team\'s line and expected points; a forecast only for outdoor games in the US; points allowed');

  const pid = Object.keys(lg.players)[0], wasLocked = lg.players[pid].locked;
  db.history['1'].leagues['espn:99999901'].players[pid].rank = -7;
  await job.freezeForUser(fakeUser(db), account, ctx);
  const again = db.history['1'].leagues['espn:99999901'].players[pid];
  check(wasLocked ? again.rank === -7 : again.rank !== -7,
    wasLocked ? 'a player whose game has started keeps his saved entry' : 'a player whose game hasn\'t started is updated');
  section('Yahoo link (sign-in handshake; tokens kept on the server)');
  const yst = 'cd'.repeat(24), ynow = 1e12;
  const yurl = new URL(job.yahooAuthUrl(yst));
  check(yurl.origin + yurl.pathname === 'https://api.login.yahoo.com/oauth2/request_auth' && yurl.searchParams.get('response_type') === 'code' &&
    yurl.searchParams.get('redirect_uri') === 'https://titanfantasyfootball.com/api/yahoo/callback' && yurl.searchParams.get('state') === yst &&
    /^dj0y/.test(yurl.searchParams.get('client_id')), 'the sign-in address: Titan\'s client id, the registered return address and the state');
  const ydb = {};
  const yStore = {doc: p => ({get: async () => ({data: () => ydb[p]}), set: async v => { ydb[p] = JSON.parse(JSON.stringify(v)); }, delete: async () => { delete ydb[p]; }})};
  const posted = [];
  const tokenReply = (a, r) => async (u, o) => { posted.push({u, o}); return new Response(JSON.stringify({access_token: a, refresh_token: r, expires_in: 3600, token_type: 'bearer'}), {status: 200}); };
  const yOk = async () => new Response('{"fantasy_content":{}}', {status: 200});
  const yDeny = async () => new Response('<error>forbidden</error>', {status: 403});
  const yDeps = extra => Object.assign({db: yStore, secret: 'test-secret', now: ynow, post: tokenReply('acc1', 'ref1'), get: yOk}, extra);
  ydb['yahooStates/' + yst] = {uid: 'u9', at: ynow - 1000};
  check(await job.linkYahoo(yst, 'code1', yDeps()) === 'linked' && ydb['yahooTokens/u9'].refresh === 'ref1' && ydb['yahooTokens/u9'].access === 'acc1' &&
    !ydb['yahooStates/' + yst], 'a fresh state links: the tokens saved at yahooTokens/{uid}, the state used up');
  const sent = posted[0];
  check(/get_token$/.test(sent.u) && Buffer.from(sent.o.headers.Authorization.replace('Basic ', ''), 'base64').toString().endsWith(':test-secret') &&
    /grant_type=authorization_code/.test(sent.o.body) && /code=code1/.test(sent.o.body) && /redirect_uri=https%3A%2F%2Ftitanfantasyfootball\.com/.test(sent.o.body),
    'the code is traded with the app\'s id and secret as Basic auth, with the return address');
  check(await job.linkYahoo(yst, 'code1', yDeps()) === 'expired', 'a state works only once');
  ydb['yahooStates/' + yst] = {uid: 'u9', at: ynow - 11 * 60 * 1000};
  check(await job.linkYahoo(yst, 'code2', yDeps()) === 'expired' && !ydb['yahooStates/' + yst], 'a state older than ten minutes is refused, and removed');
  check(await job.linkYahoo('made-up', 'code3', yDeps()) === 'failed' && await job.linkYahoo(yst, '', yDeps()) === 'failed', 'a made-up state or a missing code is refused');
  ydb['yahooStates/' + yst] = {uid: 'u8', at: ynow};
  check(await job.linkYahoo(yst, 'code4', yDeps({get: yDeny})) === 'noaccess' && !!ydb['yahooTokens/u8'],
    'Yahoo turning Titan away when it asks for leagues reads as no access yet, and the link is kept');
  const yref = yStore.doc('yahooTokens/u9');
  check(await job.yahooAccess(yref, 'test-secret', ynow + 1000, tokenReply('x', 'y')) === 'acc1', 'a token with time left is used as it is');
  check(await job.yahooAccess(yref, 'test-secret', ynow + 3600e3, tokenReply('acc2', 'ref2')) === 'acc2' && ydb['yahooTokens/u9'].refresh === 'ref2' &&
    /grant_type=refresh_token/.test(posted[posted.length - 1].o.body) && /refresh_token=ref1/.test(posted[posted.length - 1].o.body),
    'an expired token is refreshed, and Yahoo\'s new refresh token is saved at once');
  check(await job.yahooAccess(yStore.doc('yahooTokens/nobody'), 'test-secret', ynow) === null, 'nobody linked: no token');

  section('Yahoo refresh read (every league, trimmed on the server)');
  const YL = T.yahooLeague(players);
  const yAsked = [];
  const yGet = failSettings => async url => {
    yAsked.push(url);
    const body = /\/teams\/roster;week=/.test(url) ? YL.roster : /\/settings\?/.test(url) ? (failSettings ? null : YL.settings)
      : /use_login=1.*\/teams\?/.test(url) ? YL.teams : /use_login=1.*\/leagues\?/.test(url) ? YL.leagues : null;
    return body ? new Response(JSON.stringify(body), {status: 200}) : new Response('nope', {status: 500});
  };
  const yAll = await job.yahooAll('acc', '2026', 3, yGet(false));
  check(yAll.linked && yAll.leagues.length === 1 && yAll.leagues[0].teamKey === YL.key + '.t.1' && yAll.leagues[0].rosters.length === 4 &&
    yAsked.some(u => /\/league\/472\.l\.1001\/teams\/roster;week=3\?format=json$/.test(u)), 'each league\'s settings and every team\'s roster for the week, trimmed');
  const yBad = await job.yahooAll('acc', '2026', 3, yGet(true));
  check(yBad.leagues[0].error && yBad.leagues[0].name === 'Titan Yahoo Test', 'a league Yahoo won\'t read comes back with a reason');
  check((await job.yahooAll('acc', '2026', 3, async () => new Response('{"error":{}}', {status: 401}))).noaccess === true, 'Yahoo refusing Titan reads as no access yet');

  undo();
  T.done();
})().catch(T.crash);
