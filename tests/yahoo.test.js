// yahoo.js: reading Yahoo Fantasy's nested answers into Titan's shapes. Made-up leagues in
// Yahoo's format, built from Sleeper's public player list; nobody's real data.
const T = require('./lib');
const Y = T.app('yahoo.js');
const SCC = T.app('engine.js');
const API = T.app('sleeper.js');
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

(async () => {
  const players = await T.sleeperPlayers();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const L = T.yahooLeague(players);

  section('a league\'s settings and rosters');
  const slim = Y.leagueFrom(L.settings, L.roster, '');
  check(slim.key === L.key && slim.ppr === 0.5 && slim.playoffStart === 15 && slim.playoffTeams === 4 && slim.faab === true && slim.teams === 4,
    'settings: half PPR (stat 11 is receptions), the playoffs, and a waiver budget');
  check(slim.rosters.length === 4 && slim.teamKey === L.key + '.t.1' && slim.rosters[0].manager === 'Manager 1' && slim.rosters[0].logo === 'https://s.yimg.com/team1.png',
    'every team with its roster; yours found from Yahoo\'s own-team flag');
  check(Y.leagueFrom(L.settings, L.roster, L.key + '.t.2').teamKey === L.key + '.t.2', 'the team Yahoo lists as yours wins');
  const cfg = Y.leagueCfg(slim, {});
  check(cfg.id === 'yahoo:' + L.key && cfg.platform === 'yahoo' && cfg.lineup.join() === 'QB,RB,RB,WR,WR,TE,FLEX,K,DEF' && cfg.active &&
    cfg.pic === 'https://s.yimg.com/team1.png' && cfg.url === 'https://football.fantasysports.yahoo.com/f1/1001/1',
    'the league: lineup in Sleeper\'s order (W/R/T is FLEX), your team\'s logo and page');
  check(SCC.describeLeague(cfg) === 'Yahoo · 4 teams · Half PPR · Redraft' && Y.leagueCfg(slim, {[cfg.id]: {active: false}}).active === false,
    'described as a Yahoo league; the person\'s switch is kept');

  section('your roster, matched to Sleeper\'s players');
  const d = Y.buildLeague(cfg, slim, players);
  check(!d.error && d.roster.length === 15 && d.startCount === 9 && d.unmatched === 0, `15 players, 9 starting, all found in Sleeper's list (${d.unmatched} not)`);
  check(L.ids.starters.every(id => d.roster.some(p => p.id === id && p.start)) && L.ids.bench.every(id => d.roster.some(p => p.id === id && !p.start && !p.held)),
    'starters and bench as set on Yahoo, by Sleeper id');
  const flex = d.roster.find(p => p.id === L.ids.flex), def = d.roster.find(p => p.pos === 'DEF');
  check(flex && flex.slot === 'FLEX' && def && def.id === 'PHI' && def.name === 'PHI D/ST' && def.slot === 'DEF', 'the W/R/T player in FLEX; a team defense by its team');
  const out = d.roster.find(p => p.id === L.ids.out), ir = d.roster.find(p => p.id === L.ids.ir);
  check(out && out.inj === 'Out' && out.start && ir && ir.held && ir.heldAs === 'IR' && !ir.start && ir.inj === 'IR', 'Yahoo\'s statuses as tags; IR held under Reserve');
  check(d.takenNorm[SCC.norm(players[L.ids.elsewhere][0])] === 1 && d.takenAbbr.DAL === 1, 'players on other teams count as taken');
  check(!!Y.buildLeague(Object.assign({}, cfg, {teamKey: 'nope'}), slim, players).error, 'no team of yours: skipped with a reason');
  const weekly = SCC.weeklyMap(SCC.parseRanks(T.sampleRanks()).rows);
  check(SCC.analyzeAll({leagues: [d], week: 1}, weekly).leagues[0].rows.length === 9, 'the lineup check runs on a Yahoo league like any other');

  section('refresh with Yahoo leagues');
  const acct = {userId: '', username: '', displayName: 'My leagues', prefs: {}, espn: {leagues: []}, yahoo: {linked: true}};
  const asked = [];
  Y.setTransport(async args => { asked.push(args); return {linked: true, leagues: [slim, {key: '472.l.9', name: 'Broken', error: 'Yahoo couldn\'t read it this time'}]}; });
  const s1 = await API.collect(acct, null, null);
  check(s1.leagues.length === 1 && s1.leagues[0].cfg.platform === 'yahoo' && s1.leagues[0].roster.length === 15 && asked.length === 1 &&
    asked[0].kind === 'all' && asked[0].week === s1.week, 'Yahoo leagues come in through Titan\'s server, read for the week shown');
  check(s1.log.some(l => /Broken: Yahoo couldn't read it/.test(l)) && s1.log.some(l => /1 Yahoo league\(s\), 1 switched on/.test(l)),
    'the refresh log says what loaded and what didn\'t');
  Y.setTransport(async () => ({linked: true, noaccess: true}));
  const s2 = await API.collect(acct, null, null);
  check(!s2.leagues.length && s2.log.some(l => /still in review/.test(l)), 'while Yahoo reviews Titan\'s access, the log says so');
  Y.setTransport(null);
  asked.length = 0;
  const s3 = await API.collect(acct, null, null);
  check(!s3.leagues.length && !asked.length, 'signed out: Yahoo isn\'t asked');

  section('tabs that come in the next step');
  const ms = await API.collectMatchups({leagues: [d], season: s1.season, week: s1.week});
  check(/coming next/.test(ms[0].error || ''), 'Matchup says Yahoo is coming next');
  check(await API.leagueSchedule(cfg, s1.season, 1).then(() => false, e => /coming next/.test(e.message)), 'so does Standings');
  check(await API.leagueTeams(cfg, null, s1.season).then(() => false, e => /coming next/.test(e.message)), 'and Trade');
  const sc = await API.collectScores(acct, [cfg], 1, s1.season);
  check(!sc.leagues.length && sc.skipped.some(x => /Yahoo/.test(x)), 'Results lists it as not there yet');
  T.done();
})().catch(T.crash);
