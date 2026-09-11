// The Matchup tab's data: a Sleeper league's head-to-head from its matchups,
// rosters and members, and an ESPN league's from its box score. Made-up data
// plus the ESPN test league; no real league is read.
const T = require('./lib');
const ESPN = T.app('espn.js');
const API = T.app('sleeper.js');
const {check, section} = T;

(async () => {
  const players = await T.sleeperPlayers();
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});

  section('Sleeper');
  const lg = {id: 'S1', key: 'S1', lineup: ['QB', 'RB', 'FLEX']};
  const ids = Object.keys(players).filter(id => players[id][1] === 'QB').slice(0, 2)
    .concat(Object.keys(players).filter(id => players[id][1] === 'RB').slice(0, 3));
  const matchups = [
    {roster_id: 4, matchup_id: 2, starters: [ids[0], ids[2], '0'], players_points: {[ids[0]]: 18.5, [ids[2]]: 7}, points: 25.5},
    {roster_id: 2, matchup_id: 2, starters: [ids[1], ids[3], ids[4]], players_points: {[ids[1]]: 12, [ids[3]]: 0, [ids[4]]: 3.2}, points: 15.2},
    {roster_id: 7, matchup_id: 3, starters: [], players_points: {}}];
  const rosters = [{roster_id: 4, owner_id: 'me', settings: {wins: 1, losses: 0}}, {roster_id: 2, owner_id: 'them', settings: {wins: 0, losses: 1, ties: 1}},
    {roster_id: 7, owner_id: 'other'}];
  const users = [{user_id: 'me', display_name: 'Me', metadata: {}, avatar: 'abc123'}, {user_id: 'them', display_name: 'Rival', metadata: {team_name: 'The Rivals'}}];
  const m = API.sleeperMatchup(lg, 4, matchups, rosters, users, players);
  check(m.me.name === 'Me' && m.opp.name === 'The Rivals', 'both sides named, a team name ahead of a display name');
  check(m.me.record === '1-0' && m.opp.record === '0-1-1' && m.me.avatar === 'abc123' && m.opp.avatar === '', 'records and avatars, like Sleeper\'s scoreboard');
  check(m.opp.players.length === 3 && m.opp.players[2].id === ids[4] && m.opp.players[2].slot === 'FLEX' && m.opp.players[2].pts === 3.2,
    'the opponent\'s starters in lineup order, with points');
  check(m.me.players[2].empty === true && m.me.players[2].slot === 'FLEX', 'an empty spot stays empty');
  check(m.me.players[0].name === players[ids[0]][0], 'players named from Sleeper\'s list');
  check(API.sleeperMatchup(lg, 9, matchups, rosters, users, players).none === true, 'no matchup found: marked as none');
  check(API.sleeperMatchup(lg, 7, matchups, rosters, users, players).none === true, 'nobody else in the matchup (a bye): none');

  section('ESPN');
  const {league: L1} = await T.espnLeagues();
  const box = T.espnBoxscore(L1);
  const em = ESPN.matchupFrom(box, 1);
  check(em && em.me.teamId === 1 && em.opp.teamId === 2 && em.me.name === 'Team 1' && em.opp.name === 'Team 2', 'team 1 plays team 2, both named');
  check(em.opp.players.length === 16 && em.opp.players.filter(p => p.start).length === 9, 'the opponent\'s roster: 16 players, 9 starting');
  check(ESPN.matchupFrom(box, 9).opp.teamId === 10 && ESPN.matchupFrom({schedule: [{home: {teamId: 1}}]}, 1) === null, 'either side found; a bye is no matchup');
  ESPN.toSleeper(em.opp.players, players);
  check(em.opp.players.filter(p => /^\d+$/.test(p.id) || /^[A-Z]{2,3}$/.test(p.id)).length >= 15, 'opponents matched to Sleeper ids for projections');

  section('every league at once');
  const undo = T.stubEspn({99999901: (url) => new Response(JSON.stringify(/mBoxscore/.test(url) ? box : L1), {status: 200})});
  const snap = await API.collect({userId: '', displayName: 'Test', prefs: {}, espn: {leagues: [{id: '99999901', teamId: 1}]}}, null, null);
  const all = await API.collectMatchups(snap);
  check(all.length === 1 && all[0].me && all[0].opp && all[0].opp.players.length === 9 && all[0].opp.players.every(p => p.empty || p.slot),
    `the ESPN league's matchup: ${all[0].me && all[0].me.name} vs ${all[0].opp && all[0].opp.name}, 9 spots each`);
  if (T.sleeperUser) {
    const me = await API.lookupUser(T.sleeperUser);
    const s2 = await API.collect(Object.assign({}, me, {prefs: {}}), null, null);
    const real = await API.collectMatchups(s2);
    const ok = real.filter(x => x.me && x.opp && x.opp.players.length === x.cfg.lineup.length && x.opp.name);
    check(real.length === s2.leagues.length && ok.length + real.filter(x => x.none).length === real.length,
      `your Sleeper leagues: ${ok.length} matchups with both lineups, ${real.filter(x => x.none).length} without one`);
  } else {
    T.skip('your real matchups (set TITAN_SLEEPER_USER to run it)');
  }
  undo();
  T.done();
})().catch(T.crash);
