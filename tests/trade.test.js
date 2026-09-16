// The Trade tab's arithmetic (engine.js): each league's format as FantasyCalc
// prices it, finding a player's value, and weighing the two sides of a trade.
// No network: the values are made up.
const T = require('./lib');
const SCC = T.app('engine.js');
const {check, section} = T;

section('Titan\'s own value (the Trade tab for everyone but Titan\'s owner)');
{
  // Two teams starting QB, RB, WR and FLEX: RB starters come to 2 x (1 + 0.45 of the flex) = 2.9, so the 4th-best RB is replacement.
  const pl = {1: ['Q One', 'QB', 'KC'], 2: ['Q Two', 'QB', 'BUF'], 3: ['Q Three', 'QB', 'SF'], 4: ['Q Four', 'QB', 'NYJ'],
    11: ['R One', 'RB', 'KC'], 12: ['R Two', 'RB', 'BUF'], 13: ['R Three', 'RB', 'SF'], 14: ['R Four', 'RB', 'NYJ'], 15: ['R Five', 'RB', 'MIA'],
    21: ['K One', 'K', 'KC']};
  const sp = {1: [300, 0], 2: [250, 0], 3: [200, 0], 4: [150, 0], 11: [200, 10], 12: [180, 0], 13: [160, 0], 14: [140, 0], 15: [120, 0], 21: [150, 0]};
  const cfgTv = {teams: 2, ppr: 0, lineup: ['QB', 'RB', 'WR', 'FLEX']};
  const tv = SCC.titanValues(sp, pl, cfgTv);
  check(tv[1] === 100 && tv[2] === 50 && tv[3] === 0 && tv[4] === 0, 'QBs: projected points above the 3rd-best QB (two teams start one each)');
  // RB starters come to 2.9, so replacement sits nine tenths of the way from the 3rd-best (160) to the 4th (140): 142.
  check(tv[11] === 58 && tv[12] === 38 && tv[13] === 18 && tv[14] === 0 && tv[15] === 0, 'RBs: above a replacement read between the 3rd- and 4th-best, the flex shared out; nobody goes below zero');
  check(tv[21] === undefined, 'a position the league doesn\'t start gets no value');
  check(SCC.titanValues(sp, pl, Object.assign({}, cfgTv, {ppr: 1}))[11] === 68, 'in the league\'s scoring: PPR adds the catches');
  // Over weeks 1 to 17 every team sits out its bye, so each player keeps 16 of his 17 games' points.
  const span = SCC.titanValues(sp, pl, cfgTv, {from: 1, to: 17});
  check(span[1] === 94 && span[2] === 47 && span[3] === 0, 'over a span of weeks: each player\'s share of the season, his bye left out (16 of 17 games here)');
  const own = SCC.titanValues(sp, pl, cfgTv, {shares: {FLEX: {RB: 1}}});
  check(own[11] === 80 && own[12] === 60 && own[14] === 20 && own[15] === 0, 'with the league\'s own flex shares (all RB here), RB replacement moves to the 5th-best');
  const teams = [{id: 1, roster: [{id: '11', pos: 'RB'}, {id: '12', pos: 'RB'}, {id: '1', pos: 'QB'}]}, {id: 2, roster: [{id: '13', pos: 'RB'}, {id: '2', pos: 'QB'}, {id: 'w', pos: 'WR'}]}];
  const fs = SCC.flexShares(teams, ['QB', 'RB', 'FLEX'], p => ({11: 20, 12: 15, 13: 10, w: 12, 1: 30, 2: 30})[p.id] || 0);
  check(JSON.stringify(fs) === '{"FLEX":{"RB":0.5,"WR":0.5}}', 'flex shares from how the league\'s teams fill their flex spots: ' + JSON.stringify(fs));
  // Dynasty: the same backs with ages (R One 23, R Two 29): youth lifts, age cuts, and the replacement line moves with them.
  const aged = Object.assign({}, pl, {11: ['R One', 'RB', 'KC', 0, 23], 12: ['R Two', 'RB', 'BUF', 0, 29]});
  const dyn = SCC.titanValues(sp, aged, cfgTv, {dynasty: true}), flat = SCC.titanValues(sp, aged, cfgTv);
  check(SCC.ageFactor('RB', 23) === 1.15 && SCC.ageFactor('RB', 29) === 0.65 && SCC.ageFactor('WR', 27) === 1 && SCC.ageFactor('QB', 36) === 0.8 && SCC.ageFactor('RB', 0) === 1,
    'the age curve: young backs up, backs past 28 down, receivers hold to 29, quarterbacks to the mid-thirties, no age no tilt');
  check(dyn[11] > flat[11] && dyn[12] < flat[12] && dyn[1] === flat[1], `in a dynasty league R One (23) is worth more and R Two (29) less (${flat[11]}→${dyn[11]}, ${flat[12]}→${dyn[12]}); ageless players hold`);
  check(SCC.playerInfo({'9': ['A B', 'RB', 'KC', 2, 24]}, '9').age === 24 && SCC.trimPlayers({'9': {first_name: 'A', last_name: 'B', position: 'RB', team: 'KC', age: 24}})['9'][4] === 24,
    'the player list keeps each player\'s age');
}

