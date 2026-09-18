// engine.js on made-up data: lineup slots, every rankings format, merging a
// week's files, projections, freezing calls at kickoff, weekly scoring and
// bye-week needs. No network.
const T = require('./lib');
const SCC = T.app('engine.js');
const {check, section} = T;

section('slots');
check(SCC.slotFits('WRRB_FLEX', 'WR') && SCC.slotFits('WRRB_FLEX', 'RB') && !SCC.slotFits('WRRB_FLEX', 'TE'), 'W/R flex takes WR and RB, not TE');
check(SCC.slotFits('REC_FLEX', 'TE') && !SCC.slotFits('REC_FLEX', 'RB'), 'W/T flex takes TE, not RB');
check(SCC.slotFits('SUPER_FLEX', 'QB') && !SCC.slotFits('FLEX', 'QB'), 'superflex takes a QB, flex doesn\'t');
check(SCC.slotFits('IDP_FLEX', 'CB') && SCC.slotFits('DB', 'S') && SCC.slotFits('LB', 'LB'), 'IDP slots');

section('rankings: file names');
[['FantasyPros_2026_Week_1_QB_Rankings.csv', 'QB'], ['FantasyPros_2026_Week_1_K_Rankings.csv', 'K'],
  ['FantasyPros_2026_Week_1_DST_Rankings.csv', 'DEF'], ['FantasyPros_2026_Week_1_FLEX_Rankings.csv', ''],
  ['FantasyPros_2026_Week_1_TE_Rankings.csv', 'TE'], ['WeeklyRanks_Week1.csv', ''], ['all.csv', '']]
  .forEach(([f, want]) => check(SCC.positionHint(f) === want, `${f}: "${SCC.positionHint(f)}"`));

section('rankings: one row per player');
const sample = SCC.parseRanks(T.sampleRanks());
check(sample.format === 'rows' && sample.rows.length > 200 && !sample.error, `sample-rankings.csv: ${sample.rows.length} rows ${JSON.stringify(SCC.rankCounts(sample.rows))}`);
const tsv = SCC.parseRanks('Player\tPos\tTeam\tRank\nJoe Burrow\tQB\tCIN\t1');
check(tsv.rows.length === 1 && tsv.rows[0].pos === 'QB', 'a copy out of a spreadsheet (tab-separated)');

section('rankings: side-by-side tables (Late-Round style)');
const wide = SCC.parseRanks([
  'QB Rank,QB Player,QB Team,QB Opponent,QB Total,RB Rank,RB Player,RB Team,FLEX Rank,FLEX Player,DEF Rank,DEF Team,DEF Spread,K Rank,K Player,K Team,K Projection',
  '1,Josh Allen,BUF,HOU,27.5,1,Bijan Robinson,ATL,1,Bijan Robinson,1,Denver Broncos,-3.5,1,Brandon Aubrey,DAL,9.1',
  '2,Lamar Jackson,BAL,IND,26,2,Saquon Barkley,PHI,2,Saquon Barkley,2,JAC,-6,2,Cameron Dicker,LAC,8.8',
  ',,,,,3,Deep Back,NYJ,,,,,,,,,'
].join('\n'));
const w = name => wide.rows.find(r => r.name === name) || {};
check(wide.format === 'wide' && wide.rows.length === 9, `${wide.rows.length} rows from the position tables`);
check(w('Josh Allen').rank === 1 && w('Josh Allen').opp === 'HOU' && w('Josh Allen').implied === 27.5, 'QB: rank, opponent and team total');
check(w('Saquon Barkley').rank === 2 && w('Deep Back').rank === 1003 && SCC.rankLabel('RB', 1003) === 'RB3',
  'RB ranks come from the FLEX table; outside it, 1000 + position rank (shown as RB3)');
check(w('DEN D/ST').implied === -3.5 && !!w('JAX D/ST').name, 'defenses named by team (Denver Broncos, JAC), spread kept');
check(w('Brandon Aubrey').implied === 9.1, 'kicker projection kept');

section('rankings: FantasyPros');
const qbText = ['"RK","TIERS","PLAYER NAME",TEAM,"OPP","UPSIDE ","BUST "',
  '"1","1","Lamar Jackson",BAL,"at IND","-","-"', '"2","1","Joe Burrow",CIN,"vs. TB","-","-"'].join('\n');
const noHint = SCC.parseRanks(qbText);
check(noHint.needsPosition === true && noHint.rows.length === 0, 'a file with no position column asks which position');
const qb = SCC.parseRanks(qbText, {pos: 'QB'});
check(qb.format === 'fantasypros' && qb.rows.length === 2 && qb.rows.every(r => r.pos === 'QB') && !qb.warning, 'QB file: 2 QBs, no warning');
check(qb.rows[0].name === 'Lamar Jackson' && qb.rows[0].rank === 1 && qb.rows[0].opp === 'IND' && qb.rows[0].posRank === 1 && qb.rows[1].opp === 'TB',
  '"at IND" and "vs. TB" become IND and TB');
const flex = SCC.parseRanks(['"RK","TIERS","PLAYER NAME",TEAM,"POS","OPP"', '"1","1","Jahmyr Gibbs",DET,"RB1","vs. NO"',
  '"2","1","Ja\'Marr Chase",CIN,"WR1","vs. TB"', '"39","4","Trey McBride",ARI,"TE3","at LAC"'].join('\n'));
const te = flex.rows[2];
check(flex.rows.length === 3 && te.pos === 'TE' && te.rank === 39 && te.posRank === 3 && te.tier === 4, 'FLEX file: overall rank, position rank and tier');
const rb = SCC.parseRanks('"RK","PLAYER NAME",TEAM,"OPP"\n"1","Jahmyr Gibbs",DET,"vs. NO"', {pos: 'RB'});
check(rb.rows.length === 1 && /FLEX/.test(rb.warning), 'an RB-only file warns that FLEX needs overall ranks');
const dst = SCC.parseRanks('"RK","PLAYER NAME",TEAM,"OPP"\n"1","Denver Broncos",DEN,"vs. KC"\n"2","Jacksonville Jaguars",JAC,"vs. CLE"', {pos: 'DST'});
check(dst.rows.map(r => r.name + '/' + r.pos).join(',') === 'DEN D/ST/DEF,JAX D/ST/DEF', 'DST file names defenses by team');
const op = SCC.parseRanks(['"RK","PLAYER NAME",TEAM,"POS","OPP"', '"1","Lamar Jackson",BAL,"QB1","at IND"',
  '"2","Jahmyr Gibbs",DET,"RB1","vs. NO"', '"3","Ja\'Marr Chase",CIN,"WR1","vs. TB"', '"4","Trey McBride",ARI,"TE1","at LAC"'].join('\n'));
check(op.rows.length === 4 && JSON.stringify(SCC.rankCounts(op.rows)) === '{"QB":1,"RB":1,"WR":1,"TE":1}', 'OP (superflex) file: every position on one scale');

section('rankings: The Hall');
const hall = SCC.parseRanks(['Rank,Team,Player,Fantsy Position,Matchup,SOS,Bye,Floor Proj,Consensus ProjCons Proj,DS Proj,CeilingProjCeil Proj,3D Proj',
  '1,BAL,Lamar Jackson,QB,@IND,7.9%,13,20.40,19.5,23.20,29.00,23.80',
  '23,DET,Jahmyr Gibbs,RB,NO,1%,6,12.0,15,16,24,18.90',
  '26,LAR,Puka Nacua,WR,SF,2%,11,11,14,15,22,16.30',
  '44,CLE,Carson Schwesinger,LB,@JAC,0%,11,8,9,9,12,10.1',
  '65,LVR,Brock Bowers,TE,@MIA,3%,8,9,11,12,19,12.90',
  '147,DAL,Brandon Aubrey,K,@NYG,1%,14,7,8,9,12,9.50',
  '212,PIT,Pittsburgh Steelers,DEF,ATL,4%,5,5,7,8,12,8.10'].join('\n'));
const h = name => hall.rows.find(r => r.name === name) || {};
check(hall.source === 'The Hall' && hall.rows.length === 6 && hall.skipped.length === 1 && /LB/.test(hall.skipped[0].why),
  `The Hall's export is read: ${hall.rows.length} players, the IDP row skipped`);
check(h('Lamar Jackson').pos === 'QB' && h('Lamar Jackson').opp === 'IND' && h('Jahmyr Gibbs').rank === 23 && h('Puka Nacua').rank === 26,
  'its misspelled position column, "@IND" matchups and one overall rank');
check(h('Brock Bowers').team === 'LV' && !!h('PIT D/ST').name && h('PIT D/ST').pos === 'DEF', 'LVR is the Raiders (LV); defenses named by team');

section('merging a week\'s files');
const week = sample.rows.concat(dst.rows);
const before = SCC.rankCounts(week);
const withQb = SCC.mergeRanks(week, qb.rows);
check(withQb.merged && withQb.positions.join() === 'QB' && SCC.rankCounts(withQb.rows).QB === 2 && SCC.rankCounts(withQb.rows).RB === before.RB,
  'a QB file replaces only the QBs');
const withOp = SCC.mergeRanks(week, op.rows), after = SCC.rankCounts(withOp.rows);
check(withOp.merged && after.DEF === before.DEF && after.K === before.K && after.QB === 1 && after.WR === 1,
  'an OP file replaces QB, RB, WR and TE and keeps K and DEF');
check(!SCC.mergeRanks(null, qb.rows).merged, 'nothing saved yet: the file becomes the week');
const whole = SCC.mergeRanks(op.rows, week);
check(!whole.merged && whole.rows.length === week.length, 'a file with every saved position replaces the whole week');

section('combining several rankings (Import multiple sources)');
{
  const row = (name, pos, rank) => ({name, pos, team: 'KC', rank, opp: '', implied: '', tier: ''});
  // An overall list of every position, like The Hall's.
  const hall = [row('Rob One', 'RB', 1), row('Wes One', 'WR', 2), row('Quin One', 'QB', 3), row('Rob Two', 'RB', 4), row('Wes Two', 'WR', 5),
    row('Ty One', 'TE', 6), row('Rob Three', 'RB', 7), row('Quin Two', 'QB', 8), row('Wes Three', 'WR', 9), row('Kurt Kick', 'K', 1), row('KC D/ST', 'DEF', 1)];
  // Late-Round's layout: QB by position, RB/WR/TE on its FLEX list, Wes Three outside it (1000 + WR3).
  const late = [row('Quin Two', 'QB', 1), row('Quin One', 'QB', 2), row('Rob Two', 'RB', 1), row('Wes One', 'WR', 2), row('Rob One', 'RB', 3),
    row('Wes Two', 'WR', 4), row('Ty One', 'TE', 5), row('Rob Three', 'RB', 6), row('Wes Three', 'WR', 1003), row('Kurt Kick', 'K', 1)];
  // One position only: an RB file that leaves Rob Two out.
  const rbs = [row('Rob Three', 'RB', 1), row('Rob One', 'RB', 2)];
  const C = SCC.combineRanks([{name: 'Hall', rows: hall, weight: 1}, {name: 'Late', rows: late, weight: 1}, {name: 'RBs', rows: rbs, weight: 1}]);
  const at = n => C.rows.find(r => r.name === n);
  check(at('Rob One').posRank === 1 && at('Rob Two').posRank === 2 && at('Rob Three').posRank === 3,
    'each position combined on its own; a source that leaves a player out counts him just below its last, so one list\'s RB1 isn\'t everyone\'s');
  check(['Rob One', 'Wes One', 'Rob Two', 'Wes Two', 'Ty One', 'Rob Three', 'Wes Three'].every((n, i) => at(n).rank === i + 1),
    'RB, WR and TE fitted onto one FLEX list the way the overall lists place them: ' +
    C.rows.filter(r => r.rank < 1000 && ['RB', 'WR', 'TE'].includes(r.pos)).sort((a, b) => a.rank - b.rank).map(r => r.name).join(', '));
  check(at('Quin One').rank === 1 && at('Quin Two').rank === 2 && at('Kurt Kick').rank === 1 && at('KC D/ST').rank === 1 && C.rows.length === 11,
    'QB, K and DEF keep a positional rank (an even split goes by name); a position only one source ranks comes from it');
  const rob2 = C.players.find(p => p.name === 'Rob Two');
  check(rob2.ranks.Late === 1 && rob2.ranks.Hall === 2 && rob2.ranks.RBs === undefined && C.fitted.join() === 'Hall,Late' && !C.warning,
    'each player\'s place in every source is kept, to show where they disagree');
  const heavy = SCC.combineRanks([{name: 'Hall', rows: hall, weight: 1}, {name: 'Late', rows: late, weight: 3}]);
  check(heavy.rows.find(r => r.name === 'Quin Two').rank === 1, 'a source at 3x pulls the order its way (Late-Round\'s QB1 comes out on top)');
  const alone = SCC.combineRanks([{name: 'RBs', rows: rbs, weight: 1}]);
  const curved = SCC.combineRanks([{name: 'RBs', rows: rbs, weight: 1}], {curve: hall, curveName: 'Titan defaults'});
  check(alone.rows.every(r => r.rank > 1000) && /FLEX/.test(alone.warning) && curved.rows.find(r => r.name === 'Rob Three').rank === 1 &&
    curved.fitted.join() === 'Titan defaults' && !curved.warning,
    'with no overall list among the sources, RB/WR/TE stay positional (with a warning) unless Titan\'s default rankings fit them together');
}

