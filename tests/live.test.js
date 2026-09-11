// A real Sleeper account end to end: lookup, league discovery, byes from the
// schedule, refresh, analysis, projections, the kickoff record and the Results
// scoring. Runs only when TITAN_SLEEPER_USER is set (never write a username
// into this repo). Rankings are the public sample file.
const T = require('./lib');
const SCC = T.app('engine.js');
const API = T.app('sleeper.js');
const {check, section} = T;

if (!T.sleeperUser) {
  T.skip('live Sleeper account (set TITAN_SLEEPER_USER to run it)');
  process.exit(0);
}

(async () => {
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: await T.sleeperPlayers()});
  const weekly = SCC.weeklyMap(SCC.parseRanks(T.sampleRanks()).rows);

  section('account');
  const me = await API.lookupUser(T.sleeperUser);
  check(!!(me && me.userId), 'the account is found');
  check(await API.lookupUser('zz-no-such-user-9f3k2') === null, 'an unknown username gives nothing');
  check(await API.lookupUser('  @' + T.sleeperUser.toUpperCase() + ' ') !== null, 'a leading @, spaces and capitals are tolerated');

  section('leagues and schedule');
  const state = await T.nflState();
  const found = await API.discoverLeagues(me.userId, String(state.league_season || state.season), {});
  check(found.length > 0 && found.every(l => l.lineup.length > 0), `${found.length} leagues found, each with its lineup`);
  const byes = SCC.byesFromSchedule(await API.getJson('https://api.sleeper.app/schedule/nfl/regular/' + state.season));
  check(Object.keys(byes).length === 32, 'a bye week for all 32 teams');

  section('refresh and analysis');
  const snap = await API.collect(Object.assign({}, me, {prefs: {}}), null, null);
  check(snap.leagues.length > 0, `${snap.leagues.length} leagues loaded`);
  const A = SCC.analyzeAll(snap, weekly);
  check(A.leagues.every(L => L.rows.length === L.cfg.lineup.length), 'every lineup spot gets a verdict');
  check(SCC.exposure(A.leagues).active === snap.leagues.length, 'exposure counts every team');
  check(SCC.byeNeeds(A.leagues, snap.week).length === snap.leagues.length, 'bye-week needs checked for every league');

  section('scores');
  const started = snap.leagues.reduce((t, d) => t + d.roster.filter(p => p.locked).length, 0);
  const withPts = () => snap.leagues.reduce((t, d) => t + d.roster.filter(p => typeof p.pts === 'number').length, 0);
  if (started) check(withPts() >= started * 0.8, `${withPts()} of ${started} started players have points`);
  else T.skip('no rostered player\'s game has started this week, so there are no points yet');
  const n = await API.livePoints(snap, true);
  check(typeof n === 'number' && !!snap.pointsAt, `a live score update ran (${n} players with points)`);

  section('matchups');
  const mus = await API.collectMatchups(snap);
  const full = mus.filter(x => x.me && x.opp && x.opp.players.length === x.cfg.lineup.length);
  check(mus.length === snap.leagues.length && full.length + mus.filter(x => x.none).length === mus.length && !mus.some(x => x.error),
    `this week's matchups: ${full.length} with both lineups, ${mus.filter(x => x.none).length} with none`);

  section('projections, kickoff record, Results');
  const proj = await API.fetchProjections(snap.season, snap.week);
  check(Object.keys(proj).length > 300, `${Object.keys(proj).length} projections for week ${snap.week}`);
  const hist = SCC.freezeWeek(null, A, proj, snap.season, snap.week);
  const size = JSON.stringify(hist).length;
  check(Object.keys(hist.leagues).length === snap.leagues.length && size < 900000, `the week's record covers every league (${Math.round(size / 1024)} KB)`);
  const res = await API.collectScores(me, snap.leagues.map(d => d.cfg), snap.week, snap.season);
  if (res.started) {
    const W = SCC.scoreWeek(res, weekly, hist, proj);
    check(W.rows.length === snap.leagues.length, `week ${snap.week} scored: ${W.totals.actual} points, ${W.totals.projActual} projected`);
  } else {
    T.skip(`week ${snap.week} hasn't kicked off, so there's nothing to score`);
  }
  T.done();
})().catch(T.crash);
