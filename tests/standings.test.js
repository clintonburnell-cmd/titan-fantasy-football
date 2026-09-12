// The Standings tab: engine.js's standings (records, all-play, luck, power, playoff
// odds), ESPN schedules (espn.js) and a Sleeper league's schedule (sleeper.js, with
// Sleeper's answers made up here). No network, no real league.
const T = require('./lib');
const SCC = T.app('engine.js');
const ESPN = T.app('espn.js');
const API = T.app('sleeper.js');
const {check, section} = T;

section('position strength: where each team is deep or thin');
{
  // Three teams starting QB, RB and WR; each player's season points made up. Team C's 400-point RB is on IR.
  const pl = (id, pos, pts, held) => ({id, pos, pts, held: !!held});
  const psTeams = [
    {id: 'A', roster: [pl('a1', 'QB', 300), pl('a2', 'RB', 200), pl('a3', 'WR', 100), pl('a4', 'RB', 180)]},
    {id: 'B', roster: [pl('b1', 'QB', 250), pl('b2', 'RB', 220), pl('b3', 'WR', 150)]},
    {id: 'C', roster: [pl('c1', 'QB', 200), pl('c2', 'RB', 150), pl('c3', 'WR', 120), pl('c4', 'WR', 100), pl('c5', 'RB', 400, true)]}];
  const PS = SCC.positionStrength(psTeams, ['QB', 'RB', 'WR', 'BN'], p => p.pts);
  const at = (id, pos) => PS.teams.find(t => t.id === id).byPos[pos];
  check(PS.positions.join() === 'QB,RB,WR' && PS.n === 3, 'only the positions the league starts: ' + PS.positions.join(', '));
  check(at('A', 'RB').start === 200 && at('A', 'RB').depth === 180 && at('A', 'RB').rank === 1 && at('A', 'RB').grade === 'deep',
    'a starter plus a strong bench back ranks first at RB (200, with 180 of depth counted a quarter)');
  check(at('C', 'RB').start === 150 && at('C', 'RB').rank === 3 && at('C', 'RB').grade === 'thin', 'IR players don\'t count: team C is thin at RB');
  check(at('B', 'WR').grade === 'deep' && at('C', 'WR').rank === 2 && at('A', 'WR').grade === 'thin', 'WR: C\'s bench receiver (120 + a quarter of 100) puts it 2nd behind B (150); A is thin');
}

section('records, all-play and luck');
const teams = ['A', 'B', 'C', 'D'].map(id => ({id, name: 'Team ' + id}));
const g = (week, a, b, aPts, bPts, done = true) => ({week, a, b, aPts, bPts, done});
const games = [g(1, 'A', 'B', 120, 100), g(1, 'C', 'D', 90, 80), g(2, 'A', 'C', 110, 95), g(2, 'B', 'D', 130, 70),
  g(3, 'A', 'D', 100, 101), g(3, 'B', 'C', 60, 140),
  g(4, 'A', 'B', 0, 0, false), g(4, 'C', 'D', 0, 0, false), g(5, 'A', 'C', 0, 0, false), g(5, 'B', 'D', 0, 0, false)];
const R = SCC.standings(teams, games, {}, {playoffTeams: 2, sims: 4000, seed: 3});
const by = id => R.teams.find(t => t.id === id);
check(by('A').wins === 2 && by('B').wins === 1 && by('C').wins === 2 && by('D').wins === 1 && by('A').pf === 330, 'records and points from the games played');
check(by('A').allPlay.w === 6 && by('A').allPlay.l === 3 && by('D').allPlay.w === 2 && by('D').allPlay.l === 7,
  'all-play: each week against every other team (A 6-3, D 2-7)');
check(by('D').luck === 0.33 && by('B').luck === -0.67 && by('A').luck === 0,
  'luck: actual wins against what the all-play rate would give (D +0.33, B -0.67)');
