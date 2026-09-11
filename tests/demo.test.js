// demo.js: the two sample leagues behind "Try a demo", built from Sleeper's
// real player list and this week's projections, and a full demo refresh.
const T = require('./lib');
const SCC = T.app('engine.js');
const API = T.app('sleeper.js');
// sleeper.js finds the demo on the global object, as it does in the browser.
const Demo = global.TitanDemo = T.app('demo.js');
const {check, section} = T;

(async () => {
  const players = await T.sleeperPlayers();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const state = await T.nflState();
  const season = String(state.season), week = Math.max(1, Number(state.week) || 1);
  const proj = await API.fetchProjections(season, week);
  if (Object.keys(proj).length < 200) { T.skip(`no projections for week ${week} yet (the off-season)`); T.done(); return; }

  section('the demo leagues');
  const D = Demo.build(proj, players, {});
  check(D.length === 2 && D.every(d => !d.error), 'two demo leagues: ' + D.map(d => `${d.cfg.key} (${d.roster.length} players)`).join(', '));
  check(D[0].roster.length === 15 && D[1].roster.length === 15 && D[0].startCount === 9 && D[1].startCount === 10,
    'full rosters, and every starting spot filled');
  check(D.every(d => d.roster.every(p => p.name && !/^id /.test(p.name) && p.team)), 'every player is a real NFL player with a team');
  const shared = D[0].roster.filter(p => D[1].roster.some(q => q.id === p.id)).length;
  check(shared === 3, `${shared} players on both teams, for Exposure`);
  check(D.every(d => d.cfg.demo && d.cfg.active), 'marked as demo leagues, switched on');
  const A = SCC.analyzeAll({week, leagues: D}, SCC.rankingsBy([], proj, players));
  const L1 = A.leagues[0];
  check(L1.moves.some(m => m.inn.pos === 'RB') && L1.wire.length > 0,
    `Titan finds lineup changes (${L1.moves.length}) and waiver upgrades (${L1.wire.length}) in the first league`);
  const again = Demo.build(proj, players, {'demo:2': {active: false}});
  check(JSON.stringify(again[0].roster.map(p => p.id)) === JSON.stringify(D[0].roster.map(p => p.id)) && again[1].cfg.active === false,
    'the same week builds the same leagues, and a league switched off stays off');
  check(Demo.build({}, players, {}).length === 0, 'no projections yet: no demo leagues');

  section('a demo refresh');
  const snap = await API.collect({demo: true, userId: '', displayName: 'Demo leagues', prefs: {}, espn: {leagues: []}}, null, null);
  check(snap.leagues.length === 2 && snap.available.length === 2 && snap.leagues.every(d => d.cfg.demo),
    'a refresh builds both: ' + (snap.log.find(l => /^Demo/.test(l)) || 'no log line'));
  check(Object.keys(snap.games || {}).length > 0 && snap.leagues[0].roster.every(p => typeof p.locked === 'boolean' && p.game !== undefined),
    'the real game clock applies (locks and game days)');
  const small = Object.keys(snap.players || {}).length;
  check(small > 200 && small < 5000 && snap.leagues.every(d => d.roster.every(p => p.name && !/^id /.test(p.name))),
    `players named from the week's projections (${small} of them), without Sleeper's full list`);
  const saved = API.store.get(API.PLAYERS_KEY);
  check(saved && Object.keys(saved.map).length > 5000, 'the saved full player list is left as it was');
  T.done();
})().catch(T.crash);