section('season rankings');
{
  const std = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  // A 12-team PPR redraft league, and one like Studs and Duds: dynasty, superflex, +0.75 a tight end catch.
  const redraft = SCC.seasonFormat({lineup: std, teams: 12, ppr: 1, kind: 'Redraft', scoring: {}});
  const studs = SCC.seasonFormat({lineup: std.concat('SUPER_FLEX'), teams: 10, ppr: 1, kind: 'Dynasty', scoring: {bonus_rec_te: 0.75}});
  check(redraft.key === 'redraft-1qb' && !redraft.tep && studs.key === 'dynasty-sf-tep' && studs.base === 'dynasty-sf' && studs.tep,
    `each league finds its list: ${redraft.key}, and a dynasty superflex TE-premium league ${studs.key}`);
  check(SCC.seasonFormat({lineup: ['QB', 'QB', 'RB'], kind: 'Keeper'}).key === 'redraft-sf' && SCC.seasonFormat({lineup: std, kind: 'Dynasty', scoring: {bonus_rec_te: 0}}).key === 'dynasty-1qb' &&
    SCC.SEASON_FORMATS.map(f => f.base).join() === 'redraft-1qb,redraft-sf,dynasty-1qb,dynasty-sf',
    'two QB spots count as superflex, keeper leagues as redraft, and no tight end bonus means no TE Premium; four formats');

  // The market: five players worth 1000 down to 200. The person ranks the market's 4th-best player first.
  const pool = [{id: 'a', name: 'Alpha Back', pos: 'RB', v: 1000}, {id: 'b', name: 'Bravo Wide', pos: 'WR', v: 800}, {id: 'c', name: 'James Cook III', pos: 'RB', v: 600},
    {id: 'd', name: 'Delta End', pos: 'TE', v: 400}, {id: 'e', name: 'Echo Arm', pos: 'QB', v: 200}, {id: 'pk', name: '2027 1st', pos: 'PICK', v: 900}];
  const mine = [{name: 'Delta End', pos: 'TE', rank: 1}, {name: 'Alpha Back', pos: 'RB', rank: 2}, {name: 'James Cook', pos: 'RB', rank: 3}, {name: 'Nobody Here', pos: 'WR', rank: 4}];
  const S1 = SCC.seasonValues(mine, pool);
  check(S1.byId.d === 1000 && S1.byId.a === 800 && S1.byId.c === 600 && !S1.byPosition,
    'an overall list: the person\'s 1st takes the market\'s highest value, their 2nd the next (their order, the market\'s spacing)');
  check(S1.byId.b === 800 && S1.byId.e === 200 && S1.byId.pk === undefined && S1.matched === 3 && S1.listed === 4 && S1.order.d === 1 && S1.order.c === 3,
    'players the list doesn\'t name keep their market value, draft picks aren\'t ranked, "James Cook" finds James Cook III, a stranger matches nobody');
  // Ranked within each position (every position starts at 1): the person's RB1 takes the market's best RB value.
  const byPos = [{name: 'James Cook', pos: 'RB', rank: 1}, {name: 'Alpha Back', pos: 'RB', rank: 2}, {name: 'Bravo Wide', pos: 'WR', rank: 1}, {name: 'Delta End', pos: 'TE', rank: 1}];
  const S2 = SCC.seasonValues(byPos, pool);
  check(S2.byPosition && S2.byId.c === 1000 && S2.byId.a === 600 && S2.byId.b === 800 && S2.byId.d === 400,
    'a list ranked within each position maps within the position: their RB1 takes the best RB value, their RB2 the next');
  check(SCC.seasonValues([], pool).matched === 0 && SCC.seasonValues(null, null).matched === 0, 'no list, or nothing to match, changes nothing');
}

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

