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

module.exports = {
  ROOT, FIXTURES, check, section, skip, done, crash, app, cached, nflState,
  sleeperPlayers, sampleRanks, espnLeagues, stubEspn,
  sleeperUser: process.env.TITAN_SLEEPER_USER || ''
};
