// Shared helpers for Titan's tests.
//
// No test needs anyone's private data. Rankings come from
// fixtures/sample-rankings.csv (built from Sleeper's public player order), and
// ESPN test leagues are built from ESPN's public player list. A test that reads
// a real Sleeper account runs only when TITAN_SLEEPER_USER is set, so no
// username is ever written into the repo. Downloads are kept in tests/.cache.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const FIXTURES = path.join(__dirname, 'fixtures');
const HOUR = 3600 * 1000;

let fails = 0;
function check(ok, msg) {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + msg);
  return ok;
}
function section(name) { console.log('== ' + name); }
function skip(msg) { console.log('  skip ' + msg); }
function done() {
  console.log(fails ? fails + ' FAILED' : 'all checks passed');
  process.exit(fails ? 1 : 0);
}
function crash(e) { console.error('CRASH', e); process.exit(1); }

const app = file => require(path.join(ROOT, file));

// A JSON download, kept for `maxAge` so reruns are quick.
async function cached(name, url, opts, maxAge, transform) {
  fs.mkdirSync(CACHE, {recursive: true});
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAge) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const res = await fetch(url, opts || {});
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  const json = transform ? transform(await res.json()) : await res.json();
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

const nflState = () => cached('sleeper-state.json', 'https://api.sleeper.app/v1/state/nfl', null, 6 * HOUR);

// Sleeper's player list (~14 MB) trimmed the way the app trims it.
function sleeperPlayers() {
  const SCC = app('engine.js');
  return cached('sleeper-players.json', 'https://api.sleeper.app/v1/players/nfl', null, 72 * HOUR, SCC.trimPlayers);
}

function sampleRanks() { return fs.readFileSync(path.join(FIXTURES, 'sample-rankings.csv'), 'utf8'); }

/* Two ESPN-shaped leagues (settings, members, teams with rosters) built from
   ESPN's public player list: ten teams drafted round-robin by ownership. Team 1
   has a set lineup, one starter tagged OUT and one player on IR. `superflex`
   adds an OP spot and full PPR. Nobody's real league. */
async function espnLeagues() {
  const state = await nflState();
  const season = String(state.league_season || state.season);
  const all = await cached('espn-players-' + season + '.json',
    'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' + season + '/players?scoringPeriodId=0&view=players_wl',
    {headers: {'x-fantasy-filter': JSON.stringify({filterActive: {value: true}})}}, 72 * HOUR);
  const owned = p => (p.ownership && p.ownership.percentOwned) || 0;
  const need = {1: 2, 2: 5, 3: 5, 4: 2, 5: 1, 16: 1};
  const guid = t => '{0000000' + t + '-AAAA-4BBB-8CCC-DDDDDDDDDDDD}';
  const build = superflex => {
    const byPos = {};
    all.filter(p => need[p.defaultPositionId] && p.proTeamId)
      .sort((a, b) => owned(b) - owned(a))
      .forEach(p => (byPos[p.defaultPositionId] = byPos[p.defaultPositionId] || []).push(p));
    const teams = Array.from({length: 10}, (_, i) => ({id: i + 1, location: 'Team', nickname: String(i + 1), owners: [guid(i + 1)], picks: []}));
    Object.keys(need).forEach(pos => {
      for (let round = 0; round < need[pos]; round++) teams.forEach(t => t.picks.push(byPos[pos].shift()));
    });
    const entry = (p, slot, status) => ({playerId: p.id, lineupSlotId: slot, playerPoolEntry: {appliedStatTotal: 0, player: {
      id: p.id, fullName: p.fullName, defaultPositionId: p.defaultPositionId, proTeamId: p.proTeamId,
      eligibleSlots: p.eligibleSlots, injuryStatus: status || 'ACTIVE'}}});
    const lineupFor = t => {
      const left = t.picks.slice(), out = [];
      const take = (pos, slot, status) => {
        const i = left.findIndex(p => pos.includes(p.defaultPositionId));
        if (i >= 0) out.push(entry(left.splice(i, 1)[0], slot, status));
      };
      take([1], 0); take([2], 2, t.id === 1 ? 'OUT' : ''); take([2], 2); take([3], 4); take([3], 4); take([4], 6);
      take([2, 3, 4], 23);
      if (superflex) take([1, 2, 3, 4], 7);
      take([5], 17); take([16], 16);
      if (t.id === 1) take([3], 21, 'INJURY_RESERVE');
      left.forEach(p => out.push(entry(p, 20)));
      return out;
    };
    const counts = {0: 1, 2: 2, 4: 2, 6: 1, 16: 1, 17: 1, 20: 7, 21: 1, 23: 1};
    if (superflex) counts[7] = 1;
    return {
      id: superflex ? 99999902 : 99999901, seasonId: Number(season), scoringPeriodId: 1,
      settings: {name: superflex ? 'Titan Test Superflex' : 'Titan Test League', size: 10,
        rosterSettings: {lineupSlotCounts: counts},
        scoringSettings: {scoringItems: [{statId: 53, points: superflex ? 1 : 0.5}, {statId: 3, points: 0.04}]},
        draftSettings: {keeperCount: 0}},
      members: teams.map(t => ({id: t.owners[0], displayName: 'Manager ' + t.id})),
      teams: teams.map(t => ({id: t.id, location: t.location, nickname: t.nickname, owners: t.owners, roster: {entries: lineupFor(t)}}))
    };
  };
  return {season, league: build(false), superflex: build(true)};
}