section('weighing a trade, as FantasyCalc\'s calculator does');
const it = (v, pick) => ({v, pick: !!pick});
const star = SCC.tradeVerdict([it(10000)], [it(5000), it(5000)], 50);
check(star.get.adj === 10000 && star.give.adj === 10050 && star.give.spot === 50 && star.get.spot === 0 && star.fair,
  'values add up as they are; the side getting one player for two gets 50 for the roster spot it frees; within 5% is fair');
const three = SCC.tradeVerdict([it(9000)], [it(3000), it(3000), it(3000)], 50);
check(three.give.spot === 100 && three.give.adj === 9100, 'each extra roster spot adds another waiver pickup');
const win = SCC.tradeVerdict([it(4000)], [it(6000)], 50);
check(!win.fair && win.winner === 'you' && win.diff === 2000 && win.give.spot === 0, 'one for one: no roster-spot value; getting more wins, by the difference');
check(win.even === 2050, `evening it takes a player worth the difference plus the roster spot he costs them (${win.even})`);
const pk = SCC.tradeVerdict([it(3000), it(2837, true)], [it(5800)], 50);
check(pk.get.spot === 0 && pk.give.adj === 5837, 'draft picks take no roster spot');
check(SCC.tradeVerdict([], [], 50).fair, 'an empty trade is even');
const many = Array.from({length: 320}, (_, i) => ({p: 'RB', v: 10000 - i * 30}));
check(SCC.waiverValue(many) === 10000 - 299 * 30 && SCC.waiverValue([{p: 'QB', v: 900}, {p: 'PICK', v: 50}, {p: 'WR', v: 120}]) === 120 && SCC.waiverValue([]) === 0,
  'a waiver pickup is worth about the 300th-best player; with fewer listed, the last player (picks aside)');

