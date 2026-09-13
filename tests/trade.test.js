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
  check(tv[11] === 60 && tv[12] === 40 && tv[13] === 20 && tv[14] === 0 && tv[15] === 0, 'RBs: above the 4th-best, the flex shared out; nobody goes below zero');
  check(tv[21] === undefined, 'a position the league doesn\'t start gets no value');
  check(SCC.titanValues(sp, pl, Object.assign({}, cfgTv, {ppr: 1}))[11] === 70, 'in the league\'s scoring: PPR adds the catches');
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
