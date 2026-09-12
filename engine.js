/* Titan Fantasy Football Manager — engine
 *
 * Start/sit, waiver, exposure, bye and scorecard rules. Pure functions only —
 * no page, no network, no storage — so the same file runs in the browser and
 * under Node for testing.
 *
 * Start/sit order comes ONLY from the rankings the user imports. A player with
 * no rank is never started ahead of one who has a rank, and is labelled
 * UNRANKED so you can see why.
 */
(function (root) {
  'use strict';

  // Sleeper injury_status values that mean "do not start this week".
  // Questionable is playable, so it is flagged but never benched.
  var INJ_OUT = {Out: 1, Doubtful: 1, IR: 1, PUP: 1, Sus: 1, NA: 1, DNR: 1, COV: 1};

  // 2026 byes, used only until the first refresh reads Sleeper's schedule.
  var BYE_FALLBACK = {ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11, DAL: 14, DEN: 10,
    DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5, LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6,
    NE: 11, NO: 8, NYG: 8, NYJ: 13, PHI: 10, PIT: 9, SEA: 11, SF: 8, TB: 10, TEN: 9, WAS: 7};
  var byes = BYE_FALLBACK;

  var ALIAS = {JAC: 'JAX', WSH: 'WAS', LA: 'LAR', ARZ: 'ARI', LVR: 'LV'};
  // Positions a ranking can hold.
  var POSITIONS = {QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1};
  // Positions worth keeping from Sleeper's player list (IDP included, for IDP leagues).
  var PLAYER_POS = {QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, DL: 1, DE: 1, DT: 1, LB: 1, DB: 1, CB: 1, S: 1};

  // Which positions can fill each Sleeper lineup slot. Any slot not listed takes
  // only its own position (QB, RB, WR, TE, K, DEF, LB).
  var SLOT_POS = {
    FLEX: {RB: 1, WR: 1, TE: 1},
    WRRB_FLEX: {RB: 1, WR: 1},
    REC_FLEX: {WR: 1, TE: 1},
    SUPER_FLEX: {QB: 1, RB: 1, WR: 1, TE: 1},
    DL: {DL: 1, DE: 1, DT: 1},
    DB: {DB: 1, CB: 1, S: 1},
    IDP_FLEX: {DL: 1, DE: 1, DT: 1, LB: 1, DB: 1, CB: 1, S: 1}
  };
  var FLEX_SLOTS = {FLEX: 1, WRRB_FLEX: 1, REC_FLEX: 1, SUPER_FLEX: 1, IDP_FLEX: 1};
  var SLOT_LABEL = {SUPER_FLEX: 'SFLX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', IDP_FLEX: 'IDP'};
  var NOT_STARTERS = {BN: 1, IR: 1, TAXI: 1};

  /* One entry per KIND OF SLOT, because a slot can only be filled by someone who
     fits it. TE is the one that bites: the TE slot is mandatory, so a better RB on
     the wire does nothing for it — only another TE can go there. RB/WR/TE share
     one overall rank scale; QB, K and DEF each sit on their own. */
  var WIRE_GROUPS = [
    {label: 'QB',         slot: 'QB',         set: {QB: 1}},
    {label: 'RB',         slot: 'RB',         set: {RB: 1}},
    {label: 'WR',         slot: 'WR',         set: {WR: 1}},
    {label: 'TE',         slot: 'TE',         set: {TE: 1}},
    {label: 'FLEX',       slot: 'FLEX',       set: SLOT_POS.FLEX},
    {label: 'W/R FLEX',   slot: 'WRRB_FLEX',  set: SLOT_POS.WRRB_FLEX},
    {label: 'W/T FLEX',   slot: 'REC_FLEX',   set: SLOT_POS.REC_FLEX},
    {label: 'SUPER FLEX', slot: 'SUPER_FLEX', set: SLOT_POS.SUPER_FLEX},
    {label: 'K',          slot: 'K',          set: {K: 1}},
    {label: 'DEF',        slot: 'DEF',        set: {DEF: 1}}
  ];

  /* Decisions that were genuinely contested: a bench player who could have taken
     the same slot and was ranked within CLOSE spots of the man who started. */
  var CLOSE = 12;

  /* ------------------------------------------------------------- names */

  var SUFFIX = {jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1};
  var NICK = {kenny: 'kenneth', mike: 'michael', chris: 'christopher', joe: 'joseph',
    matt: 'matthew', zach: 'zachary', josh: 'joshua', nick: 'nicholas', tony: 'anthony',
    cam: 'cameron', dan: 'daniel', danny: 'daniel', will: 'william', rob: 'robert',
    bobby: 'robert', jake: 'jacob', ben: 'benjamin', greg: 'gregory', ted: 'theodore',
    tre: 'trey'};

  function norm(name) {
    if (!name) return '';
    var s = String(name).toLowerCase().replace(/[.\-]/g, ' ').replace(/[^a-z ]/g, '');
    var parts = s.split(/\s+/).filter(function (p) { return p && !SUFFIX[p]; });
    var merged = [], buf = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].length === 1) { buf += parts[i]; }
      else { if (buf) { merged.push(buf); buf = ''; } merged.push(parts[i]); }
    }
    if (buf) merged.push(buf);
    if (merged.length && NICK[merged[0]]) merged[0] = NICK[merged[0]];
    return merged.join(' ');
  }

  function teamAbbr(team) {
    var t = String(team || '').trim().toUpperCase();
    return ALIAS[t] || t;
  }

  function byeOf(team) {
    return byes[teamAbbr(team)] || '';
  }

  /* Each team's bye is the one regular-season week it has no game. Reading it
     from Sleeper's schedule keeps byes right in every season. */
  function byesFromSchedule(schedule) {
    var played = {}, weeks = {};
    (schedule || []).forEach(function (g) {
      var w = Number(g.week);
      if (!w) return;
      weeks[w] = 1;
      [g.home, g.away].forEach(function (t) {
        if (!t) return;
        t = teamAbbr(t);
        (played[t] = played[t] || {})[w] = 1;
      });
    });
    var all = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    var out = {};
    Object.keys(played).forEach(function (t) {
      for (var i = 0; i < all.length; i++) if (!played[t][all[i]]) { out[t] = all[i]; break; }
    });
    return out;
  }

  function setByes(map) {
    if (map && Object.keys(map).length >= 30) byes = map;
    return byes;
  }

  // Sleeper leaves full_name empty for some players (Patrick Mahomes, for one).
  function fullName(p) {
    return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ----------------------------------------------------------- players */

  /* The full /players/nfl dump is ~14 MB. Keep only what the app reads —
     name, position, team — for fantasy positions: well under 200 KB. */
  function trimPlayers(full) {
    var map = {};
    for (var id in full) {
      if (!/^\d+$/.test(id)) continue;
      var p = full[id];
      if (!p || !PLAYER_POS[p.position]) continue;
      // Name, position, team, and his place on the team's depth chart (0: none), for backup alerts.
      map[id] = [fullName(p) || ('id ' + id), p.position, p.team || '', Number(p.depth_chart_order) || 0];
    }
    return map;
  }

  /* Sleeper roster ids are numeric, except team defences, whose id IS the team
     abbreviation. Those are named "<ABBR> D/ST" to match the rankings. An ESPN
     player Sleeper's list doesn't have ("espn:<id>") is looked up like anyone. */
  function playerInfo(players, id) {
    var key = String(id);
    var e = players && players[key];
    if (e) return {name: e[0], pos: e[1], team: e[2], depth: e[3] || 0};
    if (!/^\d+$/.test(key) && key.indexOf(':') < 0) return {name: key + ' D/ST', pos: 'DEF', team: key};
    return {name: 'id ' + key, pos: '?', team: ''};
  }

  function isMine(roster, userId) {
    var uid = String(userId);
    if (String(roster.owner_id) === uid) return true;
    return (roster.co_owners || []).map(String).indexOf(uid) >= 0;
  }

  /* ----------------------------------------------------------- leagues */

  function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /* A user's leagues straight from Sleeper, lineup slots included. `prefs`
     holds the user's own switches ({leagueId: {active}}). Best-ball leagues set
     their own lineups, so they start switched off. */
  function leaguesFromSleeper(list, prefs) {
    prefs = prefs || {};
    var seen = {};
    return (list || []).filter(function (l) { return l && l.league_id; }).map(function (l) {
      var s = l.settings || {};
      var name = cleanName(l.name) || ('League ' + l.league_id);
      var key = name;
      for (var n = 2; seen[key]; n++) key = name + ' (' + n + ')';
      seen[key] = 1;
      var bestBall = !!s.best_ball;
      var pref = prefs[l.league_id] || {};
      return {
        id: String(l.league_id), key: key, name: name,
        pic: l.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + l.avatar : '', // the league's own picture
        lineup: (l.roster_positions || []).filter(function (p) { return !NOT_STARTERS[p]; }),
        teams: l.total_rosters || s.num_teams || 0,
        ppr: l.scoring_settings ? Number(l.scoring_settings.rec || 0) : 0,
        kind: s.type === 2 ? 'Dynasty' : s.type === 1 ? 'Keeper' : 'Redraft',
        bestBall: bestBall,
        rounds: Number(s.draft_rounds) || 0, // draft rounds, for a dynasty league's picks (Trade tab)
        // The playoffs (Standings) and the waiver budget, when the league bids for players (Waivers).
        playoffStart: Number(s.playoff_week_start) || 0, playoffTeams: Number(s.playoff_teams) || 0,
        faab: Number(s.waiver_type) === 2 ? Number(s.waiver_budget) || 0 : 0,
        status: l.status || '',
        active: pref.active !== undefined ? !!pref.active : !bestBall,
        exposure: true
      };
    });
  }

  function describeLeague(l) {
    var scoring = l.ppr >= 1 ? 'PPR' : l.ppr >= 0.5 ? 'Half PPR' : l.ppr > 0 ? l.ppr + ' PPR' : 'Standard';
    return [l.platform === 'espn' ? 'ESPN' : l.platform === 'yahoo' ? 'Yahoo' : '', l.teams ? l.teams + ' teams' : '', scoring, l.kind, l.bestBall ? 'Best ball' : '']
      .filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------ trades */

  /* A league's format as FantasyCalc prices trades: dynasty or redraft, one QB or two
     (superflex), the nearest team count it offers (8, 10, 12, 14) and PPR (0, 0.5, 1). */
  function tradeFormat(cfg) {
    var lineup = cfg.lineup || [];
    var qbs = lineup.indexOf('SUPER_FLEX') >= 0 || lineup.filter(function (s) { return s === 'QB'; }).length > 1 ? 2 : 1;
    var n = Number(cfg.teams) || 12;
    var teams = [8, 10, 12, 14].reduce(function (a, b) { return Math.abs(b - n) < Math.abs(a - n) ? b : a; });
    var p = Number(cfg.ppr) || 0;
    return {dynasty: cfg.kind === 'Dynasty', qbs: qbs, teams: teams, ppr: p >= 0.75 ? 1 : p >= 0.25 ? 0.5 : 0};
  }

  // FantasyCalc's values (as Titan's server trims them: s Sleeper id, e ESPN id, v value) by id.
  function valueIndex(list) {
    var bySleeper = {}, byEspn = {};
    (list || []).forEach(function (x) {
      if (x.s) bySleeper[x.s] = x;
      if (x.e) byEspn[x.e] = x;
    });
    return {bySleeper: bySleeper, byEspn: byEspn};
  }

  // A player's value entry: a draft pick by its FantasyCalc id (vid), ESPN players by their
  // ESPN id first, everyone else by Sleeper id. Null: no value.
  function playerValue(idx, p) {
    if (!idx || !p) return null;
    if (p.vid) return idx.bySleeper[p.vid] || null;
    var e = p.espnId !== undefined && p.espnId !== null ? idx.byEspn[String(p.espnId)] : null;
    return e || idx.bySleeper[String(p.id)] || null;
  }

  /* What a waiver pickup is worth: about the 300th-best player, as FantasyCalc's own
     calculator assumes (the last player listed when fewer are listed; draft picks aside). */
  function waiverValue(list) {
    var vals = (list || []).filter(function (x) { return x.p !== 'PICK'; })
      .map(function (x) { return Number(x.v) || 0; }).sort(function (a, b) { return b - a; });
    return vals.length ? vals[Math.min(299, vals.length - 1)] : 0;
  }

  // One side's values added up, and how many players it moves (draft picks take no roster spot).
  function sideSum(items) {
    var raw = 0, n = 0;
    (items || []).forEach(function (x) {
      raw += Math.max(0, Number(x.v) || 0);
      if (!x.pick) n++;
    });
    return {raw: raw, n: n};
  }

  // Both totals: the side getting fewer players gains a waiver pickup for each roster spot it frees.
  function withSpots(a, b, w) {
    return [a.raw + Math.max(0, b.n - a.n) * w, b.raw + Math.max(0, a.n - b.n) * w];
  }

  /* Both sides of a trade, weighed the way FantasyCalc's calculator does. The values add
     up as they are (FantasyCalc's values already count stars for more: they sit on an
     exponential curve), and in an uneven trade the side getting fewer players gets
     `waiver` for each roster spot it frees. give and get are [{v, pick}]. Fair within 5%
     of the bigger side; otherwise who wins, by how much, and what one more player on the
     lighter side would need to be worth to even it (counting the roster spot he takes). */
  var FAIR = 0.05;
  function tradeVerdict(give, get, waiver) {
    var w = Math.max(0, Number(waiver) || 0), a = sideSum(give), b = sideSum(get), t = withSpots(a, b, w);
    a.adj = t[0]; a.spot = t[0] - a.raw;
    b.adj = t[1]; b.spot = t[1] - b.raw;
    var big = Math.max(a.adj, b.adj), diff = b.adj - a.adj;
    var fair = big === 0 || Math.abs(diff) <= FAIR * big, even = 0;
    if (!fair) {
      var light = diff > 0 ? a : b, heavy = diff > 0 ? b : a;
      var t2 = withSpots({raw: light.raw, n: light.n + 1}, heavy, w);
      even = Math.max(0, t2[1] - t2[0]);
    }
    return {give: a, get: b, diff: diff, fair: fair, winner: fair ? 'even' : diff > 0 ? 'you' : 'them', even: even};
  }

  /* Titan's own trade value, for the Trade tab on every account but Titan's owner's:
     FantasyCalc asks that its numbers stay out of other sites' trade calculators. A
     player's projected points this season above a replacement-level player at his
     position, in the league's scoring: replacement is the best player just outside what
     the league's teams start there (flex spots shared out). Built only from Sleeper's
     season projections, never from FantasyCalc's values. {playerId: whole points, 0 at or
     below replacement}. */
  var FLEX_SHARE = {FLEX: {RB: 0.45, WR: 0.45, TE: 0.1}, WRRB_FLEX: {RB: 0.5, WR: 0.5}, REC_FLEX: {WR: 0.8, TE: 0.2},
    SUPER_FLEX: {QB: 0.9, RB: 0.05, WR: 0.05}};
  function titanValues(seasonProj, players, cfg) {
    var teams = Number(cfg.teams) || 12, starts = {}, byPos = {}, out = {};
    (cfg.lineup || []).forEach(function (slot) {
      var share = FLEX_SHARE[slot];
      if (!share) {
        if (!PLAYER_POS[slot]) return;
        share = {};
        share[slot] = 1;
      }
      for (var pos in share) starts[pos] = (starts[pos] || 0) + share[pos];
    });
    for (var id in seasonProj || {}) {
      var pos = playerInfo(players, id).pos;
      if (starts[pos]) (byPos[pos] = byPos[pos] || []).push({id: id, pts: projFor(seasonProj, id, cfg.ppr) || 0});
    }
    Object.keys(byPos).forEach(function (pos) {
      var list = byPos[pos].sort(function (a, b) { return b.pts - a.pts; });
      var repl = list[Math.min(Math.round(teams * starts[pos]), list.length - 1)].pts;
      list.forEach(function (x) { out[x.id] = Math.max(0, Math.round(x.pts - repl)); });
    });
    return out;
  }

  /* Trade ideas for one team in a league: trades of one or two players each way (not two
     for two) that FantasyCalc's calculator calls fair (tradeVerdict, roster spots counted)
     and that make the team's starting lineup stronger. A lineup's strength here is the value
     of its best starters (lineupPoints with values), which suits a trade better than one
     week's projections. Trades that leave both lineups stronger come first; within each
     group, ranked by our gain plus half theirs (up to ours). Each side offers its `top` (12)
     most valuable players; at most two ideas per team and one per player wanted.
     opts: {value(p), slots, waiver, max, top}. */
  function tradeIdeas(me, others, opts) {
    var value = opts.value, slots = opts.slots || [], waiver = opts.waiver || 0, max = opts.max || 6, top = opts.top || 12;
    var pool = function (roster) {
      return roster.filter(function (p) { return p.pos !== 'PICK' && value(p) > 0; })
        .sort(function (a, b) { return value(b) - value(a); }).slice(0, top);
    };
    var strength = function (roster) { return lineupPoints(roster, slots, value); };
    var combos = function (list) {
      var out = list.map(function (p) { return [p]; });
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
      return out;
    };
    var items = function (list) { return list.map(function (p) { return {v: value(p)}; }); };
    var without = function (roster, gone) { return roster.filter(function (p) { return !gone.some(function (g) { return g.id === p.id; }); }); };
    var myBase = strength(me.roster), myCombos = combos(pool(me.roster)), ideas = [];
    (others || []).forEach(function (o) {
      var theirBase = strength(o.roster), theirCombos = combos(pool(o.roster));
      myCombos.forEach(function (give) {
        theirCombos.forEach(function (get) {
          if (give.length === 2 && get.length === 2) return;
          var R = tradeVerdict(items(give), items(get), waiver);
          if (!R.fair) return;
          var gain = strength(without(me.roster, give).concat(get)) - myBase;
          if (gain <= 0) return;
          ideas.push({partner: o, give: give, get: get, verdict: R, myGain: round2(gain),
            theirGain: round2(strength(without(o.roster, get).concat(give)) - theirBase)});
        });
      });
    });
    // Trades that leave both lineups stronger come first: the other side is likelier to say yes.
    var score = function (x) { return x.myGain + 0.5 * Math.min(x.theirGain, x.myGain); };
    ideas.sort(function (a, b) { return (b.theirGain >= 0) - (a.theirGain >= 0) || score(b) - score(a); });
    var perTeam = {}, wanted = {}, out = [];
    ideas.forEach(function (x) {
      if (out.length >= max || (perTeam[x.partner.id] || 0) >= 2 || x.get.some(function (p) { return wanted[p.id]; })) return;
      perTeam[x.partner.id] = (perTeam[x.partner.id] || 0) + 1;
      x.get.forEach(function (p) { wanted[p.id] = 1; });
      out.push(x);
    });
    return out;
  }

  /* A roster's best starting lineup by projected points, for the Trade tab's before and
     after. Players on IR or the taxi squad can't start, and draft picks don't play.
     `proj(p)` gives a player's points. */
  function lineupPoints(roster, slots, proj) {
    var pool = (roster || []).filter(function (p) { return !p.held && p.pos !== 'PICK'; })
      .map(function (p) { return {id: p.id, pos: p.pos, pts: Number(proj(p)) || 0}; });
    return sumPts(bestByPoints(pool, slots || []));
  }

  /* Where each team in a league is deep or thin, position by position: its best starting
     lineup by `pts` (Titan uses Sleeper's season projections, never FantasyCalc's), the
     starters at each position added up, plus a quarter of its best bench player there
     (depth), ranked across the league (1 = strongest). The top third are 'deep', the bottom
     third 'thin'; IR and taxi players don't count. {teams: [{id, byPos: {QB: {start, depth,
     rank, grade}}}], positions, n}. */
  var STRENGTH_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  function positionStrength(teams, slots, pts) {
    var starters = (slots || []).filter(function (s) { return !NOT_STARTERS[s]; });
    var out = (teams || []).map(function (t) {
      var pool = (t.roster || []).filter(function (p) { return !p.held && p.pos !== 'PICK'; })
        .map(function (p) { return {id: p.id, pos: p.pos, pts: Number(pts(p)) || 0}; });
      var byPos = {}, used = {};
      bestByPoints(pool, starters).forEach(function (p) {
        if (!p) return;
        used[p.id] = 1;
        (byPos[p.pos] = byPos[p.pos] || {start: 0, depth: 0}).start += p.pts;
      });
      pool.forEach(function (p) {
        if (used[p.id]) return;
        var c = byPos[p.pos] = byPos[p.pos] || {start: 0, depth: 0};
        if (p.pts > c.depth) c.depth = p.pts;
      });
      return {id: String(t.id), byPos: byPos};
    });
    var n = out.length, third = Math.floor(n / 3);
    var positions = STRENGTH_POS.filter(function (pos) {
      return starters.some(function (s) { return slotFits(s, pos); }) &&
        out.some(function (t) { return t.byPos[pos] && t.byPos[pos].start > 0; });
    });
    positions.forEach(function (pos) {
      var score = function (t) { var c = t.byPos[pos] || {start: 0, depth: 0}; return c.start + 0.25 * c.depth; };
      out.slice().sort(function (a, b) { return score(b) - score(a); }).forEach(function (t, i) {
        var c = t.byPos[pos] = t.byPos[pos] || {start: 0, depth: 0};
        c.rank = i + 1;
        c.grade = i < third ? 'deep' : i >= n - third ? 'thin' : 'mid';
      });
    });
    return {teams: out, positions: positions, n: n};
  }

  var ROUND_NAME = ['', '1st', '2nd', '3rd', '4th'];
  /* Who owns which future draft picks in a Sleeper league: every team its own, moved by
     Sleeper's traded picks ({season, round, roster_id: the team it started with, owner_id:
     the team holding it now}). Seasons and rounds are the ones FantasyCalc prices (rounds
     1 to 4). Where a future pick will fall isn't known, so it takes FantasyCalc's plain
     value for its season and round (vid FP_2027_1). */
  function draftPicks(rosterIds, traded, seasons, rounds) {
    var owner = {}, out = {};
    rounds = Math.min(Number(rounds) || 4, 4);
    rosterIds.forEach(function (r) {
      out[r] = [];
      seasons.forEach(function (y) { for (var n = 1; n <= rounds; n++) owner[y + '|' + n + '|' + r] = r; });
    });
    (traded || []).forEach(function (t) {
      var k = t.season + '|' + t.round + '|' + t.roster_id;
      if (owner[k] !== undefined && out[t.owner_id]) owner[k] = t.owner_id;
    });
    Object.keys(owner).forEach(function (k) {
      var bits = k.split('|'), y = bits[0], n = Number(bits[1]), from = Number(bits[2]);
      out[owner[k]].push({id: 'pick:' + y + ':' + n + ':' + from, vid: 'FP_' + y + '_' + n, name: y + ' ' + ROUND_NAME[n],
        pos: 'PICK', season: y, round: n, from: from});
    });
    rosterIds.forEach(function (r) {
      out[r].sort(function (a, b) { return a.season - b.season || a.round - b.round || a.from - b.from; });
    });
    return out;
  }

  /* ------------------------------------------------------------ transactions */

  /* A Sleeper league's completed transactions, newest first, for the Transactions tab:
     {id, kind ('trade', 'waiver', 'free_agent' or 'commissioner'), at, week, bid, mine, sides},
     where each side is a team involved, with the players it added and dropped, the draft
     picks it received (another team's pick is labelled with whose it was) and the waiver
     budget it got or sent. names: {rosterId: team name}; myRoster marks the person's moves. */
  var ROUND_LABEL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
  function transactionsFrom(list, names, players, myRoster) {
    names = names || {};
    var team = function (r) { return names[r] || ('Team ' + r); };
    return (list || []).filter(function (t) { return t && t.status === 'complete'; }).map(function (t) {
      var sides = {}, order = [];
      var side = function (r) {
        r = String(r);
        if (!sides[r]) { sides[r] = {roster: r, name: team(r), adds: [], drops: [], picks: [], budgetIn: 0, budgetOut: 0}; order.push(r); }
        return sides[r];
      };
      var who = function (id) { var info = playerInfo(players, id); return {id: String(id), name: info.name, pos: info.pos, team: info.team}; };
      (t.roster_ids || []).forEach(side);
      Object.keys(t.adds || {}).forEach(function (id) { side(t.adds[id]).adds.push(who(id)); });
      Object.keys(t.drops || {}).forEach(function (id) { side(t.drops[id]).drops.push(who(id)); });
      (t.draft_picks || []).forEach(function (p) {
        var whose = String(p.roster_id) !== String(p.owner_id) ? ' (' + team(p.roster_id) + '\'s)' : '';
        side(p.owner_id).picks.push(p.season + ' ' + (ROUND_LABEL[p.round] || 'round ' + p.round) + whose);
      });
      (t.waiver_budget || []).forEach(function (b) {
        side(b.receiver).budgetIn += Number(b.amount) || 0;
        side(b.sender).budgetOut += Number(b.amount) || 0;
      });
      return {id: String(t.transaction_id || ''), kind: t.type || '', at: Number(t.status_updated || t.created) || 0, week: Number(t.leg) || 0,
        bid: t.settings && t.settings.waiver_bid !== undefined ? Number(t.settings.waiver_bid) : null,
        mine: order.indexOf(String(myRoster)) >= 0, sides: order.map(function (r) { return sides[r]; })};
    }).sort(function (a, b) { return b.at - a.at; });
  }

  /* ------------------------------------------------------------ game context */

  var round1 = function (x) { return Math.round(x * 10) / 10; };
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  // Each side's expected points from a game's betting line: the over/under split by the home
  // team's spread (negative when the home team is favored). Null without a full line.
  function impliedTotals(game) {
    if (!game || game.total === null || game.total === undefined || game.spread === null || game.spread === undefined) return null;
    return {home: round1((game.total - game.spread) / 2), away: round1((game.total + game.spread) / 2)};
  }

  /* Fantasy points (full PPR) each defense gives up to each position per game, from nflverse's
     weekly player stats (rows as splitRows gives them, header first; regular season only),
     ranked 1 (gives up the most: a soft matchup) down. {teams: {TEAM: {QB: {avg, rank}, ...}}, weeks}. */
  var DVP_POS = {QB: 1, RB: 1, WR: 1, TE: 1};
  function dvpFrom(rows) {
    var h = (rows && rows[0]) || [], i = {};
    h.forEach(function (c, k) { i[String(c).trim()] = k; });
    if (['position', 'week', 'season_type', 'opponent_team', 'fantasy_points_ppr'].some(function (c) { return i[c] === undefined; })) return {teams: {}, weeks: 0};
    var sum = {}, weeks = {};
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r], pos = row[i.position], team = teamAbbr(row[i.opponent_team]), wk = row[i.week];
      if (row[i.season_type] !== 'REG' || !DVP_POS[pos] || !team || !wk) continue;
      weeks[wk] = 1;
      var k = team + '|' + pos;
      (sum[k] = sum[k] || {})[wk] = (sum[k][wk] || 0) + (Number(row[i.fantasy_points_ppr]) || 0);
    }
    var out = {};
    Object.keys(DVP_POS).forEach(function (pos) {
      Object.keys(sum).filter(function (k) { return k.split('|')[1] === pos; }).map(function (k) {
        var v = Object.keys(sum[k]).map(function (w) { return sum[k][w]; });
        return {team: k.split('|')[0], avg: v.reduce(function (a, b) { return a + b; }, 0) / v.length};
      }).sort(function (a, b) { return b.avg - a.avg; }).forEach(function (x, n) {
        (out[x.team] = out[x.team] || {})[pos] = {avg: round1(x.avg), rank: n + 1};
      });
    });
    return {teams: out, weeks: Object.keys(weeks).length};
  }

  /* A player's game context for his row on Lineups ([{text, tone}]): who he plays (opts.opp),
     his team's expected points (a defense: the opponent's), how soft or tough his matchup is
     (the opponent's rank for points given up to his position: the top or bottom eight), and
     weather worth knowing (wind from 15 mph, rain or snow from 50%, 25°F or colder). ctx is
     the server's /api/game-context. */
  function gameTags(ctx, p, opts) {
    var t = ctx && ctx.teams && p && ctx.teams[teamAbbr(p.team)];
    if (!t) return [];
    var out = [], opp = ctx.teams[t.opp] || {}, n = 32;
    if (opts && opts.opp) out.push({text: (t.home ? 'vs ' : '@ ') + t.opp, tone: ''});
    if (p.pos === 'DEF') {
      if (opp.implied) out.push({text: t.opp + ' expected ' + opp.implied + ' pts', tone: opp.implied <= 18 ? 'good' : opp.implied >= 26 ? 'amber' : ''});
    } else if (t.implied) {
      out.push({text: 'team expected ' + t.implied + ' pts', tone: t.implied >= 27 ? 'good' : t.implied <= 18 ? 'amber' : ''});
    }
    var d = ctx.dvp && ctx.dvp[t.opp] && ctx.dvp[t.opp][p.pos];
    if (d && d.rank <= 8) out.push({text: 'soft matchup: ' + t.opp + ' gives up the ' + ordinal(d.rank) + ' most to ' + p.pos + 's', tone: 'good'});
    else if (d && d.rank > n - 8) out.push({text: 'tough matchup: ' + t.opp + ' gives up the ' + ordinal(n + 1 - d.rank) + ' fewest to ' + p.pos + 's', tone: 'amber'});
    var w = t.weather;
    if (w) {
      if (w.wind >= 15) out.push({text: 'wind ' + w.wind + ' mph', tone: 'amber'});
      if (w.precip >= 50) out.push({text: (/snow/i.test(w.text || '') ? 'snow ' : 'rain ') + w.precip + '%', tone: 'amber'});
      if (typeof w.temp === 'number' && w.temp <= 25) out.push({text: w.temp + '° at kickoff', tone: 'amber'});
    }
    return out;
  }

  /* ------------------------------------------------------------ standings */

  // A seeded random number source (mulberry32), so the same league gives the same odds every time.
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rand) { return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()); }

  /* A league's standings, all-play records, luck, power rankings and playoff odds.
     teams: [{id, name}]; games: the regular season's [{week, a, b, aPts, bPts, done}]
     (a and b are team ids); proj: {teamId: this week's projected points for the team's
     best lineup} (optional); opts: {playoffTeams, sims, seed}.
     - Records and points come from the games played (a tie is half a win). Seeds go by
       wins, then points for, as Sleeper and ESPN break ties by default.
     - All-play: each week, a team's score against every other team's that week. Luck is
       actual wins minus the wins that all-play rate would have given.
     - The games left are simulated `sims` times: each team scores around its expected
       points (its average so far, with this week's projection counting like four games),
       give or take the league's usual swing (18% of an average score). Division winners
       aren't modeled.
     - Power ranks all-play rate, points per game and expected points, each against the
       league (before any games, expected points alone). */
  function standings(teams, games, proj, opts) {
    opts = opts || {};
    proj = proj || {};
    var ids = teams.map(function (t) { return String(t.id); }), T = {}, byWeek = {};
    teams.forEach(function (t) {
      T[String(t.id)] = {id: String(t.id), name: t.name, w: 0, l: 0, t: 0, pf: 0, pa: 0, g: 0, apW: 0, apL: 0, apT: 0};
    });
    (games || []).forEach(function (m) {
      var a = T[String(m.a)], b = T[String(m.b)];
      if (!a || !b || !m.done) return;
      var ap = Number(m.aPts) || 0, bp = Number(m.bPts) || 0;
      a.g++; b.g++; a.pf += ap; b.pf += bp; a.pa += bp; b.pa += ap;
      if (ap > bp) { a.w++; b.l++; } else if (bp > ap) { b.w++; a.l++; } else { a.t++; b.t++; }
      var wk = byWeek[m.week] = byWeek[m.week] || {};
      wk[a.id] = ap; wk[b.id] = bp;
    });
    Object.keys(byWeek).forEach(function (week) {
      var s = byWeek[week], who = Object.keys(s);
      who.forEach(function (x) {
        who.forEach(function (y) {
          if (x === y) return;
          if (s[x] > s[y]) T[x].apW++; else if (s[x] < s[y]) T[x].apL++; else T[x].apT++;
        });
      });
    });

    var played = ids.filter(function (i) { return T[i].g; });
    var avgOf = function (list) { return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : 0; };
    var leagueAvg = avgOf(played.map(function (i) { return T[i].pf / T[i].g; })) ||
      avgOf(ids.map(function (i) { return Number(proj[i]) || 0; }).filter(function (v) { return v > 0; })) || 100;
    ids.forEach(function (i) {
      var t = T[i], p = Number(proj[i]) || 0, wP = p ? 4 : 0;
      t.mean = wP + t.g ? (p * wP + t.pf) / (wP + t.g) : leagueAvg;
    });
    var sd = Math.min(35, Math.max(12, 0.18 * leagueAvg));

    var left = (games || []).filter(function (m) { return !m.done && T[String(m.a)] && T[String(m.b)]; });
    var n = Math.max(1, opts.sims || 5000), spots = Math.min(opts.playoffTeams || 6, ids.length), rand = seeded(opts.seed || 7);
    ids.forEach(function (i) { T[i].inN = 0; T[i].topN = 0; T[i].winSum = 0; });
    for (var k = 0; k < n; k++) {
      var w = {}, pf = {};
      ids.forEach(function (i) { w[i] = T[i].w + T[i].t / 2; pf[i] = T[i].pf; });
      left.forEach(function (m) {
        var a = String(m.a), b = String(m.b);
        var ap = T[a].mean + sd * normal(rand), bp = T[b].mean + sd * normal(rand);
        pf[a] += ap; pf[b] += bp;
        w[ap > bp ? a : b]++;
      });
      ids.slice().sort(function (x, y) { return w[y] - w[x] || pf[y] - pf[x]; }).forEach(function (i, at) {
        if (at < spots) T[i].inN++;
        if (at === 0) T[i].topN++;
        T[i].winSum += w[i];
      });
    }

    var z = function (vals) {
      var m = avgOf(vals), s = Math.sqrt(avgOf(vals.map(function (v) { return (v - m) * (v - m); }))) || 1;
      return vals.map(function (v) { return (v - m) / s; });
    };
    var zA = z(ids.map(function (i) { var t = T[i], g = t.apW + t.apL + t.apT; return g ? (t.apW + t.apT / 2) / g : 0.5; }));
    var zP = z(ids.map(function (i) { return T[i].g ? T[i].pf / T[i].g : T[i].mean; }));
    var zE = z(ids.map(function (i) { return T[i].mean; }));
    var out = ids.map(function (i, j) {
      var t = T[i], apG = t.apW + t.apL + t.apT;
      return {id: i, name: t.name, wins: t.w, losses: t.l, ties: t.t, games: t.g, pf: round2(t.pf), pa: round2(t.pa),
        allPlay: {w: t.apW, l: t.apL, t: t.apT}, luck: apG ? round2(t.w + t.t / 2 - (t.apW + t.apT / 2) / apG * t.g) : 0,
        expected: round2(t.mean), power: played.length ? 0.5 * zA[j] + 0.3 * zP[j] + 0.2 * zE[j] : zE[j],
        playoffs: t.inN / n, top: t.topN / n, projWins: round2(t.winSum / n)};
    });
    out.slice().sort(function (a, b) { return b.power - a.power; }).forEach(function (r, x) { r.powerRank = x + 1; });
    // Standings order: wins, then points; before any games (all even), projected strength.
    out.sort(function (a, b) { return (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf || b.power - a.power; })
      .forEach(function (r, x) { r.seed = x + 1; });
    return {teams: out, spots: spots, sims: n, left: left.length};
  }

  function slotLabel(slot) { return SLOT_LABEL[slot] || slot; }

  /* ------------------------------------------------------------- ranks */

  /* CSV or TSV (a copy out of a spreadsheet is tab-separated). Handles quoted
     fields, CRLF and a byte-order mark. */
  function splitRows(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var sample = text.slice(0, 6000);
    var delim = (sample.split('\t').length > sample.split(',').length) ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') {
        q = true;
      } else if (ch === delim) {
        row.push(cell); cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  var HEADERS = {player: 'player', name: 'player', playername: 'player', pos: 'pos', position: 'pos',
    team: 'team', rank: 'rank', rk: 'rank', wkrank: 'rank', overall: 'rank', opp: 'opp', opponent: 'opp', matchup: 'opp',
    implied: 'implied', tier: 'tier', tiers: 'tier', posrank: 'posRank'};

  function num(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function cell(row, j) {
    return j === undefined ? '' : String(row[j] == null ? '' : row[j]).trim();
  }

  // Some exports name defences by full team name.
  var TEAM_NAMES = {
    'arizona cardinals': 'ARI', 'atlanta falcons': 'ATL', 'baltimore ravens': 'BAL', 'buffalo bills': 'BUF',
    'carolina panthers': 'CAR', 'chicago bears': 'CHI', 'cincinnati bengals': 'CIN', 'cleveland browns': 'CLE',
    'dallas cowboys': 'DAL', 'denver broncos': 'DEN', 'detroit lions': 'DET', 'green bay packers': 'GB',
    'houston texans': 'HOU', 'indianapolis colts': 'IND', 'jacksonville jaguars': 'JAX', 'kansas city chiefs': 'KC',
    'las vegas raiders': 'LV', 'los angeles chargers': 'LAC', 'los angeles rams': 'LAR', 'miami dolphins': 'MIA',
    'minnesota vikings': 'MIN', 'new england patriots': 'NE', 'new orleans saints': 'NO', 'new york giants': 'NYG',
    'new york jets': 'NYJ', 'philadelphia eagles': 'PHI', 'pittsburgh steelers': 'PIT', 'san francisco 49ers': 'SF',
    'seattle seahawks': 'SEA', 'tampa bay buccaneers': 'TB', 'tennessee titans': 'TEN', 'washington commanders': 'WAS'
  };
  var NICKNAMES = {};
  for (var full in TEAM_NAMES) NICKNAMES[full.split(' ').pop()] = TEAM_NAMES[full];

  function defTeam(s) {
    var t = String(s || '').replace(/\s*(d\/st|dst|defense|def)$/i, '').trim();
    if (/^[A-Za-z]{2,3}$/.test(t)) return teamAbbr(t);
    var low = t.toLowerCase();
    return TEAM_NAMES[low] || NICKNAMES[low.split(' ').pop()] || '';
  }

  /* Wide exports (Late-Round's, for one): every position's table side by side —
     "QB Rank","QB Player",…,"FLEX Rank","FLEX Player",…,"K Rank",… RB/WR/TE take
     their rank from the FLEX table, and anyone not in it gets 1000 + positional
     rank. Implied is the team total, except DEF (the spread) and K (the projection). */
  function parseWide(lines, hi) {
    var groups = {};
    lines[hi].forEach(function (h, j) {
      var m = String(h).trim().match(/^(QB|RB|WR|TE|K|DEF|DST|FLEX)\s+(.+)$/i);
      if (!m) return;
      var g = m[1].toUpperCase() === 'DST' ? 'DEF' : m[1].toUpperCase();
      (groups[g] = groups[g] || {})[m[2].toLowerCase().replace(/[^a-z]/g, '')] = j;
    });

    var flex = null, i;
    if (groups.FLEX && groups.FLEX.rank !== undefined && groups.FLEX.player !== undefined) {
      flex = {};
      for (i = hi + 1; i < lines.length; i++) {
        var fn = cell(lines[i], groups.FLEX.player), fr = num(cell(lines[i], groups.FLEX.rank));
        if (fn && fr !== null) flex[norm(fn)] = fr;
      }
    }

    var rows = [], skipped = [];
    ['QB', 'RB', 'WR', 'TE', 'DEF', 'K'].forEach(function (pos) {
      var g = groups[pos];
      if (!g || g.rank === undefined) return;
      for (var k = hi + 1; k < lines.length; k++) {
        var r = lines[k], name, team;
        if (pos === 'DEF') {
          var raw = cell(r, g.team !== undefined ? g.team : g.player);
          if (!raw) continue;
          team = defTeam(raw);
          if (!team) { skipped.push({line: k + 1, text: raw, why: 'unknown team'}); continue; }
          name = team + ' D/ST';
        } else {
          name = cell(r, g.player);
          if (!name) continue;
          team = teamAbbr(cell(r, g.team));
        }
        var posRank = num(cell(r, g.rank));
        if (posRank === null) { skipped.push({line: k + 1, text: name, why: 'no rank'}); continue; }
        var rank = posRank;
        if (SLOT_POS.FLEX[pos] && flex) rank = flex[norm(name)] !== undefined ? flex[norm(name)] : 1000 + posRank;
        var implied = num(cell(r, pos === 'DEF' ? g.spread : pos === 'K' ? g.projection : g.total));
        var tier = num(cell(r, g.tier));
        rows.push({name: name, pos: pos, team: team, rank: rank, opp: teamAbbr(cell(r, g.opponent)),
          implied: implied === null ? '' : implied, tier: tier === null ? '' : tier, posRank: posRank});
      }
    });
    return {rows: rows, skipped: skipped, format: 'wide',
      error: rows.length ? '' : 'Found the position columns but no player rows.'};
  }

  /* The position a single-position file ranks, from its name, for example
     FantasyPros_2026_Week_1_QB_Rankings.csv. FLEX files carry their own
     positions, so they need no hint. */
  function positionHint(filename) {
    var m = String(filename || '').toUpperCase().match(/(^|[^A-Z])(QB|RB|WR|TE|K|DST|DEF|FLEX)(?=[^A-Z]|$)/);
    if (!m || m[2] === 'FLEX') return '';
    return m[2] === 'DST' ? 'DEF' : m[2];
  }

  /* One row per player: Player, Pos, Team, Rank, then optional Opp, Implied,
     Tier, Pos Rank. Rank is the overall (FLEX) rank for RB/WR/TE and the
     positional rank for QB/K/DEF. Header row optional; columns found by name.
     Also reads FantasyPros exports: RK, PLAYER NAME, TEAM, OPP ("at IND"), with
     either a POS column like "RB12" (the FLEX file, where RK is the overall rank)
     or no position column at all (one file per position; `opts.pos` says which). */
  function parseRanks(text, opts) {
    opts = opts || {};
    var lines = splitRows(text);
    var cols = {player: 0, pos: 1, team: 2, rank: 3, opp: 4, implied: 5, tier: 6, posRank: 7};
    var start = 0, header = [], i;
    for (i = 0; i < Math.min(lines.length, 15); i++) {
      var low = lines[i].map(function (c) { return String(c).trim().toLowerCase(); });
      if (low.some(function (c) { return /^(qb|rb|wr|te|k|def|dst|flex) rank$/.test(c); })) return parseWide(lines, i);
      if (!low.some(function (c) { return c === 'player' || c === 'name' || c === 'player name'; })) continue;
      cols = {};
      low.forEach(function (h, j) {
        var key = h.replace(/[^a-z]/g, '');
        // Exports name the position column differently ("Fantsy Position" in The Hall's).
        var k = HEADERS[key] || (/position$/.test(key) ? 'pos' : '');
        if (k && cols[k] === undefined) cols[k] = j;
      });
      header = low;
      start = i + 1;
      break;
    }
    var fixedPos = String(opts.pos || '').toUpperCase();
    if (fixedPos === 'DST' || fixedPos === 'D/ST') fixedPos = 'DEF';
    if (cols.player === undefined || cols.rank === undefined) {
      return {rows: [], skipped: [], error: 'Could not find the Player and Rank columns.'};
    }
    var single = cols.pos === undefined;
    if (single && !POSITIONS[fixedPos]) {
      return {rows: [], skipped: [], needsPosition: true,
        error: 'This file has no position column. Choose the position it ranks.'};
    }
    var fantasyPros = header.indexOf('player name') >= 0 && header.indexOf('rk') >= 0;
    var rows = [], skipped = [];
    for (i = start; i < lines.length; i++) {
      var r = lines[i];
      var name = String(r[cols.player] || '').trim();
      if (!name) continue;
      var rawPos = single ? fixedPos : String(r[cols.pos] || '').trim().toUpperCase();
      var pm = rawPos.match(/^(QB|RB|WR|TE|K|DEF|DST|D\/ST)(\d+)?$/);
      var pos = pm ? (pm[1] === 'DST' || pm[1] === 'D/ST' ? 'DEF' : pm[1]) : rawPos;
      if (!POSITIONS[pos]) {
        skipped.push({line: i + 1, text: name, why: pos ? 'position ' + pos : 'no position'});
        continue;
      }
      if (pos === 'DEF' && !/D\/ST$/.test(name)) {
        var abbr = defTeam(name) || teamAbbr(r[cols.team]);
        if (abbr) name = abbr + ' D/ST';
      }
      var implied = num(r[cols.implied]), tier = num(r[cols.tier]), rank = num(r[cols.rank]);
      rows.push({
        name: name,
        pos: pos,
        team: teamAbbr(r[cols.team]),
        rank: rank,
        // "at IND", "vs. TB", "@IND" and "@ IND" all mean the opponent is IND.
        opp: teamAbbr(String(r[cols.opp] == null ? '' : r[cols.opp]).trim().replace(/^(?:at\s+|vs\.?\s+|@\s*)/i, '')),
        implied: implied === null ? '' : implied,
        tier: tier === null ? '' : tier,
        posRank: cols.posRank !== undefined ? num(r[cols.posRank]) : pm && pm[2] ? Number(pm[2]) : single ? rank : null
      });
    }
    // RB, WR and TE share FLEX slots, so a positional list (RB1, RB2, ...) can't
    // be compared fairly with the other two.
    var warning = single && SLOT_POS.FLEX[fixedPos]
      ? 'These ' + fixedPos + ' ranks are positional, so FLEX slots can\'t compare them fairly with other positions. ' +
        'For RB, WR and TE, FantasyPros\' FLEX rankings work best.'
      : '';
    // Known exports get named in the import message.
    var source = fantasyPros ? 'FantasyPros' : header.indexOf('3d proj') >= 0 ? 'The Hall' : '';
    return {rows: rows, skipped: skipped, format: fantasyPros ? 'fantasypros' : single ? 'single' : 'rows', source: source,
      position: single ? fixedPos : '', warning: warning, error: rows.length ? '' : 'No player rows found.'};
  }

  /* A file replaces only the positions it ranks and keeps the rest of the week,
     so FantasyPros' per-position files add up, and a file without K or DEF (like
     the OP list) leaves the saved K and DEF ranks alone. */
  function mergeRanks(prevRows, newRows) {
    var c = rankCounts(newRows);
    var positions = Object.keys(c);
    var kept = (prevRows || []).filter(function (r) { return !c[r.pos]; });
    return {rows: kept.length ? kept.concat(newRows) : newRows, merged: kept.length > 0, positions: positions};
  }

  function weeklyMap(rows) {
    var map = {};
    (rows || []).forEach(function (w) {
      map[norm(w.name)] = {name: w.name, pos: w.pos, team: w.team, rank: w.rank,
        opp: w.opp, implied: w.implied, tier: w.tier};
    });
    return map;
  }

  function rankCounts(rows) {
    var c = {};
    (rows || []).forEach(function (w) { c[w.pos] = (c[w.pos] || 0) + 1; });
    return c;
  }

  /* --------------------------------------------------- default rankings */

  /* Rankings for a week with none imported, and for positions an import leaves
     out: Sleeper's weekly projections (RotoWire's numbers) in one league's
     scoring. QB, RB, WR and TE share one overall scale, so FLEX and superflex
     spots compare projected points, as an overall rankings file does; K and DEF
     each rank on their own. A player projected for nothing stays unranked.
     `players` is the trimmed player list (trimPlayers). */
  var DEFAULT_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  var OVERALL = {QB: 1, RB: 1, WR: 1, TE: 1};
  function defaultRanks(projMap, players, ppr) {
    var list = [], seen = {}, count = {}, out = [];
    for (var id in projMap || {}) {
      var info = playerInfo(players, id);
      if (DEFAULT_POS.indexOf(info.pos) < 0) continue;
      var pts = projFor(projMap, id, ppr);
      if (pts > 0) list.push({name: info.name, pos: info.pos, team: info.team, pts: pts});
    }
    list.sort(function (a, b) { return b.pts - a.pts || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    list.forEach(function (x) {
      // Rankings are keyed by name: of two players sharing one, the one projected higher keeps it.
      var k = norm(x.name);
      if (seen[k]) return;
      seen[k] = 1;
      var scale = OVERALL[x.pos] ? 'overall' : x.pos;
      count[scale] = (count[scale] || 0) + 1;
      out.push({name: x.name, pos: x.pos, team: x.team, rank: count[scale], opp: '', implied: '', tier: '', proj: x.pts});
    });
    return out;
  }

  /* The rankings each league plays by: the week's imported rows, with default
     rows for every position they leave out (all of them when nothing is
     imported). Returns a function of a league's settings, for analyzeAll and
     scoreWeek, that builds each scoring value's map once. Without projections
     there are no defaults, only the imported rows. */
  function rankingsBy(rows, projMap, players) {
    var have = rankCounts(rows);
    var fill = !!projMap && Object.keys(projMap).length > 0 && DEFAULT_POS.some(function (p) { return !have[p]; });
    var plain = null, byPpr = {};
    return function (cfg) {
      if (!fill) return plain || (plain = weeklyMap(rows));
      var ppr = Number(cfg && cfg.ppr) || 0;
      if (!byPpr[ppr]) {
        var gaps = defaultRanks(projMap, players, ppr).filter(function (r) { return !have[r.pos]; });
        // The imported rows go last, so on a shared name the import wins.
        byPpr[ppr] = weeklyMap(gaps.concat(rows || []));
      }
      return byPpr[ppr];
    };
  }

  /* ------------------------------------------------------------- games */

  /* Per-team game state for the week, from Sleeper's own schedule. Sleeper locks
     each player at HIS OWN game's kickoff, and everything unlocks when the new
     fantasy week opens Tuesday. */
  function gameStates(schedule, week) {
    var map = {};
    (schedule || []).forEach(function (g) {
      if (Number(g.week) !== Number(week)) return;
      var st = String(g.status || 'pre_game');
      [g.home, g.away].forEach(function (ab) {
        if (ab) map[teamAbbr(ab)] = {state: st === 'pre_game' ? 'pre' : st, kick: g.date || ''};
      });
    });
    return map;
  }

  function weekProgress(schedule, week) {
    var total = 0, started = 0, done = 0;
    (schedule || []).forEach(function (g) {
      if (Number(g.week) !== Number(week)) return;
      total++;
      var st = String(g.status || 'pre_game');
      if (st !== 'pre_game') started++;
      if (st === 'complete') done++;
    });
    return {total: total, started: started, done: done};
  }

  function etDate(ms) { return new Date(ms).toLocaleDateString('en-CA', {timeZone: 'America/New_York'}); }
  function addDays(ymd, n) {
    var d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* The week the lineup screens are about. Once every game of `week` is over
     and the Tuesday after its last game has come (Eastern time), the next week
     takes over, even if Sleeper hasn't moved on yet: scores clear and the next
     week's projections show. A game still to be played holds the week. */
  function effectiveWeek(week, schedule, now) {
    week = Number(week) || 1;
    var games = (schedule || []).filter(function (g) { return Number(g.week) === week; });
    var lastWeek = 0;
    (schedule || []).forEach(function (g) { if (Number(g.week) > lastWeek) lastWeek = Number(g.week); });
    if (!games.length || week >= lastWeek) return week;
    var today = etDate(now || Date.now()), last = '';
    for (var i = 0; i < games.length; i++) {
      var st = String(games[i].status || 'pre_game'), date = String(games[i].date || '');
      if (st === 'in_game') return week;
      if (st !== 'complete' && date >= today) return week;
      if (date > last) last = date;
    }
    if (!last) return week;
    var tuesday = addDays(last, 1);
    while (new Date(tuesday + 'T12:00:00Z').getUTCDay() !== 2) tuesday = addDays(tuesday, 1);
    return today >= tuesday ? week + 1 : week;
  }

  /* Each side's chance to win a matchup, from points so far and what's still to
     come. A player whose game is over counts his points; one still playing, his
     points plus half of whatever his projection still expects; one yet to play,
     his projection. Points still to come are uncertain (a spread of 0.6 times
     each player's expected remaining points), so the chance heads to 100% as
     games end. Each side is a list of {pts, proj, state}. */
  function winProbability(a, b) {
    function side(list) {
      var exp = 0, v = 0;
      (list || []).forEach(function (p) {
        if (!p) return;
        var pts = Number(p.pts) || 0, proj = Number(p.proj) || 0, rem;
        if (p.state === 'complete') rem = 0;
        else if (p.state === 'in_game') rem = Math.max(0, proj - pts) * 0.5;
        else rem = proj;
        exp += (p.state === 'complete' || p.state === 'in_game' ? pts : 0) + rem;
        v += Math.pow(0.6 * rem, 2);
      });
      return {exp: exp, v: v};
    }
    var A = side(a), B = side(b), sd = Math.sqrt(A.v + B.v), d = A.exp - B.exp;
    var pa = sd < 0.01 ? (d > 0 ? 1 : d < 0 ? 0 : 0.5) : normCdf(d / sd);
    return {a: pa, b: 1 - pa, expA: round2(A.exp), expB: round2(B.exp)};
  }

  // The standard normal distribution's CDF (Abramowitz and Stegun 26.2.17).
  function normCdf(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var p = 0.3989423 * Math.exp(-z * z / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  /* A new rankings file usually leaves out players whose games are already
     over. Rostered players whose game has started keep the rank they had in the
     rankings being replaced, so they don't turn "unranked" halfway through a
     week. `startedNames` is keyed by norm(name). Returns the rows to keep. */
  function keepStartedRanks(newRows, oldRows, startedNames) {
    var have = {}, keep = [];
    (newRows || []).forEach(function (r) { have[norm(r.name)] = 1; });
    (oldRows || []).forEach(function (r) {
      var k = norm(r.name);
      if (startedNames[k] && !have[k]) { keep.push(r); have[k] = 1; }
    });
    return keep;
  }

  /* Real points, in the league's own scoring, for players whose game has
     started; everyone else's stay empty. `points` is keyed by Sleeper player id,
     or by ESPN player id when `byEspn`. */
  function applyPoints(d, points, byEspn) {
    var n = 0;
    d.roster.forEach(function (p) {
      var v = points ? points[byEspn ? p.espnId : p.id] : undefined;
      p.pts = p.locked && v !== undefined && v !== null && isFinite(Number(v)) ? round2(Number(v)) : null;
      if (p.pts !== null) n++;
    });
    return n;
  }

  /* ------------------------------------------------------ start/sit core */

  function rankKey(p) {
    // ONLY the imported rank orders players. Unranked always sits last, and
    // anyone tagged Out/Doubtful/IR sits below even the unranked — the optimiser
    // must never hand you an injured player as a recommendation.
    var base = (p.rank === null || p.rank === undefined) ? 100000 : Number(p.rank);
    return p.outish || p.onBye ? 900000 + base : base;
  }

  /* Ranks at 1000+ are the "outside the overall top 100" sentinel; the real
     positional rank is what is left when you subtract it. Never show the raw
     number — TE1021 means nothing, TE21 does. */
  function rankLabel(pos, rank) {
    if (rank === null || rank === undefined) return 'unranked';
    return pos + (rank >= 1000 ? (rank - 1000) : rank);
  }

  function slotFits(slot, pos) {
    var s = SLOT_POS[slot];
    return s ? !!s[pos] : slot === pos;
  }

  function optimal(roster, slots) {
    var sorted = roster.slice().sort(function (a, b) { return rankKey(a) - rankKey(b); });
    var picked = new Array(slots.length), used = {}, s, j;

    // 1. A locked player already in the lineup cannot be taken out. He keeps the
    //    slot Sleeper has him in.
    sorted.forEach(function (p) {
      if (!p.locked || !p.start || used[p.id]) return;
      var want = -1;
      for (s = 0; s < slots.length; s++) {
        if (!picked[s] && p.slot && slots[s] === p.slot) { want = s; break; }
      }
      if (want < 0) {
        for (s = 0; s < slots.length; s++) {
          if (!picked[s] && slotFits(slots[s], p.pos)) { want = s; break; }
        }
      }
      if (want >= 0) { picked[want] = p; used[p.id] = 1; }
    });

    // 2. Fill what is left by rank. A locked player who is NOT already starting
    //    can no longer be added, so he is skipped entirely.
    for (s = 0; s < slots.length; s++) {
      if (picked[s]) continue;
      for (j = 0; j < sorted.length; j++) {
        var c = sorted[j];
        if (used[c.id] || c.locked) continue;
        if (!slotFits(slots[s], c.pos)) continue;
        picked[s] = c; used[c.id] = 1; break;
      }
    }

    var out = [];
    for (s = 0; s < slots.length; s++) out.push({slot: slots[s], p: picked[s] || null});
    return out;
  }

  /* The real lineup, in slot order, straight from Sleeper. */
  function actualLineup(roster, slots) {
    var out = [], usedIds = {}, i;
    var starters = roster.filter(function (p) { return p.start; });
    for (i = 0; i < slots.length; i++) out.push({slot: slots[i], p: null});
    // first pass: the slot Sleeper actually has them in
    starters.forEach(function (p) {
      if (!p.slot) return;
      for (var k = 0; k < out.length; k++) {
        if (!out[k].p && out[k].slot === p.slot) { out[k].p = p; usedIds[p.id] = 1; return; }
      }
    });
    // anything left over drops into the first slot it legally fits
    starters.forEach(function (p) {
      if (usedIds[p.id]) return;
      for (var k = 0; k < out.length; k++) {
        if (!out[k].p && slotFits(out[k].slot, p.pos)) { out[k].p = p; usedIds[p.id] = 1; return; }
      }
    });
    return out;
  }

  /* Players for a list of spots, one each, or null if they can't all be
     filled. Augmenting paths, as in openSlots. */
  function matchSlots(slots, players) {
    var owner = {}, bySlot = new Array(slots.length);
    function assign(s, seen) {
      for (var j = 0; j < players.length; j++) {
        if (seen[j] || !slotFits(slots[s], players[j].pos)) continue;
        seen[j] = 1;
        if (owner[j] === undefined || assign(owner[j], seen)) { owner[j] = s; return true; }
      }
      return false;
    }
    for (var s = 0; s < slots.length; s++) if (!assign(s, {})) return null;
    for (var j in owner) bySlot[owner[j]] = players[j];
    return bySlot;
  }

  /* Titan's lineup with the latest kickoffs in the flex spots (widest first:
     SUPER_FLEX, then FLEX, then W/R and W/T) and earlier starters in their own
     position's spots, so a late scratch can still be covered from the bench.
     Only spots change, never who starts, and players whose game has started
     stay put. A tie keeps the player already in that flex spot, then puts the
     lower-ranked one there. Last, a player who only sits in another spot of
     the same kind (RB1 or RB2) goes back where he is now, so that doesn't show
     as a change. `kickAt(p)` is his kickoff in ms. */
  function flexLate(opt, act, kickAt) {
    var slots = opt.map(function (o) { return o.slot; });
    var out = opt.map(function (o) { return {slot: o.slot, p: o.p}; });
    var actAt = {};
    (act || []).forEach(function (o, i) { if (o.p) actAt[o.p.id] = i; });
    var left = [], people = [];
    out.forEach(function (o, i) { if (o.p && !o.p.locked) { left.push(i); people.push(o.p); } });
    var slotsOf = function (idx) { return idx.map(function (i) { return slots[i]; }); };
    left.filter(function (i) { return FLEX_ORDER[slots[i]]; })
      .sort(function (a, b) { return FLEX_ORDER[slots[b]] - FLEX_ORDER[slots[a]] || a - b; })
      .forEach(function (f) {
        var rest = left.filter(function (i) { return i !== f; });
        var cands = people.filter(function (p) { return slotFits(slots[f], p.pos); }).sort(function (a, b) {
          return kickAt(b) - kickAt(a) || (actAt[b.id] === f) - (actAt[a.id] === f) || rankKey(b) - rankKey(a);
        });
        for (var c = 0; c < cands.length; c++) {
          var others = people.filter(function (p) { return p !== cands[c]; });
          if (matchSlots(slotsOf(rest), others)) { out[f].p = cands[c]; left = rest; people = others; return; }
        }
      });
    var fill = matchSlots(slotsOf(left), people);
    if (!fill) return opt;
    left.forEach(function (i, k) { out[i].p = fill[k]; });
    for (var pass = 0, moved = true; moved && pass < 30; pass++) {
      moved = false;
      for (var i = 0; i < out.length; i++) {
        var p = out[i].p, j = p ? actAt[p.id] : undefined;
        if (j === undefined || j === i || slots[j] !== slots[i]) continue;
        out[i].p = out[j].p; out[j].p = p; moved = true;
      }
    }
    return out;
  }

  /* Each spot whose player should change: who's there now (`out`) and who
     belongs there (`inn`). `from` is the spot a player already starting moves
     over from, and `to` the spot a player leaving this one moves to (empty
     when he goes to the bench). Two starters just trading spots make one
     change, shown at the flex spot: picking the late player there in Sleeper
     swaps the two. */
  function spotMoves(opt, act) {
    var actAt = {}, optAt = {}, moves = [];
    act.forEach(function (o, i) { if (o.p) actAt[o.p.id] = i; });
    opt.forEach(function (o, i) { if (o.p) optAt[o.p.id] = i; });
    opt.forEach(function (o, i) {
      var cur = act[i] ? act[i].p : null;
      if (!o.p || (cur && cur.id === o.p.id)) return;
      var m = {slot: o.slot, out: cur, inn: o.p,
        from: actAt[o.p.id] !== undefined ? act[actAt[o.p.id]].slot : '',
        to: cur && optAt[cur.id] !== undefined ? opt[optAt[cur.id]].slot : ''};
      var twin = -1;
      for (var k = 0; k < moves.length; k++) {
        if (cur && moves[k].out && moves[k].out.id === o.p.id && moves[k].inn.id === cur.id) { twin = k; break; }
      }
      if (twin < 0) moves.push(m);
      else if (FLEX_ORDER[m.slot] && !FLEX_ORDER[moves[twin].slot]) moves[twin] = m;
    });
    return moves;
  }

  /* Best lineup by ACTUAL points, in hindsight. Dedicated slots are filled before
     the flex ones so a flex slot never steals a player the strict slot needed. */
  function bestByPoints(roster, slots) {
    var order = [], i;
    for (i = 0; i < slots.length; i++) order.push({i: i, slot: slots[i]});
    order.sort(function (a, b) { return (FLEX_SLOTS[a.slot] ? 1 : 0) - (FLEX_SLOTS[b.slot] ? 1 : 0); });
    var pool = roster.slice().sort(function (a, b) { return (b.pts || 0) - (a.pts || 0); });
    var used = {}, picked = new Array(slots.length);
    order.forEach(function (o) {
      for (var j = 0; j < pool.length; j++) {
        var p = pool[j];
        if (used[p.id] || !slotFits(o.slot, p.pos)) continue;
        picked[o.i] = p; used[p.id] = 1; return;
      }
    });
    return picked;
  }

  function sumPts(list) {
    var t = 0;
    for (var i = 0; i < list.length; i++) if (list[i]) t += Number(list[i].pts || 0);
    return round2(t);
  }

  function closeCalls(roster, slots, startedIds) {
    var wins = 0, total = 0;
    var starters = roster.filter(function (p) { return startedIds[p.id]; });
    var bench = roster.filter(function (p) { return !startedIds[p.id]; });
    starters.forEach(function (s) {
      if (s.rank === null) return;
      var fits = false;
      for (var i = 0; i < slots.length; i++) if (slotFits(slots[i], s.pos)) { fits = true; break; }
      if (!fits) return;
      bench.forEach(function (b) {
        if (b.rank === null || b.pos !== s.pos) return;
        if (Math.abs(b.rank - s.rank) > CLOSE) return;
        total++;
        if (Number(s.pts || 0) >= Number(b.pts || 0)) wins++;
      });
    });
    return {wins: wins, total: total};
  }

  /* Ranked players nobody in the league rosters, better than the bar, whose game
     hasn't started (`started`: teams already playing or done this week). Returns
     at most `limit`, best rank first. */
  function freeAgents(posSet, weekly, takenNorm, takenAbbr, curRank, limit, started) {
    var out = [];
    for (var k in weekly) {
      var w = weekly[k];
      if (!posSet[w.pos] || w.rank === null) continue;
      if (w.pos === 'DEF' ? takenAbbr[teamAbbr(w.team)] : takenNorm[k]) continue;
      if (started && started[teamAbbr(w.team)]) continue;
      if (curRank !== null && w.rank >= curRank) continue;
      out.push(w);
    }
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out.slice(0, limit || 3);
  }

  /* ------------------------------------------------------ building a league */

  /* One league's roster from Sleeper, plus the names of everyone rostered
     league-wide (what the wire scan treats as taken). */
  function buildLeague(lg, rosters, userId, players) {
    if (!rosters) return {cfg: lg, error: 'could not load'};
    var mine = null;
    for (var r = 0; r < rosters.length; r++) {
      if (isMine(rosters[r], userId)) { mine = rosters[r]; break; }
    }
    if (!mine) return {cfg: lg, error: 'no team found'};

    var ids = mine.players || [];
    var starterArr = (mine.starters || []).map(String);
    var starters = starterArr.filter(function (x) { return x && x !== '0'; });
    var slotOf = {};
    for (var sx = 0; sx < starterArr.length && sx < lg.lineup.length; sx++) {
      if (starterArr[sx] && starterArr[sx] !== '0') slotOf[starterArr[sx]] = lg.lineup[sx];
    }
    // Stashed on IR or the taxi squad: rostered, but can't be started.
    var held = {};
    (mine.reserve || []).forEach(function (x) { held[String(x)] = 'IR'; });
    (mine.taxi || []).forEach(function (x) { held[String(x)] = 'TAXI'; });

    var roster = ids.map(function (id) {
      var info = playerInfo(players, id);
      return {
        id: String(id), name: info.name, pos: info.pos, team: info.team,
        start: starters.indexOf(String(id)) >= 0,
        slot: slotOf[String(id)] || '',
        bye: byeOf(info.team),
        inj: '', outish: false, locked: false, held: !!held[String(id)], heldAs: held[String(id)] || ''
      };
    });

    var takenNorm = {}, takenAbbr = {};
    rosters.forEach(function (x) {
      (x.players || []).forEach(function (id) {
        var info = playerInfo(players, id);
        if (info.pos === 'DEF') takenAbbr[teamAbbr(info.team)] = 1;
        else takenNorm[norm(info.name)] = 1;
      });
    });

    return {cfg: lg, roster: roster, startCount: starters.length, takenNorm: takenNorm, takenAbbr: takenAbbr, rosterId: mine.roster_id};
  }

  /* Fresh injury tags (never cached — a Doubtful tag is only true for one week)
     and, while we have the player, his current team. Returns how many rostered
     players carry a tag. */
  function applyDetails(live, details) {
    var tagged = {};
    live.forEach(function (d) {
      d.roster.forEach(function (p) {
        var x = details[p.id];
        if (x && x.team && x.team !== p.team) { p.team = x.team; p.bye = byeOf(x.team); }
        // A player Sleeper can't look up (an unmatched ESPN or Yahoo player) keeps the tag his league gave him.
        if (x) p.inj = x.inj;
        p.outish = !!(p.inj && INJ_OUT[p.inj.split(' ')[0]]);
        if (p.inj) tagged[p.id] = 1;
      });
    });
    return Object.keys(tagged).length;
  }

  function applyLocks(live, games) {
    var total = 0, teams = [];
    for (var ab in games) if (games[ab].state !== 'pre') teams.push(ab);
    live.forEach(function (d) {
      d.roster.forEach(function (p) {
        var g = games[teamAbbr(p.team)];
        p.locked = !!(g && g.state !== 'pre');
        p.game = g ? g.state : ''; // 'pre', 'in_game' or 'complete'
        p.kick = g ? g.kick : '';  // the game's date (Eastern)
        if (p.locked) total++;
      });
    });
    return {total: total, teams: teams.sort()};
  }

  function attachRanks(roster, weekly) {
    return roster.map(function (p) {
      var w = weekly[norm(p.name)] || null;
      var q = {};
      for (var k in p) q[k] = p[k];
      q.rank = w && w.rank !== null ? w.rank : null;
      q.opp = w ? w.opp : '';
      q.implied = w ? w.implied : '';
      q.tier = w ? w.tier : '';
      return q;
    });
  }

  /* ------------------------------------------------------------ analysis */

  function analyzeLeague(d, weekly, week) {
    var slots = d.cfg.lineup;
    // A player whose team is on bye this week can't score: he's benched like an Out player.
    d.roster.forEach(function (p) { p.onBye = !!week && !!p.bye && Number(p.bye) === Number(week); });
    // With no ranks there is no order to follow, so nothing counts as a swap —
    // otherwise every unranked starter would "lose" to an unranked bench player.
    var ranked = Object.keys(weekly).length > 0;
    var act = actualLineup(d.roster, slots);
    var opt = flexLate(optimal(d.roster, slots), act, d.kickAt || function () { return 0; });
    var optIds = {}, actIds = {};
    opt.forEach(function (o) { if (o.p) optIds[o.p.id] = 1; });
    act.forEach(function (o) { if (o.p) actIds[o.p.id] = 1; });

    var rows = [], stops = 0;
    act.forEach(function (o) {
      if (!o.p) { rows.push({slot: o.slot, p: null, verdict: 'FILL SLOT'}); stops++; return; }
      var p = o.p, verdict = 'OK';
      if (p.onBye) verdict = 'ON BYE';
      else if (p.outish) verdict = 'DO NOT START';
      else if (!optIds[p.id] && ranked) verdict = 'SWAP OUT';
      else if (p.rank === null) verdict = 'UNRANKED';
      if (p.locked) verdict = 'LOCKED';
      if (verdict === 'DO NOT START' || verdict === 'ON BYE') stops++;
      rows.push({slot: o.slot, p: p, verdict: verdict});
    });

    // The changes to make, spot by spot: a new starter, or a starter moving
    // between a flex spot and his position's spot (flexLate). The same players
    // in other spots of the same kind (RB1 and RB2) is no change.
    var moves = !ranked ? [] : spotMoves(opt, act);

    // Wire scan. The bar is the WORST player currently filling a slot of this
    // kind: he is the one a pickup would actually replace. Unranked means anyone
    // ranked wins. A player whose game has started can't be replaced this week,
    // so he never sets the bar (a slot held only by such players gets no
    // suggestion), and a free agent whose game has started can't help either.
    var wire = [];
    WIRE_GROUPS.forEach(function (g) {
      if (slots.indexOf(g.slot) < 0) return;
      var worst = null, anyUnranked = false, held = 0;
      opt.forEach(function (o) {
        if (o.slot !== g.slot || !o.p || o.p.locked) return;
        held++;
        if (o.p.rank === null) { anyUnranked = true; return; }
        if (worst === null || o.p.rank > worst.rank) worst = o.p;
      });
      if (!held) return;
      var bar = anyUnranked ? 100000 : (worst ? worst.rank : null);
      var open = freeAgents(g.set, weekly, d.takenNorm, d.takenAbbr, bar, 3, d.started);
      if (open.length) wire.push({pos: g.label, cur: anyUnranked ? null : worst, anyUnranked: anyUnranked, list: open});
    });

    // Only starters who can still be benched are worth a warning.
    var hurt = d.roster.filter(function (p) { return p.start && p.inj && !p.locked; });
    return {cfg: d.cfg, roster: d.roster, rows: rows, moves: moves, wire: wire, hurt: hurt, stops: stops, opt: opt,
      takenNorm: d.takenNorm, takenAbbr: d.takenAbbr}; // who's rostered in the league (Waivers)
  }

  /* `weekly` is one rankings map for every league, or a function of a league's
     settings that returns its map (rankingsBy). */
  function analyzeAll(snap, weekly) {
    var rankingsFor = typeof weekly === 'function' ? weekly : function () { return weekly; };
    // Teams whose game has kicked off this week: their free agents are no use now.
    var started = {}, games = (snap && snap.games) || {};
    for (var t in games) if (games[t] && games[t].state !== 'pre') started[t] = 1;
    var rankedCount = typeof weekly === 'function' ? 0 : Object.keys(weekly).length;
    // When each player kicks off (ms): the time where it's known, else his game's day.
    var kicks = (snap && snap.kickoffs) || {};
    function kickAt(p) {
      var k = kicks[teamAbbr(p.team)];
      if (k && k[0]) return Number(k[0]) || 0;
      return p.kick ? Date.parse(p.kick + 'T17:00:00Z') || 0 : 0;
    }
    var leagues = ((snap && snap.leagues) || []).map(function (d) {
      var wk = rankingsFor(d.cfg);
      rankedCount = Math.max(rankedCount, Object.keys(wk).length);
      return analyzeLeague({
        cfg: d.cfg, roster: attachRanks(d.roster, wk),
        takenNorm: d.takenNorm || {}, takenAbbr: d.takenAbbr || {}, started: started, kickAt: kickAt
      }, wk, snap && snap.week);
    });

    var changes = [], hurtStarters = [], wireLines = [], stops = 0, locked = 0;
    leagues.forEach(function (L) {
      L.moves.forEach(function (m) { changes.push({league: L.cfg, move: m}); });
      L.hurt.forEach(function (p) { hurtStarters.push({league: L.cfg, p: p}); });
      L.wire.forEach(function (w) { wireLines.push({league: L.cfg, w: w}); });
      stops += L.stops;
      L.roster.forEach(function (p) { if (p.locked) locked++; });
    });

    var log = [rankedCount + ' players in your rankings.'];
    if (!rankedCount) log.push('No rankings yet, so nothing can be ordered. Import your rankings first.');
    if (hurtStarters.length) {
      log.push('', 'INJURY FLAGS on players you are CURRENTLY STARTING:');
      hurtStarters.forEach(function (h) { log.push('   ' + h.league.name + ': ' + h.p.name + ' (' + h.p.inj + ')'); });
    }
    if (wireLines.length) {
      log.push('', 'Waiver-wire upgrades available:');
      wireLines.forEach(function (x) {
        log.push('   ' + x.league.name + ': ' + x.w.pos + ': ' +
          x.w.list.map(function (w) { return w.name + ' (' + rankLabel(w.pos, w.rank) + ')'; }).join(', '));
      });
    }
    log.push('');
    if (changes.length) {
      log.push(changes.length + ' lineup change(s) your rankings want:');
      changes.forEach(function (c) {
        var m = c.move;
        log.push('   ' + c.league.name + ': ' + (m.from ? 'move ' + m.inn.name + ' to ' + slotLabel(m.slot)
          : 'start ' + m.inn.name + ' (' + rankLabel(m.inn.pos, m.inn.rank) + ')'));
      });
      log.push('', 'Make the changes in Sleeper or ESPN. Titan cannot set lineups.');
    } else {
      log.push('Every lineup already matches your rankings.');
    }

    return {leagues: leagues, changes: changes, hurtStarters: hurtStarters, wireLines: wireLines,
      stops: stops, locked: locked, rankedCount: rankedCount, log: log};
  }

  function exposure(leagues) {
    var active = leagues.filter(function (d) { return d.cfg.exposure !== false; });
    var own = {}, starts = {}, meta = {};
    active.forEach(function (d) {
      d.roster.forEach(function (p) {
        if (!own[p.name]) { own[p.name] = []; starts[p.name] = 0; }
        own[p.name].push(d.cfg.key);
        meta[p.name] = p;
        if (p.start) starts[p.name]++;
      });
    });
    var rows = Object.keys(own).filter(function (n) { return own[n].length >= 2; })
      .sort(function (a, b) { return own[b].length - own[a].length || a.localeCompare(b); })
      .map(function (n) {
        var p = meta[n];
        return {name: n, pos: p.pos, team: p.team, bye: p.bye, count: own[n].length,
          starts: starts[n], leagues: own[n]};
      });
    return {active: active.length, rows: rows};
  }

  function byeMap(leagues, byeTable) {
    var table = byeTable && Object.keys(byeTable).length ? byeTable : byes;
    // Every week from the first bye to the last, so a week nobody is off shows as clean.
    var vals = Object.keys(table).map(function (t) { return table[t]; });
    var weeks = [];
    for (var w = Math.min.apply(null, vals); w <= Math.max.apply(null, vals); w++) weeks.push(w);
    var totals = {};
    var rows = leagues.map(function (d) {
      var cnt = {}, tot = 0;
      d.roster.forEach(function (p) {
        if (!p.bye) return;
        cnt[p.bye] = (cnt[p.bye] || 0) + 1;
        totals[p.bye] = (totals[p.bye] || 0) + 1;
        tot++;
      });
      return {key: d.cfg.key, name: d.cfg.name, counts: cnt, total: tot};
    });
    var clean = weeks.filter(function (w) { return !totals[w]; });
    return {weeks: weeks, rows: rows, totals: totals, clean: clean};
  }

  /* The starting spots a roster can't fill: players are matched to spots by
     augmenting paths, dedicated spots first, then the flex spots from narrowest
     to widest, so nobody is counted for two spots. Returns the open spots. */
  var FLEX_ORDER = {WRRB_FLEX: 1, REC_FLEX: 1, FLEX: 2, IDP_FLEX: 2, SUPER_FLEX: 3};
  function openSlots(slots, players) {
    var owner = {}, open = [];
    function assign(s, seen) {
      for (var j = 0; j < players.length; j++) {
        if (seen[j] || !slotFits(slots[s], players[j].pos)) continue;
        seen[j] = 1;
        if (owner[j] === undefined || assign(owner[j], seen)) { owner[j] = s; return true; }
      }
      return false;
    }
    slots.map(function (s, i) { return i; })
      .sort(function (a, b) { return (FLEX_ORDER[slots[a]] || 0) - (FLEX_ORDER[slots[b]] || 0) || a - b; })
      .forEach(function (i) { if (!assign(i, {})) open.push(slots[i]); });
    return open;
  }

  /* For each league, every upcoming bye week that leaves a starting spot you
     can't fill, and who's off. Players on IR or the taxi squad, or out long-term,
     don't count as available. A spot that's already empty without any byes
     (the Lineups tab flags those) isn't blamed on the bye. */
  var LONG_OUT = {IR: 1, PUP: 1, Sus: 1, NA: 1, DNR: 1};
  function byeNeeds(leagues, fromWeek) {
    var from = Number(fromWeek) || 1;
    return leagues.map(function (d) {
      var slots = (d.cfg.lineup || []).filter(function (s) { return !NOT_STARTERS[s]; });
      var usable = d.roster.filter(function (p) { return !p.held && !(p.inj && LONG_OUT[p.inj.split(' ')[0]]); });
      var already = {};
      openSlots(slots, usable).forEach(function (s) { already[s] = (already[s] || 0) + 1; });
      var weeks = {};
      d.roster.forEach(function (p) { if (p.bye && p.bye >= from) weeks[p.bye] = 1; });
      var needs = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; }).map(function (w) {
        var left = {}, need = [];
        for (var k in already) left[k] = already[k];
        openSlots(slots, usable.filter(function (p) { return p.bye !== w; })).forEach(function (s) {
          if (left[s]) left[s]--; else need.push(s);
        });
        if (!need.length) return null;
        var off = usable.filter(function (p) {
          return p.bye === w && need.some(function (s) { return slotFits(s, p.pos); });
        }).map(function (p) { return p.name; });
        return {week: w, need: need.map(slotLabel), off: off};
      }).filter(Boolean);
      return {key: d.cfg.key, name: d.cfg.name, needs: needs};
    });
  }

  /* ----------------------------------------- projections + weekly history */

  /* Sleeper's weekly projections (RotoWire's numbers) trimmed to what Titan
     uses. Each player keeps his standard-scoring points and the points his
     catches add at full PPR, so any league's reception value works:
     standard + ppr * catches. */
  function trimProjections(list) {
    var map = {};
    (list || []).forEach(function (e) {
      if (!e || e.player_id === undefined || !e.stats) return;
      var std = Number(e.stats.pts_std), full = Number(e.stats.pts_ppr);
      if (!isFinite(std) && !isFinite(full)) return;
      if (!isFinite(std)) std = full;
      if (!isFinite(full)) full = std;
      map[String(e.player_id)] = [round2(std), round2(full - std)];
    });
    return map;
  }

  function projFor(projMap, id, ppr) {
    var e = projMap && projMap[String(id)];
    return e ? round2(e[0] + (Number(ppr) || 0) * e[1]) : null;
  }

  function sumProj(list) {
    var t = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].proj !== null && list[i].proj !== undefined) t += Number(list[i].proj);
    }
    return round2(t);
  }

  /* A week's record of Titan's calls, one entry per rostered player. Every
     refresh rewrites a player's entry until his game kicks off; from then on
     the entry stays exactly as it was at the last refresh before kickoff. */
  function freezeWeek(prev, analysis, projMap, season, week, now) {
    now = now || Date.now();
    var old = (prev && prev.leagues) || {};
    var out = {season: String(season), week: Number(week), updatedAt: now, leagues: {}};
    ((analysis && analysis.leagues) || []).forEach(function (L) {
      var id = String(L.cfg.id);
      var before = (old[id] && old[id].players) || {};
      var players = {}, k;
      for (k in before) players[k] = before[k];
      var titanSlot = {}, call = {};
      (L.opt || []).forEach(function (o) { if (o.p) titanSlot[o.p.id] = o.slot; });
      L.rows.forEach(function (r) { if (r.p) call[r.p.id] = r.verdict; });
      L.roster.forEach(function (p) {
        if (p.locked && before[p.id]) return; // frozen at kickoff
        players[p.id] = {
          n: p.name, pos: p.pos, team: p.team, start: !!p.start, slot: p.slot || '',
          rank: p.rank === undefined ? null : p.rank,
          tier: p.tier === '' || p.tier === undefined ? null : p.tier,
          proj: projFor(projMap, p.id, L.cfg.ppr),
          call: call[p.id] || (titanSlot[p.id] ? 'START' : 'BENCH'),
          titan: titanSlot[p.id] || '', inj: p.inj || '', locked: !!p.locked, at: now
        };
      });
      out.leagues[id] = {key: L.cfg.key, name: L.cfg.name, ppr: L.cfg.ppr || 0, lineup: L.cfg.lineup, players: players};
    });
    // A league switched off mid-week keeps what was already saved for it.
    for (var lid in old) if (!out.leagues[lid]) out.leagues[lid] = old[lid];
    return out;
  }

  /* ------------------------------------------------ results + scorecard

     Not "are the rankings good in the abstract" but "given the players I
     actually had on my bench that week, did following them beat what I did?"

       actual   what the lineup I really started scored
       byRank   what the rank-ordered lineup would have scored
       perfect  the best any lineup off that roster could have scored

     Points come from Sleeper's matchups, so they are already under each
     league's own scoring rules. */

  function scoreLeague(lg, rosters, matchups, userId, players, weekly, hist, projMap) {
    if (!rosters) return {error: 'could not load rosters'};
    var mineId = null;
    for (var r = 0; r < rosters.length; r++) {
      if (isMine(rosters[r], userId)) { mineId = rosters[r].roster_id; break; }
    }
    if (mineId === null) return {error: 'no team found'};
    if (!matchups) return {error: 'no matchups for this week'};
    var mine = null;
    for (var m = 0; m < matchups.length; m++) {
      if (String(matchups[m].roster_id) === String(mineId)) { mine = matchups[m]; break; }
    }
    if (!mine) return {error: 'no matchup found'};

    var pp = mine.players_points || {};
    var ids = mine.players || [];
    var starterArr = (mine.starters || []).map(String);
    var startedIds = {}, slotOf = {};
    starterArr.forEach(function (x) { if (x && x !== '0') startedIds[x] = 1; });
    for (var sx = 0; sx < starterArr.length && sx < lg.lineup.length; sx++) {
      if (starterArr[sx] && starterArr[sx] !== '0') slotOf[starterArr[sx]] = lg.lineup[sx];
    }

    // A frozen record (saved at each kickoff) supplies the rank, call and
    // projection Titan had at lock. Without one, today's rankings and
    // projections stand in.
    var frozen = (hist && hist.players) || {};
    var roster = ids.map(function (id) {
      var info = playerInfo(players, id);
      var w = weekly[norm(info.name)] || null;
      var h = frozen[String(id)] || null;
      return {
        id: String(id), name: info.name, pos: info.pos, team: info.team,
        rank: h ? (h.rank === undefined ? null : h.rank) : (w && w.rank !== null ? w.rank : null),
        pts: Number(pp[String(id)] || 0),
        proj: h && h.proj !== null && h.proj !== undefined ? h.proj : projFor(projMap, id, lg.ppr),
        call: h ? h.call : '', frozen: !!h,
        start: !!startedIds[String(id)],
        locked: false, outish: false, slot: slotOf[String(id)] || ''
      };
    });

    var actual = sumPts(roster.filter(function (p) { return p.start; }));
    var rankLine = optimal(roster, lg.lineup).map(function (o) { return o.p; });
    var byRank = sumPts(rankLine);
    // Players with no frozen call get the call today's rankings make.
    var inLine = {};
    rankLine.forEach(function (p) { if (p) inLine[p.id] = true; });
    roster.forEach(function (p) {
      if (!p.frozen) p.call = p.start ? (inLine[p.id] ? 'OK' : 'SWAP OUT') : (inLine[p.id] ? 'START' : 'BENCH');
    });
    var projActual = sumProj(roster.filter(function (p) { return p.start; }));
    var projByRank = sumProj(rankLine);
    var perfect = sumPts(bestByPoints(roster, lg.lineup));
    var cc = closeCalls(roster, lg.lineup, startedIds);

    // The lineup as it stood, then any bench player who outscored the weakest
    // man in it.
    var actLine = actualLineup(roster, lg.lineup);
    var detail = [], weakest = null;
    actLine.forEach(function (o) { if (o.p && (weakest === null || o.p.pts < weakest)) weakest = o.p.pts; });
    actLine.forEach(function (o) { detail.push({slot: o.slot, p: o.p, benchWin: false}); });
    roster.filter(function (p) { return !p.start; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .forEach(function (p) {
        if (weakest === null || p.pts <= weakest || detail.length > 22) return;
        detail.push({slot: 'bench', p: p, benchWin: true});
      });

    return {key: lg.key, name: lg.name, actual: actual, byRank: byRank, perfect: perfect,
      leftOnBench: round2(byRank - actual), ceiling: round2(perfect - byRank),
      projActual: projActual, projByRank: projByRank, vsProj: round2(actual - projActual),
      frozen: roster.filter(function (p) { return p.frozen; }).length,
      close: cc, detail: detail, roster: roster};
  }

  /* `history` is the week's frozen record (freezeWeek output) or null, and
     `projMap` is Sleeper's projections for the week, used where nothing froze.
     `weekly` is a rankings map or a function of a league's settings, as in analyzeAll. */
  function scoreWeek(res, weekly, history, projMap) {
    var rankingsFor = typeof weekly === 'function' ? weekly : function () { return weekly; };
    var rows = [], skipped = (res.skipped || []).slice();
    var T = {actual: 0, byRank: 0, perfect: 0, projActual: 0, projByRank: 0, cw: 0, ct: 0};
    var hist = (history && history.leagues) || {};
    res.leagues.forEach(function (x) {
      var r = scoreLeague(x.cfg, x.rosters, x.matchups, res.userId, res.players, rankingsFor(x.cfg), hist[String(x.cfg.id)], projMap);
      if (r.error) { skipped.push(x.cfg.key + ': ' + r.error); return; }
      rows.push(r);
      T.actual += r.actual; T.byRank += r.byRank; T.perfect += r.perfect;
      T.projActual += r.projActual; T.projByRank += r.projByRank;
      T.cw += r.close.wins; T.ct += r.close.total;
    });
    ['actual', 'byRank', 'perfect', 'projActual', 'projByRank'].forEach(function (k) { T[k] = round2(T[k]); });
    T.vsProj = round2(T.actual - T.projActual);
    return {week: res.week, rows: rows, totals: T, skipped: skipped};
  }

  /* ------------------------------------------------------------- alerts */

  /* Game-day alerts from one person's analysed leagues (analyzeAll):
     'out'    a starter whose game hasn't kicked off is ruled out (Out, Doubtful,
              IR and the like), with the player Titan would start instead. Once
              per player and tag each week.
     'check'  45 to 80 minutes before a kickoff (inactives come out about 90
              minutes before), a league still starting someone ruled out in that
              game, someone on bye, or nobody in a spot. Once per league and
              kickoff time.
     opts: {week, now, kickoffs: [ms], kickAt(p) -> ms, sent: {key: 1},
     want: {out, check}}. Returns [{key, kind, title, body}] not yet sent, and
     marks them in `sent`. */
  var CHECK_FROM = 45 * 60000, CHECK_TO = 80 * 60000;
  function alertsFor(analysis, opts) {
    opts = opts || {};
    var sent = opts.sent || {}, want = opts.want || {out: true, check: true}, now = opts.now || Date.now();
    var out = [], leagues = (analysis && analysis.leagues) || [];
    var add = function (a) { if (!sent[a.key]) { sent[a.key] = 1; out.push(a); } };
    // Who Titan would put in a starter's place: the player coming into his spot.
    var instead = function (L, p) {
      var m = L.moves.filter(function (x) { return x.out && x.out.id === p.id; })[0];
      return m ? m.inn : null;
    };
    // A ruled-out starter's backup (the next man on his team's depth chart, from opts.players),
    // when nobody in the league has him.
    var depth = opts.players ? depthCharts(opts.players) : null;
    var freeBackup = function (L, p) {
      var b = depth ? backupOf(opts.players, p, depth) : null;
      return b && !(L.takenNorm || {})[norm(b.name)] ? b : null;
    };
    if (want.out) {
      leagues.forEach(function (L) {
        var name = L.cfg.name || L.cfg.key, id = String(L.cfg.id);
        L.rows.forEach(function (r) {
          var p = r.p;
          if (!p || p.locked || !p.outish) return;
          var sub = instead(L, p), b = freeBackup(L, p);
          add({key: ['out', opts.week, id, p.id, p.inj].join('|'), kind: 'out', url: '/app/lineups',
            title: p.name + ' is ' + injWord(p.inj),
            body: 'He\'s in your ' + name + ' lineup. ' + (sub ? 'Titan would start ' + sub.name + ' instead.' : 'Titan has nobody to start in his place.') +
              (b ? ' His backup, ' + b.name + ', is a free agent there.' : '')});
        });
      });
    }
    if (!want.check) return out;
    // One lineup check for each kickoff about an hour away, covering every league with something still wrong.
    (opts.kickoffs || []).filter(function (k) { return k - now >= CHECK_FROM && k - now <= CHECK_TO; }).forEach(function (k) {
      var parts = [], names = [];
      leagues.forEach(function (L) {
        var problems = [], subs = [];
        L.rows.forEach(function (r) {
          var p = r.p;
          if (!p) { problems.push('an empty ' + slotLabel(r.slot)); return; }
          if (p.locked) return;
          if (p.onBye) problems.push(p.name + ' (on bye)');
          else if (p.outish && opts.kickAt && opts.kickAt(p) === k) problems.push(p.name + ' (' + p.inj + ')');
          else return;
          var sub = instead(L, p);
          if (sub) subs.push(sub.name);
        });
        if (!problems.length) return;
        var name = L.cfg.name || L.cfg.key;
        names.push(name);
        parts.push(name + ': ' + andJoin(problems) + (subs.length ? ' (Titan would start ' + andJoin(subs) + ')' : ''));
      });
      if (!parts.length) return;
      add({key: ['check', opts.week, k].join('|'), kind: 'check', url: '/app/lineups',
        title: 'Lineup check: ' + (names.length === 1 ? names[0] : names.length + ' leagues'),
        body: 'Games start in about an hour. ' + parts.join('. ') + '.'});
    });
    return out;
  }

  // Positions whose backup is worth picking up when the starter is out.
  var HANDCUFF = {QB: 1, RB: 1, TE: 1};
  // Each team's depth chart at those positions, from Sleeper's player list (trimPlayers keeps the order).
  function depthCharts(players) {
    var out = {};
    for (var id in players) {
      var e = players[id];
      if (!e || !e[3] || !HANDCUFF[e[1]] || !e[2]) continue;
      var k = teamAbbr(e[2]) + '|' + e[1];
      (out[k] = out[k] || []).push({id: id, name: e[0], depth: Number(e[3])});
    }
    for (var key in out) out[key].sort(function (a, b) { return a.depth - b.depth; });
    return out;
  }

  // A QB, RB or TE's backup: the next man on his team's depth chart ({id, name, depth}), or null.
  function backupOf(players, p, charts) {
    if (!p || !HANDCUFF[p.pos]) return null;
    charts = charts || depthCharts(players);
    var mine = playerInfo(players, p.id).depth || 0;
    return (charts[teamAbbr(p.team) + '|' + p.pos] || []).filter(function (x) { return x.id !== String(p.id) && x.depth > mine; })[0] || null;
  }

  /* A waiver bid to suggest where a league bids for players (FAAB). With at least five of
     the league's own winning bids to go on: a hot pickup (among the most added) gets the
     75th percentile, a warm one the median, anyone else a quarter of the median. With
     fewer: 12%, 5% or 1% of the budget. Whole dollars, at least $1, never more than what's
     left. o: {budget, left, bids, heat: 'hot'|'warm'|'cold'}. */
  function faabBid(o) {
    var budget = Number(o.budget) || 0, left = o.left === undefined ? budget : Math.max(0, Number(o.left) || 0);
    if (!budget || !left) return {bid: 0, basis: 'none'};
    var bids = (o.bids || []).map(Number).filter(function (b) { return b > 0; }).sort(function (a, b) { return a - b; });
    var q = function (p) { var i = (bids.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return bids[lo] + (bids[hi] - bids[lo]) * (i - lo); };
    var heat = o.heat || 'cold', league = bids.length >= 5;
    var bid = league ? (heat === 'hot' ? q(0.75) : heat === 'warm' ? q(0.5) : q(0.5) / 4)
      : budget * (heat === 'hot' ? 0.12 : heat === 'warm' ? 0.05 : 0.01);
    return {bid: Math.max(1, Math.min(left, Math.round(bid))), basis: league ? 'league' : 'budget'};
  }

  /* The players whose news people want to hear about: everyone in their lineups, each
     with the leagues he starts in (n is the name as norm() reads it). The server keeps
     this with each person's alert settings between checks. */
  function newsWatch(analysis) {
    var by = {};
    ((analysis && analysis.leagues) || []).forEach(function (L) {
      var league = L.cfg.name || L.cfg.key;
      (L.rows || []).forEach(function (r) {
        var n = r.p && r.p.name ? norm(r.p.name) : '';
        if (!n) return;
        var w = by[n] = by[n] || {n: n, name: r.p.name, leagues: []};
        if (w.leagues.indexOf(league) < 0) w.leagues.push(league);
      });
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  /* News alerts: each story (espn.js newsFrom) that tags a watched starter, once per
     story and player (key news|week|story|player, marked in opts.sent), at most three at
     a time so a busy news day doesn't flood the phone. Each opens the story. */
  var NEWS_MAX = 3;
  function newsAlertsFor(stories, watch, opts) {
    opts = opts || {};
    var sent = opts.sent || {}, byName = {}, out = [];
    (watch || []).forEach(function (w) { byName[w.n] = w; });
    (stories || []).forEach(function (s) {
      (s.athletes || []).forEach(function (a) {
        var w = byName[norm(a.name)];
        if (!w || out.length >= NEWS_MAX) return;
        var key = ['news', opts.week, s.id, w.n].join('|');
        if (sent[key]) return;
        sent[key] = 1;
        var head = /[.!?]$/.test(s.headline) ? s.headline : s.headline + '.';
        out.push({key: key, kind: 'news', title: 'News: ' + w.name, url: s.url,
          body: head + ' He\'s in your ' + andJoin(w.leagues) + ' lineup' + (w.leagues.length > 1 ? 's' : '') + '.'});
      });
    });
    return out;
  }

  function andJoin(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  function injWord(tag) {
    var t = String(tag || '').split(' ')[0];
    return t === 'Out' ? 'out' : t === 'Doubtful' ? 'doubtful' : t === 'IR' ? 'on IR' : t === 'Sus' ? 'suspended' : 'ruled out (' + tag + ')';
  }

  /* A fantasy team as Titan names it on every tab: the team's nickname with the
     manager's account name after it, "Gridiron Gang (clintb)". A team without a
     nickname (or one that only repeats the account name) shows the account name
     alone, and a team with neither shows `fallback`. */
  function teamLabel(nick, account, fallback) {
    var n = String(nick || '').trim(), a = String(account || '').trim();
    if (n && a && n.toLowerCase() !== a.toLowerCase()) return n + ' (' + a + ')';
    return n || a || fallback || '';
  }

  /* Sleeper's player list by name and position (and by name alone), so a player from
     another site (ESPN, Yahoo) can be found in it. matchPlayer gives his Sleeper id (a
     team defense's is its team), or '' when he isn't there. */
  function playerIndex(players) {
    var idx = {byKey: {}, byName: {}};
    for (var id in players) {
      var e = players[id], n = norm(e[0]);
      (idx.byKey[n + '|' + e[1]] = idx.byKey[n + '|' + e[1]] || []).push(id);
      (idx.byName[n] = idx.byName[n] || []).push(id);
    }
    return idx;
  }

  function matchPlayer(idx, players, name, pos, team) {
    if (pos === 'DEF') return team || '';
    var n = norm(name);
    // IDP positions are named differently from site to site, so a unique name is enough there.
    var list = idx.byKey[n + '|' + pos] || (idx.byName[n] && idx.byName[n].length === 1 ? idx.byName[n] : []);
    if (list.length > 1) {
      var same = list.filter(function (id) { return teamAbbr(players[id][2]) === team; });
      if (same.length) list = same;
    }
    return list[0] || '';
  }

  var api = {
    INJ_OUT: INJ_OUT, WIRE_GROUPS: WIRE_GROUPS, SLOT_POS: SLOT_POS, teamLabel: teamLabel, playerIndex: playerIndex, matchPlayer: matchPlayer,
    norm: norm, teamAbbr: teamAbbr, byeOf: byeOf, byesFromSchedule: byesFromSchedule, setByes: setByes,
    fullName: fullName, trimPlayers: trimPlayers, playerInfo: playerInfo,
    leaguesFromSleeper: leaguesFromSleeper, describeLeague: describeLeague, slotLabel: slotLabel,
    tradeFormat: tradeFormat, valueIndex: valueIndex, playerValue: playerValue, waiverValue: waiverValue, tradeVerdict: tradeVerdict, titanValues: titanValues, positionStrength: positionStrength,
    lineupPoints: lineupPoints, draftPicks: draftPicks, standings: standings, tradeIdeas: tradeIdeas,
    impliedTotals: impliedTotals, dvpFrom: dvpFrom, gameTags: gameTags, transactionsFrom: transactionsFrom,
    splitRows: splitRows, parseRanks: parseRanks, positionHint: positionHint, mergeRanks: mergeRanks,
    weeklyMap: weeklyMap, rankCounts: rankCounts, DEFAULT_POS: DEFAULT_POS, defaultRanks: defaultRanks, rankingsBy: rankingsBy,
    alertsFor: alertsFor, newsWatch: newsWatch, newsAlertsFor: newsAlertsFor,
    depthCharts: depthCharts, backupOf: backupOf, faabBid: faabBid,
    gameStates: gameStates, weekProgress: weekProgress,
    rankKey: rankKey, rankLabel: rankLabel, slotFits: slotFits, optimal: optimal,
    actualLineup: actualLineup, bestByPoints: bestByPoints, sumPts: sumPts,
    closeCalls: closeCalls, freeAgents: freeAgents,
    buildLeague: buildLeague, applyDetails: applyDetails, applyLocks: applyLocks,
    attachRanks: attachRanks, analyzeLeague: analyzeLeague, analyzeAll: analyzeAll,
    exposure: exposure, byeMap: byeMap, scoreLeague: scoreLeague, scoreWeek: scoreWeek,
    trimProjections: trimProjections, projFor: projFor, sumProj: sumProj, freezeWeek: freezeWeek,
    openSlots: openSlots, byeNeeds: byeNeeds, effectiveWeek: effectiveWeek, applyPoints: applyPoints,
    keepStartedRanks: keepStartedRanks, winProbability: winProbability
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