section('draft results');
{
  const pl = {101: ['A One', 'RB', 'KC'], 102: ['B Two', 'WR', 'BUF'], 103: ['C Three', 'QB', 'SF'], 104: ['D Four', 'TE', 'MIA']};
  // Sleeper's answers for a two-team, three-round snake: team 2 keeps D Four in round 2, team 1 takes KC's defense in
  // round 3, and team 2 a rookie Titan's player list doesn't have yet.
  const sp = (no, round, slot, roster, id, extra) => Object.assign({pick_no: no, round, draft_slot: slot, roster_id: roster, player_id: id, is_keeper: null,
    metadata: {first_name: 'Meta', last_name: 'Name', position: pl[id] ? pl[id][1] : 'DEF', team: pl[id] ? pl[id][2] : id}}, extra);
  const raw = [sp(1, 1, 1, 1, '101'), sp(2, 1, 2, 2, '102'), sp(3, 2, 2, 2, '104', {is_keeper: true}), sp(4, 2, 1, 1, '103'), sp(5, 3, 1, 1, 'KC'),
    sp(6, 3, 2, 2, '999', {metadata: {first_name: 'Rookie', last_name: 'Newman', position: 'WR', team: 'LV'}})];
  const D = SCC.draftFromSleeper({type: 'snake', status: 'complete', season: '2026', settings: {rounds: 3, teams: 2}}, raw.slice().reverse(), pl);
  check(D.type === 'snake' && D.status === 'complete' && D.teams === 2 && D.rounds === 3 && D.picks.map(p => p.no).join() === '1,2,3,4,5,6',
    'a Sleeper draft: its picks in order, with its type, rounds and teams');
  check(D.picks[0].name === 'A One' && D.picks[0].team === '1' && D.picks[2].keeper && D.picks[3].pick === 2 && D.picks[3].slot === 1,
    'each pick names its player from Titan\'s list, the team that made it, its place in the round and its draft slot; keepers marked');
  check(D.picks[4].name === 'KC D/ST' && D.picks[4].pos === 'DEF' && D.picks[5].name === 'Rookie Newman' && D.picks[5].nfl === 'LV',
    'a defense is named as Titan names them; a player not in the list yet keeps Sleeper\'s name for him');
  const vals = {101: 50, 102: 10, 103: 40, 104: 30, KC: 0, 999: 20};
  const G = SCC.draftGrades(D, p => vals[p.id]);
  const at = no => G.picks.find(p => p.no === no);
  // By value now the five graded players go 50, 40, 20, 10, 0; the spots they used were 1, 2, 4, 5, 6.
  check(at(1).exp === 50 && at(1).gain === 0 && at(2).gain === -30 && at(4).gain === 20 && at(5).gain === -10 && at(6).gain === 20 && at(3).gain === null,
    'each pick against its spot: the value that spot would get with everyone going in order of value; keepers aren\'t graded');
  check(at(4).tag === 'steal' && at(6).tag === 'steal' && at(2).tag === 'reach' && at(5).tag === '' && at(1).vrank === 1 && at(6).vrank === 3,
    'a gain of a spread or more is a steal, a loss of one a reach; each player\'s place by value');
  check(at(2).posTaken === 1 && at(2).posNow === 2 && at(6).posTaken === 2 && at(6).posNow === 1 && at(4).posTaken === 1 && at(3).posTaken === 0,
    'each pick\'s place at its position: B Two was the 1st WR taken and is WR2 by value now, the rookie WR2 taken and WR1 now; keepers left out');
  check(G.graded === 5 && G.teams[0].team === '1' && G.teams[0].total === 10 && G.teams[0].best.no === 4 && G.teams[0].worst.no === 5 &&
    G.teams[0].grade === 'A' && G.teams[1].grade === 'C+' && G.teams[1].picks.length === 3,
    `teams best first, each with its total, best and worst pick, and a grade by how far it sits from the league\'s average (${G.teams.map(t => t.grade).join(', ')})`);
  const none = SCC.draftGrades(D, () => 0);
  check(none.teams.every(t => t.grade === 'B' && t.total === 0) && none.valued === 0 && G.valued === 4,
    'with no values to go on, every team gets a B, and the count of valued picks says so (the app then shows the board ungraded)');
  const auc = {type: 'auction', picks: [{no: 1, team: '1', id: 'a', amount: 10}, {no: 2, team: '2', id: 'b', amount: 40}, {no: 3, team: '1', id: 'c', amount: 20}]};
  const GA = SCC.draftGrades(auc, p => ({a: 30, b: 10, c: 20})[p.id]);
  check(GA.picks[1].exp === 30 && GA.picks[1].gain === -20 && GA.picks[2].gain === 0 && GA.picks[0].gain === 20,
    'in an auction the spots follow price: the dearest player should be the most valuable');
}

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

section('trade ideas');
const TV = {q1: 1000, r1: 3000, r2: 2800, r3: 2600, w1: 500, qa: 1000, wa1: 3000, wa2: 2800, wa3: 2700, ra: 400, qb: 1000, rb: 900, wb: 900};
const P = (id, pos) => ({id, pos, name: id});
const meT = {id: 'me', roster: [P('q1', 'QB'), P('r1', 'RB'), P('r2', 'RB'), P('r3', 'RB'), P('w1', 'WR')]};
const teamA = {id: 'A', name: 'A', roster: [P('qa', 'QB'), P('wa1', 'WR'), P('wa2', 'WR'), P('wa3', 'WR'), P('ra', 'RB')]};
const teamB = {id: 'B', name: 'B', roster: [P('qb', 'QB'), P('rb', 'RB'), P('wb', 'WR')]};
const ideas = SCC.tradeIdeas(meT, [teamA, teamB], {value: p => TV[p.id] || 0, slots: ['QB', 'RB', 'WR', 'FLEX'], waiver: 50});
const best = ideas[0], ids = l => l.map(p => p.id).join();
check(best && best.partner.id === 'A' && ids(best.give) === 'r3,w1' && ids(best.get) === 'wa1' && best.myGain === 2500 && best.theirGain === 1900,
  'the best idea: a spare RB and a weak WR for their top WR, both lineups stronger: ' + (best ? ids(best.give) + ' for ' + ids(best.get) + ', +' + best.myGain : 'none'));
