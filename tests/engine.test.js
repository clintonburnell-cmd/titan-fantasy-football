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
T.done();