check(by('A').seed === 1 && by('C').seed === 2 && R.left === 4, 'seeded by wins, then points; four games left');
const sum = R.teams.reduce((s, t) => s + t.playoffs, 0);
check(Math.abs(sum - 2) < 1e-9 && R.teams.every(t => t.playoffs >= 0 && t.playoffs <= 1), 'the playoff odds add up to the playoff spots (2)');
const again = SCC.standings(teams, games, {}, {playoffTeams: 2, sims: 4000, seed: 3});
check(again.teams.map(t => t.playoffs).join() === R.teams.map(t => t.playoffs).join(), 'the same league gives the same odds');
const strong = SCC.standings(teams, games, {D: 200, A: 80, B: 80, C: 80}, {playoffTeams: 2, sims: 4000, seed: 3});
check(strong.teams.find(t => t.id === 'D').playoffs > by('D').playoffs, 'a team projected to score big has better odds');
const pre = SCC.standings(teams, games.map(x => Object.assign({}, x, {done: false})), {A: 130, B: 100, C: 100, D: 90}, {playoffTeams: 2, sims: 2000});
check(pre.teams.find(t => t.id === 'A').powerRank === 1 && pre.teams.every(t => t.games === 0 && t.luck === 0) &&
  pre.teams.find(t => t.id === 'A').playoffs > pre.teams.find(t => t.id === 'D').playoffs, 'before any games, power and odds follow the projections');

section('team names');
check(SCC.teamLabel('Gridiron Gang', 'clintb') === 'Gridiron Gang (clintb)', 'a nickname with the account name after it');
check(SCC.teamLabel('', 'clintb') === 'clintb' && SCC.teamLabel('ClintB', 'clintb') === 'ClintB', 'no nickname, or one repeating the account: the name once');
check(SCC.teamLabel('Gridiron Gang', '') === 'Gridiron Gang' && SCC.teamLabel('', '', 'Team 4') === 'Team 4', 'no account name: the nickname; neither: the fallback');

section('ESPN schedules');
const uno = '{00000001-AAAA-4BBB-8CCC-DDDDDDDDDDDD}';
const json = {settings: {scheduleSettings: {matchupPeriodCount: 2, playoffTeamCount: 4}},
  members: [{id: uno, displayName: 'Uno'}],
  teams: [{id: 1, location: 'Team', nickname: 'One', owners: [uno]}, {id: 2, location: 'Team', nickname: 'Two'}],
  schedule: [{matchupPeriodId: 1, winner: 'HOME', home: {teamId: 1, totalPoints: 101}, away: {teamId: 2, totalPoints: 99}},
    {matchupPeriodId: 2, winner: 'UNDECIDED', home: {teamId: 2, totalPoints: 0}, away: {teamId: 1, totalPoints: 0}},
    {matchupPeriodId: 3, winner: 'UNDECIDED', home: {teamId: 1}, away: {teamId: 2}}, {matchupPeriodId: 1, home: {teamId: 3}}]};
const es = ESPN.scheduleFrom(ESPN.slimSchedule(json), 2);
check(es.teams.length === 2 && es.teams[0].name === 'Team One (Uno)' && es.teams[1].name === 'Team Two' && es.games.length === 2 && es.games[0].done && !es.games[1].done &&
  es.games[0].aPts === 101 && es.playoffTeams === 4, 'regular-season games with scores, trimmed the way the server sends them; byes and playoff weeks left out');

section('a Sleeper league\'s schedule');
(async () => {
  const replies = {
    '/rosters': [{roster_id: 1, owner_id: 'u1'}, {roster_id: 2, owner_id: 'u2'}],
    '/users': [{user_id: 'u1', display_name: 'Me'}, {user_id: 'u2', display_name: 'Pat', metadata: {team_name: 'Pat\'s Team'}}],
    '/matchups/1': [{roster_id: 1, matchup_id: 1, points: 110.5}, {roster_id: 2, matchup_id: 1, points: 90}],
    '/matchups/2': [{roster_id: 1, matchup_id: 1, points: 12}, {roster_id: 2, matchup_id: 1, points: 30}]
  };
  const asked = [];
  global.fetch = async url => {
    asked.push(url);
    const k = Object.keys(replies).find(s => url.endsWith(s));
    return new Response(JSON.stringify(k ? replies[k] : []), {status: 200});
  };
  const s = await API.leagueSchedule({id: '9', playoffStart: 4, playoffTeams: 4}, '2026', 2);
  check(s.teams.map(t => t.name).join() === 'Me,Pat\'s Team (Pat)' && s.games.length === 2 && s.games[0].done && s.games[0].aPts === 110.5 &&
    !s.games[1].done && s.playoffTeams === 4 && asked.filter(u => /matchups/.test(u)).length === 3,
    'each week up to the playoffs, a week before this one counts as played, and names come from the members');
  T.done();
})().catch(T.crash);