check(ideas.length >= 2 && ideas.every(x => x.verdict.fair && x.myGain > 0) && ideas.filter(x => x.partner.id === 'A').length <= 2 &&
  new Set(ideas.map(x => ids(x.get))).size === ideas.length, 'every idea is fair and helps your lineup; at most two per team, each wanting someone different');
check(!ideas.some(x => x.partner.id === 'B'), 'no idea where nothing fair helps');
check(ideas.every(x => typeof x.accept === 'number' && Array.isArray(x.why) && x.trueGain === x.myGain && x.edge === 0 && x.myPts === 0),
  'without the edge or points, an idea\'s true gain is its market gain and it still says how likely a yes is');
// Team D starts cheap players; without a WR of my own, the fair trades that help me are one of my RBs for two of theirs.
const teamD = {id: 'D', name: 'D', roster: [P('qd', 'QB'), P('wd1', 'WR'), P('wd2', 'WR')]};
const TVD = Object.assign({qd: 1000, wd1: 1700, wd2: 1400}, TV);
const twoFor1 = SCC.tradeIdeas({id: 'me', roster: meT.roster.filter(p => p.id !== 'w1')}, [teamD], {value: p => TVD[p.id] || 0, slots: ['QB', 'RB', 'WR', 'FLEX'], waiver: 50});
check(twoFor1.length === 1 && twoFor1[0].give.length === 1 && twoFor1[0].get.length === 2 && twoFor1[0].accept === 0 &&
  twoFor1[0].why.join('; ') === 'they get the best player in it; asks two of their starters for one',
  'an idea that asks two of their starters for one is a harder yes, and handing them the best player an easier one: ' + twoFor1.map(x => x.why.join('; ')).join(' | '));

section('the usage edge, points over weeks, and ideas that use them');
check(SCC.impliedValue(5000, 0.25) === 6667 && SCC.impliedValue(5000, -0.25) === 3750 && SCC.impliedValue(5000, 0) === 5000 && SCC.impliedValue(0, 0.5) === 0,
  'implied value: the market\'s price if it agreed with the usage numbers (a quarter under: 6,667; a quarter over: 3,750)');
const sp2 = {a: [170, 0], b: [340, 17]};
check(SCC.spanPoints(sp2, 'a', {ppr: 0}, 10, 17, 12) === 70 && SCC.spanPoints(sp2, 'b', {ppr: 1}, 15, 17, 0) === 63 && SCC.spanPoints(sp2, 'zz', {ppr: 0}, 1, 17, 0) === 0,
  'points over a span of weeks: a 17-game season\'s share each week, the bye left out, in the league\'s scoring');
// Two equally priced receivers: the market says even, the usage numbers say mine is a sell-high and theirs a buy-low.
const EV = {q1: 1000, r1: 3000, w1: 3000, qc: 1000, rc: 400, wc: 3000}, ED = {w1: -1500, wc: 1500};
const meE = {id: 'me', roster: [P('q1', 'QB'), P('r1', 'RB'), P('w1', 'WR')]};
const teamC = {id: 'C', name: 'C', roster: [P('qc', 'QB'), P('rc', 'RB'), P('wc', 'WR')]};
const base = {value: p => EV[p.id] || 0, slots: ['QB', 'RB', 'WR'], waiver: 50};
check(SCC.tradeIdeas(meE, [teamC], base).length === 0, 'by market value alone, swapping two equally priced receivers gains nothing');
const PT = {q1: 100, r1: 100, w1: 100, qc: 100, rc: 50, wc: 110};
const withEdge = SCC.tradeIdeas(meE, [teamC], Object.assign({edge: p => ED[p.id] || 0, points: p => PT[p.id] || 0, thin: {C: ['WR']}}, base));
const e0 = withEdge[0];
check(withEdge.length === 1 && ids(e0.give) === 'w1' && ids(e0.get) === 'wc' && e0.myGain === 0 && e0.trueGain === 3000 && e0.edge === 3000 && e0.verdict.fair,
  'with the usage edge, the same swap is an idea: fair by the market, +3,000 by usage (my sell-high for their buy-low)');
