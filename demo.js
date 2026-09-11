/* Titan Fantasy Football Manager: "Try a demo".
 *
 * Two sample leagues built from Sleeper's real player list and this week's
 * projections, so the demo shows real players with real kickoff times and
 * injury tags without linking anything. Each spot takes the player projected
 * at a set rank for his position (RB15 is this week's 15th-best projected
 * running back), picked so the lineups show Titan at work: a better back left
 * on the bench, a weak FLEX, players on both teams (Exposure) and a few good
 * free agents. Everyone else good enough to be rostered counts as taken by
 * the league's other teams. The app keeps the demo apart from a real account.
 */
(function (root) {
  'use strict';

  var SCC = root.SCC || (typeof require === 'function' ? require('./engine.js') : null);

  var LEAGUES = [
    {cfg: {id: 'demo:1', key: 'Demo League', name: 'Demo League', teams: 12, ppr: 0.5,
      lineup: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']},
      start: [['QB', 7], ['RB', 4], ['RB', 24], ['WR', 6], ['WR', 13], ['TE', 8], ['WR', 25], ['K', 6], ['DEF', 5]],
      bench: [['QB', 19], ['RB', 15], ['RB', 33], ['WR', 38], ['TE', 21], ['RB', 41]],
      free: [['WR', 20], ['RB', 22], ['TE', 12]]},
    {cfg: {id: 'demo:2', key: 'Demo Superflex', name: 'Demo Superflex', teams: 10, ppr: 1,
      lineup: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF']},
      start: [['QB', 5], ['RB', 9], ['RB', 15], ['WR', 3], ['WR', 13], ['TE', 4], ['RB', 28], ['QB', 12], ['K', 9], ['DEF', 8]],
      bench: [['WR', 16], ['WR', 31], ['TE', 8], ['RB', 36], ['QB', 24]],
      free: [['WR', 18], ['RB', 25]]}
  ];
  // How many players per team the other rosters hold at each position.
  var DEPTH = {QB: 1.5, RB: 3.6, WR: 4.4, TE: 1.3, K: 1, DEF: 1.1};

  /* This week's projected players by position, best first. Anyone without a
     team or a projection is left out. */
  function byPosition(projMap, players) {
    var out = {QB: [], RB: [], WR: [], TE: [], K: [], DEF: []};
    for (var id in projMap) {
      var info = SCC.playerInfo(players, id);
      if (!out[info.pos] || !info.team) continue;
      var pts = SCC.projFor(projMap, id, 0.5);
      if (pts > 0) out[info.pos].push({id: String(id), pts: pts});
    }
    for (var pos in out) out[pos].sort(function (a, b) { return b.pts - a.pts || (a.id < b.id ? -1 : 1); });
    return out;
  }

  /* The demo leagues, each as SCC.buildLeague returns a Sleeper league.
     `prefs` are the person's league switches ({leagueId: {active}}). */
  function build(projMap, players, prefs) {
    var ranked = byPosition(projMap || {}, players || {});
    prefs = prefs || {};
    if (!ranked.QB.length) return [];
    return LEAGUES.map(function (L) {
      var pick = function (spot) { var e = ranked[spot[0]][spot[1] - 1]; return e ? e.id : null; };
      var start = L.start.map(pick), bench = L.bench.map(pick);
      var mine = start.concat(bench).filter(Boolean);
      var skip = {};
      mine.concat(L.free.map(pick)).forEach(function (id) { if (id) skip[id] = 1; });
      var others = [];
      Object.keys(DEPTH).forEach(function (pos) {
        ranked[pos].slice(0, Math.round(DEPTH[pos] * L.cfg.teams)).forEach(function (e) { if (!skip[e.id]) others.push(e.id); });
      });
      var pref = prefs[L.cfg.id] || {};
      var cfg = Object.assign({}, L.cfg, {demo: true, kind: 'Redraft', bestBall: false, status: 'in_season',
        active: pref.active !== undefined ? !!pref.active : true, exposure: true});
      var rosters = [
        {roster_id: 1, owner_id: 'demo', players: mine, starters: start.map(function (id) { return id || '0'; }), reserve: [], taxi: []},
        {roster_id: 2, owner_id: 'others', players: others}
      ];
      return SCC.buildLeague(cfg, rosters, 'demo', players);
    });
  }

  var api = {build: build, LEAGUES: LEAGUES};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TitanDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
