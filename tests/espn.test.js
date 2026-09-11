// espn.js: reading ESPN leagues, mapping them to Titan's roster shape, and a
// full refresh with ESPN leagues. Uses the test leagues from lib.espnLeagues(),
// never a real league.
const T = require('./lib');
const SCC = T.app('engine.js');
const ESPN = T.app('espn.js');
const API = T.app('sleeper.js');
const {check, section} = T;

(async () => {
  const players = await T.sleeperPlayers();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const {league: L1, superflex: SF} = await T.espnLeagues();
  const weekly = SCC.weeklyMap(SCC.parseRanks(T.sampleRanks()).rows);

  section('league ids and teams');
  check(ESPN.parseLeagueId('https://fantasy.espn.com/football/team?leagueId=1234567&teamId=3&seasonId=2026') === '1234567', 'league id from an ESPN link');
  check(ESPN.parseLeagueId(' 1234567 ') === '1234567' && ESPN.parseLeagueId('abc') === '', 'plain id; junk rejected');
  const teams = ESPN.teamsOf(L1);
  check(teams.length === 10 && teams[2].name === 'Team 3' && teams[2].manager === 'Manager 3', 'teams listed with their managers');
  check(ESPN.ownedTeam(L1, '00000003-aaaa-4bbb-8ccc-dddddddddddd') === 3, 'a SWID without braces, in lower case, finds its team');

  section('league settings');
  const cfg = ESPN.leagueCfg(L1, {id: L1.id, teamId: 1}, {});
  check(cfg.id === 'espn:99999901' && cfg.platform === 'espn' && cfg.teams === 10 && cfg.ppr === 0.5, SCC.describeLeague(cfg));
  check(cfg.lineup.join(' ') === 'QB RB RB WR WR TE FLEX K DEF', 'lineup: ' + cfg.lineup.join(' '));
  const sfc = ESPN.leagueCfg(SF, {id: SF.id, teamId: 2}, {'espn:99999902': {active: false}});
  check(sfc.lineup.join(' ') === 'QB RB RB WR WR TE FLEX SUPER_FLEX K DEF' && sfc.active === false && sfc.ppr === 1,
    'superflex lineup, full PPR, switched off by the person\'s choice');
  const withLogo = Object.assign({}, L1, {teams: L1.teams.map(t => Object.assign({}, t, {logo: 'http://example.com/logo-' + t.id + '.png'}))});
  check(ESPN.leagueCfg(withLogo, {id: L1.id, teamId: 3}, {}).pic === 'https://example.com/logo-3.png' && cfg.pic === '' &&
    ESPN.leagueCfg(withLogo, {id: L1.id}, {}).pic === '', 'the league picture is your team\'s logo (made https); none without a logo or a team');
  check(ESPN.slimLeague(withLogo).teams[2].logo === 'http://example.com/logo-3.png', 'the server keeps team logos for private leagues');
  check(SCC.leaguesFromSleeper([{league_id: '1', name: 'A', avatar: 'abc'}, {league_id: '2', name: 'B'}]).map(l => l.pic).join('|') ===
    'https://sleepercdn.com/avatars/thumbs/abc|', 'a Sleeper league keeps its own picture');

  section('roster');
  const d = ESPN.buildLeague(cfg, L1, players);
  const def = d.roster.find(p => p.pos === 'DEF');
  check(d.roster.length === 16 && d.startCount === 9, `16 players, ${d.startCount} starting`);
  check(d.unmatched <= 1, `${16 - d.unmatched} of 16 matched to Sleeper ids`);
  check(def && def.id === def.team && /^[A-Z]{2,3} D\/ST$/.test(def.name), `defense named and keyed by team: ${def && def.name}`);
  check(d.roster.filter(p => p.held).length === 1, 'the IR player is marked as held');
  check(d.roster.some(p => p.inj === 'Out' && p.start), 'ESPN\'s injury tag is carried');
  check(Object.keys(d.takenNorm).length > 140 && Object.keys(d.takenAbbr).length === 10, 'everyone rostered in the league is known (for waiver ideas)');
  check(ESPN.buildLeague(ESPN.leagueCfg(L1, {id: L1.id}, {}), L1, players).error === 'pick your team in Settings', 'no team picked: asks for one');
  const slim = ESPN.slimLeague(L1);
  const ds = ESPN.buildLeague(ESPN.leagueCfg(slim, {id: L1.id, teamId: 1}, {}), slim, players);
  check(JSON.stringify(ds.roster) === JSON.stringify(d.roster),
    `the server's slimmed league reads the same (${Math.round(JSON.stringify(slim).length / 1024)} KB of ${Math.round(JSON.stringify(L1).length / 1024)} KB)`);

  section('scores');
  check(d.roster.every(p => p.espnId) && Object.keys(d.espnPoints).length === 16, 'each player keeps his ESPN id, and the league read carries this week\'s points');
  const firstId = L1.teams[0].roster.entries[0].playerId;
  const box = {schedule: [{home: {teamId: 1, rosterForCurrentScoringPeriod: {entries: [{playerId: firstId, playerPoolEntry: {appliedStatTotal: 21.4}}]}},
    away: {teamId: 2, rosterForCurrentScoringPeriod: {entries: []}}}]};
  const bp = ESPN.pointsFromBoxscore(box, 1);
  check(bp && bp[firstId] === 21.4 && ESPN.pointsFromBoxscore(box, 5) === null, 'box score points are read for the right team');
  check(ESPN.slimLeague(L1).teams[0].roster.entries[0].playerPoolEntry.appliedStatTotal === 0, 'the server\'s slimmed league keeps points');

  section('kickoff times');
  const ko = ESPN.kickoffsFrom({settings: {proTeams: [
    {id: 25, abbrev: 'SF', proGamesByScoringPeriod: {1: [{date: 1789432500000, startTimeTBD: false}]}},
    {id: 28, abbrev: 'WSH', proGamesByScoringPeriod: {17: [{date: 1798000000000, startTimeTBD: true}]}},
    {id: 0, abbrev: 'FA', proGamesByScoringPeriod: {}}]}});
  check(ko.SF['1'][0] === 1789432500000 && ko.SF['1'][1] === false, 'a kickoff time per team and week');
  check(ko.WAS && ko.WAS['17'][1] === true && !ko.FA, 'ESPN\'s WSH is WAS; a time still to be set is marked; free agents skipped');
  const live = await ESPN.fetchKickoffs((await T.nflState()).league_season);
  check(live && Object.keys(live).length === 32 && Object.values(live).every(t => Object.keys(t).length >= 16),
    'ESPN\'s public schedule gives every team\'s kickoffs');

  section('analysis');
  SCC.applyDetails([d], {});
  const La = SCC.analyzeAll({leagues: [d], week: 1}, weekly).leagues[0];
  check(La.rows.some(r => r.p && r.p.inj === 'Out' && r.verdict === 'DO NOT START'), 'the OUT starter is flagged DO NOT START');
  check(La.rows.filter(r => r.p && r.p.rank !== null).length >= 6, 'rankings attach to ESPN players by name');
  const dsf = ESPN.buildLeague(Object.assign({}, sfc, {active: true}), SF, players);
  const Asf = SCC.analyzeAll({leagues: [dsf], week: 1}, weekly).leagues[0];
  check(Asf.rows.some(r => r.slot === 'SUPER_FLEX' && r.p), 'the superflex spot is filled');

  section('refresh with ESPN leagues');
  // Each test league answers with its box score when Titan asks for one.
  const serve = L => url => new Response(JSON.stringify(/mBoxscore/.test(url) ? T.espnBoxscore(L) : L), {status: 200});
  const undo = T.stubEspn({99999901: serve(L1), 99999902: serve(SF), 99999903: 401});
  const espnOnly = {userId: '', username: '', displayName: 'My leagues', prefs: {},
    espn: {leagues: [{id: '99999901', teamId: 1}, {id: '99999902', teamId: 2}, {id: '99999903', teamId: 1, name: 'Secret League'}]}};
  const s1 = await API.collect(espnOnly, null, null);
  check(s1.leagues.length === 2 && s1.available.length === 3, `ESPN only: ${s1.leagues.length} leagues loaded, ${s1.available.length} listed`);
  const priv = s1.available.find(l => l.id === 'espn:99999903');
  check(priv && priv.error === 'private' && priv.active === false && priv.key === 'Secret League', 'a private league is listed with its reason, switched off');
  const sc1 = await API.collectScores(espnOnly, s1.leagues.map(x => x.cfg), 1, s1.season);
  const W1 = SCC.scoreWeek(sc1, weekly);
  const r1 = W1.rows.find(r => r.key === 'Titan Test League');
  check(sc1.leagues.length === 2 && !sc1.skipped.length && W1.rows.length === 2 && r1 && r1.detail.filter(x => x.slot !== 'bench').length === 9,
    `the Results tab scores ESPN leagues from the week's box score (${W1.rows.length} leagues, 9 spots in the first)`);
  check(r1 && r1.roster.length === 16 && r1.roster.every(p => p.pos && p.pos !== '?') && r1.roster.filter(p => p.rank !== null).length >= 6,
    'every ESPN player is named and placed, and ranked players get their rank');
  check(!Object.prototype.hasOwnProperty.call(await API.loadPlayers(), 'espn:' + L1.teams[0].roster.entries[0].playerId),
    'players Sleeper\'s list lacks are added for that week only, not to the saved list');

  if (T.sleeperUser) {
    const me = await API.lookupUser(T.sleeperUser);
    const both = Object.assign({}, me, {prefs: {}, espn: {leagues: [{id: '99999901', teamId: 1}]}});
    const s2 = await API.collect(both, null, null);
    const keys = s2.available.map(l => l.key);
    const espnLoaded = s2.leagues.filter(x => x.cfg.platform === 'espn').length;
    check(espnLoaded === 1 && s2.leagues.length > 1 && new Set(keys).size === keys.length,
      `Sleeper + ESPN: ${s2.leagues.length} leagues loaded, every name unique`);
    const A2 = SCC.analyzeAll(s2, weekly);
    check(SCC.exposure(A2.leagues).active === s2.leagues.length && SCC.byeNeeds(A2.leagues, s2.week).length === s2.leagues.length,
      'exposure and byes cover every team');
  } else {
    T.skip('Sleeper + ESPN refresh (set TITAN_SLEEPER_USER to run it)');
  }
  undo();
  T.done();
})().catch(T.crash);