/* A week's box score for a test league: team 1 plays team 2, 3 plays 4, and so
   on, each side's roster as set, with ESPN's team names. */
function espnBoxscore(league) {
  const side = t => ({teamId: t.id, totalPoints: 0, rosterForCurrentScoringPeriod: {entries: t.roster.entries}});
  const schedule = [];
  for (let i = 0; i + 1 < league.teams.length; i += 2) schedule.push({matchupPeriodId: 1, home: side(league.teams[i]), away: side(league.teams[i + 1])});
  return {id: league.id, scoringPeriodId: 1, schedule, members: league.members,
    teams: league.teams.map(t => ({id: t.id, location: t.location, nickname: t.nickname, owners: t.owners}))};
}

/* Answers ESPN league requests from the given test leagues ({id: json, or 401,
   or a function (url, opts) returning a Response}). Any other ESPN league id
   throws, so a test can never read a real person's league. Returns an undo. */
function stubEspn(leagues) {
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    const m = String(url).match(/fantasy\.espn\.com.*\/leagues\/(\d+)/);
    if (!m) return real(url, opts);
    const hit = leagues[m[1]];
    if (typeof hit === 'function') return hit(String(url), opts);
    if (hit === 401) return new Response('{"messages":["You are not authorized to view this League."]}', {status: 401});
    if (hit) return new Response(JSON.stringify(hit), {status: 200});
    throw new Error('a test tried to read a real ESPN league: ' + m[1]);
  };
  return () => { global.fetch = real; };
}

/* A made-up Yahoo league in Yahoo's own nesting (league 472.l.1001, four teams), built
   from Sleeper's player list with names that appear only once, so each should match
   back to its Sleeper id: the answers Titan's server gets for the person's leagues and
   teams, the league's settings, and every team's roster for week 1. Team 1 is the
   person's: a set lineup (one starter Out, a W/R/T flex, Philadelphia's defense), five
   on the bench and one on IR. Nobody's real league. */
