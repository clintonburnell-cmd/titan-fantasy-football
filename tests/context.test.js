// Game context on start/sit calls: expected points from a betting line, ESPN's scoreboard,
// points allowed by position (nflverse's weekly stats) and the tags a Lineups row shows.
// Made-up data only, no network.
const T = require('./lib');
const SCC = T.app('engine.js');
const ESPN = T.app('espn.js');
const {check, section} = T;

section('expected points from the betting line');
check(JSON.stringify(SCC.impliedTotals({total: 50.5, spread: -3.5})) === '{"home":27,"away":23.5}' &&
  JSON.stringify(SCC.impliedTotals({total: 47.5, spread: 3.5})) === '{"home":22,"away":25.5}' && SCC.impliedTotals({total: 44, spread: null}) === null,
  'the over/under split by the spread: a 3.5-point home favorite in a 50.5 game expects 27 to 23.5; no line, nothing');

section('ESPN\'s scoreboard');
const board = ESPN.scoreboardFrom({season: {year: 2026}, week: {number: 1}, events: [
  {id: '1', date: '2026-09-13T17:00Z', competitions: [{neutralSite: false, venue: {indoor: false, address: {country: 'USA'}}, status: {type: {state: 'pre'}},
    odds: [{overUnder: 50.5, spread: -3.5}], competitors: [{homeAway: 'home', team: {abbreviation: 'CIN'}}, {homeAway: 'away', team: {abbreviation: 'TB'}}]}]},
  {id: '2', date: '2026-09-14T00:20Z', competitions: [{venue: {indoor: true}, competitors: [{homeAway: 'home', team: {abbreviation: 'WSH'}}, {homeAway: 'away', team: {abbreviation: 'LA'}}]}]}]});
check(board.season === 2026 && board.week === 1 && board.games.length === 2 && board.games[0].home === 'CIN' && board.games[0].spread === -3.5 &&
  board.games[0].total === 50.5 && board.games[0].country === 'USA' && board.games[1].home === 'WAS' && board.games[1].away === 'LAR' &&
  board.games[1].spread === null && board.games[1].indoor, 'each game with its line, venue and Titan\'s team abbreviations (WSH is WAS, LA is LAR)');

section('points allowed by position');
const rows = [['player_id', 'position', 'season_type', 'week', 'opponent_team', 'fantasy_points_ppr'],
  ['a', 'RB', 'REG', '1', 'MIA', '20'], ['b', 'RB', 'REG', '1', 'MIA', '10'], ['c', 'RB', 'REG', '2', 'MIA', '12'], ['d', 'RB', 'REG', '1', 'BUF', '8'],
  ['e', 'RB', 'POST', '19', 'BUF', '50'], ['f', 'WR', 'REG', '1', 'LA', '15'], ['g', 'K', 'REG', '1', 'MIA', '9']];
const dvp = SCC.dvpFrom(rows);
check(dvp.teams.MIA.RB.avg === 21 && dvp.teams.MIA.RB.rank === 1 && dvp.teams.BUF.RB.avg === 8 && dvp.teams.BUF.RB.rank === 2 &&
  dvp.teams.LAR.WR.rank === 1 && !dvp.teams.MIA.K && dvp.weeks === 2,
  'per game against each defense (MIA: 30, then 12, is 21 a game), ranked most first; the playoffs and kickers left out');
check(SCC.dvpFrom([['name', 'week']]).weeks === 0, 'a file without the columns gives nothing');

section('a player\'s tags');
const ctx = {teams: {CIN: {opp: 'TB', home: true, implied: 27, weather: {temp: 20, wind: 18, precip: 70, text: 'Snow Showers'}},
  TB: {opp: 'CIN', home: false, implied: 23.5}}, dvp: {TB: {RB: {rank: 3}, WR: {rank: 30}}}};
const tags = p => SCC.gameTags(ctx, p, {opp: true}).map(t => (t.tone ? t.tone + ':' : '') + t.text);
const rb = tags({pos: 'RB', team: 'CIN'});
check(rb[0] === 'vs TB' && rb.includes('good:team expected 27 pts') && rb.includes('good:soft matchup: TB gives up the 3rd most to RBs') &&
  rb.includes('amber:wind 18 mph') && rb.includes('amber:snow 70%') && rb.includes('amber:20° at kickoff'), rb.join(' | '));
check(tags({pos: 'WR', team: 'CIN'}).includes('amber:tough matchup: TB gives up the 3rd fewest to WRs'), 'a tough matchup');
const def = tags({pos: 'DEF', team: 'TB'});
check(def[0] === '@ CIN' && def.includes('amber:CIN expected 27 pts') && SCC.gameTags(ctx, {pos: 'QB', team: 'KC'}).length === 0 &&
  SCC.gameTags(null, {pos: 'QB', team: 'CIN'}).length === 0, 'a defense sees the opponent\'s expected points; no context, no tags: ' + def.join(' | '));

T.done();
