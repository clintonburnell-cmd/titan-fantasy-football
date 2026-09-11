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

T.done();
