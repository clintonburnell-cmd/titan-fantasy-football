// The Waivers tab's pieces: waiver bid suggestions and backups (engine.js), and Sleeper's
// trending adds and a league's waiver budget (sleeper.js, with Sleeper's answers made up
// here). No network, no real league.
const T = require('./lib');
const SCC = T.app('engine.js');
const API = T.app('sleeper.js');
const {check, section} = T;

section('waiver bids');
const history = [1, 2, 3, 5, 8, 13, 21, 34];
const hot = SCC.faabBid({budget: 100, left: 80, bids: history, heat: 'hot'});
const warm = SCC.faabBid({budget: 100, left: 80, bids: history, heat: 'warm'});
const cold = SCC.faabBid({budget: 100, left: 80, bids: history, heat: 'cold'});
check(hot.basis === 'league' && hot.bid === 15 && warm.bid === 7 && cold.bid === 2,
  `from the league's own winning bids: hot $${hot.bid} (75th percentile), warm $${warm.bid} (median), cold $${cold.bid}`);
check(SCC.faabBid({budget: 100, left: 80, bids: [3], heat: 'hot'}).bid === 12 && SCC.faabBid({budget: 100, bids: [], heat: 'warm'}).bid === 5 &&
  SCC.faabBid({budget: 100, bids: [], heat: 'cold'}).basis === 'budget', 'with too few bids to go on, a share of the budget (12%, 5%, 1%)');
check(SCC.faabBid({budget: 100, left: 6, bids: history, heat: 'hot'}).bid === 6 && SCC.faabBid({budget: 100, left: 0, heat: 'hot'}).bid === 0 &&
  SCC.faabBid({budget: 1000, bids: [], heat: 'cold'}).bid === 10 && SCC.faabBid({budget: 20, bids: [], heat: 'cold'}).bid === 1,
  'never more than what\'s left, nothing when nothing\'s left, and at least $1');

section('backups');
const players = {'1': ['Starter Back', 'RB', 'KC', 1], '2': ['Backup Back', 'RB', 'KC', 2], '3': ['Third Back', 'RB', 'KC', 3],
  '4': ['Starter Wideout', 'WR', 'KC', 1], '5': ['Wideout Two', 'WR', 'KC', 2], '6': ['Only Tight End', 'TE', 'KC', 1]};
check(SCC.backupOf(players, {id: '1', pos: 'RB', team: 'KC'}).name === 'Backup Back' && SCC.backupOf(players, {id: '2', pos: 'RB', team: 'KC'}).name === 'Third Back',
  'the next man on the depth chart');
check(SCC.backupOf(players, {id: '4', pos: 'WR', team: 'KC'}) === null && SCC.backupOf(players, {id: '6', pos: 'TE', team: 'KC'}) === null,
  'no backup for a receiver (there\'s no handcuff), or when nobody is listed behind him');

section('Sleeper: trending adds and a league\'s waiver budget');
(async () => {
  const replies = {
    'trending/add': [{player_id: '4046', count: 12000}, {player_id: '9509', count: 800}],
    '/rosters': [{roster_id: 1, settings: {waiver_budget_used: 27}}, {roster_id: 2, settings: {waiver_budget_used: 0}}],
    '/transactions/1': [{type: 'waiver', status: 'complete', settings: {waiver_bid: 11}}, {type: 'waiver', status: 'failed', settings: {waiver_bid: 40}},
      {type: 'free_agent', status: 'complete', settings: {}}],
    '/transactions/2': [{type: 'waiver', status: 'complete', settings: {waiver_bid: 3}}]
  };
  const asked = [];
  global.fetch = async url => {
    asked.push(url);
    const k = Object.keys(replies).find(s => url.includes(s));
    return new Response(JSON.stringify(k ? replies[k] : []), {status: 200});
  };
  const trend = await API.trendingAdds(25);
  check(trend.length === 2 && trend[0].id === '4046' && trend[0].count === 12000 && asked[0].includes('limit=25'), 'the most added, with how many adds');
  const w = await API.leagueWaivers({id: '9', faab: 100}, 1, 2);
  check(w.budget === 100 && w.left === 73 && w.bids.join() === '11,3', 'the budget, what\'s left, and only the winning bids');
  const late = await API.leagueWaivers({id: '9', faab: 100}, 1, 12);
  check(asked.filter(u => /transactions\/\d+$/.test(u)).map(u => u.split('/').pop()).slice(-6).join() === '7,8,9,10,11,12' && late.left === 73,
    'only the last six weeks of claims');
  T.done();
})().catch(T.crash);