check(e0.myPts === 10 && e0.theirPts === -10 && e0.accept === 1 && e0.why.join() === 'fills their hole at WR',
  'it says both teams\' rest-of-season points, and why they might say yes: ' + e0.why.join('; '));
const drop = SCC.tradeIdeas(meE, [teamC], Object.assign({edge: p => ED[p.id] || 0, points: p => (p.id === 'wc' ? 90 : PT[p.id] || 0)}, base));
check(drop.length === 0, 'an idea that would lower the rest-of-season points of your best lineup is dropped, whatever the values say');

section('two for two, and draft picks for rebuilders');
{
  // I have three RBs and no WR; they have three WRs and no RB. No one-for-one or two-for-one is fair; two for two is.
  const V2 = {q: 1000, ra: 2000, rb: 1900, rc: 1000, qp: 1000, wx: 2000, wy: 1500, wz: 1400};
  const me2 = {id: 'me', roster: [P('q', 'QB'), P('ra', 'RB'), P('rb', 'RB'), P('rc', 'RB')]};
  const pr = {id: 'Pr', name: 'Pr', roster: [P('qp', 'QB'), P('wx', 'WR'), P('wy', 'WR'), P('wz', 'WR')]};
  const two = SCC.tradeIdeas(me2, [pr], {value: p => V2[p.id] || 0, slots: ['QB', 'RB', 'WR', 'FLEX'], waiver: 50});
  check(two.length >= 1 && ids(two[0].give) === 'rb,rc' && ids(two[0].get) === 'wy,wz' && two[0].myGain === 1000 && two[0].theirGain === 1400,
    'two for two balances two uneven rosters, and leads when it helps both most: ' + two.map(x => ids(x.give) + ' for ' + ids(x.get)).join(', '));
  // A rebuilding partner takes picks: my 2027 1st for their starting RB is an idea only when they're rebuilding.
  const V3 = {q1: 1000, r1: 500, w1: 1000, 'pick:2027:1:1': 2000, qr: 1000, rr: 2000, wr: 300};
  const me3 = {id: 'me', roster: [P('q1', 'QB'), P('r1', 'RB'), P('w1', 'WR')], picks: [{id: 'pick:2027:1:1', pos: 'PICK', name: '2027 1st'}]};
  const rb = {id: 'Rb', name: 'Rb', roster: [P('qr', 'QB'), P('rr', 'RB'), P('wr', 'WR')]};
  const o3 = {value: p => V3[p.id] || 0, slots: ['QB', 'RB', 'WR'], waiver: 50};
  check(SCC.tradeIdeas(me3, [rb], o3).length === 0, 'without a stance, draft picks stay out of the ideas');
  const pk = SCC.tradeIdeas(me3, [rb], Object.assign({stance: {Rb: 'rebuilder'}}, o3));
  check(pk.length === 1 && ids(pk[0].give) === 'pick:2027:1:1' && ids(pk[0].get) === 'rr' && pk[0].verdict.fair && pk[0].myGain === 1500 && pk[0].accept === 1 &&
    pk[0].why.join() === 'they\'re rebuilding, and this brings picks', 'for a rebuilding partner my pick buys their starter, and the idea says why they\'d take it: ' + (pk[0] ? pk[0].why.join() : 'none'));
  check(SCC.tradeIdeas(me3, [rb], Object.assign({stance: {Rb: 'contender'}}, o3)).length === 0, 'a contender isn\'t offered picks');
}

