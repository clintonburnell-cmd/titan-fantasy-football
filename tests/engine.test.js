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

section('projections');
const pm = SCC.trimProjections([{player_id: '10', stats: {pts_std: 10, pts_half_ppr: 12.5, pts_ppr: 15}},
  {player_id: 'SEA', stats: {pts_std: 8.81, pts_ppr: 8.81}}, {player_id: '99', stats: {}}, {player_id: '98'}]);
check(JSON.stringify(pm) === '{"10":[10,5],"SEA":[8.81,0]}', 'trimmed to standard points and catch points');
check(SCC.projFor(pm, '10', 1) === 15 && SCC.projFor(pm, '10', 0.5) === 12.5 && SCC.projFor(pm, '10', 0.25) === 11.25, 'any points-per-catch');
check(SCC.projFor(pm, 'SEA', 1) === 8.81 && SCC.projFor(pm, 'nobody', 1) === null, 'defenses by team; unknown players have none');

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
T.done();
