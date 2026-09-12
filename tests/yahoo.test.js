// yahoo.js: reading Yahoo Fantasy's nested answers. Made-up leagues in Yahoo's shape; nobody's real data.
const T = require('./lib');
const Y = T.app('yahoo.js');
const {check, section} = T;

// /users;use_login=1/games;game_codes=nfl;seasons=2026/<what>, wrapped the way Yahoo wraps it.
const answer = (what, items) => ({fantasy_content: {users: {'0': {user: [{guid: 'TESTGUID'}, {games: {'0': {game: [
  {game_key: '472', code: 'nfl', season: '2026'}, {[what]: items}]}, count: 1}}]}, count: 1}}});

const leaguesJson = answer('leagues', {
  '0': {league: [{league_key: '472.l.1001', league_id: '1001', name: 'Office League', num_teams: 12, url: 'https://football.fantasysports.yahoo.com/f1/1001',
    logo_url: false, season: '2026', current_week: 1, scoring_type: 'head'}]},
  '1': {league: [{league_key: '472.l.2002', league_id: '2002', name: '  Family   Cup ', num_teams: '10', url: 'http://football.fantasysports.yahoo.com/f1/2002',
    logo_url: 'https://s.yimg.com/league.png', season: '2026'}]},
  count: 2});
const teamsJson = answer('teams', {
  '0': {team: [[{team_key: '472.l.1001.t.3'}, {team_id: '3'}, {name: 'Gridiron Gang'}, [], [],
    {team_logos: [{team_logo: {size: 'large', url: 'https://s.yimg.com/team3.png'}}]}]]},
  count: 1});

section('Yahoo\'s nesting');
check(JSON.stringify(Y.flat([{a: 1}, [], {b: 2}, null])) === '{"a":1,"b":2}' && JSON.stringify(Y.flat({c: 3})) === '{"c":3}', 'one-key objects merge; empty [] fillers are skipped');
check(Y.list({'1': {x: 'b'}, '0': {x: 'a'}, count: 2}, 'x').join() === 'a,b' && Y.list(null, 'x').length === 0, 'collections come out in order, count skipped');

section('your leagues and teams');
const leagues = Y.leaguesFrom(leaguesJson);
check(leagues.length === 2 && leagues[0].key === '472.l.1001' && leagues[0].teams === 12 && leagues[0].logo === '' && leagues[0].week === 1,
  'leagues with their keys and team counts; no logo reads as none');
check(leagues[1].name === 'Family Cup' && leagues[1].teams === 10 && leagues[1].url === 'https://football.fantasysports.yahoo.com/f1/2002',
  'names tidied, numbers from strings, links made https');
const teams = Y.teamsFrom(teamsJson);
check(teams.length === 1 && teams[0].league === '472.l.1001' && teams[0].name === 'Gridiron Gang' && teams[0].logo === 'https://s.yimg.com/team3.png',
  'your team, its league and its logo');
const yours = Y.yourLeagues(leaguesJson, teamsJson);
check(yours[0].team && yours[0].team.key === '472.l.1001.t.3' && yours[1].team === null, 'each league paired with your team in it');
check(Y.yourLeagues(leaguesJson, null).every(l => l.team === null) && Y.leaguesFrom({}).length === 0 && Y.leaguesFrom(null).length === 0,
  'no teams answer, or an empty answer, is handled');
T.done();
