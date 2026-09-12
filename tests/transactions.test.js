// The Transactions tab: a Sleeper league's transactions read into who did what
// (engine.js transactionsFrom), and loaded with team names (sleeper.js, with Sleeper's
// answers made up here). No network, no real league.
const T = require('./lib');
const SCC = T.app('engine.js');
const API = T.app('sleeper.js');
const {check, section} = T;

const players = {'10': ['Star Back', 'RB', 'KC'], '11': ['Deep Wideout', 'WR', 'BUF'], '12': ['Waiver Wonder', 'RB', 'MIA'], '13': ['Cut Guy', 'TE', 'NYJ']};
const names = {1: 'Me', 2: 'Pat\'s Team', 3: 'Third Team'};
const list = [
  {transaction_id: 't1', type: 'trade', status: 'complete', status_updated: 3000, leg: 2, roster_ids: [1, 2],
    adds: {'10': 1, '11': 2}, drops: {'10': 2, '11': 1},
    draft_picks: [{season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1}, {season: '2028', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2}],
    waiver_budget: [{sender: 2, receiver: 1, amount: 10}]},
  {transaction_id: 'w1', type: 'waiver', status: 'complete', status_updated: 5000, leg: 2, roster_ids: [3], adds: {'12': 3}, drops: {'13': 3}, settings: {waiver_bid: 17}},
  {transaction_id: 'w2', type: 'waiver', status: 'failed', status_updated: 6000, leg: 2, roster_ids: [1], adds: {'12': 1}, settings: {waiver_bid: 9}},
  {transaction_id: 'f1', type: 'free_agent', status: 'complete', created: 1000, leg: 1, roster_ids: [1], adds: {'13': 1}}];

section('reading transactions');
const tx = SCC.transactionsFrom(list, names, players, 1);
check(tx.map(x => x.id).join() === 'w1,t1,f1', 'completed moves only, newest first (a failed claim is left out)');
const trade = tx.find(x => x.id === 't1'), me = trade.sides.find(s => s.roster === '1'), pat = trade.sides.find(s => s.roster === '2');
check(trade.kind === 'trade' && trade.mine && me.adds.map(p => p.name).join() === 'Star Back' && pat.adds.map(p => p.name).join() === 'Deep Wideout' &&
  me.picks.join() === '2027 1st (Pat\'s Team\'s)' && pat.picks.join() === '2028 2nd (Me\'s)' && me.budgetIn === 10 && pat.budgetOut === 10,
  'a trade: what each side gets, draft picks labelled with whose they were, and waiver budget');
const claim = tx.find(x => x.id === 'w1');
check(claim.kind === 'waiver' && !claim.mine && claim.bid === 17 && claim.sides[0].name === 'Third Team' &&
  claim.sides[0].adds[0].name === 'Waiver Wonder' && claim.sides[0].drops[0].pos === 'TE', 'a waiver claim: who added and dropped whom, for how much');
check(tx.find(x => x.id === 'f1').at === 1000 && SCC.transactionsFrom(null, {}, players, 1).length === 0, 'the time comes from when it went through (or was made); nothing, nothing');

section('loading a league\'s moves');
(async () => {
  API.store.set(API.PLAYERS_KEY, {ts: Date.now(), map: players});
  const replies = {
    '/rosters': [{roster_id: 1, owner_id: 'u1'}, {roster_id: 2, owner_id: 'u2'}, {roster_id: 3, owner_id: 'u3'}],
    '/users': [{user_id: 'u1', display_name: 'Me'}, {user_id: 'u2', display_name: 'Pat', metadata: {team_name: 'Pat\'s Team'}}, {user_id: 'u3', display_name: 'Third Team'}],
    '/transactions/1': [list[3]], '/transactions/2': [list[0], list[1], list[2]]
  };
  const asked = [];
  global.fetch = async url => {
    asked.push(url);
    const k = Object.keys(replies).find(s => url.endsWith(s));
    return new Response(JSON.stringify(k ? replies[k] : []), {status: 200});
  };
  const got = await API.leagueTransactions({id: '9'}, 1, 2, 3);
  check(got.length === 3 && got[1].sides.find(s => s.roster === '2').name === 'Pat\'s Team' &&
    asked.filter(u => /transactions/.test(u)).map(u => u.split('/').pop()).join() === '1,2', 'each week so far, team names from the members');
  T.done();
})().catch(T.crash);