section('projections');
const pm = SCC.trimProjections([{player_id: '10', stats: {pts_std: 10, pts_half_ppr: 12.5, pts_ppr: 15, rec: 5, rec_yd: 60, gp: 1, adp_dd_ppr: 30, pass_td: 0}},
  {player_id: 'SEA', stats: {pts_std: 8.81, pts_ppr: 8.81}}, {player_id: '99', stats: {}}, {player_id: '98'}, {player_id: '0', stats: {pts_std: 0, pts_ppr: 0, rec: 0}}]);
check(JSON.stringify(pm) === '{"0":[0,0],"10":[10,5,{"rec":5,"rec_yd":60}],"SEA":[8.81,0]}',
  'trimmed to standard points, catch points and the nonzero stat line (none for a player projected nothing)');
check(SCC.projFor(pm, '10', 1) === 15 && SCC.projFor(pm, '10', 0.5) === 12.5 && SCC.projFor(pm, '10', 0.25) === 11.25, 'any points-per-catch');
check(SCC.projFor(pm, 'SEA', 1) === 8.81 && SCC.projFor(pm, 'nobody', 1) === null, 'defenses by team; unknown players have none');
// A league's scoring beyond receptions: differences from Sleeper's standard, applied to the stat line.
const sixPt = {rec: 1, pass_td: 6, pass_yd: 0.04, pass_int: -2, rec_yd: 0.1, bonus_rec_te: 0.5, def_3_and_out: 0.2};
check(JSON.stringify(SCC.scoringDeltas(sixPt)) === '{"pass_td":2,"pass_int":-1,"bonus_rec_te":0.5}',
  'a league\'s scoring as differences from Sleeper\'s standard, over the stats Sleeper projects (receptions apart)');
check(JSON.stringify(SCC.scoringDeltas({rec: 0.5, pass_td: 4, rush_yd: 0.1})) === '{}', 'a standard or PPR league has no differences');
const qbm = SCC.trimProjections([{player_id: 'q', stats: {pts_std: 20, pts_ppr: 20, pass_td: 2, pass_int: 1, pass_yd: 250}},
  {player_id: 't', stats: {pts_std: 8, pts_ppr: 12, rec: 4, bonus_rec_te: 4}}]);
const six = {ppr: 1, scoring: SCC.scoringDeltas(sixPt)};
check(SCC.projFor(qbm, 'q', six) === 23 && SCC.projFor(qbm, 'q', {ppr: 1}) === 20 && SCC.projFor(qbm, 'q', 1) === 20,
  'in a 6-point-passing-TD league with -2 interceptions the QB gains 2 a TD and loses 1 an interception (20 -> 23); elsewhere he stays at 20');
check(SCC.projFor(qbm, 't', six) === 14 && SCC.projFor(qbm, 't', {ppr: 1}) === 12, 'TE premium adds the bonus on each of the tight end\'s catches (12 -> 14)');
check(/6-pt pass TD · TE premium/.test(SCC.describeLeague({teams: 12, ppr: 1, kind: 'Redraft', scoring: six.scoring})) &&
  !/pass TD/.test(SCC.describeLeague({teams: 12, ppr: 1, kind: 'Redraft', scoring: {}})), 'a league\'s description names the scoring that differs');
const bySc = SCC.rankingsBy([], qbm, {q: ['Q Back', 'QB', 'KC'], t: ['T End', 'TE', 'KC']});
check(bySc(six)[SCC.norm('Q Back')].rank === 1 && bySc({ppr: 1})[SCC.norm('Q Back')].rank === 1 && bySc(six) !== bySc({ppr: 1}),
  'the default rankings are built once per distinct scoring');

section('the kickoff record');
const cfg = {id: 'L1', key: 'L1', name: 'Test League', ppr: 1, lineup: ['QB', 'RB']};
const player = (id, name, pos, over) => Object.assign({id, name, pos, team: 'KC', start: false, slot: '', rank: 5, tier: 2, inj: '', locked: false}, over);
const analysis = ros => ({leagues: [{cfg, roster: ros, opt: [{slot: 'QB', p: ros[0]}, {slot: 'RB', p: ros[2]}],
  rows: [{slot: 'QB', p: ros[0], verdict: 'OK'}, {slot: 'RB', p: ros[1], verdict: 'SWAP OUT'}]}]});
const proj = SCC.trimProjections([{player_id: '1', stats: {pts_std: 18, pts_ppr: 18}}, {player_id: '2', stats: {pts_std: 6, pts_ppr: 10}},
  {player_id: '3', stats: {pts_std: 8, pts_ppr: 12}}]);
const sat = [player('1', 'Q B', 'QB', {start: true, slot: 'QB', rank: 3}), player('2', 'R One', 'RB', {start: true, slot: 'RB', rank: 20}), player('3', 'R Two', 'RB', {rank: 12})];
const h1 = SCC.freezeWeek(null, analysis(sat), proj, '2026', 1, 1000), p1 = h1.leagues.L1.players;
check(p1['1'].call === 'OK' && p1['2'].call === 'SWAP OUT' && p1['3'].call === 'START' && p1['3'].titan === 'RB', 'calls saved: start, swap out, start from the bench');
check(p1['2'].proj === 10 && p1['3'].proj === 12 && p1['1'].rank === 3, 'projections and ranks saved');
const sun = [player('1', 'Q B', 'QB', {start: true, slot: 'QB', rank: 30, locked: true}), player('2', 'R One', 'RB', {start: true, slot: 'RB', rank: 1}), player('3', 'R Two', 'RB', {rank: 40})];
const h2 = SCC.freezeWeek(h1, analysis(sun), proj, '2026', 1, 2000), p2 = h2.leagues.L1.players;
check(p2['1'].rank === 3 && p2['1'].at === 1000, 'a player whose game started keeps what was saved before kickoff');
check(p2['2'].rank === 1 && p2['2'].at === 2000, 'a player whose game hasn\'t started is updated');
const h3 = SCC.freezeWeek({leagues: {L1: {players: {}}}}, analysis(sun), proj, '2026', 1, 3000);
check(h3.leagues.L1.players['1'].locked === true && h3.leagues.L1.players['1'].rank === 30, 'first seen after kickoff: saved as it stands, marked locked');
check(!!SCC.freezeWeek(h2, {leagues: []}, proj, '2026', 1, 4000).leagues.L1, 'a league missing from one refresh keeps its record');
check(JSON.stringify(h2).indexOf('undefined') < 0, 'no undefined values (Firestore rejects them)');

section('scoring a week');
const res = {week: 1, userId: 'u', players: {1: ['Q B', 'QB', 'KC'], 2: ['R One', 'RB', 'KC'], 3: ['R Two', 'RB', 'KC']},
  leagues: [{cfg, rosters: [{owner_id: 'u', roster_id: 1, players: ['1', '2', '3']}],
    matchups: [{roster_id: 1, players: ['1', '2', '3'], starters: ['1', '2'], players_points: {1: 20, 2: 5, 3: 15}}]}]};
const liveRanks = SCC.weeklyMap([{name: 'R Two', pos: 'RB', team: 'KC', rank: 1}, {name: 'R One', pos: 'RB', team: 'KC', rank: 99}]);
const W = SCC.scoreWeek(res, liveRanks, h2, proj), L = W.rows[0];
check(L.actual === 25 && L.projActual === 28 && L.vsProj === -3 && W.totals.vsProj === -3, 'scored 25 against 28 projected at kickoff');
check(L.frozen === 3 && L.byRank === 25 && L.projByRank === 28, 'the saved ranks decide "by rank", not today\'s');
const noRecord = SCC.scoreWeek(res, liveRanks, null, proj).rows[0];
check(noRecord.frozen === 0 && noRecord.projActual === 28 && noRecord.detail.every(d => !d.p || d.p.call), 'without a record, today\'s ranks and projections stand in, calls included');
check(SCC.scoreWeek(Object.assign({}, res, {skipped: ['X: not scored']}), liveRanks).skipped[0] === 'X: not scored', 'leagues the refresh skipped are listed');
const vs = Object.assign({}, res, {leagues: [{cfg, rosters: res.leagues[0].rosters, matchups: res.leagues[0].matchups.map(m => Object.assign({}, m, {matchup_id: 4}))
  .concat([{roster_id: 2, matchup_id: 4, points: 30, starters: [], players_points: {}}, {roster_id: 3, matchup_id: 5, points: 99, starters: [], players_points: {}}])}]});
const WV = SCC.scoreWeek(vs, liveRanks, null, proj);
check(WV.rows[0].opp === 30 && WV.rows[0].result === 'L' && WV.totals.losses === 1 && WV.totals.wins === 0 && noRecord.result === null,
  'won or lost against the other team in the same matchup (25 to 30 is a loss); no opponent, no result');
const bm = SCC.benchMistakes(WV.rows);
check(bm.length === 1 && bm[0].sat.name === 'R Two' && bm[0].started.name === 'R One' && bm[0].slot === 'RB' && bm[0].lost === 10,
  'the bench\'s biggest miss: R Two (15) sat while R One (5) started at RB, 10 points; a running back can\'t take the QB spot');

