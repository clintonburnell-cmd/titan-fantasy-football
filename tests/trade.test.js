// The Trade tab's arithmetic (engine.js): each league's format as FantasyCalc
// prices it, finding a player's value, and weighing the two sides of a trade.
// No network: the values are made up.
const T = require('./lib');
const SCC = T.app('engine.js');
const {check, section} = T;

section('league format');
const std = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const f = SCC.tradeFormat({lineup: std, teams: 12, ppr: 1, kind: 'Redraft'});
check(f.dynasty === false && f.qbs === 1 && f.teams === 12 && f.ppr === 1, 'a 12-team PPR redraft league: ' + JSON.stringify(f));
const sf = SCC.tradeFormat({lineup: ['QB', 'RB', 'WR', 'SUPER_FLEX'], teams: 9, ppr: 0.5, kind: 'Dynasty'});
check(sf.dynasty === true && sf.qbs === 2 && sf.teams === 8 && sf.ppr === 0.5, 'superflex dynasty, 9 teams priced as FantasyCalc\'s nearest (8), half PPR');
check(SCC.tradeFormat({lineup: ['QB', 'QB', 'RB'], teams: 16, ppr: 0}).qbs === 2 && SCC.tradeFormat({lineup: std, teams: 16}).teams === 14 &&
  SCC.tradeFormat({lineup: std, teams: 4}).teams === 8 && SCC.tradeFormat({lineup: std, ppr: 0.2}).ppr === 0, 'two QB spots count as superflex; team counts and scoring snap to what FantasyCalc offers');
check(SCC.tradeFormat({lineup: std, teams: 10, ppr: 1, kind: 'Keeper'}).dynasty === false, 'keeper leagues use redraft values');

section('values');
const idx = SCC.valueIndex([{s: '4046', e: '3918298', v: 9000}, {s: '9509', e: '', v: 5000}]);
check(SCC.playerValue(idx, {id: '4046'}).v === 9000 && SCC.playerValue(idx, {id: 'espn:3918298', espnId: 3918298}).v === 9000 &&
  SCC.playerValue(idx, {id: '9509', espnId: 1}).v === 5000 && SCC.playerValue(idx, {id: '1'}) === null,
  'found by Sleeper id, or by ESPN id for an ESPN player Titan couldn\'t match; none for a player without a value');

section('weighing a trade');
const star = SCC.tradeVerdict([10000], [5000, 5000]);
check(star.get.raw === 10000 && Math.round(star.get.adj) === 8706 && star.winner === 'them',
  `giving a 10,000 star for two 5,000 players loses: they weigh ${Math.round(star.get.adj)}`);
check(Math.abs(SCC.tradeSide([5000, 5000, star.even]).adj - 10000) < 1, `adding a player worth ${Math.round(star.even)} to the lighter side evens it`);
const fair = SCC.tradeVerdict([5000], [5200]);
check(fair.fair && fair.winner === 'even' && fair.even === 0, 'within 5% is fair');
const win = SCC.tradeVerdict([4000], [6000]);
check(!win.fair && win.winner === 'you' && Math.round(win.diff) === 2000, 'getting more wins, by the difference');
check(SCC.tradeVerdict([], []).fair && SCC.tradeSide([10000, 200]).adj < 10200, 'an empty trade is even; a small throw-in adds less than its value');

section('draft picks (dynasty)');
const dp = SCC.draftPicks([1, 2, 3], [{season: '2027', round: 1, roster_id: 2, owner_id: 1}, {season: '2028', round: 2, roster_id: 1, owner_id: 3},
  {season: '2027', round: 2, roster_id: 3, owner_id: 9}], ['2027', '2028'], 2);
check(dp[1].length === 4 && dp[2].length === 3 && dp[3].length === 5, `every team starts with its own picks, moved by trades: ${dp[1].length}, ${dp[2].length}, ${dp[3].length}`);
const got1st = dp[1].find(p => p.id === 'pick:2027:1:2');
check(got1st && got1st.vid === 'FP_2027_1' && got1st.name === '2027 1st' && got1st.from === 2 && dp[3].some(p => p.id === 'pick:2027:2:3'),
  'an acquired pick keeps the team it came from; a trade to a team not in the league is ignored');
check(SCC.draftPicks([1], [], ['2027'], 5)[1].length === 4 && SCC.draftPicks([1], [], ['2027'], 0)[1].length === 4, 'rounds 1 to 4, as FantasyCalc prices them');
check(SCC.playerValue(SCC.valueIndex([{s: 'FP_2027_1', v: 2837}]), got1st).v === 2837, 'a pick takes FantasyCalc\'s value for its season and round');

section('lineup impact');
const ro = [{id: 'a', pos: 'QB'}, {id: 'b', pos: 'RB'}, {id: 'c', pos: 'RB'}, {id: 'd', pos: 'WR'}, {id: 'e', pos: 'RB', held: true}, got1st];
const pp = {a: 20, b: 15, c: 10, d: 12, e: 30};
check(SCC.lineupPoints(ro, ['QB', 'RB', 'FLEX'], p => pp[p.id]) === 47, 'best lineup by projection: QB 20, RB 15, FLEX 12 (the IR player and the pick can\'t start)');
check(SCC.lineupPoints(ro.filter(p => p.id !== 'b'), ['QB', 'RB', 'FLEX'], p => pp[p.id]) === 42, 'without the top RB the lineup drops to 42');

// sleeper.js reading a league's teams, with Sleeper's answers made up here (no network).
section('a dynasty Sleeper league\'s teams and picks');
(async () => {
  const API = T.app('sleeper.js');
  const players = await T.sleeperPlayers();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const ids = Object.keys(players).filter(id => /^\d+$/.test(id)).slice(0, 4);
  const replies = {
    '/rosters': [{roster_id: 1, owner_id: 'u1', players: [ids[0], ids[1]], reserve: [ids[1]]},
      {roster_id: 2, owner_id: 'u2', players: [ids[2], ids[3]], taxi: [ids[3]]}],
    '/users': [{user_id: 'u1', display_name: 'Me'}, {user_id: 'u2', display_name: 'Pat', metadata: {team_name: 'Pat\'s Team'}}],
    '/traded_picks': [{season: '2027', round: 1, roster_id: 2, owner_id: 1}]
  };
  const asked = [];
  global.fetch = async url => {
    asked.push(url);
    const k = Object.keys(replies).find(s => url.endsWith(s));
    return new Response(JSON.stringify(k ? replies[k] : []), {status: k ? 200 : 404});
  };
  const teams = await API.leagueTeams({id: '42', kind: 'Dynasty', rounds: 3, lineup: ['QB']}, 1, '2026');
  const me = teams.find(t => t.mine), pat = teams.find(t => !t.mine);
  check(teams.length === 2 && me.name === 'Me' && pat.name === 'Pat\'s Team' && me.roster[1].held && pat.roster[1].held && !me.roster[0].held,
    'both teams, named as Sleeper shows them, with IR and taxi players marked');
  check(me.picks.length === 10 && pat.picks.length === 8 && me.picks.some(p => p.id === 'pick:2027:1:2' && p.via === 'Pat\'s Team') && me.picks[0].season === '2027',
    `3 rounds of each of the next three drafts, plus the 1st traded from Pat's Team (${me.picks.length} and ${pat.picks.length})`);
  const red = await API.leagueTeams({id: '43', kind: 'Redraft', lineup: ['QB']}, 1, '2026');
  check(!red[0].picks && !asked.some(u => /43\/traded_picks/.test(u)), 'a redraft league has no picks and doesn\'t ask for them');
  T.done();
})().catch(T.crash);