function yahooLeague(players) {
  const SCC = app('engine.js');
  const KEY = '472.l.1001', seen = {};
  const nk = id => SCC.norm(players[id][0]) + '|' + players[id][1];
  Object.keys(players).forEach(id => { seen[nk(id)] = (seen[nk(id)] || 0) + 1; });
  const pick = (pos, n) => Object.keys(players).filter(id => players[id][1] === pos && players[id][2] && seen[nk(id)] === 1).slice(0, n);
  const [q, r, w, t, k] = [pick('QB', 5), pick('RB', 8), pick('WR', 7), pick('TE', 2), pick('K', 2)];
  const title = s => s.charAt(0) + s.slice(1).toLowerCase();
  const coll = items => Object.assign({count: items.length}, ...items.map((x, i) => ({[i]: x})));
  let yid = 30000;
  const sel = slot => ({selected_position: [{coverage_type: 'week', week: '1'}, {position: slot}, {is_flex: 0}]});
  const yp = (id, slot, status) => ({player: [[{player_key: '472.p.' + (++yid)}, {player_id: String(yid)}, {name: {full: players[id][0]}},
    {editorial_team_abbr: title(players[id][2])}, {bye_weeks: {week: '9'}}, {display_position: players[id][1]}, [],
    {primary_position: players[id][1]}, status ? {status} : []], sel(slot)]});
  const ydef = (abbr, city, slot) => ({player: [[{player_key: '472.p.' + (++yid)}, {player_id: String(yid)}, {name: {full: city}},
    {editorial_team_abbr: title(abbr)}, {display_position: 'DEF'}, {primary_position: 'DEF'}], sel(slot)]});
  const team = (n, name, list) => ({team: [[{team_key: KEY + '.t.' + n}, {team_id: String(n)}, {name}, [],
    {url: 'https://football.fantasysports.yahoo.com/f1/1001/' + n}, {team_logos: [{team_logo: {size: 'large', url: 'https://s.yimg.com/team' + n + '.png'}}]},
    n === 1 ? {is_owned_by_current_login: 1} : [], {managers: [{manager: {manager_id: String(n), nickname: 'Manager ' + n}}]}],
    {roster: {coverage_type: 'week', week: '1', '0': {players: coll(list)}}}]});
  const meta = {league_key: KEY, league_id: '1001', name: 'Titan Yahoo Test', num_teams: '4', url: 'https://football.fantasysports.yahoo.com/f1/1001',
    logo_url: false, season: '2026', current_week: '1'};
  const spot = (position, count) => ({roster_position: {position, count}});
  const user = (what, items) => ({fantasy_content: {users: {'0': {user: [{guid: 'TESTGUID'}, {games: {'0': {game: [
    {game_key: '472', code: 'nfl', season: '2026'}, {[what]: items}]}, count: 1}}]}, count: 1}}});
  return {
    key: KEY,
    ids: {starters: [q[0], r[0], r[1], w[0], w[1], t[0], w[2], k[0], 'PHI'], flex: w[2], out: r[1], ir: r[4],
      bench: [q[1], r[2], r[3], w[3], t[1]], elsewhere: w[4]},
    leagues: user('leagues', coll([{league: [meta]}])),
    teams: user('teams', coll([{team: [[{team_key: KEY + '.t.1'}, {team_id: '1'}, {name: 'My Yahoo Team'}]]}])),
    settings: {fantasy_content: {league: [meta, {settings: [{uses_faab: '1', playoff_start_week: '15', num_playoff_teams: '4',
      roster_positions: [spot('QB', 1), spot('WR', 2), spot('RB', 2), spot('TE', 1), spot('W/R/T', 1), spot('K', 1), spot('DEF', 1), spot('BN', 5), spot('IR', 1)],
      stat_modifiers: {stats: [{stat: {stat_id: 4, value: '0.04'}}, {stat: {stat_id: 11, value: '0.5'}}]}}]}]}},
    roster: {fantasy_content: {league: [meta, {teams: coll([
      team(1, 'My Yahoo Team', [yp(q[0], 'QB'), yp(r[0], 'RB'), yp(r[1], 'RB', 'O'), yp(w[0], 'WR'), yp(w[1], 'WR'), yp(t[0], 'TE'),
        yp(w[2], 'W/R/T'), yp(k[0], 'K'), ydef('PHI', 'Philadelphia', 'DEF'), yp(q[1], 'BN'), yp(r[2], 'BN'), yp(r[3], 'BN'),
        yp(w[3], 'BN'), yp(t[1], 'BN'), yp(r[4], 'IR', 'IR')]),
      team(2, 'Second Team', [yp(q[2], 'QB'), yp(r[5], 'RB'), yp(w[4], 'WR'), ydef('DAL', 'Dallas', 'DEF')]),
      team(3, 'Third Team', [yp(q[3], 'QB'), yp(r[6], 'RB'), yp(w[5], 'WR')]),
      team(4, 'Fourth Team', [yp(q[4], 'QB'), yp(r[7], 'RB'), yp(w[6], 'WR'), yp(k[1], 'K')])])}]}}
  };
}

module.exports = {
  ROOT, FIXTURES, check, section, skip, done, crash, app, cached, nflState,
  sleeperPlayers, sampleRanks, espnLeagues, espnBoxscore, stubEspn, yahooLeague,
  sleeperUser: process.env.TITAN_SLEEPER_USER || ''
};