section('the rankings lab (Compare rankings, Titan\'s owner only)');
{
  const pl = {1: ['Q A', 'QB', 'KC'], 2: ['Q B', 'QB', 'BUF'], 3: ['Q C', 'QB', 'SF'], 11: ['R A', 'RB', 'KC'], 12: ['R B', 'RB', 'BUF'], 13: ['R C', 'RB', 'SF']};
  const lc = {id: 'L', key: 'L', ppr: 1, lineup: ['QB', 'RB']};
  const lres = {userId: 'u', leagues: [{cfg: lc, rosters: [{owner_id: 'u', roster_id: 1, players: ['1', '2', '11', '12']}],
    matchups: [{roster_id: 1, players: ['1', '2', '11', '12'], starters: ['1', '11'], players_points: {1: 10, 2: 25, 11: 8, 12: 20}}]}]};
  // Sleeper projects Q A and R A best; FantasyCalc values Q B and R B most; the owner's rankings like Q A and R B.
  const lproj = {1: [20, 0], 2: [15, 0], 3: [5, 0], 11: [18, 0], 12: [10, 0], 13: [4, 0]};
  const fcv = [{s: '2', n: 'Q B', p: 'QB', v: 900}, {s: '1', n: 'Q A', p: 'QB', v: 800}, {s: '12', n: 'R B', p: 'RB', v: 700},
    {s: '11', n: 'R A', p: 'RB', v: 600}, {s: '3', n: 'Q C', p: 'QB', v: 100}, {s: '13', n: 'R C', p: 'RB', v: 50}];
  const imports = [{name: 'Q A', pos: 'QB', team: 'KC', rank: 1}, {name: 'Q B', pos: 'QB', team: 'BUF', rank: 2},
    {name: 'R B', pos: 'RB', team: 'BUF', rank: 1}, {name: 'R A', pos: 'RB', team: 'KC', rank: 2}];
  const lstats = {1: {ppr: 10}, 2: {ppr: 25}, 3: {ppr: 30}, 11: {ppr: 8}, 12: {ppr: 20}, 13: {ppr: 1}};
  const LW = SCC.labWeek({res: lres, proj: lproj, stats: lstats, players: pl, imports, fcFor: () => fcv, fcOrder: fcv});
  check(LW.sources.join() === 'sleeper,fc,imports' && LW.lineups.sleeper === 18 && LW.lineups.fc === 45 && LW.lineups.imports === 30 &&
    LW.lineups.actual === 18 && LW.lineups.leagues === 1,
    'lineups: what each source would have started from the roster, scored by what happened (Sleeper 18, FantasyCalc 45, your rankings 30)');
  check(LW.order.QB.sleeper === -100 && LW.order.QB.fc === -50 && LW.order.QB.imports === -100 && LW.order.RB.sleeper === 50 &&
    LW.order.RB.fc === 100 && LW.order.RB.imports === 100 && LW.order.WR.sleeper === null,
    'order: each source\'s order at a position against actual points, -100 to 100 (a player a source leaves out counts after its last)');
  const noFc = SCC.labWeek({res: lres, proj: lproj, stats: lstats, players: pl, imports: null, fcFor: () => null, fcOrder: null});
  check(noFc.sources.join() === 'sleeper' && noFc.lineups.fc === undefined && noFc.order.QB.fc === undefined && noFc.order.QB.imports === undefined,
    'without a FantasyCalc snapshot or imported rankings, only Sleeper\'s projections are tested');
  check(SCC.rankCorrelation([1, 2, 3], [1, 2, 3]) === 1 && SCC.rankCorrelation([1, 2], [2, 1]) === null, 'a rank correlation needs three players');
}

section('the waiver plan, usage and the waiver reminder');
{
  const P = (id, name, pos, rank, x) => Object.assign({id, name, pos, team: 'KC', rank, start: false, held: false}, x);
  const roster = [P('1', 'Q One', 'QB', 5, {start: true}), P('2', 'R A', 'RB', 10, {start: true}), P('3', 'R Start', 'RB', 40, {start: true}),
    P('4', 'W A', 'WR', 12, {start: true}), P('5', 'W B', 'WR', 30, {start: true}), P('6', 'K One', 'K', 3, {start: true}),
    P('7', 'Q Two', 'QB', 20), P('8', 'R C', 'RB', 90), P('9', 'W C', 'WR', 150), P('12', 'W D', 'WR', 120), P('10', 'K Two', 'K', 12),
    P('11', 'R Hurt', 'RB', null, {held: true})];
  const fa = (name, pos, rank) => ({name, pos, team: 'BUF', rank});
  const wire = [{pos: 'RB', cur: roster[2], list: [fa('FA One', 'RB', 20), fa('FA Two', 'RB', 25)]},
    {pos: 'FLEX', cur: roster[4], list: [fa('FA One', 'RB', 20), fa('FA Three', 'WR', 28)]}];
  const cfg = {id: 'L', key: 'L', lineup: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'K'], bench: 5};
  const plan = SCC.waiverPlan([{cfg, roster, wire}]);
  const c = plan[0].claims;
  check(plan.length === 1 && plan[0].open === 0 && c.length === 2 && c[0].add.name === 'FA One' && c[0].over.name === 'R Start' && c[0].alts[0].name === 'FA Two',
    'each league\'s claims come from its waiver targets, with the starter each beats and the next free agents as alternatives');
  check(c[0].drop.name === 'W C' && c[0].dropAlts.map(p => p.name).join() === 'W D,R C' && !c[0].thin && c[1].add.name === 'FA Three' && c[1].drop.name === 'W D',
    'drops: the bench player the rankings like least, never the only backup QB, a kicker for a running back or someone on IR; two claims never drop the same player, and a free agent is claimed once');
  const roomy = SCC.waiverPlan([{cfg: Object.assign({}, cfg, {bench: 6}), roster, wire}])[0];
  check(roomy.open === 1 && roomy.claims[0].drop === null && roomy.claims[0].dropAlts.length === 2 && roomy.claims[1].drop.name === 'W C',
    'an open roster spot means the first claim needs no drop');
  const lean = roster.filter(p => ['7', '10'].includes(p.id) || p.start);
  const thin = SCC.waiverPlan([{cfg: Object.assign({}, cfg, {bench: 2}), roster: lean, wire: wire.slice(0, 1)}])[0].claims[0];
  check(thin.drop.name === 'Q Two' && thin.thin, 'when every spare bench player is an only backup, Titan still names one and says so');
  const byVal = SCC.waiverPlan([{cfg, roster, wire}], {value: (c, p) => ({'W C': 50, 'W D': 5})[p.name] || 0})[0].claims;
  check(byVal[0].drop.name === 'R C' && byVal[0].dropAlts.map(p => p.name).join() === 'W D,W C' && !byVal[0].keep && byVal[1].drop.name === 'W D' && byVal[1].keep,
    'with season values, the least valuable goes first (W C, ranked low this week, is safe), and a drop worth more than his claim is flagged');
  check(SCC.waiverPlan([{cfg, roster, wire: []}]).length === 0, 'no waiver targets, nothing to plan');
  // A kicker (or defense) is only swapped for one: the spare kicker on the bench first, else the kicker he replaces; never an open spot or a skill player.
  const kwire = [{pos: 'K', cur: roster[5], list: [fa('FA Kick', 'K', 1)]}].concat(wire);
  const kplan = SCC.waiverPlan([{cfg: Object.assign({}, cfg, {bench: 6}), roster, wire: kwire}])[0];
  check(kplan.open === 1 && kplan.claims[0].add.name === 'FA Kick' && kplan.claims[0].drop.name === 'K Two' && kplan.claims[0].like && kplan.claims[0].over.name === 'K One'
    && kplan.claims[1].drop === null,
    'a kicker claim drops the spare kicker on the bench, and leaves the open spot to the next claim: ' + JSON.stringify(kplan.claims.map(c => [c.add.name, c.drop && c.drop.name])));
  const noSpare = SCC.waiverPlan([{cfg, roster: roster.filter(p => p.id !== '10'), wire: kwire}])[0].claims[0];
  check(noSpare.drop.name === 'K One' && noSpare.like && noSpare.dropAlts.length === 0, 'with no spare kicker, the claim drops the kicker he replaces, never a skill player');
  const lockedRoster = roster.filter(p => p.id !== '10').map(p => (p.id === '6' ? Object.assign({}, p, {locked: true}) : p));
  const kLocked = SCC.waiverPlan([{cfg, roster: lockedRoster, wire: [{pos: 'K', cur: lockedRoster.find(p => p.id === '6'), list: [fa('FA Kick', 'K', 1)]}]}])[0].claims[0];
  check(kLocked.drop === null, 'a kicker whose game has started can\'t be dropped for one: the claim names nobody');
  const u = SCC.usageOf([{9: {gp: 1, snp: 40, tsnp: 60, tgt: 5, car: 2, rz: 1, ppr: 10}}, {}, {9: {gp: 1, snp: 54, tsnp: 60, tgt: 9, car: 0, rz: 2, ppr: 20}}], '9');
  check(u.games === 2 && u.snapPct === 78 && u.tgt === 7 && u.car === 1 && u.rz === 1.5 && u.pts === 15 && u.trend === 'up' && SCC.usageOf([{}], '9') === null,
    'usage: snap share, targets, carries and red-zone looks a game, and his snaps rising (67% to 90%)');
  const lg = (waiverDay, x) => ({cfg: Object.assign({key: 'Lg ' + waiverDay, waiverDay}, x)});
  const sentW = {};
  const tue8 = SCC.waiverReminder([lg(2), lg(2), lg(2, {dailyWaivers: true}), lg(4), lg(undefined, {platform: 'espn'})], {week: 2, etDay: 2, etHour: 20, date: '2026-09-15', sent: sentW});
  check(tue8.length === 1 && tue8[0].key === 'waiver|2|2026-09-15' && /2 of your leagues/.test(tue8[0].body) && tue8[0].url === '/app/waivers',
    'Tuesday at 8 PM Eastern: one reminder for the leagues whose waivers run Wednesday (daily ones aside): ' + (tue8[0] || {}).body);
  check(SCC.waiverReminder([lg(2)], {week: 2, etDay: 2, etHour: 20, date: '2026-09-15', sent: sentW}).length === 0 &&
    SCC.waiverReminder([lg(2)], {week: 2, etDay: 2, etHour: 16, date: '2026-09-15', sent: {}}).length === 0 &&
    SCC.waiverReminder([lg(2)], {week: 2, etDay: 1, etHour: 20, date: '2026-09-14', sent: {}}).length === 0, 'once a night, only at 8 PM, only the evening before');
}

section('bye-week needs');
const P = (name, pos, bye, x) => Object.assign({id: name, name, pos, bye, inj: '', held: false}, x);
const lg = {cfg: {key: 'T', name: 'Test', lineup: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']}, roster: [
  P('Q1', 'QB', 7), P('Ra', 'RB', 5), P('Rb', 'RB', 6), P('Rc', 'RB', 9), P('Wa', 'WR', 5), P('Wb', 'WR', 8), P('Wc', 'WR', 8),
  P('T1', 'TE', 10), P('T2', 'TE', 12, {held: true}), P('K1', 'K', 9), P('D1', 'DEF', 11), P('Wd', 'WR', 6, {inj: 'IR (knee)'})]};