section('the lineup goal: trades that add points to the starting lineup, and the partners who fit');
{
  // One spot each. My starting WR is a young name the market prices at 2,000 who scores 100; their bench WR is an old
  // hand priced 1,950 who scores 180. Swapping them is fair by the market and costs me 50 of value, but it adds 80
  // rest-of-season points to my lineup: nothing by value, the idea under the lineup goal.
  const V4 = {q: 1000, ra: 3000, wa: 2000, qp: 1000, rp: 600, wx: 2600, wo: 1950};
  const P4 = {q: 100, ra: 200, wa: 100, qp: 100, rp: 50, wx: 210, wo: 180};
  const me4 = {id: 'me', roster: [P('q', 'QB'), P('ra', 'RB'), P('wa', 'WR')]};
  const p4 = {id: 'P4', name: 'P4', roster: [P('qp', 'QB'), P('rp', 'RB'), P('wx', 'WR'), P('wo', 'WR')]};
  const o4 = {value: p => V4[p.id] || 0, points: p => P4[p.id] || 0, slots: ['QB', 'RB', 'WR'], waiver: 50};
  const byValue = SCC.tradeIdeas(me4, [p4], o4), byLineup = SCC.tradeIdeas(me4, [p4], Object.assign({goal: 'lineup', deep: {P4: ['WR']}}, o4));
  check(byValue.length === 0, 'by value alone, a swap that costs 50 of value is no idea');
  check(byLineup.length === 1 && ids(byLineup[0].give) === 'wa' && ids(byLineup[0].get) === 'wo' && byLineup[0].myPts === 80 && byLineup[0].theirPts === 0 &&
    byLineup[0].myGain === -50 && byLineup[0].why.join('; ') === 'comes from their depth at WR; they get the best player in it' && byLineup[0].accept === 2,
    'with the lineup goal, the same swap is the idea: +80 rest-of-season points to my lineup for 50 of value, and it says it comes from their depth: '
    + byLineup.map(x => ids(x.give) + ' for ' + ids(x.get) + ' ' + x.myPts + ' ' + x.why.join(';')).join(', '));
  const noPts = SCC.tradeIdeas(me4, [p4], Object.assign({goal: 'lineup'}, o4, {points: p => (p.id === 'wo' ? 90 : P4[p.id] || 0)}));
  check(noPts.length === 0, 'an idea that adds no points to the lineup is no idea under the lineup goal, whatever the values say');
  check(SCC.tradeIdeas(me4, [p4], Object.assign({goal: 'lineup', weeks: 100}, o4)).length === 0,
    'a lineup gain under a point a week doesn\'t buy a loss of value: the swap must gain by your own numbers too');
  // The position guard: QB, RB, RB, WR, FLEX. Trading my only real WR for a third back adds points (the flex) but guts WR.
  const V5 = {q: 1000, ra: 3000, rb: 2000, wa: 1500, wb: 300, qp: 1000, rc: 1500};
  const P5 = {q: 100, ra: 200, rb: 150, wa: 120, wb: 40, qp: 100, rc: 200};
  const me5 = {id: 'me', roster: [P('q', 'QB'), P('ra', 'RB'), P('rb', 'RB'), P('wa', 'WR'), P('wb', 'WR')]};
  const p5 = {id: 'P5', name: 'P5', roster: [P('qp', 'QB'), P('rc', 'RB')]};
  const o5 = {value: p => V5[p.id] || 0, points: p => P5[p.id] || 0, slots: ['QB', 'RB', 'RB', 'WR', 'FLEX'], waiver: 50, goal: 'lineup', weeks: 16};
  const open = SCC.tradeIdeas(me5, [p5], o5), guarded = SCC.tradeIdeas(me5, [p5], Object.assign({guard: true, myDeep: ['RB']}, o5));
  check(open.some(x => ids(x.give) === 'wa' && ids(x.get) === 'rc') && !guarded.some(x => ids(x.give) === 'wa' && ids(x.get) === 'rc'),
    'with the guard on, an idea that weakens a starting position you aren\'t deep at (WR here) is out, even though it adds points: '
    + guarded.map(x => ids(x.give) + ' for ' + ids(x.get)).join(', '));
  check(SCC.tradeIdeas(me5, [p5], Object.assign({guard: true, myDeep: ['RB', 'WR']}, o5)).some(x => ids(x.give) === 'wa' && ids(x.get) === 'rc'),
    'deep at WR, the same idea is allowed: depth is what you trade from');
  check(JSON.stringify(SCC.positionPoints(me5.roster, o5.slots, o5.points)) === '{"QB":100,"RB":350,"WR":160}',
    'positionPoints adds the best lineup up by position, a flex player at his own position: ' + JSON.stringify(SCC.positionPoints(me5.roster, o5.slots, o5.points)));
  // Both upgrades: by my numbers their back and receiver are better than mine (two positions up); by the public projections
  // (theirPoints) they gain too, and the market calls it even. That package ranks first and says why.
  const V6 = {q: 1000, ra: 3000, wa: 1500, qp: 1000, rp: 2900, wp: 1600};
  const mine6 = {q: 100, ra: 180, wa: 110, qp: 100, rp: 200, wp: 130}, pub6 = {q: 100, ra: 205, wa: 125, qp: 100, rp: 190, wp: 115};
  const me6 = {id: 'me', roster: [P('q', 'QB'), P('ra', 'RB'), P('wa', 'WR')]};
  const p6 = {id: 'P6', name: 'P6', roster: [P('qp', 'QB'), P('rp', 'RB'), P('wp', 'WR')]};
  const both = SCC.tradeIdeas(me6, [p6], {value: p => V6[p.id] || 0, points: p => mine6[p.id] || 0, theirPoints: p => pub6[p.id] || 0,
    slots: ['QB', 'RB', 'WR'], waiver: 50, goal: 'lineup', weeks: 16, guard: true});
  check(both.length >= 1 && ids(both[0].give) === 'ra,wa' && ids(both[0].get) === 'rp,wp' && both[0].ups.join() === 'RB,WR' && both[0].myPts === 40 && both[0].theirPts === 25 &&
    both[0].why[0] === 'upgrades your RB and WR by your numbers',
    'a package that upgrades two of your positions by your rankings while the partner gains by the public projections leads, and says so: '
    + both.map(x => ids(x.give) + ' for ' + ids(x.get) + ' ' + x.ups.join('+') + ' ' + x.theirPts).join(' | '));
  // Partners who fit: from positionStrength's grades. Team T is thin at RB where I'm deep, and deep at WR where I'm thin; team U matches me.
  const PS = {positions: ['QB', 'RB', 'WR'], teams: [
    {id: 'me', byPos: {QB: {z: 0, grade: 'mid'}, RB: {z: 1.2, grade: 'deep'}, WR: {z: -1.0, grade: 'thin'}}},
    {id: 'T', byPos: {QB: {z: 0, grade: 'mid'}, RB: {z: -0.9, grade: 'thin'}, WR: {z: 0.8, grade: 'deep'}}},
    {id: 'U', byPos: {QB: {z: 0.1, grade: 'mid'}, RB: {z: 1.0, grade: 'deep'}, WR: {z: -0.8, grade: 'thin'}}}]};
  const partners = SCC.tradePartners('me', PS);
  check(partners.length === 1 && partners[0].id === 'T' && partners[0].need.join() === 'RB' && partners[0].spare.join() === 'WR' && partners[0].fit === 3.9,
    'a partner fits when they\'re thin where I\'m deep (they need RB) and deep where I\'m thin (they can spare WR); a team built like mine doesn\'t: '
    + JSON.stringify(partners));
  check(SCC.tradePartners('zz', PS).length === 0 && SCC.tradePartners('me', null).length === 0, 'no team of mine, or no strength table: no partners');
}

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
  check(teams.length === 2 && me.name === 'Me' && pat.name === 'Pat\'s Team (Pat)' && me.roster[1].held && pat.roster[1].held && !me.roster[0].held,
    'both teams, named team name (account name), with IR and taxi players marked');
  check(me.picks.length === 10 && pat.picks.length === 8 && me.picks.some(p => p.id === 'pick:2027:1:2' && p.via === 'Pat\'s Team (Pat)') && me.picks[0].season === '2027',
    `3 rounds of each of the next three drafts, plus the 1st traded from Pat's Team (${me.picks.length} and ${pat.picks.length})`);
  const red = await API.leagueTeams({id: '43', kind: 'Redraft', lineup: ['QB']}, 1, '2026');
  check(!red[0].picks && !asked.some(u => /43\/traded_picks/.test(u)), 'a redraft league has no picks and doesn\'t ask for them');
  T.done();
})().catch(T.crash);