const n = SCC.byeNeeds([lg], 1)[0], at = wk => n.needs.find(x => x.week === wk);
check(at(7) && at(7).need.join() === 'QB' && at(7).off.join() === 'Q1', 'week 7: the only QB is off, so a QB is needed');
check(at(8) && at(8).need.join() === 'WR', 'week 8: two WRs off and an RB covers FLEX, so only a WR is needed');
check(at(5) && at(5).need.join() === 'FLEX' && at(5).off.join() === 'Ra,Wa', 'week 5: an RB and a WR off, so the FLEX is short');
check(at(9) && at(9).need.join() === 'K', 'week 9: a WR moves to FLEX; the kicker is short');
check(at(10) && at(10).need.join() === 'TE' && at(11).need.join() === 'DEF', 'weeks 10 and 11: TE (the backup is on IR), then DEF');
check(!at(6) && !at(12), 'weeks 6 and 12: covered (the injured WR and the held TE never count)');
check(SCC.byeNeeds([lg], 8)[0].needs.every(x => x.week >= 8), 'weeks already played are left out');
const noK = {cfg: lg.cfg, roster: lg.roster.filter(p => p.pos !== 'K')};
check(!SCC.byeNeeds([noK], 1)[0].needs.some(x => x.need.includes('K')), 'a spot empty without any byes isn\'t blamed on a bye');
const sf = {cfg: {key: 'S', lineup: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX']}, roster: [P('Qa', 'QB', 6), P('Qb', 'QB', 7), P('R', 'RB', 9), P('W', 'WR', 9), P('T', 'TE', 10)]};
const s = SCC.byeNeeds([sf], 1)[0];
check(s.needs.find(x => x.week === 6).need.join() === 'SFLX' && s.needs.find(x => x.week === 9).need.sort().join() === 'RB,WR', 'superflex: a QB off leaves the superflex short');

section('which week the lineups show');
const g = (week, date, status) => ({week, date, status, home: 'KC', away: 'BUF'});
const sched = [g(1, '2026-09-10', 'complete'), g(1, '2026-09-13', 'complete'), g(1, '2026-09-14', 'complete'),
  g(2, '2026-09-20', 'pre_game'), g(3, '2026-09-27', 'pre_game')];
const et = iso => Date.parse(iso);
check(SCC.effectiveWeek(1, sched, et('2026-09-15T03:00:00Z')) === 1, 'Monday night after the last game (Eastern): still week 1, final scores');
check(SCC.effectiveWeek(1, sched, et('2026-09-15T14:00:00Z')) === 2, 'Tuesday: week 2, upcoming projections');
check(SCC.effectiveWeek(2, sched, et('2026-09-15T14:00:00Z')) === 2, 'Sleeper already on week 2: stays week 2');
const live = sched.map(x => (x.date === '2026-09-14' ? Object.assign({}, x, {status: 'in_game'}) : x));
check(SCC.effectiveWeek(1, live, et('2026-09-15T14:00:00Z')) === 1, 'a game still in progress holds the week');
const postponed = sched.concat([g(1, '2026-09-15', 'pre_game')]);
check(SCC.effectiveWeek(1, postponed, et('2026-09-15T14:00:00Z')) === 1, 'a game moved to Tuesday holds the week');
const sundayWeek = [g(2, '2026-09-20', 'complete'), g(3, '2026-09-27', 'pre_game')];
check(SCC.effectiveWeek(2, sundayWeek, et('2026-09-21T15:00:00Z')) === 2 && SCC.effectiveWeek(2, sundayWeek, et('2026-09-22T15:00:00Z')) === 3,
  'a week ending Sunday still switches on Tuesday');
check(SCC.effectiveWeek(3, sched, et('2026-12-30T15:00:00Z')) === 3, 'the last week never moves past the schedule');

section('points for started players');
const lk = {roster: [{id: '1', team: 'KC'}, {id: '2', team: 'NYJ'}, {id: 'SEA', team: 'SEA'}]};
SCC.applyLocks([lk], {KC: {state: 'in_game', kick: '2026-09-13'}, NYJ: {state: 'pre', kick: '2026-09-14'}, SEA: {state: 'complete', kick: '2026-09-10'}});
check(lk.roster[0].game === 'in_game' && lk.roster[0].kick === '2026-09-13' && lk.roster[1].locked === false && lk.roster[2].game === 'complete',
  'each player knows whether his game is on, over or still to come');
SCC.applyPoints(lk, {1: 12.345, 2: 5, SEA: 7});
check(lk.roster[0].pts === 12.35 && lk.roster[1].pts === null && lk.roster[2].pts === 7, 'points land only on players whose game has started');
const byEspn = {roster: [{id: '9', espnId: 3918298, locked: true}]};
SCC.applyPoints(byEspn, {3918298: 21.4}, true);
check(byEspn.roster[0].pts === 21.4, 'ESPN points match by ESPN player id');

section('players whose game has started');
const lgX = {id: 'X', key: 'X', name: 'X', lineup: ['QB', 'RB', 'WR', 'K']};
const pl = (id, name, pos, team, over) => Object.assign({id, name, pos, team, start: true, slot: pos, locked: false, inj: '', outish: false}, over);
const rosX = [pl('q', 'Played Qb', 'QB', 'SEA', {locked: true}), pl('r', 'Slow Back', 'RB', 'KC'),
  pl('w', 'Hurt Wideout', 'WR', 'SEA', {locked: true, inj: 'Out (knee)', outish: true}), pl('k', 'Done Kicker', 'K', 'SEA', {locked: true})];
const wkX = SCC.weeklyMap([{name: 'Slow Back', pos: 'RB', team: 'KC', rank: 60}, {name: 'Free Qb', pos: 'QB', team: 'BUF', rank: 1},
  {name: 'Early Back', pos: 'RB', team: 'SEA', rank: 5}, {name: 'Late Back', pos: 'RB', team: 'MIA', rank: 10},
  {name: 'Free Kicker', pos: 'K', team: 'BUF', rank: 1}]);
const takenX = {};
rosX.forEach(p => { takenX[SCC.norm(p.name)] = 1; });
const LX = SCC.analyzeAll({leagues: [{cfg: lgX, roster: rosX, takenNorm: takenX, takenAbbr: {}}],
  games: {SEA: {state: 'complete'}, KC: {state: 'pre'}, MIA: {state: 'pre'}, BUF: {state: 'pre'}}}, wkX).leagues[0];
const wireX = pos => LX.wire.find(x => x.pos === pos);
check(!wireX('QB') && !wireX('K') && !wireX('WR'), 'no pickup is offered over a player whose game has started, ranked or not');
check(wireX('RB') && wireX('RB').list.map(x => x.name).join() === 'Late Back', 'an RB upgrade is offered, but never a free agent whose game has started');
check(LX.rows.filter(r => r.p.locked).every(r => r.verdict === 'LOCKED') && !LX.moves.length && !LX.stops, 'started players show LOCKED and are never swapped');
check(!LX.hurt.length, 'an injured player whose game has started gets no warning');
const keptX = SCC.keepStartedRanks([{name: 'Slow Back', pos: 'RB', rank: 55}],
  [{name: 'Played Qb', pos: 'QB', rank: 4}, {name: 'Slow Back', pos: 'RB', rank: 60}, {name: 'Bench Guy', pos: 'WR', rank: 30}],
  {[SCC.norm('Played Qb')]: 1, [SCC.norm('Slow Back')]: 1});
check(keptX.length === 1 && keptX[0].name === 'Played Qb' && keptX[0].rank === 4,
  'new rankings keep the old rank of a started player they left out, and nobody else\'s');

section('IR and taxi');
const heldLg = SCC.buildLeague({id: 'H', key: 'H', lineup: ['QB']}, [{owner_id: 'u', roster_id: 1, players: ['1', '2', '3'], starters: ['1'],
  reserve: ['2'], taxi: ['3']}], 'u', {1: ['A Qb', 'QB', 'KC'], 2: ['B Rb', 'RB', 'KC'], 3: ['C Wr', 'WR', 'KC']});
const heldOf = id => heldLg.roster.find(p => p.id === id);
check(heldOf('2').held && heldOf('2').heldAs === 'IR' && heldOf('3').held && heldOf('3').heldAs === 'TAXI' && !heldOf('1').held,
  'a Sleeper roster keeps IR and taxi players apart');

section('a starter on bye');
const byeLg = {id: 'B', key: 'B', name: 'B', lineup: ['QB']};
const byeRos = [pl('q1', 'Bye Qb', 'QB', 'KC', {bye: 5}), pl('q2', 'Backup Qb', 'QB', 'BUF', {bye: 7, start: false, slot: ''})];
const byeRanks = SCC.weeklyMap([{name: 'Bye Qb', pos: 'QB', team: 'KC', rank: 1}, {name: 'Backup Qb', pos: 'QB', team: 'BUF', rank: 20}]);
const onBye = SCC.analyzeAll({week: 5, leagues: [{cfg: byeLg, roster: byeRos, takenNorm: {}, takenAbbr: {}}]}, byeRanks).leagues[0];
check(onBye.rows[0].verdict === 'ON BYE' && onBye.stops === 1 && onBye.moves.length === 1 && onBye.moves[0].inn.name === 'Backup Qb',
  'his bye week: ON BYE, even ranked first, and his backup goes in');
const notBye = SCC.analyzeAll({week: 6, leagues: [{cfg: byeLg, roster: byeRos, takenNorm: {}, takenAbbr: {}}]}, byeRanks).leagues[0];
check(notBye.rows[0].verdict === 'OK' && !notBye.moves.length && !notBye.stops, 'any other week he starts as normal');

section('planning a later week (Lineups\' week dropdown)');
const planSched = [{week: 3, date: '2026-09-27', status: 'pre_game', home: 'KC', away: 'BUF'},
  {week: 3, date: '2026-09-28', status: 'pre_game', home: 'NYJ', away: 'MIA'}, {week: 1, date: '2026-09-13', status: 'complete', home: 'KC', away: 'SEA'}];
const planLg = {id: 'P', key: 'P', name: 'P', lineup: ['QB', 'RB']};
const planRos = [pl('pq', 'Plan Qb', 'QB', 'KC', {locked: true, game: 'complete', pts: 20, inj: 'Out (ankle)', outish: true}),
  pl('pr', 'Plan Rb', 'RB', 'SEA', {bye: 3}), pl('ps', 'Spare Rb', 'RB', 'MIA', {start: false, slot: '', inj: 'IR (knee)', outish: true})];
const planSnap = {week: 1, games: {KC: {state: 'complete'}}, kickoffs: {KC: [1]}, leagues: [{cfg: planLg, roster: planRos, takenNorm: {}, takenAbbr: {}}]};
const plan = SCC.planWeek(planSnap, planSched, 3), pq = plan.leagues[0].roster[0];
check(plan.week === 3 && !pq.locked && pq.game === 'pre' && pq.kick === '2026-09-27' && pq.pts === null && pq.opp === 'BUF' && !Object.keys(plan.kickoffs).length,
  'a later week: nothing locked or scored, each player with that week\'s game day and opponent');
check(!pq.outish && plan.leagues[0].roster[2].outish, 'today\'s Out tag doesn\'t bench him weeks ahead; IR still does');
check(planRos[0].locked && planRos[0].pts === 20 && planSnap.week === 1 && planSnap.games.KC.state === 'complete', 'this week\'s snapshot is left as it was');
const planL = SCC.analyzeAll(plan, SCC.weeklyMap([{name: 'Plan Qb', pos: 'QB', team: 'KC', rank: 1}, {name: 'Plan Rb', pos: 'RB', team: 'SEA', rank: 1},
  {name: 'Spare Rb', pos: 'RB', team: 'MIA', rank: 2}])).leagues[0];
check(planL.rows[0].verdict === 'OK' && planL.rows[0].p.opp === 'BUF' && planL.rows[1].verdict === 'ON BYE' && !planL.rows[1].p.opp,
  'the plan starts the QB against BUF, and the RB whose team is off that week shows ON BYE, with no opponent');

section('opening a Sleeper league');
check(SCC.sleeperTeamUrl('123', false) === 'https://sleeper.com/leagues/123/team', 'a computer or an iPhone opens the league\'s team page on the web');
check(SCC.sleeperTeamUrl('123', true) === 'https://sleeper.com/leagues/123/team' && !/intent:/.test(SCC.sleeperTeamUrl('123', true)),
  'an Android phone gets the same web link, never an intent (Sleeper\'s app won\'t take league links, so an intent went to the Play Store)');

section('chance to win a matchup');
const team = (projs, state, pts) => projs.map((proj, i) => ({proj, state: state || 'pre', pts: pts ? pts[i] : 0}));
const even = SCC.winProbability(team([15, 15, 15]), team([15, 15, 15]));
check(Math.abs(even.a - 0.5) < 0.001 && Math.abs(even.a + even.b - 1) < 1e-9, 'same projections before kickoff: 50/50');
const fav = SCC.winProbability(team([15, 15, 15, 15, 15, 15, 15, 15, 20]), team([12, 12, 12, 12, 12, 12, 12, 12, 14]));
check(fav.a > 0.6 && fav.a < 0.9, `projected 140 against 110 before kickoff: ${Math.round(fav.a * 100)}% (a clear favorite, not a lock)`);
const over = SCC.winProbability(team([15, 15], 'complete', [20, 21]), team([30, 30], 'complete', [18, 22]));
check(over.a === 1 && over.b === 0, 'every game over: the side ahead has 100%');
const late = SCC.winProbability(team([15, 15], 'complete', [30, 30]).concat(team([10], 'in_game', [8])), team([15, 15, 15], 'complete', [10, 12, 11]));
check(late.a > 0.99, 'far ahead with one player left: almost certain');
const comeback = SCC.winProbability(team([15, 15, 15], 'complete', [10, 10, 10]), team([15, 15], 'complete', [12, 12]).concat(team([25])));
check(comeback.b > 0.5 && comeback.b < 1, `behind by 6 with a 25-point projection still to play: ${Math.round(comeback.b * 100)}%`);

section('default rankings (from projections)');
// Made-up projections: [standard points, points catches add at full PPR].
const dProj = {1: [20, 0], 2: [10, 6], 3: [13, 1], 4: [8, 0], 5: [9, 0], DEN: [7, 0], 6: [0, 0], 7: [11, 0], 8: [5, 5], 9: [3, 0]};
const dPlayers = {1: ['Qb Guy', 'QB', 'KC'], 2: ['Rb Catch', 'RB', 'ATL'], 3: ['Wr Deep', 'WR', 'CIN'], 4: ['Kick Er', 'K', 'DAL'],
  5: ['Kick Two', 'K', 'LAC'], 6: ['Zero Back', 'RB', 'NYJ'], 7: ['Ld Lb', 'LB', 'SF'], 8: ['Te Catch', 'TE', 'DET'], 9: ['Qb Guy', 'WR', 'NYG']};
const dStd = SCC.defaultRanks(dProj, dPlayers, 0), dFull = SCC.defaultRanks(dProj, dPlayers, 1);
const dr = (rows, n) => (rows.find(r => r.name === n) || {}).rank;
check(dr(dStd, 'Qb Guy') === 1 && dr(dStd, 'Wr Deep') === 2 && dr(dStd, 'Rb Catch') === 3 && dr(dStd, 'Te Catch') === 4,
  'standard scoring: QB, RB, WR and TE on one overall scale, by projected points');
check(dr(dFull, 'Rb Catch') === 2 && dr(dFull, 'Wr Deep') === 3 && dr(dFull, 'Te Catch') === 4, 'full PPR: catches move the pass-catching back ahead');
check(dr(dStd, 'Kick Two') === 1 && dr(dStd, 'Kick Er') === 2 && dr(dStd, 'DEN D/ST') === 1,
  'K and DEF each rank on their own; a defense is named like the rosters (DEN D/ST)');
check(!dStd.some(r => r.name === 'Zero Back' || r.name === 'Ld Lb'), 'no projection, no rank; IDP players are left out');
check(dStd.filter(r => r.name === 'Qb Guy').length === 1 && dStd.find(r => r.name === 'Qb Guy').pos === 'QB', 'two players with one name: the one projected higher keeps it');
const imported = [{name: 'Wr Deep', pos: 'WR', team: 'CIN', rank: 1}, {name: 'Rb Catch', pos: 'RB', team: 'ATL', rank: 40}, {name: 'Qb Guy', pos: 'QB', team: 'KC', rank: 5}];
const byCfg = SCC.rankingsBy(imported, dProj, dPlayers);
const mStd = byCfg({ppr: 0}), mFull = byCfg({ppr: 1});
check(mStd[SCC.norm('Wr Deep')].rank === 1 && mStd[SCC.norm('Rb Catch')].rank === 40 && mStd[SCC.norm('Qb Guy')].rank === 5, 'an import wins for the positions it covers');
check(mStd[SCC.norm('Te Catch')].rank === 4 && mStd[SCC.norm('Kick Two')].rank === 1 && !!mStd[SCC.norm('DEN D/ST')] && Object.keys(mStd).length === 7,
  'the defaults fill the positions it leaves out (TE, K, DEF)');
check(byCfg({ppr: 0}) === mStd && mFull !== mStd, 'each scoring value\'s rankings are built once');
const dNone = SCC.rankingsBy([], dProj, dPlayers)({ppr: 1});
check(dNone[SCC.norm('Rb Catch')].rank === 2 && Object.keys(dNone).length === 7, 'nothing imported: the defaults alone');
check(Object.keys(SCC.rankingsBy(imported, null, dPlayers)({ppr: 1})).length === 3, 'no projections: the import alone');
const every = imported.concat([{name: 'Tight End', pos: 'TE', team: 'KC', rank: 3}, {name: 'Kicker Guy', pos: 'K', team: 'KC', rank: 1},
  {name: 'NYJ D/ST', pos: 'DEF', team: 'NYJ', rank: 1}]);
check(Object.keys(SCC.rankingsBy(every, dProj, dPlayers)({ppr: 1})).length === 6, 'an import covering every position gets no defaults');
const flexRoster = () => [
  {id: '2', name: 'Rb Catch', pos: 'RB', team: 'ATL', start: true, slot: 'FLEX', inj: '', outish: false, locked: false},
  {id: '3', name: 'Wr Deep', pos: 'WR', team: 'CIN', start: false, slot: '', inj: '', outish: false, locked: false}];
const lgStd = {id: 'a', key: 'Std', name: 'Std', lineup: ['FLEX'], ppr: 0}, lgFull = {id: 'b', key: 'Full', name: 'Full', lineup: ['FLEX'], ppr: 1};
const dA = SCC.analyzeAll({week: 1, leagues: [{cfg: lgStd, roster: flexRoster(), takenNorm: {}, takenAbbr: {}},
  {cfg: lgFull, roster: flexRoster(), takenNorm: {}, takenAbbr: {}}]}, SCC.rankingsBy([], dProj, dPlayers));
check(dA.leagues[0].moves.length === 1 && dA.leagues[0].moves[0].inn.name === 'Wr Deep' && dA.leagues[1].moves.length === 0,
  'each league by its own scoring: standard starts the receiver at FLEX, full PPR keeps the back');

section('latest kickoff in FLEX');
const kickRanks = SCC.weeklyMap([{name: 'Thu Back', pos: 'RB', team: 'KC', rank: 1}, {name: 'Sun Wideout', pos: 'WR', team: 'BUF', rank: 2},
  {name: 'Mon Back', pos: 'RB', team: 'DAL', rank: 3}, {name: 'Bench Back', pos: 'RB', team: 'NYJ', rank: 50}]);
const THU = Date.UTC(2026, 8, 11, 0, 15), SUN = Date.UTC(2026, 8, 13, 17), MON = Date.UTC(2026, 8, 15, 0, 15);
const kickLg = {id: 'k', key: 'Kick', name: 'Kick', lineup: ['RB', 'WR', 'FLEX'], ppr: 1};
const kp = (id, name, pos, team, slot, extra) => Object.assign({id, name, pos, team, start: !!slot, slot: slot || '', inj: '', outish: false, locked: false}, extra || {});
const kickRoster = extra => [kp('1', 'Thu Back', 'RB', 'KC', 'FLEX', extra), kp('2', 'Sun Wideout', 'WR', 'BUF', 'WR'),
  kp('3', 'Mon Back', 'RB', 'DAL', 'RB'), kp('4', 'Bench Back', 'RB', 'NYJ', '')];
const kicks = {KC: [THU, false], BUF: [SUN, false], DAL: [MON, false], NYJ: [SUN, false]};
const kickRun = (roster, kickoffs) => SCC.analyzeAll({week: 1, kickoffs, leagues: [{cfg: kickLg, roster, takenNorm: {}, takenAbbr: {}}]}, kickRanks).leagues[0];
const K1 = kickRun(kickRoster(), kicks);
check(K1.opt.map(o => o.p.name).join(', ') === 'Thu Back, Sun Wideout, Mon Back',
  'Titan\'s lineup puts the Monday back in FLEX and the Thursday back at RB: ' + K1.opt.map(o => o.slot + ' ' + o.p.name).join(', '));
const km = K1.moves;
check(km.length === 1 && km[0].slot === 'FLEX' && km[0].inn.name === 'Mon Back' && km[0].from === 'RB' && km[0].out.name === 'Thu Back' && km[0].to === 'RB',
  'the same players starting, spots traded: one change, shown at FLEX');
check(K1.rows.every(r => r.verdict === 'OK'), 'nobody is marked to swap out');
check(kickRun(kickRoster(), {}).moves.length === 0, 'without kickoff times, a lineup starting the right players is left alone');
check(kickRun(kickRoster({locked: true}), kicks).moves.length === 0, 'once the Thursday game has started, he stays in FLEX');
const byDay = kickRun(kickRoster().map(p => Object.assign(p, {kick: {KC: '2026-09-10', BUF: '2026-09-13', DAL: '2026-09-14', NYJ: '2026-09-13'}[p.team]})), {});
check(byDay.moves.length === 1 && byDay.moves[0].inn.name === 'Mon Back', 'with only game days (the server job), the Monday back still goes in FLEX');

section('game-day alerts');
const aRanks = SCC.weeklyMap([{name: 'Hurt Back', pos: 'RB', team: 'KC', rank: 1}, {name: 'Bench Back', pos: 'RB', team: 'BUF', rank: 5},
  {name: 'Extra Back', pos: 'RB', team: 'BUF', rank: 7}, {name: 'Bye Wideout', pos: 'WR', team: 'MIA', rank: 3},
  {name: 'Spare Wideout', pos: 'WR', team: 'BUF', rank: 9}]);
const aLg = {id: 'a1', key: 'Alert League', name: 'Alert League', lineup: ['RB', 'WR', 'FLEX'], ppr: 1};
const aRoster = () => [kp('11', 'Hurt Back', 'RB', 'KC', 'RB', {inj: 'Out', outish: true}), kp('12', 'Bye Wideout', 'WR', 'MIA', 'WR', {bye: 5}),
  kp('13', 'Bench Back', 'RB', 'BUF', ''), kp('14', 'Extra Back', 'RB', 'BUF', ''), kp('15', 'Spare Wideout', 'WR', 'BUF', '')];
const KC1 = Date.UTC(2026, 9, 11, 17), BUF1 = KC1 + 3 * 3600e3;
const aA = SCC.analyzeAll({week: 5, kickoffs: {KC: [KC1, false], BUF: [BUF1, false]},
  leagues: [{cfg: aLg, roster: aRoster(), takenNorm: {}, takenAbbr: {}}]}, aRanks);
const aKick = p => ({KC: KC1, BUF: BUF1})[p.team] || 0;
const aSent = {};
const early = SCC.alertsFor(aA, {week: 5, now: KC1 - 5 * 3600e3, kickoffs: [KC1, BUF1], kickAt: aKick, sent: aSent});
check(early.length === 1 && early[0].kind === 'out' && early[0].title === 'Hurt Back is out' && /Titan would start Bench Back instead/.test(early[0].body),
  'a ruled-out starter: one alert, with who Titan would start: ' + (early[0] && early[0].title + '. ' + early[0].body));
const hour = SCC.alertsFor(aA, {week: 5, now: KC1 - 60 * 60000, kickoffs: [KC1, BUF1], kickAt: aKick, sent: aSent});
check(hour.length === 1 && hour[0].kind === 'check' && /Hurt Back \(Out\)/.test(hour[0].body) && /Bye Wideout \(on bye\)/.test(hour[0].body) &&
  /an empty FLEX/.test(hour[0].body), 'about an hour before kickoff, the lineup check lists what\'s still wrong: ' + (hour[0] && hour[0].body));
check(SCC.alertsFor(aA, {week: 5, now: KC1 - 50 * 60000, kickoffs: [KC1, BUF1], kickAt: aKick, sent: aSent}).length === 0, 'nothing is sent twice');
check(SCC.alertsFor(aA, {week: 5, now: KC1 - 60 * 60000, kickoffs: [KC1, BUF1], kickAt: aKick, sent: {}, want: {out: false, check: false}}).length === 0,
  'alerts someone turned off stay off');
check(SCC.alertsFor(aA, {week: 5, now: KC1 - 3 * 3600e3, kickoffs: [KC1, BUF1], kickAt: aKick, sent: {}, want: {out: false, check: true}}).length === 0,
  'no lineup check while kickoff is still hours away');

section('one lineup check for every league, and free backups');
const aLg2 = {id: 'a2', key: 'Second League', name: 'Second League', lineup: ['RB', 'WR', 'FLEX'], ppr: 1};
const two = SCC.analyzeAll({week: 5, kickoffs: {KC: [KC1, false], BUF: [BUF1, false]},
  leagues: [{cfg: aLg, roster: aRoster(), takenNorm: {}, takenAbbr: {}}, {cfg: aLg2, roster: aRoster(), takenNorm: {[SCC.norm('Backup Back')]: 1}, takenAbbr: {}}]}, aRanks);
const both = SCC.alertsFor(two, {week: 5, now: KC1 - 60 * 60000, kickoffs: [KC1, BUF1], kickAt: aKick, sent: {}, want: {out: false, check: true}});
check(both.length === 1 && both[0].title === 'Lineup check: 2 leagues' && /Alert League: Hurt Back \(Out\)/.test(both[0].body) &&
  /Second League: /.test(both[0].body) && both[0].url === '/app/lineups' && both[0].key === 'check|5|' + KC1,
  'one lineup check covers every league with something wrong: ' + (both[0] && both[0].body));
const depthPlayers = {'11': ['Hurt Back', 'RB', 'KC', 1], '21': ['Backup Back', 'RB', 'KC', 2], '22': ['Third Back', 'RB', 'KC', 3], '23': ['KC Wideout', 'WR', 'KC', 2]};
const cuffs = SCC.alertsFor(two, {week: 5, now: KC1 - 5 * 3600e3, kickoffs: [KC1, BUF1], kickAt: aKick, sent: {}, players: depthPlayers, want: {out: true, check: false}});
const inFirst = cuffs.find(a => /Alert League/.test(a.body)), inSecond = cuffs.find(a => /Second League/.test(a.body));
check(cuffs.length === 2 && /His backup, Backup Back, is a free agent there\./.test(inFirst.body) && !/backup/.test(inSecond.body),
  'a ruled-out starter\'s backup is named where he\'s a free agent, and not where someone has him: ' + inFirst.body);
check(SCC.playerInfo({'9': ['A B', 'RB', 'KC', 2]}, '9').depth === 2 && SCC.trimPlayers({'9': {first_name: 'A', last_name: 'B', position: 'RB', team: 'KC', depth_chart_order: 2}})['9'][3] === 2,
  'the player list keeps each player\'s place on the depth chart');

section('strength of schedule by position');
{
  const sched = [{week: 3, home: 'KC', away: 'BUF'}, {week: 4, home: 'SF', away: 'KC'}, {week: 5, home: 'KC', away: 'MIA'}, {week: 2, home: 'MIA', away: 'KC'},
    {week: 15, home: 'BUF', away: 'KC'}, {week: 16, home: 'KC', away: 'SF'}, {week: 3, home: 'MIA', away: 'SF'}];
  const dvp = {BUF: {RB: {rank: 30}}, SF: {RB: {rank: 2}}, MIA: {RB: {rank: 10}}, KC: {RB: {rank: 20}}};
  const S = SCC.scheduleStrength(sched, dvp, 'RB', 3, {next4: [3, 6], ros: [3, 17], playoffs: [15, 17]});
  const kc = S.find(r => r.team === 'KC');
  check(kc.opps.map(o => `${o.week}:${o.opp}${o.home ? 'h' : 'a'}:${o.rank}`).join() === '3:BUFh:30,4:SFa:2,5:MIAh:10,15:BUFa:30,16:SFh:2',
    'each team\'s remaining opponents from the week given, with each defense\'s rank against the position: ' + kc.opps.map(o => o.opp).join(', '));
  check(kc.spans.next4 === 14 && kc.spans.ros === 14.8 && kc.spans.playoffs === 16 && S.find(r => r.team === 'SF').spans.next4 === 15,
    `the average rank over each span (KC next four ${kc.spans.next4}, rest of season ${kc.spans.ros}, playoffs ${kc.spans.playoffs})`);
  check(S.map(r => r.team).join() === 'MIA,KC,SF,BUF', 'easiest rest of season first: ' + S.map(r => r.team + ' ' + r.spans.ros).join(', '));
}

section('floor and ceiling, and the close calls in a lineup');
{
  // Three weeks of stats: a steady receiver (10, 10, 10) and a streaky one (2, 20, 8), both projected 12.
  const wk = (a, b) => ({s1: {gp: 1, ppr: a}, s2: {gp: 1, ppr: b}});
  const weeks = [wk(10, 2), wk(10, 20), wk(10, 8)];
  const steady = SCC.spreadOf(weeks, 's1', 'WR', 12), streaky = SCC.spreadOf(weeks, 's2', 'WR', 12), fresh = SCC.spreadOf(weeks, 'nobody', 'WR', 12);
  check(steady.games === 3 && steady.sd < fresh.sd && fresh.sd < streaky.sd && steady.floor > streaky.floor && steady.ceiling < streaky.ceiling,
    `a steady player's range is narrower than his position's usual, a streaky one's wider (sd ${steady.sd}, ${fresh.sd}, ${streaky.sd})`);
  check(fresh.games === 0 && fresh.sd === 6.6 && fresh.floor === 6.39 && fresh.ceiling === 17.61 && SCC.spreadOf(weeks, 's1', 'WR', 0) === null,
    'with no games, the position\'s usual swing (a WR: 55% of his projection); nothing without a projection');
  const P = (id, pos, rank, x) => Object.assign({id, name: id, pos, rank}, x);
  const opt = [{slot: 'RB', p: P('r1', 'RB', 5)}, {slot: 'WR', p: P('w1', 'WR', 10)}, {slot: 'FLEX', p: P('r2', 'RB', 30)}, {slot: 'TE', p: P('t1', 'TE', 3)}];
  const roster = opt.map(o => o.p).concat([P('r3', 'RB', 36), P('r4', 'RB', 34, {outish: true}), P('w2', 'WR', 40), P('t2', 'TE', 4, {locked: true}), P('w3', 'WR', 14, {onBye: true})]);
  const pairs = SCC.closeCallPairs(opt, roster);
  check(pairs.length === 1 && pairs[0].starter.id === 'r2' && pairs[0].bench.id === 'r3',
    'a close call is a bench player at the starter\'s position within 12 ranks who could play: not one ruled out, locked or on bye, and not a 30-rank gap');
  // Tiers over rankings: with tiers on both players, a different tier is never a close call, and the same tier counts only when the two are near each other too.
  const tOpt = [{slot: 'RB', p: P('r1', 'RB', 5, {tier: 1})}, {slot: 'WR', p: P('w1', 'WR', 10, {tier: 2})}];
  const tRoster = tOpt.map(o => o.p).concat([P('r5', 'RB', 15, {tier: 1}), P('w4', 'WR', 12, {tier: 3})]);
  const tPairs = SCC.closeCallPairs(tOpt, tRoster);
  check(tPairs.length === 1 && tPairs[0].starter.id === 'r1' && tPairs[0].bench.id === 'r5' && SCC.closeByRank({rank: 1, tier: ''}, {rank: 9, tier: 2}),
    'with tiers, the RB5 and RB15 in tier 1 are a close call and the WR10 (tier 2) and WR12 (tier 3) aren\'t; without a tier on both, ranks decide');
  // The same tier is not enough on its own: a long file's tier holds dozens, and the order inside it still means something.
  check(!SCC.closeByRank({rank: 102, tier: 8}, {rank: 130, tier: 8}) && SCC.closeByRank({rank: 102, tier: 8}, {rank: 110, tier: 8}),
    'in the same tier but 28 ranks apart is not a close call; eight ranks apart still is');
  // The matchup tilt: two RB spots, RB8 starting, RB12 on the bench; with the matchups counted the bench back projects 3 more.
  const d = () => ({cfg: {key: 'T', lineup: ['RB', 'RB']}, roster: [P('r1', 'RB', 5, {start: true, slot: 'RB'}), P('r2', 'RB', 8, {start: true, slot: 'RB'}), P('r3', 'RB', 12)],
    takenNorm: {}, takenAbbr: {}, started: {}});
  // The bench back's matchup has to be the softer one (rankOf), or there is nothing matchup about the tilt.
  const soft = {r1: 15, r2: 20, r3: 4}, tiltFn = (p, cfg) => ({r1: 18, r2: 12, r3: 15})[p.id] * (cfg.key === 'T' ? 1 : 0);
  const tilted = SCC.analyzeLeague(d(), {x: 1}, 2, {tilt: tiltFn, rankOf: p => soft[p.id]});
  check(tilted.tilts.length === 1 && tilted.tilts[0].inn.id === 'r3' && tilted.tilts[0].out.id === 'r2' && tilted.tilts[0].by === 3 &&
    tilted.tilts[0].muIn === 4 && tilted.tilts[0].muOut === 20 &&
    tilted.opt.map(o => o.p.id).sort().join() === 'r1,r3' && tilted.moves.length === 1,
    'on a close call a bench player with the softer matchup and the better tilted projection (by 1.5 or more) takes the spot, and the card is told which matchups');
  const flat = SCC.analyzeLeague(d(), {x: 1}, 2, {tilt: p => ({r1: 18, r2: 12, r3: 13})[p.id], rankOf: p => soft[p.id]});
  check(flat.tilts.length === 0 && flat.moves.length === 0 && SCC.analyzeLeague(d(), {x: 1}, 2).tilts.length === 0,
    'a smaller tilt, or none, leaves the rankings\' call alone');
  // The same matchup for both: a projection gap alone is the rankings' business, not the tilt's.
  const same = SCC.analyzeLeague(d(), {x: 1}, 2, {tilt: tiltFn, rankOf: () => 16});
  check(same.tilts.length === 0 && same.moves.length === 0, 'with the same matchup on both, a six-point projection gap flips nothing');
  check(SCC.analyzeLeague(d(), {x: 1}, 2, {tilt: tiltFn}).tilts.length === 0, 'and with no matchup to read at all, the rankings simply stand');
  // A hurt bench player never takes a healthy starter's spot on a projection written as though he plays.
  const hurt = () => { const x = d(); x.roster[2] = P('r3', 'RB', 12, {inj: 'Questionable'}); return x; };
  check(SCC.analyzeLeague(hurt(), {x: 1}, 2, {tilt: tiltFn, rankOf: p => soft[p.id]}).tilts.length === 0,
    'a Questionable bench player is never tilted in over a healthy starter');
}

section('past the overall list: an estimated overall rank instead of the position-only sentinel (extendOverall)');
{
  // A wide file whose FLEX (overall) list stops at five players: the receivers and tight ends beyond it used to carry
  // the 1000+ sentinel, which ordered TE25 ahead of WR47 on position rank alone.
  const wide = ['QB Player,QB Rank,WR Player,WR Rank,WR Tier,TE Player,TE Rank,TE Tier,FLEX Player,FLEX Rank',
    'A Passer,1,W One,1,1,T One,1,1,W One,1', ',,W Two,2,1,T Two,2,1,T One,2', ',,W Three,3,2,T Three,3,2,W Two,3',
    ',,W Four,4,2,T Four,4,2,W Three,5', ',,W Five,5,3,T Five,5,3,T Two,8', ',,W Six,6,3,,,,,'].join('\n');
  const w = SCC.parseRanks(wide);
  const by = {}; w.rows.forEach(r => { by[r.name] = r; });
  check(w.format === 'wide' && by['W Three'].rank === 5 && !by['W Three'].est && by['T Two'].rank === 8, 'listed players keep the list\'s overall ranks');
  // Receivers map two overall spots to one position spot (1→1, 2→3, 3→5): W Four continues the line from the list's end.
  check(by['W Four'].rank === 10 && by['W Four'].est === true && by['W Five'].rank === 12 && by['W Six'].rank === 14,
    `past the list a receiver's overall rank continues his position's line, behind everyone listed (${by['W Four'].rank}, ${by['W Five'].rank}, ${by['W Six'].rank})`);
  check(by['T Three'].rank === 1003 && !by['T Three'].est, 'a position with too few listed players (two tight ends) keeps the sentinel');
  const p = SCC.attachRanks([{id: 'x', name: 'W Four', pos: 'WR'}], SCC.weeklyMap(w.rows))[0];
  check(p.est === true && SCC.rankNote(p) === '#10 overall (estimated) · WR4 at position · tier 2', 'the note says the overall rank is an estimate: ' + SCC.rankNote(p));
}

section('the rank note: overall rank, rank at the position, tier (rankBits, rankNote)');
{
  const weekly = SCC.weeklyMap([{name: 'Flex Back', pos: 'RB', team: 'PIT', rank: 17, opp: '', implied: '', tier: 2, posRank: 9},
    {name: 'Deep End', pos: 'TE', team: 'DAL', rank: 1008, opp: '', implied: '', tier: '', posRank: 8},
    {name: 'Passer One', pos: 'QB', team: 'BUF', rank: 1, opp: '', implied: '', tier: 1, posRank: 1}]);
  const [rb, te, qb, nr] = SCC.attachRanks([{id: 'a', name: 'Flex Back', pos: 'RB'}, {id: 'b', name: 'Deep End', pos: 'TE'}, {id: 'c', name: 'Passer One', pos: 'QB'},
    {id: 'd', name: 'Nobody', pos: 'WR'}], weekly);
  check(rb.posRank === 9 && rb.tier === 2 && te.posRank === 8 && qb.posRank === 1, 'attachRanks carries the position rank and tier onto the player');
  const b = SCC.rankBits(rb);
  check(b.overall === 17 && b.pos === 9 && b.tier === 2 && SCC.rankNote(rb) === '#17 overall · RB9 at position · tier 2',
    'a flex-scale back: overall rank, rank at the position and tier: ' + SCC.rankNote(rb));
  check(SCC.rankBits(te).overall === null && SCC.rankBits(te).pos === 8 && SCC.rankNote(te) === '' && SCC.rankLabel(te.pos, te.rank) === 'TE8',
    'past the overall list (the 1000+ sentinel): no overall rank, TE8 at the position, no note without a tier');
  check(SCC.rankBits(qb).overall === null && SCC.rankBits(qb).pos === 1 && SCC.rankNote(qb) === 'tier 1', 'a quarterback ranks on his own scale: no overall, tier only');
  check(SCC.rankBits(nr).overall === null && SCC.rankBits(nr).pos === null && SCC.rankNote(nr) === '', 'unranked: nothing');
  const noPos = SCC.rankBits({pos: 'WR', rank: 1021, posRank: '', tier: 4});
  check(noPos.pos === 21 && noPos.tier === 4 && SCC.rankNote({pos: 'WR', rank: 1021, posRank: '', tier: 4}) === 'tier 4',
    'without a position column the sentinel gives the position rank (the label WR21 already says it, so the note is the tier)');
}

section('where the projections disagree with the rankings (disagreements)');
{
  const mk = (id, name, pos, rank, tier, extra) => Object.assign({id, name, pos, team: 'X', rank, tier}, extra || {});
  const s1 = mk('1', 'Starter One', 'WR', 12, 3), s2 = mk('2', 'Starter Two', 'WR', 20, 4), rb = mk('3', 'Back One', 'RB', 8, 2);
  const b1 = mk('4', 'Bench One', 'WR', 30, 6), b2 = mk('5', 'Bench Two', 'WR', 21, 4), b3 = mk('6', 'Bench Out', 'WR', 40, 7, {outish: true}), b4 = mk('7', 'Bench Back', 'RB', 25, 5);
  const opt = [{slot: 'WR', p: s1}, {slot: 'WR', p: s2}, {slot: 'RB', p: rb}];
  const roster = [s1, s2, rb, b1, b2, b3, b4];
  const proj = {1: 10.8, 2: 9.0, 3: 15, 4: 14.2, 5: 11.5, 6: 30, 7: 19};
  const D = SCC.disagreements(opt, roster, p => proj[p.id]);
  check(D.length === 2 && D[0].bench.name === 'Bench One' && D[0].starter.name === 'Starter Two' && D[0].a === 9 && D[0].b === 14.2,
    `a bench receiver two tiers down who projects 3+ points more is a disagreement, the widest gap first, with both projections (${JSON.stringify(D.map(d => [d.starter.name, d.bench.name, d.a, d.b]))})`);
  check(D[1].bench.name === 'Bench Back' && D[1].starter.name === 'Back One', 'a back on the bench over the starting back too (same position only)');
  check(!D.some(d => d.bench.name === 'Bench Two'), 'a bench player in the starter\'s tier is a close call, not a disagreement (the tilt already weighs it)');
  check(!D.some(d => d.bench.name === 'Bench Out'), 'an Out bench player never counts, whatever he projects');
  check(SCC.disagreements(opt, roster, () => null).length === 0, 'no projections, no disagreements');
  // Each player once: Bench One would also beat Starter Two (14.2 vs 9), but he's already named against Starter One.
  check(D.filter(d => d.bench.id === '4').length === 1, 'each bench player is named once, against the starter he most outscores');
}

section('close calls graded against the points (gradeCalls)');
{
  const calls = [{league: 'A', slot: 'WR', pick: {id: '1', name: 'P One'}, other: {id: '2', name: 'O One'}, flip: false, a: 10, b: 9},
    {league: 'A', slot: 'RB', pick: {id: '3', name: 'P Two'}, other: {id: '4', name: 'O Two'}, flip: true, a: 12, b: 14},
    {league: 'B', slot: 'TE', pick: {id: '5', name: 'P Three'}, other: {id: '6', name: 'O Three'}, flip: false},
    {league: 'B', slot: 'WR', pick: {id: '7', name: 'Not yet'}, other: {id: '8', name: 'Played'}, flip: false}];
  const pts = {1: 15.2, 2: 8.1, 3: 6, 4: 19.5, 5: 7, 6: 7, 8: 10};
  const G = SCC.gradeCalls(calls, id => (id in pts ? pts[id] : null));
  check(G.n === 3 && G.right === 1 && G.rows.length === 4, `three calls with both players played, one right (${G.right} of ${G.n}), every call listed`);
  check(G.ranks.n === 2 && G.ranks.right === 1 && G.flips.n === 1 && G.flips.right === 0, 'the rankings\' calls and the tilt\'s flips are counted apart');
  // A projections-disagree note is graded apart: Titan kept the starter, and it was right when the starter outscored him.
  const withNote = calls.concat([{league: 'C', slot: 'WR', pick: {id: '9', name: 'Kept'}, other: {id: '10', name: 'Liked'}, note: true}]);
  const notePts = {9: 14, 10: 6};
  const GN = SCC.gradeCalls(withNote, id => (id in notePts ? notePts[id] : (id in pts ? pts[id] : null)));
  check(GN.notes.n === 1 && GN.notes.right === 1 && GN.n === 3 && GN.rows[4].note === true,
    'a note is counted in its own bucket and left out of the close-call score');
  check(G.rows[0].margin === 7.1 && G.rows[0].right === true && G.rows[1].margin === -13.5 && G.rows[1].right === false, 'each row carries the margin and the verdict');
  check(G.rows[2].right === false && G.rows[3].right === null && G.rows[3].pickPts === null, 'a tie is not right; a call with a player yet to play is ungraded');
}

section('a trade offer as text (parseOffer)');
{
  const P = SCC.parseOffer;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(same(P('give Jaylen Warren, Kenny Gainwell get Josh Allen'), {give: ['Jaylen Warren', 'Kenny Gainwell'], get: ['Josh Allen']}), 'give A, B get C: ' + JSON.stringify(P('give Jaylen Warren, Kenny Gainwell get Josh Allen')));
  check(same(P('Jaylen Warren and Kenny Gainwell for Josh Allen'), {give: ['Jaylen Warren', 'Kenny Gainwell'], get: ['Josh Allen']}), 'A and B for C');
  check(same(P('I give my Jaylen Warren for your Josh Allen + Bench Back'), {give: ['Jaylen Warren'], get: ['Josh Allen', 'Bench Back']}), 'I give my A for your B + C (the small words go)');
  check(same(P('Team B offered Josh Allen (QB - BUF) for Jaylen Warren'), {give: ['Josh Allen'], get: ['Jaylen Warren']}),
    'an offer written from the other side parses as written (the rosters settle whose is whose); a position in brackets is dropped');
  check(same(P('You receive: Josh Allen; you send: Jaylen Warren'), {give: ['Jaylen Warren'], get: ['Josh Allen']}), 'you receive X; you send Y');
  check(P('Jaylen Warren') === null && P('') === null && P('give Jaylen Warren') === null, 'one side only, or nothing: null');
}

section('a weekly matchup table as text (parseMatchups)');
{
  const tsv = ['Offense\tMatchup\tTeam Tot\tSpread\tPROE Off\tPROE Def', 'BUF\tvs. DET\t30.0\t+5.5\t10\t11', 'ATL\tvs. CAR\t20.5\t−2.5\t32\t16', 'DET\t@ BUF\t24.5\t-5.5\t25\t19'].join('\n');
  const M = SCC.parseMatchups(tsv);
  check(M && M.cols.join('|') === 'Team Tot|Spread|PROE Off|PROE Def' && M.rows.length === 3 && M.rows[0].team === 'ATL' && M.rows[1].team === 'BUF' && M.rows[1].opp === 'DET' && M.rows[1].home === true && M.rows[2].home === false,
    'a tab-separated sheet with a header: the measures, each offense with its opponent and home or away, sorted by team');
  check(M.rows[0].v.join() === '20.5,-2.5,32,16' && M.rows[1].v[1] === 5.5 && M.ranks.join() === 'false,false,true,true', 'numbers parsed (a minus sign of either kind, a plus), and the 1-to-32 columns marked as ranks');
  check(SCC.parseMatchups('Offense,Matchup,PROE Off\nKC,@ IND,12') .rows[0].v[0] === 12 && SCC.parseMatchups('just some text') === null && SCC.parseMatchups('') === null, 'comma-separated works too; no table gives null');
}

section('the matchup sheet as the tilt\'s source (matchupRank, tiltFromRank)');
{
  const tsv = ['Offense\tMatchup\tTeam Tot\tFP/G QB\tFP/G RB\tFP/G WR\tFP/G TE', 'KC\tvs. IND\t26.5\t6\t3\t9\t16',
    'NE\tvs. PIT\t23.5\t30\t6\t32\t32', 'CHI\tvs. MIN\t26.0\t11\t32\t2\t10'].join('\n');
  const tables = {overview: SCC.parseMatchups(tsv)};
  check(SCC.matchupRank(tables, 'CHI', 'WR') === 2 && SCC.matchupRank(tables, 'NE', 'WR') === 32 && SCC.matchupRank(tables, 'KC', 'RB') === 3,
    'a player\'s matchup on the sheet: his opponent\'s rank for points given up to his position, 1 the softest');
  check(SCC.matchupRank(tables, 'DEN', 'WR') === null && SCC.matchupRank(tables, 'KC', 'K') === null && SCC.matchupRank(null, 'KC', 'WR') === null && SCC.matchupRank({}, 'KC', 'WR') === null,
    'a team the sheet doesn\'t carry, a position it has no column for, or no sheet at all: null');
  check(SCC.tiltFromRank(2) === SCC.MATCH_TILT && SCC.tiltFromRank(8) === SCC.MATCH_TILT && SCC.tiltFromRank(9) === 0 && SCC.tiltFromRank(24) === 0
    && SCC.tiltFromRank(25) === -SCC.MATCH_TILT && SCC.tiltFromRank(32) === -SCC.MATCH_TILT,
    'the tilt: the eight softest spots up, the eight toughest down, the middle nothing');
  check(SCC.tiltFromRank(null) === 0 && SCC.tiltFromRank(undefined) === 0 && SCC.tiltFromRank(1, 0.05) === 0.05, 'no rank, no tilt; the ceiling can be set');
}

section('streaming a kicker or a defense, and the next best at a spot (streamPicks, nextBest)');
{
  const fa = (name, pos, team, rank) => ({id: name, name, pos, team, rank});
  const implied = {KC: 27, BUF: 30, TEN: 16, NYJ: 18, CLE: 17};
  const opp = {KC: 20, BUF: 24, TEN: 23, NYJ: 26, CLE: 25};
  const opts = {implied: t => implied[t] || null, oppImplied: t => opp[t] || null, rank: (t, p) => ({KC: 3, BUF: 12, TEN: 30}[t] || null)};
  const kickers = [fa('K Tenn', 'K', 'TEN', 5), fa('K Chief', 'K', 'KC', 20), fa('K Bill', 'K', 'BUF', 9), fa('K Nobody', 'K', 'XXX', 1)];
  const K = SCC.streamPicks('K', kickers, opts, 3);
  check(K.length === 3 && K[0].p.name === 'K Bill' && K[1].p.name === 'K Chief' && !K.some(x => x.p.name === 'K Nobody'),
    `a kicker rides his team's expected points, the matchup nudging it, and one with no game known is left out (${K.map(x => x.p.name).join(', ')})`);
  check(/expected to score 30/.test(K[0].why.join(' ')) && /soft matchup, 3 of 32/.test(K[1].why.join(' ')), 'each pick says why: ' + K[1].why.join('; '));
  const defs = [fa('D Chief', 'DEF', 'KC', 8), fa('D Jet', 'DEF', 'NYJ', 2), fa('D Brown', 'DEF', 'CLE', 14)];
  const D = SCC.streamPicks('DEF', defs, opts, 2);
  check(D.length === 2 && D[0].p.name === 'D Chief' && /20 expected against them/.test(D[0].why.join(' ')),
    `a defense rides how few points it faces (${D.map(x => x.p.name).join(', ')})`);
  check(SCC.streamPicks('K', [], opts).length === 0 && SCC.streamPicks('K', kickers, {}).length === 0, 'nothing to go on, nothing suggested');
  // nextBest: who else could have taken the spot.
  const roster = [{id: '1', name: 'Starter', pos: 'RB', rank: 10, start: true}, {id: '2', name: 'Bench One', pos: 'RB', rank: 30},
    {id: '3', name: 'Bench Hurt', pos: 'RB', rank: 12, outish: true}, {id: '4', name: 'Bench Bye', pos: 'RB', rank: 11, onBye: true},
    {id: '5', name: 'A Tight End', pos: 'TE', rank: 5}];
  const opt = [{slot: 'RB', p: roster[0]}];
  check(SCC.nextBest(opt, roster, 'RB').name === 'Bench One', 'the best bench player who fits the spot, skipping the hurt and the on-bye');
  check(SCC.nextBest(opt, roster, 'FLEX').name === 'A Tight End' && SCC.nextBest(opt, roster, 'QB') === null, 'a flex takes the best of any eligible position; a spot with nobody gives null');
}

section('what a lineup change is worth (lineupSwing)');
{
  const P = (proj, pts, state) => ({proj, pts: pts || 0, state: state || 'pre'});
  const opp = [P(20), P(15), P(12)];
  const now = [P(18), P(10), P(9)], better = [P(18), P(16), P(9)];
  const S1 = SCC.lineupSwing(now, better, opp);
  check(S1.before < S1.after && S1.swing === S1.after - S1.before && S1.points === 6,
    `a better lineup lifts the chance of winning (${S1.before}% to ${S1.after}%, ${S1.points} more points)`);
  check(SCC.lineupSwing(now, now, opp).swing === 0 && SCC.lineupSwing(now, now, opp).points === 0, 'no change, no swing');
  const S2 = SCC.lineupSwing(better, now, opp);
  check(S2.swing === -S1.swing && S2.points === -6, 'and the other way round it costs you the same');
  // Once a game is over its points are settled, so a swap there changes nothing.
  const done = [P(18, 22, 'complete'), P(10, 4, 'complete'), P(9, 11, 'complete')];
  check(SCC.lineupSwing(done, done.slice().reverse(), opp).swing === 0, 'a finished lineup cannot be improved by reordering it');
}

section('what changed since you last looked (whatChanged)');
{
  const mk = o => Object.assign({week: 2, ranksAt: 100, leagues: {L1: {name: 'Big League', mv: [], hurt: [], wire: [], inj: {}, names: {p1: 'A Starter'}}}}, o || {});
  const before = mk();
  const after = mk({leagues: {L1: {name: 'Big League', mv: ['p9'], hurt: ['p1'], wire: ['TE'], inj: {p1: 'Out'}, names: {p1: 'A Starter'}}}});
  const lines = SCC.whatChanged(before, after);
  check(lines[0] === 'A Starter is Out (Big League)', 'a starter newly ruled out leads: ' + lines[0]);
  check(lines.includes('Big League: a hurt starter') && lines.includes('Big League: a new lineup change')
    && lines.includes('Big League: a free agent worth a look at TE'), `then the hurt starters, the changes and the wire (${lines.length} lines)`);
  check(SCC.whatChanged(before, before).length === 0 && SCC.whatChanged(null, after).length === 0, 'nothing moved, or no previous visit: nothing to say');
  const worse = SCC.whatChanged(mk({leagues: {L1: {name: 'Big League', mv: [], hurt: [], wire: [], inj: {p1: 'Questionable'}, names: {p1: 'A Starter'}}}}), after);
  check(worse[0] === 'A Starter is now Out, was Questionable (Big League)', 'a tag that worsened says both: ' + worse[0]);
  const cleared = SCC.whatChanged(after, mk({leagues: {L1: {name: 'Big League', mv: ['p9'], hurt: [], wire: ['TE'], inj: {p1: ''}, names: {p1: 'A Starter'}}}}));
  check(cleared[0] === 'A Starter is off the injury report (Big League)', 'and a tag that cleared is news too: ' + cleared[0]);
  check(SCC.whatChanged(before, mk({week: 3})).length === 0, 'a new week is a new slate, not a list of changes');
  const reimported = SCC.whatChanged(before, mk({ranksAt: 200}));
  check(reimported[0] === 'Your week 2 rankings changed', 'a re-import is the first thing said: ' + reimported[0]);
}

section('the pre-kickoff sweep (lineupSweep)');
{
  const LG = (key, o) => Object.assign({cfg: {key}, moves: [], hurt: [], stops: 0}, o);
  const hurtOne = {id: 'h1', name: 'Hurt Man'};
  const sweepLeagues = [LG('Set A'), LG('Set B'),
    LG('Needs One', {moves: [{slot: 'RB', inn: {id: 'a'}, out: {id: 'b'}}]}),
    LG('Empty Spot', {stops: 2}),
    LG('Hurt', {hurt: [hurtOne]}),
    LG('Covered', {hurt: [hurtOne], moves: [{slot: 'RB', inn: {id: 'x'}, out: hurtOne}]})];
  const SW = SCC.lineupSweep(sweepLeagues);
  check(SW.total === 6 && SW.ready === 2 && SW.problems.length === 4,
    `every league counted, the ready ones apart (${SW.ready} of ${SW.total} ready, ${SW.problems.length} with something left)`);
  check(SW.problems[0].key === 'Empty Spot' && SW.problems[0].what === '2 spots to fill', 'the worst comes first, and says what is wrong: ' + SW.problems[0].what);
  check(SW.problems.map(x => x.key).join() === 'Empty Spot,Hurt,Covered,Needs One', 'then the hurt starters, then the plain changes: ' + SW.problems.map(x => x.key).join(', '));
  check(SW.problems.find(x => x.key === 'Covered').what === 'a change to make', "a hurt starter the changes already bench isn't counted twice");
  check(SCC.lineupSweep([]).total === 0 && SCC.lineupSweep(null).problems.length === 0, 'no leagues, nothing to say');
}

section('injury tags refreshed without a full refresh (taggedIds, applyInjuries)');
{
  const pl = (id, name, inj) => ({id, name, pos: 'WR', team: 'KC', inj, outish: !!(inj && ['Out', 'Doubtful', 'IR'].includes(inj.split(' ')[0]))});
  const leagues = [{roster: [pl('1', 'Tagged One', 'Questionable (Hamstring)'), pl('2', 'Healthy', ''), pl('DEF-KC', 'A Defense', 'Questionable')]},
    {roster: [pl('1', 'Tagged One', 'Questionable (Hamstring)'), pl('3', 'Tagged Two', 'Out')]}];
  const ids = SCC.taggedIds(leagues);
  check(ids.join() === '1,3', `only the rostered players already carrying a tag, each once, Sleeper ids only (${ids.join(', ')})`);
  const n = SCC.applyInjuries(leagues, {1: {inj: 'Out (Hamstring)'}, 3: {inj: ''}});
  check(n === 3 && leagues[0].roster[0].inj === 'Out (Hamstring)' && leagues[0].roster[0].outish === true && leagues[1].roster[0].outish === true,
    'a tag turning into Out lands on every copy of him across the leagues and benches him');
  check(leagues[1].roster[1].inj === '' && leagues[1].roster[1].outish === false, 'a tag that has gone is cleared, and he can start again');
  check(SCC.applyInjuries(leagues, {1: {inj: 'Out (Hamstring)'}}) === 0 && SCC.applyInjuries(leagues, {}) === 0 && SCC.taggedIds(null).length === 0,
    'nothing changed, nothing counted; no leagues, no ids');
}

section('the nudge before kickoff (kickoffNudge)');
{
  const now = Date.parse('2026-09-20T15:00:00Z'), h = 3600e3, min = 60e3;
  const items = [{league: 'A', text: 'Start X over Y', kick: now + 60 * min}, {league: 'B', text: 'Z is Questionable and in your lineup', kick: now + 80 * min},
    {league: 'C', text: 'Start late guy', kick: now + 5 * h}, {league: 'D', text: 'too late', kick: now - 10 * min}];
  const N = SCC.kickoffNudge(items, now, 90 * min);
  check(N && N.lines.length === 2 && N.lines[0] === 'A: Start X over Y' && N.mins === 60 && N.key === String(now + 60 * min),
    `two items due within 90 minutes, keyed by the earliest kickoff, the minutes left (${N && N.title})`);
  check(N.title === '2 things to do before kickoff (60 min)', 'the title counts them');
  check(SCC.kickoffNudge(items, now + 2 * h, 90 * min) === null, 'nothing due (the next kickoff is three hours off, the early ones are past): null');
  check(SCC.kickoffNudge([], now, 90 * min) === null && SCC.kickoffNudge(null, now, 90 * min) === null, 'no items: null');
}
T.done();
