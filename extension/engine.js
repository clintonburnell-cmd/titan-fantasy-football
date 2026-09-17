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
  /* How many weeks from now a player's status says he'll miss, for the Trade tab's rest-of-season points and its
     ideas: a rough timeframe by status (Sleeper gives no return date), so an out or IR player's points start later.
     Questionable plays. `inj` is a roster player's status text ("Out (knee)"). */
  var MISS_WEEKS = {Out: 1, Doubtful: 1, COV: 1, NA: 2, Sus: 3, IR: 4, PUP: 4, DNR: 8};
  function missWeeks(inj) {
    var s = String(inj || '').split(' ')[0];
    return MISS_WEEKS[s] || 0;
  }

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
      // Name, position, team, his place on the team's depth chart (0: none, for backup alerts) and his age (0: unknown, for dynasty values).
      map[id] = [fullName(p) || ('id ' + id), p.position, p.team || '', Number(p.depth_chart_order) || 0, Number(p.age) || 0];
    }
    return map;
  }

  /* Sleeper roster ids are numeric, except team defences, whose id IS the team
     abbreviation. Those are named "<ABBR> D/ST" to match the rankings. An ESPN
     player Sleeper's list doesn't have ("espn:<id>") is looked up like anyone. */
  function playerInfo(players, id) {
    var key = String(id);
    var e = players && players[key];
    if (e) return {name: e[0], pos: e[1], team: e[2], depth: e[3] || 0, age: e[4] || 0};
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
        scoring: scoringDeltas(l.scoring_settings), // the rest of its scoring, as differences from Sleeper's standard
        kind: s.type === 2 ? 'Dynasty' : s.type === 1 ? 'Keeper' : 'Redraft',
        bestBall: bestBall,
        rounds: Number(s.draft_rounds) || 0, // draft rounds, for a dynasty league's picks (Trade tab)
        // The playoffs (Standings) and the waiver budget, when the league bids for players (Waivers).
        playoffStart: Number(s.playoff_week_start) || 0, playoffTeams: Number(s.playoff_teams) || 0,
        // Divisions and how they seed the playoffs (standings): Sleeper's playoff_seed_type, 0 division winners take the
        // top seeds, 1 division winners are in but seeded by record, 2 divisions are ignored.
        divisions: Number(s.divisions) || 0, seedType: s.playoff_seed_type === undefined || s.playoff_seed_type === null ? 0 : Number(s.playoff_seed_type),
        faab: Number(s.waiver_type) === 2 ? Number(s.waiver_budget) || 0 : 0,
        // Waivers' plan and reminder: the day waivers run (Sleeper counts from Monday, so 2, its default, is
        // Wednesday; they process about 3 AM Eastern), whether they run daily, and the bench size (an open spot needs no drop).
        waiverDay: s.waiver_day_of_week === undefined || s.waiver_day_of_week === null ? 2 : Number(s.waiver_day_of_week),
        dailyWaivers: !!s.daily_waivers,
        bench: (l.roster_positions || []).filter(function (p) { return p === 'BN'; }).length,
        status: l.status || '',
        active: pref.active !== undefined ? !!pref.active : !bestBall,
        exposure: true
      };
    });
  }

  function describeLeague(l) {
    var scoring = l.ppr >= 1 ? 'PPR' : l.ppr >= 0.5 ? 'Half PPR' : l.ppr > 0 ? l.ppr + ' PPR' : 'Standard';
    return [l.platform === 'espn' ? 'ESPN' : l.platform === 'yahoo' ? 'Yahoo' : '', l.teams ? l.teams + ' teams' : '', scoring].concat(scoringNotes(l))
      .concat([l.kind, l.bestBall ? 'Best ball' : '']).filter(Boolean).join(' · ');
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

  /* ------------------------------------------------------- season rankings */

  /* The kinds of league a person's season rankings are kept for: redraft or dynasty (keeper leagues count as
     redraft, as FantasyCalc prices them), one QB or two (superflex and true 2QB value players almost alike),
     each with an optional TE Premium list for leagues that pay tight ends extra per catch. */
  var SEASON_FORMATS = [
    {base: 'redraft-1qb', label: '1QB Redraft'},
    {base: 'redraft-sf', label: 'Superflex Redraft'},
    {base: 'dynasty-1qb', label: '1QB Dynasty'},
    {base: 'dynasty-sf', label: 'Superflex Dynasty'}
  ];
  /* Which season list a league uses: {base, tep, key}. TE Premium is any extra points per tight end catch
     (Sleeper's bonus_rec_te, ESPN's reception override for tight ends: both reach cfg.scoring). */
  function seasonFormat(cfg) {
    var f = tradeFormat(cfg || {}), sc = (cfg && cfg.scoring) || {};
    var base = (f.dynasty ? 'dynasty' : 'redraft') + '-' + (f.qbs === 2 ? 'sf' : '1qb'), tep = Number(sc.bonus_rec_te) > 0;
    return {base: base, tep: tep, key: base + (tep ? '-tep' : '')};
  }

  /* A person's season rankings as values in the market's own scale: their order, the market's spacing. rows: the
     parsed list ({name, pos, rank}); pool: the players the market values ([{id, name, pos, v}]). The Nth player in
     the person's order takes the market's Nth-highest value, so a player they rank above the market is worth more to
     them and one they rank below is worth less, in numbers a trade can weigh. A list ranked within each position
     (its ranks repeat across positions), or opts.byPosition, maps within each position instead. Players the list
     doesn't name keep their market value. Draft picks aren't ranked.
     {byId: {id: value}, order: {id: place in the person's list, 1 best}, matched, listed, byPosition}. */
  function seasonValues(rows, pool, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r && r.name && r.pos !== 'PICK'; });
    pool = (pool || []).filter(function (p) { return p && p.id && p.pos !== 'PICK'; });
    var byKey = {}, byName = {};
    pool.forEach(function (p) {
      var n = norm(p.name);
      byKey[n + '|' + p.pos] = p;
      (byName[n] = byName[n] || []).push(p);
    });
    var ranks = rows.map(function (r) { return Number(r.rank); }).filter(function (x) { return isFinite(x); });
    var distinct = {};
    ranks.forEach(function (x) { distinct[x] = 1; });
    var byPosition = !!opts.byPosition || (ranks.length > 1 && Object.keys(distinct).length < ranks.length * 0.9);
    var sorted = rows.slice().sort(function (a, b) {
      var x = Number(a.rank), y = Number(b.rank);
      return (isFinite(x) ? x : 1e9) - (isFinite(y) ? y : 1e9);
    });
    var seen = {}, list = [], tierOf = {}, tiered = false;
    sorted.forEach(function (r) {
      var n = norm(r.name), p = byKey[n + '|' + r.pos] || (byName[n] && byName[n].length === 1 ? byName[n][0] : null);
      if (!p || seen[p.id]) return;
      seen[p.id] = 1;
      list.push(p);
      var t = Number(r.tier);
      if (r.tier !== '' && r.tier !== null && r.tier !== undefined && isFinite(t)) { tierOf[p.id] = t; tiered = true; }
    });
    var desc = function (ps) { return ps.map(function (p) { return Math.max(0, Number(p.v) || 0); }).sort(function (a, b) { return b - a; }); };
    var byId = {}, order = {};
    pool.forEach(function (p) { byId[p.id] = Math.max(0, Number(p.v) || 0); });
    list.forEach(function (p, i) { order[p.id] = i + 1; });
    if (byPosition) {
      var curves = {}, at = {};
      pool.forEach(function (p) { (curves[p.pos] = curves[p.pos] || []).push(p); });
      Object.keys(curves).forEach(function (pos) { curves[pos] = desc(curves[pos]); });
      list.forEach(function (p) {
        var c = curves[p.pos] || [], i = at[p.pos] = (at[p.pos] || 0) + 1;
        byId[p.id] = c[i - 1] !== undefined ? c[i - 1] : 0;
      });
    } else {
      var curve = desc(pool);
      list.forEach(function (p, i) { byId[p.id] = curve[i] !== undefined ? curve[i] : 0; });
    }
    // Tiers over rankings: with tiers on the list, players in the same tier (at the same position when the list is
    // ranked within positions) are pulled TIER_FLATTEN of the way to their tier's average, so tier-mates trade about
    // even and the real cliffs sit between tiers; a little of the order inside a tier is kept.
    if (tiered) {
      var groups = {};
      list.forEach(function (p) {
        if (tierOf[p.id] === undefined) return;
        var k = (byPosition ? p.pos + '|' : '') + tierOf[p.id];
        (groups[k] = groups[k] || []).push(p.id);
      });
      Object.keys(groups).forEach(function (k) {
        var ids = groups[k], mean = ids.reduce(function (s, id) { return s + byId[id]; }, 0) / ids.length;
        ids.forEach(function (id) { byId[id] = Math.round(byId[id] + TIER_FLATTEN * (mean - byId[id])); });
      });
    }
    return {byId: byId, order: order, matched: list.length, listed: rows.length, byPosition: byPosition, tiered: tiered};
  }
  var TIER_FLATTEN = 0.75;

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
     player's projected points above a replacement-level player at his position, in the
     league's scoring: replacement is the player just outside what the league's teams start
     there (flex spots shared out), read between the two players either side of that spot so
     one roster spot more or fewer moves the line a little, not to the next player. Built
     only from Sleeper's season projections, never from FantasyCalc's values. {playerId:
     whole points, 0 at or below replacement}.
     opts: {from, to}: count only weeks from..to (each player's bye left out: a trade is a
       rest-of-season decision, and a player who's missed games keeps his per-game worth);
       the whole season when absent. {shares}: the league's own flex shares (flexShares)
       instead of FLEX_SHARE. {dynasty}: tilt each player's points by his age (ageFactor), since
       a dynasty team owns the seasons ahead: young players up, older ones down. */
  var FLEX_SHARE = {FLEX: {RB: 0.45, WR: 0.45, TE: 0.1}, WRRB_FLEX: {RB: 0.5, WR: 0.5}, REC_FLEX: {WR: 0.8, TE: 0.2},
    SUPER_FLEX: {QB: 0.9, RB: 0.05, WR: 0.05}};
  /* How a dynasty team should weigh a player's age, by position: running backs fade from 27 and are
     worth little past 29; receivers and tight ends hold to 29 and fade after; quarterbacks hold to
     the mid-thirties. Judgement, not fitted; no age (0) means no tilt. */
  var AGE_CURVE = {
    RB: [[24, 1.15], [26, 1.0], [27, 0.9], [28, 0.8], [99, 0.65]],
    WR: [[25, 1.15], [29, 1.0], [30, 0.9], [99, 0.75]],
    TE: [[26, 1.15], [30, 1.0], [31, 0.9], [99, 0.75]],
    QB: [[30, 1.05], [34, 1.0], [99, 0.8]]
  };
  function ageFactor(pos, age) {
    var curve = AGE_CURVE[pos];
    age = Number(age) || 0;
    if (!curve || !age) return 1;
    for (var i = 0; i < curve.length; i++) if (age <= curve[i][0]) return curve[i][1];
    return 1;
  }
  function titanValues(seasonProj, players, cfg, opts) {
    opts = opts || {};
    var teams = Number(cfg.teams) || 12, starts = {}, byPos = {}, out = {}, shares = opts.shares || {};
    (cfg.lineup || []).forEach(function (slot) {
      var share = shares[slot] || FLEX_SHARE[slot];
      if (!share) {
        if (!PLAYER_POS[slot]) return;
        share = {};
        share[slot] = 1;
      }
      for (var pos in share) starts[pos] = (starts[pos] || 0) + share[pos];
    });
    var span = opts.from && opts.to;
    for (var id in seasonProj || {}) {
      var info = playerInfo(players, id);
      if (!starts[info.pos]) continue;
      var pts = span ? spanPoints(seasonProj, id, cfg, opts.from, opts.to, byeOf(info.team)) : projFor(seasonProj, id, cfg) || 0;
      if (opts.dynasty) pts *= ageFactor(info.pos, info.age);
      (byPos[info.pos] = byPos[info.pos] || []).push({id: id, pts: pts});
    }
    Object.keys(byPos).forEach(function (pos) {
      var list = byPos[pos].sort(function (a, b) { return b.pts - a.pts; });
      var at = Math.min(teams * starts[pos], list.length - 1), lo = Math.floor(at), hi = Math.min(Math.ceil(at), list.length - 1);
      var repl = list[lo].pts + (list[hi].pts - list[lo].pts) * (at - lo);
      list.forEach(function (x) { out[x.id] = Math.max(0, Math.round(x.pts - repl)); });
    });
    return out;
  }

  /* How a league's teams actually fill their flex spots: each team's best lineup by `pts`,
     the positions in each flex slot counted across the league. {FLEX: {RB: 0.6, WR: 0.4}, ...}
     for the flex slots seen; titanValues takes it as `shares`. */
  function flexShares(teams, slots, pts) {
    var counts = {};
    (teams || []).forEach(function (t) {
      var pool = (t.roster || []).filter(function (p) { return !p.held && p.pos !== 'PICK'; })
        .map(function (p) { return {id: p.id, pos: p.pos, pts: Number(pts(p)) || 0}; });
      bestByPoints(pool, slots || []).forEach(function (p, i) {
        var slot = slots[i];
        if (!p || !FLEX_SLOTS[slot]) return;
        var c = counts[slot] = counts[slot] || {};
        c[p.pos] = (c[p.pos] || 0) + 1;
      });
    });
    var out = {};
    Object.keys(counts).forEach(function (slot) {
      var c = counts[slot], n = 0, pos;
      for (pos in c) n += c[pos];
      out[slot] = {};
      for (pos in c) out[slot][pos] = round2(c[pos] / n);
    });
    return out;
  }

  /* What the market's price would be if it agreed with the usage numbers: the Value report's
     `vgap` is the gap between a player's market value and the value at his projected rank, as a
     share of the larger (positive: the market underrates him). Implied value from the two; the
     edge is implied minus market: what a trade at market price hands over or picks up. */
  function impliedValue(value, vgap) {
    var v = Math.max(0, Number(value) || 0), g = Number(vgap) || 0;
    if (!v || !g) return v;
    return Math.round(g > 0 ? v / (1 - Math.min(g, 0.95)) : v * (1 + Math.max(g, -0.95)));
  }

  /* A player's projected points over weeks `from` to `to` (both counted), from Sleeper's season
     projection in the league's scoring: a 17-game season's share for each week, his bye week
     left out. The Trade tab's rest of season (this week to the last regular-season week) and
     playoff weeks. */
  var SEASON_GAMES = 17;
  function spanPoints(seasonProj, id, cfg, from, to, bye) {
    var total = projFor(seasonProj, id, cfg) || 0, games = 0;
    for (var w = Math.max(1, Number(from) || 1); w <= (Number(to) || 0); w++) if (w !== Number(bye)) games++;
    return round2(total / SEASON_GAMES * games);
  }

  /* Trade ideas for one team in a league: trades of one or two pieces each way that
     FantasyCalc's calculator calls fair (tradeVerdict, roster spots counted) and that make
     the team's starting lineup stronger. A lineup's strength here is the value of its best
     starters (lineupPoints with values), which suits a trade better than one week's
     projections. Trades that leave both lineups stronger come first; within each group,
     ranked by our gain plus half theirs (up to ours). Each side offers its `top` (12) most
     valuable players; at most two ideas per team and one per player wanted. Two for two is
     allowed (it's how uneven rosters get balanced); draft picks join a side's pool only when
     the other side is rebuilding (`stance`, below).
     opts: {value(p), slots, waiver, max, top}, and for the edge:
       edge(p): the usage numbers' edge on his market value (impliedValue minus market). Then a
         team's own gain is measured by market value plus edge (what the players are worth by
         usage), the partner's still by market value (what they see), and an idea that swaps
         equal market value for players the market underrates counts as a gain.
       points(p): his rest-of-season projected points. An idea must not lower the team's best
         lineup by points (a value gain that scores less is a mirage), and each idea says both
         teams' change (myPts, theirPts).
       thin: {teamId: [positions]} where each partner is thin (positionStrength).
       stance: {teamId: 'contender' | 'rebuilder' | 'mid'} from playoff odds, `me.id` included.
         A rebuilder takes picks: our picks (me.picks) join our pool for a rebuilding partner,
         and a contending partner's picks join theirs when we're rebuilding.
     Each idea also carries `accept`, how likely the partner is to say yes (-1 to 3), and its
     reasons: +1 when the trade fills a position they're thin at, +1 when they get the single
     most valuable player in it, +1 when a rebuilder gets picks or a contender gets a player for
     picks, -1 when they'd give two starters for one. It tilts the order by 15% a point. */
  var LINEUP_BIG = 1.0, LINEUP_VALUE = 20, GUARD_WEEKLY = 0.5, UPGRADE_BONUS = 0.1, NOW_COST = 0.05, NOW_FLOOR = 0.6;
  /* A roster's best lineup by `pts`, added up by position (a flex player counts at his own position):
     {QB: points, RB: points, ...}. Players on IR or the taxi squad and draft picks stay out. */
  function positionPoints(roster, slots, pts) {
    var pool = (roster || []).filter(function (p) { return !p.held && p.pos !== 'PICK'; })
      .map(function (p) { return {id: p.id, pos: p.pos, pts: Number(pts(p)) || 0}; });
    var out = {};
    bestByPoints(pool, (slots || []).filter(function (s) { return !NOT_STARTERS[s]; })).forEach(function (p) {
      if (p) out[p.pos] = (out[p.pos] || 0) + p.pts;
    });
    return out;
  }
  function tradeIdeas(me, others, opts) {
    var value = opts.value, slots = opts.slots || [], waiver = opts.waiver || 0, max = opts.max || 6, top = opts.top || 12;
    var edge = typeof opts.edge === 'function' ? opts.edge : null, points = typeof opts.points === 'function' ? opts.points : null;
    // The partner's lineup is judged by what they see (opts.theirPoints, the public projections) when that differs from
    // your numbers (opts.points, your season rankings' points): a package that upgrades you by your rankings and them by
    // the market is the edge. Your starting positions (opts.guard): an idea may not weaken a position you're not deep at
    // (opts.myDeep) by more than GUARD_WEEKLY points a week; positions it strengthens are its `ups`, and an idea that
    // upgrades more than one position ranks higher (UPGRADE_BONUS a position past the first).
    var theirPoints = typeof opts.theirPoints === 'function' ? opts.theirPoints : points, guard = !!opts.guard && !!points;
    var myDeep = opts.myDeep || [];
    // Status and this week (opts.miss(p): weeks a player's status says he'll miss, missWeeks; opts.nowPoints(p): this
    // week's projection): an idea says when a player it brings in is out and for about how long, carries `myNow`
    // (what it does to your lineup this week), and ranks lower the more it costs you this week (NOW_COST a point,
    // never below NOW_FLOOR), so you keep winning while you improve.
    var miss = typeof opts.miss === 'function' ? opts.miss : null, nowPoints = typeof opts.nowPoints === 'function' ? opts.nowPoints : null;
    var byNow = nowPoints ? function (roster) { return lineupPoints(roster, slots, nowPoints); } : null, myNowBase = byNow ? byNow(me.roster) : 0;
    var thin = opts.thin || {}, deep = opts.deep || {}, stance = opts.stance || {}, myStance = stance[String(me.id)] || 'mid';
    // The lineup goal (opts.goal 'lineup', with points): the point of a trade is a starting lineup that scores more,
    // so an idea must raise the rest-of-season points of the best lineup. It still has to gain value by your own
    // numbers (the market's price plus your season rankings' or the usage's edge, trueGain), except a consolidation
    // that adds LINEUP_BIG points a week or more, which may cost a little value (the market's verdict keeps it fair).
    // Ideas rank by both: the points gained a week plus the value gained as a share of your lineup's (LINEUP_VALUE
    // points a week per whole share: a 5% gain in value counts like a point a week). Without the goal, by value alone.
    var lineup = opts.goal === 'lineup' && !!points, weeks = Math.max(1, Number(opts.weeks) || 16);
    // Positions kept out of every idea, on both sides (opts.skipPos): a quarterback in a one-QB league is easy to fill.
    var skipPos = opts.skipPos || [];
    var pool = function (team, withPicks) {
      var list = (team.roster || []).concat(withPicks ? team.picks || [] : []);
      return list.filter(function (p) { return (p.pos !== 'PICK' || withPicks) && value(p) > 0 && skipPos.indexOf(p.pos) < 0; })
        .sort(function (a, b) { return value(b) - value(a); }).slice(0, top);
    };
    var isPick = function (p) { return p.pos === 'PICK'; };
    var strength = function (roster) { return lineupPoints(roster, slots, value); };
    var mine = edge ? function (roster) { return lineupPoints(roster, slots, function (p) { return value(p) + (Number(edge(p)) || 0); }); } : strength;
    var byPoints = points ? function (roster) { return lineupPoints(roster, slots, points); } : null;
    var byTheirPoints = theirPoints ? function (roster) { return lineupPoints(roster, slots, theirPoints); } : null;
    var myPosBase = points ? positionPoints(me.roster, slots, points) : null;
    var combos = function (list) {
      var out = list.map(function (p) { return [p]; });
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
      return out;
    };
    var items = function (list) { return list.map(function (p) { return {v: value(p), pick: isPick(p)}; }); };
    var without = function (roster, gone) { return roster.filter(function (p) { return !gone.some(function (g) { return g.id === p.id; }); }); };
    var sumOf = function (list, f) { return list.reduce(function (s, p) { return s + (Number(f(p)) || 0); }, 0); };
    var maxOf = function (list) { return list.reduce(function (m, p) { return Math.max(m, value(p)); }, 0); };
    var startersOf = function (roster) {
      var ids = {};
      bestByPoints(roster.filter(function (p) { return !p.held && p.pos !== 'PICK'; })
        .map(function (p) { return {id: p.id, pos: p.pos, pts: value(p)}; }), slots).forEach(function (p) { if (p) ids[p.id] = 1; });
      return ids;
    };
    var myBase = strength(me.roster), myTrue = mine(me.roster), myPtsBase = byPoints ? byPoints(me.roster) : 0;
    var myPlayers = combos(pool(me, false)), myWithPicks = null, ideas = [];
    (others || []).forEach(function (o) {
      var theirStance = stance[String(o.id)] || 'mid';
      var giveCombos = theirStance === 'rebuilder' ? (myWithPicks = myWithPicks || combos(pool(me, true))) : myPlayers;
      var theirBase = strength(o.roster), theirCombos = combos(pool(o, myStance === 'rebuilder' && theirStance === 'contender')), theirStarters = startersOf(o.roster);
      var theirPtsBase = byTheirPoints ? byTheirPoints(o.roster) : 0, holes = thin[String(o.id)] || [], rich = deep[String(o.id)] || [];
      giveCombos.forEach(function (give) {
        theirCombos.forEach(function (get) {
          // Picks for picks says nothing about either lineup.
          if (give.every(isPick) && get.every(isPick)) return;
          var R = tradeVerdict(items(give), items(get), waiver);
          if (!R.fair) return;
          var after = without(me.roster, give).concat(get), gain = strength(after) - myBase, trueGain = mine(after) - myTrue;
          var theirAfter = without(o.roster, get).concat(give), myPts = 0, theirPts = 0;
          var ups = [];
          if (byPoints) {
            myPts = round2(byPoints(after) - myPtsBase);
            if (lineup ? myPts <= 0 : myPts < 0) return;
            theirPts = round2(byTheirPoints(theirAfter) - theirPtsBase);
            // Position by position: what the trade does to your starters at each, by your numbers.
            var posAfter = positionPoints(after, slots, points), tol = GUARD_WEEKLY * weeks, weakened = false, pos;
            for (pos in myPosBase) if (myPosBase.hasOwnProperty(pos)) {
              var dpos = (posAfter[pos] || 0) - myPosBase[pos];
              if (dpos > tol) ups.push(pos);
              else if (dpos < -tol && myDeep.indexOf(pos) < 0) weakened = true;
            }
            for (pos in posAfter) if (posAfter.hasOwnProperty(pos) && !myPosBase.hasOwnProperty(pos) && posAfter[pos] > tol) ups.push(pos);
            if (guard && weakened) return;
          }
          if (trueGain <= 0 && !(lineup && myPts / weeks >= LINEUP_BIG)) return;
          var why = [], accept = 0, myNow = byNow ? round2(byNow(after) - myNowBase) : 0;
          if (ups.length > 1) why.push('upgrades your ' + ups.join(' and ') + ' by your numbers');
          if (miss) get.forEach(function (p) {
            var w = miss(p);
            if (w > 0) why.push(p.name + ' is ' + String(p.inj || 'out').split(' (')[0].toLowerCase() + ', about ' + w + (w === 1 ? ' week' : ' weeks') + ' by his status');
          });
          if (byNow && myNow <= -1) why.push('costs you ' + round2(-myNow) + ' this week');
          var fills = give.filter(function (p) { return holes.indexOf(p.pos) >= 0; }).map(function (p) { return p.pos; });
          if (fills.length) { accept++; why.push('fills their hole at ' + fills.filter(function (p, i) { return fills.indexOf(p) === i; }).join(' and ')); }
          var spare = get.filter(function (p) { return !isPick(p) && rich.indexOf(p.pos) >= 0; }).map(function (p) { return p.pos; });
          if (spare.length && spare.length === get.filter(function (p) { return !isPick(p); }).length) {
            accept++; why.push('comes from their depth at ' + spare.filter(function (p, i) { return spare.indexOf(p) === i; }).join(' and '));
          }
          if (maxOf(give) > maxOf(get)) { accept++; why.push('they get the best player in it'); }
          if (get.length === 2 && give.length === 1 && get.every(function (p) { return theirStarters[p.id]; })) { accept--; why.push('asks two of their starters for one'); }
          if (theirStance === 'rebuilder' && give.some(isPick)) { accept++; why.push('they\'re rebuilding, and this brings picks'); }
          else if (theirStance === 'contender' && get.some(isPick) && !give.some(isPick)) { accept++; why.push('they\'re contending, and this brings a player now'); }
          ideas.push({partner: o, give: give, get: get, verdict: R, myGain: round2(gain), trueGain: round2(trueGain),
            theirGain: round2(strength(theirAfter) - theirBase), edge: edge ? Math.round(sumOf(get, edge) - sumOf(give, edge)) : 0,
            myPts: myPts, theirPts: theirPts, myNow: myNow, ups: ups, accept: accept, why: why});
        });
      });
    });
    // Trades that leave both lineups stronger come first: the other side is likelier to say yes. With the lineup
    // goal, "stronger" is points and the order is the points you gain (a fair price is the constraint, not the prize).
    var score = lineup ? function (x) {
        var ppw = x.myPts / weeks + 0.25 * Math.max(0, Math.min(x.theirPts, x.myPts)) / weeks;
        var value = myTrue ? (x.trueGain + 0.5 * Math.min(x.theirGain, x.trueGain)) / myTrue : 0;
        var now = Math.max(NOW_FLOOR, 1 - NOW_COST * Math.max(0, -x.myNow));
        return (ppw + LINEUP_VALUE * value) * (1 + 0.15 * x.accept) * (1 + UPGRADE_BONUS * Math.max(0, x.ups.length - 1)) * now;
      } : function (x) { return (x.trueGain + 0.5 * Math.min(x.theirGain, x.trueGain)) * (1 + 0.15 * x.accept); };
    var helps = lineup ? function (x) { return x.theirPts >= 0; } : function (x) { return x.theirGain >= 0; };
    ideas.sort(function (a, b) { return helps(b) - helps(a) || score(b) - score(a); });
    var perTeam = {}, wanted = {}, out = [];
    ideas.forEach(function (x) {
      if (out.length >= max || (perTeam[x.partner.id] || 0) >= 2 || x.get.some(function (p) { return wanted[p.id]; })) return;
      perTeam[x.partner.id] = (perTeam[x.partner.id] || 0) + 1;
      x.get.forEach(function (p) { wanted[p.id] = 1; });
      out.push(x);
    });
    return out;
  }

  /* The trade partners whose rosters fit yours, from positionStrength's grades: a partner needs a
     position where they're thin and you're clearly stronger (`need`: what you can spare them), and
     can spare one where they're deep and you're clearly weaker (`spare`: what you want). Clearly is
     PARTNER_GAP standard deviations apart (z). `fit` adds up those gaps; partners with none are left
     out, the best fit first. [{id, need, spare, fit}]. */
  var PARTNER_GAP = 0.6;
  function tradePartners(meId, PS) {
    var teams = (PS && PS.teams) || [], positions = (PS && PS.positions) || [];
    var me = teams.filter(function (t) { return String(t.id) === String(meId); })[0];
    if (!me) return [];
    var z = function (t, pos) { return (t.byPos[pos] || {}).z || 0; }, grade = function (t, pos) { return (t.byPos[pos] || {}).grade || 'mid'; };
    return teams.filter(function (t) { return t !== me; }).map(function (t) {
      var need = [], spare = [], fit = 0;
      positions.forEach(function (pos) {
        if (pos === 'K' || pos === 'DEF') return;
        var d = z(me, pos) - z(t, pos);
        if (grade(t, pos) === 'thin' && d >= PARTNER_GAP) { need.push(pos); fit += d; }
        if (grade(t, pos) === 'deep' && -d >= PARTNER_GAP) { spare.push(pos); fit -= d; }
      });
      return {id: String(t.id), need: need, spare: spare, fit: round2(fit)};
    }).filter(function (x) { return x.fit > 0; }).sort(function (a, b) { return b.fit - a.fit || (b.need.length + b.spare.length) - (a.need.length + a.spare.length); });
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
     (depth), ranked across the league (1 = strongest). 'deep' is 0.6 standard deviations or
     more above the league's average at that position, 'thin' that far below (z), so teams a
     point apart get the same label; IR and taxi players don't count. {teams: [{id, byPos:
     {QB: {start, depth, rank, grade, z}}}], positions, n}. */
  var STRENGTH_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], STRENGTH_Z = 0.6;
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
    var n = out.length;
    var positions = STRENGTH_POS.filter(function (pos) {
      return starters.some(function (s) { return slotFits(s, pos); }) &&
        out.some(function (t) { return t.byPos[pos] && t.byPos[pos].start > 0; });
    });
    positions.forEach(function (pos) {
      var score = function (t) { var c = t.byPos[pos] || {start: 0, depth: 0}; return c.start + 0.25 * c.depth; };
      var all = out.map(score), mean = all.reduce(function (a, b) { return a + b; }, 0) / (n || 1);
      var sd = Math.sqrt(all.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (n || 1));
      out.slice().sort(function (a, b) { return score(b) - score(a); }).forEach(function (t, i) {
        var c = t.byPos[pos] = t.byPos[pos] || {start: 0, depth: 0};
        c.rank = i + 1;
        c.z = sd ? round2((score(t) - mean) / sd) : 0;
        c.grade = c.z >= STRENGTH_Z ? 'deep' : c.z <= -STRENGTH_Z ? 'thin' : 'mid';
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

  /* ------------------------------------------------------------ draft results */

  /* A Sleeper draft in the shape draft results read (espn.js draftFrom gives the same):
     {type ('snake', 'linear' or 'auction'), status ('complete', 'drafting' or 'pre_draft'),
     rounds, teams, picks in order: [{no, round, pick (its place in the round), slot (the draft
     slot it belongs to), team (the roster that made it), id, name, pos, nfl, keeper, amount (an
     auction's price)}]}. A team defense's id is its team; a player Titan's list doesn't have yet
     keeps Sleeper's name for him. */
  var DRAFT_TYPES = {snake: 1, linear: 1, auction: 1};
  function draftFromSleeper(draft, picks, players) {
    draft = draft || {};
    var st = draft.settings || {};
    var list = (picks || []).map(function (p) {
      var m = p.metadata || {}, id = String(p.player_id || ''), info = playerInfo(players, id);
      var pos = m.position || info.pos, meta = String((m.first_name || '') + ' ' + (m.last_name || '')).replace(/\s+/g, ' ').trim();
      return {no: Number(p.pick_no) || 0, round: Number(p.round) || 0, pick: 0, slot: Number(p.draft_slot) || 0, team: String(p.roster_id || ''),
        id: id, name: (players && players[id]) || pos === 'DEF' ? info.name : meta || info.name, pos: pos, nfl: m.team || info.team,
        keeper: !!p.is_keeper, amount: Number(m.amount) || 0};
    }).sort(function (a, b) { return a.no - b.no; });
    var teams = Number(st.teams) || list.filter(function (p) { return p.round === 1; }).length;
    list.forEach(function (p) { p.pick = teams ? ((p.no - 1) % teams) + 1 : p.no; });
    return {type: DRAFT_TYPES[draft.type] ? draft.type : 'snake', status: draft.status || '', season: String(draft.season || ''),
      rounds: Number(st.rounds) || list.reduce(function (n, p) { return Math.max(n, p.round); }, 0), teams: teams, picks: list};
  }

  function spread(list) {
    if (!list.length) return 0;
    var mean = list.reduce(function (s, x) { return s + x; }, 0) / list.length;
    return Math.sqrt(list.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / list.length);
  }

  /* Draft results: every pick against the spot it used. A spot is worth what it would get if the
     draft were held again today with every player going in order of value (`value(pick)`, the
     value the Trade tab shows: Titan's own or FantasyCalc's): the Nth pick gets the Nth-best value
     among the players drafted. In an auction the spots follow price, so the Nth-dearest player
     should be the Nth most valuable. Keepers aren't graded, since nobody chose them there. Each
     pick gets its value (v), its spot's (exp), the difference (gain), its place by value (vrank),
     its place at its position taken and by value (posTaken, posNow) and a tag when its gain is a
     spread or more either way ('steal', 'reach'). Each team gets its
     total gain, its best and worst pick, and a grade from how many spreads its total sits from the
     league's average (A+ down to D). Teams best first. */
  var DRAFT_GRADES = [[1.5, 'A+'], [1, 'A'], [0.5, 'A-'], [0.2, 'B+'], [-0.2, 'B'], [-0.5, 'B-'], [-1, 'C+'], [-1.5, 'C'], [-Infinity, 'D']];
  function draftGrades(draft, value) {
    var picks = ((draft && draft.picks) || []).map(function (p) {
      var v = Number(value(p));
      return Object.assign({}, p, {v: v > 0 ? v : 0, exp: null, gain: null, vrank: 0, posTaken: 0, posNow: 0, tag: ''});
    });
    var graded = picks.filter(function (p) { return !p.keeper; });
    var auction = draft && draft.type === 'auction';
    var bySpot = graded.slice().sort(function (a, b) { return auction ? b.amount - a.amount || a.no - b.no : a.no - b.no; });
    var byValue = graded.slice().sort(function (a, b) { return b.v - a.v || a.no - b.no; });
    byValue.forEach(function (p, i) { p.vrank = i + 1; });
    bySpot.forEach(function (p, i) { p.exp = byValue[i].v; p.gain = p.v - p.exp; });
    // His place at his position: the Nth taken there, and the Nth there by value now ("RB5 taken, RB2 now").
    var taken = {}, now = {};
    bySpot.forEach(function (p) { p.posTaken = taken[p.pos] = (taken[p.pos] || 0) + 1; });
    byValue.forEach(function (p) { p.posNow = now[p.pos] = (now[p.pos] || 0) + 1; });
    var sd = spread(graded.map(function (p) { return p.gain; }));
    graded.forEach(function (p) { p.tag = sd && p.gain >= sd ? 'steal' : sd && p.gain <= -sd ? 'reach' : ''; });
    var byTeam = {}, teams = [];
    picks.forEach(function (p) {
      if (!byTeam[p.team]) teams.push(byTeam[p.team] = {team: p.team, slot: p.slot, picks: [], total: 0, best: null, worst: null, grade: 'B'});
      var t = byTeam[p.team];
      t.picks.push(p);
      if (p.keeper) return;
      t.total += p.gain;
      if (p.gain > 0 && (!t.best || p.gain > t.best.gain)) t.best = p;
      if (p.gain < 0 && (!t.worst || p.gain < t.worst.gain)) t.worst = p;
    });
    var totals = teams.map(function (t) { return t.total; }), tsd = spread(totals);
    var mean = totals.reduce(function (s, x) { return s + x; }, 0) / (totals.length || 1);
    teams.forEach(function (t) {
      var z = tsd ? (t.total - mean) / tsd : 0;
      t.grade = DRAFT_GRADES.filter(function (g) { return z >= g[0]; })[0][1];
    });
    teams.sort(function (a, b) { return b.total - a.total || a.slot - b.slot; });
    // valued: how many graded picks have any value at all (few in a dynasty rookie draft by this season's projections).
    return {picks: picks, teams: teams, graded: graded.length, valued: graded.filter(function (p) { return p.v > 0; }).length};
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

  /* The game's pull on a player's projection, as a share to add to one: his team's expected points
     against the average side this week (the betting lines in the game context), ENV_TILT of the
     difference and never past ENV_CAP either way. A team expected to score 27 when the average
     side is expected to score 22.5 lifts its players 8%; one expected to score 18 drops them 8%.
     Zero without a line for his game, or with fewer than four sides priced. */
  var ENV_TILT = 0.4, ENV_CAP = 0.1;
  function impliedTilt(ctx, team) {
    var teams = ctx && ctx.teams, t = teams && teams[teamAbbr(team)];
    if (!t || !t.implied) return 0;
    var all = [], k;
    for (k in teams) if (teams[k] && teams[k].implied) all.push(teams[k].implied);
    if (all.length < 4) return 0;
    var avg = all.reduce(function (a, b) { return a + b; }, 0) / all.length;
    return Math.max(-ENV_CAP, Math.min(ENV_CAP, ENV_TILT * (t.implied / avg - 1)));
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

  /* Strength of schedule by position, from the points each defense gives up (dvpFrom's teams, rank 1
     giving up the most): for every NFL team, its remaining opponents from week `from` and the average
     of their ranks at `pos` over each span (a low average is an easy stretch). spans: {next4: [from,
     from + 3], ros: [from, 17], playoffs: [15, 17]}. [{team, opps: [{week, opp, home, rank}], spans:
     {next4, ros, playoffs}}], easiest rest of season first. */
  function scheduleStrength(schedule, dvp, pos, from, spans) {
    var byTeam = {};
    from = Number(from) || 1;
    (schedule || []).forEach(function (g) {
      var w = Number(g.week);
      if (!w || w < from || !g.home || !g.away) return;
      var h = teamAbbr(g.home), a = teamAbbr(g.away);
      (byTeam[h] = byTeam[h] || []).push({week: w, opp: a, home: true});
      (byTeam[a] = byTeam[a] || []).push({week: w, opp: h, home: false});
    });
    var rankOf = function (opp) { var d = dvp && dvp[opp] && dvp[opp][pos]; return d ? d.rank : null; };
    var out = Object.keys(byTeam).map(function (t) {
      var opps = byTeam[t].sort(function (a, b) { return a.week - b.week; })
        .map(function (o) { return {week: o.week, opp: o.opp, home: o.home, rank: rankOf(o.opp)}; });
      var avg = function (lo, hi) {
        var v = opps.filter(function (o) { return o.week >= lo && o.week <= hi && o.rank !== null; }).map(function (o) { return o.rank; });
        return v.length ? round1(v.reduce(function (s, x) { return s + x; }, 0) / v.length) : null;
      };
      var sp = {};
      Object.keys(spans || {}).forEach(function (k) { sp[k] = avg(spans[k][0], spans[k][1]); });
      return {team: t, opps: opps, spans: sp};
    });
    var key = function (r) { return r.spans.ros === null || r.spans.ros === undefined ? Infinity : r.spans.ros; };
    out.sort(function (a, b) { return key(a) - key(b) || a.team.localeCompare(b.team); });
    return out;
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

  var SD_PRIOR = 4; // games' worth of the league's swing blended into each team's own (standings)

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
       give or take its own usual swing, steadied by the league's.
     - Divisions (each team's `division`, when the league has two or more): the best record
       in each division takes a playoff spot; opts.seedType 0 (Sleeper's default, ESPN's way)
       seeds the winners first, 1 seeds them by record among everyone, 2 ignores divisions.
     - Power ranks all-play rate, points per game and expected points, each against the
       league (before any games, expected points alone). */
  function standings(teams, games, proj, opts) {
    opts = opts || {};
    proj = proj || {};
    var ids = teams.map(function (t) { return String(t.id); }), T = {}, byWeek = {};
    teams.forEach(function (t) {
      T[String(t.id)] = {id: String(t.id), name: t.name, w: 0, l: 0, t: 0, pf: 0, pa: 0, g: 0, apW: 0, apL: 0, apT: 0, division: Number(t.division) || 0};
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
    // Each team's own swing: the spread of its weekly scores, steadied by the league's (four games' worth) while
    // few are played, so a streaky team's odds are wider than a steady one's.
    var scoresOf = {};
    Object.keys(byWeek).forEach(function (week) {
      var s = byWeek[week];
      Object.keys(s).forEach(function (i) { (scoresOf[i] = scoresOf[i] || []).push(s[i]); });
    });
    ids.forEach(function (i) {
      var sc = scoresOf[i] || [], g = sc.length, v = 0;
      if (g >= 2) {
        var m = sc.reduce(function (a, b) { return a + b; }, 0) / g;
        v = sc.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (g - 1);
      }
      T[i].sd = Math.min(45, Math.max(8, Math.sqrt((v * (g >= 2 ? g : 0) + sd * sd * SD_PRIOR) / ((g >= 2 ? g : 0) + SD_PRIOR))));
    });

    var left = (games || []).filter(function (m) { return !m.done && T[String(m.a)] && T[String(m.b)]; });
    var n = Math.max(1, opts.sims || 5000), spots = Math.min(opts.playoffTeams || 6, ids.length), rand = seeded(opts.seed || 7);
    // Divisions: each one's best record is in. Seeds by opts.seedType (0 winners first, 1 by record, 2 no divisions).
    var seedType = Number(opts.seedType) || 0, divList = [];
    ids.forEach(function (i) { var d = T[i].division; if (d && divList.indexOf(d) < 0) divList.push(d); });
    var useDivs = seedType !== 2 && divList.length >= 2 && spots >= divList.length;
    /* The playoff order from a standings order (best first): the division winners (the first of each division)
       take a spot each, the rest of the spots go by the order; seedType 0 puts the winners at the top. */
    var seedsFrom = function (order) {
      if (!useDivs) return order;
      var won = {}, winners = [];
      order.forEach(function (i) { var d = T[i].division; if (d && !won[d]) { won[d] = 1; winners.push(i); } });
      var others = order.filter(function (i) { return !won[i] || winners.indexOf(i) < 0; }).filter(function (i) { return winners.indexOf(i) < 0; });
      var rest = others.slice(0, Math.max(0, spots - winners.length)), out = others.slice(Math.max(0, spots - winners.length));
      var inside = seedType === 0 ? winners.concat(rest) : order.filter(function (i) { return winners.indexOf(i) >= 0 || rest.indexOf(i) >= 0; });
      return inside.concat(out);
    };
    ids.forEach(function (i) { T[i].inN = 0; T[i].topN = 0; T[i].winSum = 0; });
    for (var k = 0; k < n; k++) {
      var w = {}, pf = {};
      ids.forEach(function (i) { w[i] = T[i].w + T[i].t / 2; pf[i] = T[i].pf; });
      left.forEach(function (m) {
        var a = String(m.a), b = String(m.b);
        var ap = T[a].mean + T[a].sd * normal(rand), bp = T[b].mean + T[b].sd * normal(rand);
        pf[a] += ap; pf[b] += bp;
        w[ap > bp ? a : b]++;
      });
      seedsFrom(ids.slice().sort(function (x, y) { return w[y] - w[x] || pf[y] - pf[x]; })).forEach(function (i, at) {
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
      return {id: i, name: t.name, division: t.division, wins: t.w, losses: t.l, ties: t.t, games: t.g, pf: round2(t.pf), pa: round2(t.pa), sd: round2(t.sd),
        allPlay: {w: t.apW, l: t.apL, t: t.apT}, luck: apG ? round2(t.w + t.t / 2 - (t.apW + t.apT / 2) / apG * t.g) : 0,
        expected: round2(t.mean), power: played.length ? 0.5 * zA[j] + 0.3 * zP[j] + 0.2 * zE[j] : zE[j],
        playoffs: t.inN / n, top: t.topN / n, projWins: round2(t.winSum / n), divWinner: false};
    });
    out.slice().sort(function (a, b) { return b.power - a.power; }).forEach(function (r, x) { r.powerRank = x + 1; });
    // Standings order: wins, then points; before any games (all even), projected strength. Then the playoff seeds
    // as the league would draw them today (division winners in, by seedType).
    out.sort(function (a, b) { return (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf || b.power - a.power; });
    var byId = {};
    out.forEach(function (r) { byId[r.id] = r; });
    var seedOrder = seedsFrom(out.map(function (r) { return r.id; }));
    if (useDivs) {
      var won = {};
      out.forEach(function (r) { if (r.division && !won[r.division]) { won[r.division] = 1; r.divWinner = true; } });
    }
    var ordered = seedOrder.map(function (id) { return byId[id]; });
    ordered.forEach(function (r, x) { r.seed = x + 1; });
    return {teams: ordered, spots: spots, sims: n, left: left.length, divisions: useDivs ? divList.length : 0};
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
    if (flex) extendOverall(rows);
    return {rows: rows, skipped: skipped, format: 'wide',
      error: rows.length ? '' : 'Found the position columns but no player rows.'};
  }

  /* Past the end of a file's FLEX (overall) list, RB, WR and TE rows carry the 1000+ sentinel, which orders them by
     position rank alone: TE25 ahead of WR47 whatever the positions are worth. This gives each such player an
     estimated overall rank instead, from how his position's ranks map onto the overall list (a straight line fitted
     to the listed pairs of position rank and overall rank), kept behind everyone the list names. Rows get `est`
     so the note can say the number is an estimate. Positions with too few listed players keep the sentinel. */
  function extendOverall(rows) {
    var fits = {}, listMax = 0, lastPR = {};
    rows.forEach(function (r) {
      if (!SLOT_POS.FLEX[r.pos] || r.rank >= 1000 || r.posRank === null || r.posRank === undefined) return;
      (fits[r.pos] = fits[r.pos] || []).push([Number(r.posRank), Number(r.rank)]);
      if (r.rank > listMax) listMax = r.rank;
      if (!lastPR[r.pos] || Number(r.posRank) > lastPR[r.pos]) lastPR[r.pos] = Number(r.posRank);
    });
    // The slope of each position's line (overall ranks per position rank), from the listed pairs.
    var slope = {};
    Object.keys(fits).forEach(function (pos) {
      var pts = fits[pos];
      if (pts.length < 3) return;
      var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
      var d = n * sxx - sx * sx;
      if (!d) return;
      var b = (n * sxy - sx * sy) / d;
      if (b > 0) slope[pos] = b;
    });
    // Past the list, each position's line continues from the list's end: always behind everyone listed, and in
    // position-rank order within a position.
    rows.forEach(function (r) {
      if (!SLOT_POS.FLEX[r.pos] || r.rank < 1000 || !slope[r.pos]) return;
      r.rank = listMax + Math.max(1, Math.round(slope[r.pos] * (Number(r.posRank) - lastPR[r.pos])));
      r.est = true;
    });
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

  /* Several rankings for one week combined into a single list (Import multiple sources), in
     the rows an import saves. sources: [{name, rows (parseRanks' rows), weight}]. Each
     position is combined on its own: a player's place at his position in every source that
     ranks the position (one below its last player there when it leaves him out), averaged by
     the sources' weights; a tie goes to the player more sources rank, then by name. QB, K and
     DEF keep that positional rank. RB, WR and TE also need one overall (FLEX) scale so FLEX
     spots compare them fairly, so the positions are fitted together the way the sources with
     an overall list do it (where their Nth RB lands among their RBs, WRs and TEs, averaged), or
     opts.curve's (Titan's default rankings) when none has one; past every overall list a
     player gets 1000 + his position rank, as a rankings file does. {rows, players (name, pos,
     team, posRank, rank, ranks: {source: his place there}), sources, fitted (the lists FLEX
     follows), warning}. */
  function combineRanks(sources, opts) {
    opts = opts || {};
    var FLEX3 = {RB: 1, WR: 1, TE: 1};
    var byRank = function (a, b) { return rankKey(a) - rankKey(b); };
    var onFlexList = function (r) { return FLEX3[r.pos] && r.rank !== null && r.rank !== undefined && r.rank < 1000; };
    // A list ranks RB, WR and TE on one overall scale when two or more of them share it without repeating a rank.
    var hasFlexScale = function (rows) {
      var seen = {}, pos = {}, list = (rows || []).filter(onFlexList);
      for (var i = 0; i < list.length; i++) {
        if (seen[list[i].rank]) return false;
        seen[list[i].rank] = 1;
        pos[list[i].pos] = 1;
      }
      return Object.keys(pos).length >= 2;
    };
    // Where a list's Nth RB (WR, TE) lands among its RBs, WRs and TEs: {RB: [place of RB1, RB2, ...]}.
    var flexCurve = function (rows) {
      var out = {};
      rows.filter(onFlexList).sort(byRank).forEach(function (r, i) { (out[r.pos] = out[r.pos] || []).push(i + 1); });
      return out;
    };
    var srcs = (sources || []).filter(function (s) { return s && s.rows && s.rows.length && Number(s.weight) > 0; });
    var players = {}, list = [];
    var orders = srcs.map(function (s) {
      var byPos = {}, place = {}, count = {};
      s.rows.forEach(function (r) { if (POSITIONS[r.pos]) (byPos[r.pos] = byPos[r.pos] || []).push(r); });
      Object.keys(byPos).forEach(function (p) {
        var k = 0;
        byPos[p].slice().sort(byRank).forEach(function (r) {
          var key = norm(r.name) + '|' + p;
          if (place[key]) return;
          place[key] = ++k;
          var pl = players[key];
          if (!pl) list.push(pl = players[key] = {name: r.name, pos: p, team: r.team || '', opp: r.opp || '', ranks: {}});
          if (!pl.team && r.team) pl.team = r.team;
          if (!pl.opp && r.opp) pl.opp = r.opp;
          pl.ranks[s.name] = k;
        });
        count[p] = k;
      });
      return {name: s.name, weight: Number(s.weight), place: place, count: count, rows: s.rows};
    });
    list.forEach(function (pl) {
      var key = norm(pl.name) + '|' + pl.pos, sum = 0, wsum = 0, n = 0;
      orders.forEach(function (o) {
        if (!o.count[pl.pos]) return;
        var at = o.place[key];
        if (at) n++;
        sum += o.weight * (at || o.count[pl.pos] + 1);
        wsum += o.weight;
      });
      pl.score = sum / wsum;
      pl.n = n;
    });
    var byPos = {};
    list.forEach(function (pl) { (byPos[pl.pos] = byPos[pl.pos] || []).push(pl); });
    Object.keys(byPos).forEach(function (p) {
      byPos[p].sort(function (a, b) { return a.score - b.score || b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); })
        .forEach(function (pl, i) { pl.posRank = i + 1; });
    });
    // RB, WR and TE onto one overall scale, the way the overall lists fit them together.
    var fitted = orders.filter(function (o) { return hasFlexScale(o.rows); });
    var curves = fitted.map(function (o) { return {c: flexCurve(o.rows), w: o.weight}; });
    var names = fitted.map(function (o) { return o.name; });
    if (!curves.length && opts.curve && hasFlexScale(opts.curve)) {
      curves = [{c: flexCurve(opts.curve), w: 1}];
      names = [opts.curveName || 'default rankings'];
    }
    var flex = [];
    Object.keys(FLEX3).forEach(function (p) {
      var last = 0;
      (byPos[p] || []).forEach(function (pl) {
        var sum = 0, wsum = 0;
        curves.forEach(function (x) {
          var v = (x.c[p] || [])[pl.posRank - 1];
          if (v !== undefined) { sum += x.w * v; wsum += x.w; }
        });
        if (!wsum) return;
        // Never ahead of the player above him at his position.
        pl.at = last = Math.max(sum / wsum, last + 1e-6);
        flex.push(pl);
      });
    });
    flex.sort(function (a, b) { return a.at - b.at || a.posRank - b.posRank; }).forEach(function (pl, i) { pl.rank = i + 1; });
    list.forEach(function (pl) { if (!pl.rank) pl.rank = FLEX3[pl.pos] ? 1000 + pl.posRank : pl.posRank; });
    var warning = list.some(function (pl) { return FLEX3[pl.pos]; }) && !curves.length
      ? 'None of these sources ranks RB, WR and TE on one overall list, so FLEX spots can\'t compare them fairly. ' +
        'Add one that does (FantasyPros\' FLEX rankings, say), or count Titan\'s default rankings too.' : '';
    list.sort(function (a, b) { return DEFAULT_POS.indexOf(a.pos) - DEFAULT_POS.indexOf(b.pos) || a.posRank - b.posRank; });
    return {
      rows: list.map(function (pl) { return {name: pl.name, pos: pl.pos, team: pl.team, rank: pl.rank, opp: pl.opp, implied: '', tier: '', posRank: pl.posRank}; }),
      players: list.map(function (pl) { return {name: pl.name, pos: pl.pos, team: pl.team, posRank: pl.posRank, rank: pl.rank, ranks: pl.ranks, n: pl.n}; }),
      sources: orders.map(function (o) { return o.name; }), fitted: names, warning: warning
    };
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
        opp: w.opp, implied: w.implied, tier: w.tier, posRank: w.posRank, est: !!w.est};
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
  // `cfg`: the league ({ppr, scoring}), or just its points per catch.
  function defaultRanks(projMap, players, cfg) {
    var list = [], seen = {}, count = {}, out = [];
    for (var id in projMap || {}) {
      var info = playerInfo(players, id);
      if (DEFAULT_POS.indexOf(info.pos) < 0) continue;
      var pts = projFor(projMap, id, cfg);
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
    var plain = null, byScoring = {};
    return function (cfg) {
      if (!fill) return plain || (plain = weeklyMap(rows));
      // One map per distinct scoring (points per catch and the rest).
      var key = (Number(cfg && cfg.ppr) || 0) + '|' + JSON.stringify((cfg && cfg.scoring) || {});
      if (!byScoring[key]) {
        var gaps = defaultRanks(projMap, players, cfg).filter(function (r) { return !have[r.pos]; });
        // The imported rows go last, so on a shared name the import wins.
        byScoring[key] = weeklyMap(gaps.concat(rows || []));
      }
      return byScoring[key];
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

  /* A later week's lineups, for planning (Lineups' week dropdown): a copy of the snapshot as that week
     will start, from Sleeper's schedule. No game has started, so nothing is locked or scored; each player
     gets his team's game day and opponent (none on bye); and only injury tags that outlast a game (IR,
     PUP, suspended and the like) still bench him, since today's Out or Doubtful is about this week.
     The snapshot itself is left as it was. */
  /* A Sleeper league's team page, where its lineup is set: the same plain web link on every device. Sleeper's apps
     take only their chat pages from outside (/channels, /topics, /topic and /message in its app link files, checked
     2026-09-16), so an Android intent aimed at the app for a league page can't resolve, and Chrome sent it to the
     Play Store even with Sleeper installed (the owner's phone, 2026-09-16; v1.34.1 to v1.47.1 did that). A plain
     link opens the league on sleeper.com, and Android would hand it to the app by itself if Sleeper ever claims
     league pages. */
  function sleeperTeamUrl(id) {
    return 'https://sleeper.com/leagues/' + encodeURIComponent(id) + '/team';
  }

  var LASTING = {IR: 1, PUP: 1, Sus: 1, NA: 1, DNR: 1};
  function planWeek(snap, schedule, week) {
    var games = {}, opp = {};
    (schedule || []).forEach(function (g) {
      if (Number(g.week) !== Number(week) || !g.home || !g.away) return;
      var h = teamAbbr(g.home), a = teamAbbr(g.away);
      games[h] = {state: 'pre', kick: g.date || ''};
      games[a] = {state: 'pre', kick: g.date || ''};
      opp[h] = a;
      opp[a] = h;
    });
    var copy = function (o) { var c = {}; for (var k in o) c[k] = o[k]; return c; };
    var out = copy(snap || {});
    out.week = Number(week);
    out.games = games;
    out.kickoffs = {};
    out.leagues = ((snap && snap.leagues) || []).map(function (d) {
      var l = copy(d);
      l.roster = d.roster.map(function (p) {
        var q = copy(p), t = teamAbbr(p.team), g = games[t];
        q.locked = false;
        q.game = g ? 'pre' : '';
        q.kick = g ? g.kick : '';
        q.pts = null;
        q.opp = opp[t] || '';
        q.outish = !!(p.inj && LASTING[p.inj.split(' ')[0]]);
        return q;
      });
      return l;
    });
    return out;
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

  /* A head-to-head in plain words, for the Matchup tab. Each side: {pts (so far), proj,
     started (one of its starters' games has begun), done (every started game is over)}.
     Before any game it goes by projections ('Projected to win by 9.9'), while games are on
     by points ('Winning by 14.3', 'Tied'), and once both sides are done it's the result
     ('Won by 12.4'). {phase ('pre', 'live' or 'final'), lead (1 ahead, -1 behind, 0 level),
     by (the margin), text}. */
  function matchStatus(a, b) {
    var phase = a.done && b.done ? 'final' : a.started || b.started ? 'live' : 'pre';
    var diff = Math.round(((phase === 'pre' ? a.proj - b.proj : a.pts - b.pts) || 0) * 10) / 10;
    var lead = diff > 0 ? 1 : diff < 0 ? -1 : 0, by = Math.abs(diff).toFixed(1);
    var text = phase === 'pre' ? (lead ? 'Projected to ' + (lead > 0 ? 'win' : 'lose') + ' by ' + by : 'Projected to tie')
      : phase === 'final' ? (lead ? (lead > 0 ? 'Won' : 'Lost') + ' by ' + by : 'Tied')
      : lead ? (lead > 0 ? 'Winning' : 'Losing') + ' by ' + by : 'Tied';
    return {phase: phase, lead: lead, by: Math.abs(diff), text: text};
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

  /* A player's floor and ceiling this week: his projection give or take his usual swing. The swing is
     a share of his projection (a coefficient of variation): his own, from his points in the weeks
     given (Sleeper's stats as fetchStats trims them, PPR points), blended with his position's usual
     share (a few games' worth of prior, SPREAD_PRIOR) so one big week doesn't set it. Floor and
     ceiling sit about 0.85 swings out (near the 20th and 80th percentiles). Null without a
     projection. {sd, floor, ceiling, games}. */
  var SPREAD_CV = {QB: 0.35, RB: 0.5, WR: 0.55, TE: 0.6, K: 0.45, DEF: 0.6};
  var SPREAD_PRIOR = 4, SPREAD_Z = 0.85;
  function spreadOf(weeks, id, pos, proj) {
    proj = Number(proj);
    if (!proj || proj <= 0) return null;
    var pts = [];
    (weeks || []).forEach(function (m) {
      var s = m && m[id];
      if (s && (Number(s.gp) || Number(s.snp))) pts.push(Number(s.ppr) || 0);
    });
    var prior = SPREAD_CV[pos] || 0.5, n = pts.length, cv = prior;
    if (n >= 2) {
      var mean = pts.reduce(function (a, b) { return a + b; }, 0) / n;
      var own = mean > 0 ? Math.sqrt(pts.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (n - 1)) / mean : prior;
      cv = (own * n + prior * SPREAD_PRIOR) / (n + SPREAD_PRIOR);
    }
    var sd = round2(proj * cv);
    return {sd: sd, floor: round2(Math.max(0, proj - SPREAD_Z * sd)), ceiling: round2(proj + SPREAD_Z * sd), games: n};
  }

  /* The close calls in a lineup: a starter (from `opt`, the recommended lineup) and a bench player at
     his position ranked within CLOSE spots of him, neither locked, hurt or on bye. The weakest
     starters pair first (a bench player's real rival is the lowest-ranked starter at his position),
     one pair per starter (the nearest bench player), each bench player once. [{starter, bench}]. */
  /* Whether two players are close by the rankings: with tiers on both (the weekly rankings' tier column), the same
     tier is close whatever the rank gap and a different tier never is (tiers over rankings); without, within CLOSE
     ranks of each other. */
  function closeByRank(a, b) {
    var ta = Number(a.tier), tb = Number(b.tier);
    var tiered = a.tier !== '' && a.tier !== null && a.tier !== undefined && isFinite(ta) && b.tier !== '' && b.tier !== null && b.tier !== undefined && isFinite(tb);
    return tiered ? ta === tb : Math.abs(a.rank - b.rank) <= CLOSE;
  }
  function closeCallPairs(opt, roster) {
    var starting = {}, out = [], taken = {};
    (opt || []).forEach(function (o) { if (o.p) starting[o.p.id] = 1; });
    var bench = (roster || []).filter(function (p) {
      return !starting[p.id] && !p.held && !p.locked && !p.outish && !p.onBye && p.rank !== null && p.rank !== undefined;
    });
    var starters = (opt || []).filter(function (o) {
      var s = o.p;
      return s && !s.locked && !s.outish && !s.onBye && s.rank !== null && s.rank !== undefined;
    }).sort(function (a, b) { return b.p.rank - a.p.rank; });
    starters.forEach(function (o) {
      var s = o.p;
      var best = null;
      bench.forEach(function (b) {
        if (taken[b.id] || b.pos !== s.pos || !closeByRank(b, s)) return;
        if (!best || Math.abs(b.rank - s.rank) < Math.abs(best.rank - s.rank)) best = b;
      });
      if (best) { taken[best.id] = 1; out.push({starter: s, bench: best}); }
    });
    return out;
  }

  /* Where the projections disagree with the rankings (a note on Lineups that never changes the call): a bench player
     whose matchup-tilted projection beats a starter's at his position by DISAGREE points or more while the rankings
     don't call them close (a close call already flips on TILT_MARGIN in analyzeLeague, so these are the wide gaps:
     a different tier, or more than CLOSE ranks apart). tilt(p) is the tilted projection in the league's scoring.
     [{starter, bench, a, b}], the widest gap first, each player once, at most three. */
  var DISAGREE = 3;
  function disagreements(opt, roster, tilt) {
    var starting = {}, out = [];
    (opt || []).forEach(function (o) { if (o.p) starting[o.p.id] = 1; });
    var bench = (roster || []).filter(function (p) {
      return !starting[p.id] && !p.held && !p.locked && !p.outish && !p.onBye && p.rank !== null && p.rank !== undefined;
    });
    (opt || []).forEach(function (o) {
      var s = o.p;
      if (!s || s.locked || s.outish || s.onBye || s.rank === null || s.rank === undefined) return;
      var a = Number(tilt(s));
      if (!isFinite(a)) return;
      bench.forEach(function (p) {
        if (p.pos !== s.pos || closeByRank(p, s)) return;
        var b = Number(tilt(p));
        if (!isFinite(b) || b - a < DISAGREE) return;
        out.push({starter: s, bench: p, a: round1(a), b: round1(b)});
      });
    });
    out.sort(function (x, y) { return (y.b - y.a) - (x.b - x.a); });
    var seen = {}, keep = [];
    out.forEach(function (x) {
      if (seen[x.starter.id] || seen[x.bench.id]) return;
      seen[x.starter.id] = seen[x.bench.id] = 1;
      keep.push(x);
    });
    return keep.slice(0, 3);
  }

  /* Close calls graded (Results): each call recorded before kickoff (pick: the player Titan started, other: the bench
     player the rankings called it close with, flip: the matchup tilt made the pick over the rankings) against the
     points each scored. ptsOf(id) gives a player's points, or null while he hasn't played. Counts only the calls where
     both have played: {n, right, flips: {n, right}, ranks: {n, right}, rows: [{pick, other, flip, league, slot, a, b,
     pickPts, otherPts, margin, right}]}. A call is right when the pick outscored the other. */
  function gradeCalls(calls, ptsOf) {
    var out = {n: 0, right: 0, flips: {n: 0, right: 0}, ranks: {n: 0, right: 0}, rows: []};
    (calls || []).forEach(function (c) {
      if (!c || !c.pick || !c.other) return;
      var a = ptsOf(c.pick.id), b = ptsOf(c.other.id);
      var done = typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b);
      var row = {pick: c.pick, other: c.other, flip: !!c.flip, league: c.league, slot: c.slot, a: c.a, b: c.b,
        pickPts: done ? round2(a) : null, otherPts: done ? round2(b) : null, margin: done ? round2(a - b) : null, right: done ? a > b : null};
      out.rows.push(row);
      if (!done) return;
      out.n++;
      if (row.right) out.right++;
      var g = c.flip ? out.flips : out.ranks;
      g.n++;
      if (row.right) g.right++;
    });
    return out;
  }

  /* The nudge before kickoff (the extension): items [{league, text, kick}] still to do, each with the kickoff (ms) it
     must be done by. The ones due within `lead` ms of now (and not past) make one notice, keyed by the earliest of
     their kickoffs so it's shown once: {key, kick, mins, title, lines}, or null when nothing is due. */
  function kickoffNudge(items, now, lead) {
    var due = (items || []).filter(function (i) { return i && i.kick && i.kick > now && i.kick - now <= lead; });
    if (!due.length) return null;
    var kick = Math.min.apply(null, due.map(function (i) { return i.kick; }));
    var mins = Math.max(1, Math.round((kick - now) / 60000));
    var lines = due.map(function (i) { return (i.league ? i.league + ': ' : '') + i.text; });
    return {key: String(kick), kick: kick, mins: mins, lines: lines,
      title: (due.length === 1 ? '1 thing' : due.length + ' things') + ' to do before kickoff (' + mins + ' min)'};
  }

  /* A trade offer as text (the Trade tab's "Paste an offer"): "give A, B get C", "A and B for C", "I give A for your B",
     "Team X offered A for your B", "you receive A; you send B". Each side's names, in the order written:
     {give: [names], get: [names]}, or null when a side is missing. Which side is really yours is settled by the rosters
     (the app swaps them when the "give" names sit on another team), so the writer's point of view doesn't matter. */
  var OFFER_GIVE = /\b(give|gives|gave|giving|given|send|sends|sent|sending|offer|offers|offered|offering|trade away|trading away)\b/;
  var OFFER_GET = /\b(get|gets|got|getting|receive|receives|received|receiving|in return for|in exchange for|for)\b/;
  var OFFER_WORDS = new RegExp('(' + OFFER_GIVE.source.slice(2, -2) + '|' + OFFER_GET.source.slice(2, -2) + ')\\b:?', 'gi');
  function parseOffer(text) {
    var t = String(text || '').replace(/\s+/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
    if (!t) return null;
    var parts = [], last = 0, lead = '', m, side = null;
    OFFER_WORDS.lastIndex = 0;
    while ((m = OFFER_WORDS.exec(t))) {
      var before = t.slice(last, m.index);
      if (side) parts.push([side, before]); else lead = before;
      side = OFFER_GIVE.test(m[0].toLowerCase()) ? 'give' : 'get';
      last = m.index + m[0].length;
    }
    if (side) parts.push([side, t.slice(last)]);
    // "A and B for C": the names before a get-word are what's given.
    if (lead.trim() && parts.length && parts[0][0] === 'get') parts.unshift(['give', lead]);
    if (!parts.length) return null;
    var names = function (s) {
      return s.split(/,|;|\+|&|\band\b|\bplus\b|\bwith\b/i).map(function (x) {
        return x.replace(/\b(my|your|their|his|our|the|a|an|you|i|me|them|they|we|us|player|players|trade|offer|to|from|would|will|can|team)\b/gi, ' ')
          .replace(/[^A-Za-z.'’\- ]/g, ' ').replace(/\s+/g, ' ').trim();
      }).filter(function (x) { return x.length >= 3 && /[a-z]/i.test(x); });
    };
    var out = {give: [], get: []};
    parts.forEach(function (p) { names(p[1]).forEach(function (n) { if (out[p[0]].indexOf(n) < 0) out[p[0]].push(n); }); });
    return out.give.length && out.get.length ? out : null;
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
      q.opp = w && w.opp ? w.opp : (p.opp || ''); // a planned week's opponent (planWeek) when the rankings don't say
      q.implied = w ? w.implied : '';
      q.tier = w ? w.tier : '';
      q.posRank = w && w.posRank !== undefined ? w.posRank : '';
      q.est = !!(w && w.est);
      return q;
    });
  }

  /* The three numbers behind a ranked player, for close calls: his overall rank (RB, WR and TE share one scale,
     so this is where he sits among all of them; null for QB, K and DEF, which rank on their own, and for a player
     past the overall list's end), his rank at his position (the file's, else what the rank itself says), and
     his tier (null when the list has none). */
  function rankBits(p) {
    var out = {overall: null, pos: null, tier: null};
    if (!p || p.rank === null || p.rank === undefined) return out;
    var r = Number(p.rank), shared = !!SLOT_POS.FLEX[p.pos];
    if (shared && r < 1000) out.overall = r;
    var pr = p.posRank;
    if (pr !== '' && pr !== null && pr !== undefined && isFinite(Number(pr))) out.pos = Number(pr);
    else if (!shared) out.pos = r;
    else if (r >= 1000) out.pos = r - 1000;
    var t = p.tier;
    if (t !== '' && t !== null && t !== undefined && isFinite(Number(t))) out.tier = Number(t);
    return out;
  }

  /* The note beside a ranked player's label: "#17 overall · RB9 at position · tier 2" (the parts he has). When the
     label is already his rank at the position (a quarterback, or a player past the overall list), only the tier. */
  function rankNote(p) {
    var b = rankBits(p), parts = [];
    if (b.overall !== null) parts.push('#' + b.overall + ' overall' + (p.est ? ' (estimated)' : ''));
    if (b.pos !== null && b.overall !== null) parts.push(p.pos + b.pos + ' at position');
    if (b.tier !== null) parts.push('tier ' + b.tier);
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------ analysis */

  /* opts.tilt(p, cfg): a player's matchup-tilted projection in the league's scoring (the app: Sleeper's
     projection moved by how soft his opponent is to his position). On a close call (closeCallPairs: a bench player within CLOSE
     ranks of a starter at his position) the bench player takes the spot when his tilted projection
     beats the starter's by TILT_MARGIN or more; the swap is recorded in `tilts` so the card can say
     why. The rankings still decide everything that isn't close. */
  var TILT_MARGIN = 1.5;
  function analyzeLeague(d, weekly, week, opts) {
    var slots = d.cfg.lineup;
    // A player whose team is on bye this week can't score: he's benched like an Out player.
    d.roster.forEach(function (p) { p.onBye = !!week && !!p.bye && Number(p.bye) === Number(week); });
    // With no ranks there is no order to follow, so nothing counts as a swap —
    // otherwise every unranked starter would "lose" to an unranked bench player.
    var ranked = Object.keys(weekly).length > 0;
    var act = actualLineup(d.roster, slots);
    var opt = flexLate(optimal(d.roster, slots), act, d.kickAt || function () { return 0; });
    var tilt = opts && typeof opts.tilt === 'function' ? opts.tilt : null, tilts = [];
    if (tilt && ranked) {
      closeCallPairs(opt, d.roster).forEach(function (pair) {
        var a = Number(tilt(pair.starter, d.cfg)), b = Number(tilt(pair.bench, d.cfg));
        if (!isFinite(a) || !isFinite(b) || b - a < TILT_MARGIN) return;
        opt.forEach(function (o) { if (o.p && o.p.id === pair.starter.id) o.p = pair.bench; });
        tilts.push({inn: pair.bench, out: pair.starter, by: round1(b - a)});
      });
      if (tilts.length) opt = flexLate(opt, act, d.kickAt || function () { return 0; });
    }
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
    return {cfg: d.cfg, roster: d.roster, rows: rows, moves: moves, wire: wire, hurt: hurt, stops: stops, opt: opt, tilts: tilts,
      takenNorm: d.takenNorm, takenAbbr: d.takenAbbr}; // who's rostered in the league (Waivers)
  }

  /* `weekly` is one rankings map for every league, or a function of a league's
     settings that returns its map (rankingsBy). opts: analyzeLeague's (tilt). */
  function analyzeAll(snap, weekly, opts) {
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
      }, wk, snap && snap.week, opts);
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
    // The players you lean on most first: by how many of your lineups start him, then how many teams own him.
    var rows = Object.keys(own).filter(function (n) { return own[n].length >= 2; })
      .sort(function (a, b) { return starts[b] - starts[a] || own[b].length - own[a].length || a.localeCompare(b); })
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
  var LONG_OUT = LASTING; // the same idea as planWeek's: an injury that outlasts a week
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
  /* Sleeper's projections come with standard points (pts_std), PPR points and the projected stat line
     (pass_td, rec_yd, pass_fd, bonus_rec_te and so on). Titan keeps [standard, receptions, stats]: receptions
     are PPR points minus standard, and the stats are the projected line, rounded, nonzero only, for players
     projected any points. A league's points are then standard + its catch points + its differences from
     Sleeper's standard scoring times the stats (scoringDeltas): standard and PPR leagues come out exactly as
     Sleeper says, and 6-point passing TDs, TE premium, first downs, bonuses and ESPN's -2 interceptions all
     count where a league scores them. Checked 2026-09-15: pts_std is SLEEPER_STD applied to the stat line,
     to within rounding, for every position. */
  var NOT_A_STAT = /^(pts_|adp_|pos_adp|gp$)/;
  function trimProjections(list) {
    var map = {};
    (list || []).forEach(function (e) {
      if (!e || e.player_id === undefined || !e.stats) return;
      var std = Number(e.stats.pts_std), full = Number(e.stats.pts_ppr);
      if (!isFinite(std) && !isFinite(full)) return;
      if (!isFinite(std)) std = full;
      if (!isFinite(full)) full = std;
      var entry = [round2(std), round2(full - std)];
      if (std > 0.05 || full > 0.05) {
        var stats = {}, any = false;
        for (var k in e.stats) {
          if (NOT_A_STAT.test(k)) continue;
          var v = round2(Number(e.stats[k]));
          if (v) { stats[k] = v; any = true; }
        }
        if (any) entry.push(stats);
      }
      map[String(e.player_id)] = entry;
    });
    return map;
  }

  // Sleeper's standard scoring, per projected stat: what pts_std is made of. (Receptions are the PPR setting, kept apart.)
  var SLEEPER_STD = {pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    fum_lost: -2, xpm: 1, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1,
    sack: 1, int: 2, fum_rec: 2, ff: 1, def_td: 6, def_st_td: 6, st_td: 6, safe: 2, blk_kick: 2, def_st_ff: 1, def_st_fum_rec: 1, st_ff: 1, st_fum_rec: 1,
    pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4};
  // The stats Sleeper projects (the ones a league's scoring can be applied to).
  var PROJECTED = ['pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'pass_att', 'pass_cmp', 'pass_inc', 'pass_fd', 'pass_sack', 'pass_cmp_40p', 'pass_int_td',
    'rush_yd', 'rush_td', 'rush_2pt', 'rush_att', 'rush_fd', 'rush_40p', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_tgt', 'rec_fd', 'rec_40p',
    'rec_0_4', 'rec_5_9', 'rec_10_19', 'rec_20_29', 'rec_30_39', 'bonus_rec_te', 'bonus_rec_rb', 'bonus_rec_wr', 'bonus_rush_td_qb', 'fum', 'fum_lost',
    'xpm', 'xpa', 'xpmiss', 'fgm', 'fga', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p', 'fgm_yds', 'fgmiss', 'fgmiss_30_39', 'fgmiss_40_49',
    'sack', 'int', 'ff', 'fum_rec', 'def_td', 'def_st_td', 'st_td', 'def_kr_td', 'def_pr_td', 'pr_td', 'safe', 'blk_kick', 'tkl_loss', 'def_fum_td',
    'def_kr_yd', 'def_pr_yd', 'pr_yd', 'pts_allow', 'pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27', 'pts_allow_28_34',
    'pts_allow_35p', 'yds_allow', 'yds_allow_200_299', 'yds_allow_300_349', 'yds_allow_350_399', 'yds_allow_400_449'];
  var IS_PROJECTED = {};
  PROJECTED.forEach(function (k) { IS_PROJECTED[k] = 1; });

  /* A league's scoring as differences from Sleeper's standard, over the stats Sleeper projects, receptions
     apart (they're cfg.ppr): {} for a league that scores like Sleeper's standard or PPR. `settings` is a Sleeper
     league's scoring_settings, or the same keys built from another site's settings. */
  function scoringDeltas(settings) {
    var out = {};
    for (var k in settings || {}) {
      if (k === 'rec' || !IS_PROJECTED[k]) continue;
      var d = round2((Number(settings[k]) || 0) - (SLEEPER_STD[k] || 0));
      if (Math.abs(d) >= 0.005) out[k] = d;
    }
    return out;
  }

  // A player's projected points in a league: `cfg` is the league ({ppr, scoring}), or just its points per catch.
  function projFor(projMap, id, cfg) {
    var e = projMap && projMap[String(id)];
    if (!e) return null;
    var ppr = typeof cfg === 'number' ? cfg : Number(cfg && cfg.ppr) || 0;
    var pts = e[0] + ppr * e[1];
    var sc = cfg && typeof cfg === 'object' && cfg.scoring, st = e[2];
    if (sc && st) for (var k in sc) if (st[k]) pts += sc[k] * st[k];
    return round2(pts);
  }

  // What a league's scoring does differently, in words, for describeLeague.
  function scoringNotes(cfg) {
    var sc = (cfg && cfg.scoring) || {}, out = [];
    if (sc.pass_td) out.push((4 + sc.pass_td) + '-pt pass TD');
    if (sc.bonus_rec_te > 0) out.push('TE premium');
    return out;
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
          proj: projFor(projMap, p.id, L.cfg),
          call: call[p.id] || (titanSlot[p.id] ? 'START' : 'BENCH'),
          titan: titanSlot[p.id] || '', inj: p.inj || '', locked: !!p.locked, at: now
        };
      });
      out.leagues[id] = {key: L.cfg.key, name: L.cfg.name, ppr: L.cfg.ppr || 0, scoring: L.cfg.scoring || {}, lineup: L.cfg.lineup, players: players};
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
    // The opponent that week: the other team in the same matchup (none on a bye). His score is
    // Sleeper's `points`, or his starters' points added up.
    var opp = null, oppPts = null;
    if (mine.matchup_id !== null && mine.matchup_id !== undefined) {
      for (var o = 0; o < matchups.length; o++) {
        if (matchups[o].matchup_id === mine.matchup_id && String(matchups[o].roster_id) !== String(mineId)) { opp = matchups[o]; break; }
      }
    }
    if (opp) {
      var opts = opp.players_points || {};
      oppPts = round2(opp.points !== undefined && opp.points !== null ? Number(opp.points) || 0
        : (opp.starters || []).reduce(function (t, id) { return t + Number(opts[String(id)] || 0); }, 0));
    }

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
        proj: h && h.proj !== null && h.proj !== undefined ? h.proj : projFor(projMap, id, lg),
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

    return {key: lg.key, name: lg.name, lineup: lg.lineup, actual: actual, byRank: byRank, perfect: perfect,
      opp: oppPts, result: oppPts === null ? null : actual > oppPts ? 'W' : actual < oppPts ? 'L' : 'T',
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
    var T = {actual: 0, byRank: 0, perfect: 0, projActual: 0, projByRank: 0, cw: 0, ct: 0, wins: 0, losses: 0, ties: 0};
    var hist = (history && history.leagues) || {};
    res.leagues.forEach(function (x) {
      var r = scoreLeague(x.cfg, x.rosters, x.matchups, res.userId, res.players, rankingsFor(x.cfg), hist[String(x.cfg.id)], projMap);
      if (r.error) { skipped.push(x.cfg.key + ': ' + r.error); return; }
      rows.push(r);
      T.actual += r.actual; T.byRank += r.byRank; T.perfect += r.perfect;
      T.projActual += r.projActual; T.projByRank += r.projByRank;
      T.cw += r.close.wins; T.ct += r.close.total;
      if (r.result === 'W') T.wins++;
      else if (r.result === 'L') T.losses++;
      else if (r.result === 'T') T.ties++;
    });
    ['actual', 'byRank', 'perfect', 'projActual', 'projByRank'].forEach(function (k) { T[k] = round2(T[k]); });
    T.vsProj = round2(T.actual - T.projActual);
    return {week: res.week, rows: rows, totals: T, skipped: skipped};
  }

  /* Points left on the bench, league by league (Results): in each league the bench player
     who most outscored a starter he could have replaced (his position fits that starter's
     spot). [{key, sat, started, slot, lost}], most points lost first; a league where nobody
     on the bench beat a starter he could replace isn't listed. */
  function benchMistakes(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var line = actualLineup(r.roster || [], r.lineup || []), best = null;
      (r.roster || []).filter(function (p) { return !p.start; }).forEach(function (b) {
        line.forEach(function (o) {
          if (!o.p || !slotFits(o.slot, b.pos)) return;
          var lost = round2(Number(b.pts || 0) - Number(o.p.pts || 0));
          if (lost > 0 && (!best || lost > best.lost)) best = {key: r.key, sat: b, started: o.p, slot: o.slot, lost: lost};
        });
      });
      if (best) out.push(best);
    });
    return out.sort(function (a, b) { return b.lost - a.lost; });
  }

  /* ------------------------------------------------------------ waiver plan */

  /* The week's waiver plan (Waivers): in each league, who to claim, from the rankings' waiver
     targets (analyzeLeague's wire: free agents ranked above the starter they'd replace), and who to
     drop for each claim: the bench player the rankings like least that the team can spare. Never
     someone on IR or the taxi squad, never a kicker or defense for a claim at another position, and
     never the only bench player at a position the lineup starts on its own, unless the claim is at
     that position. Two claims never drop the same player, and each gets the next two as
     alternatives; a roster with open spots needs no drop for as many claims. A free agent is claimed
     once even when he'd fill two kinds of spot. At most three claims a league. "Likes least" goes by
     opts.value(cfg, player), a season-long value (higher is better: the app's is Titan's value, then
     season projected points), so a star on bye this week is safe, then by this week's rank; `keep`
     flags a drop worth more than his claim by that value. leagues: analyzeAll's.
     [{cfg, league, open, claims: [{pos, add, alts, over, drop, dropAlts, thin, keep}]}]. */
  var PLAN_MAX = 3;
  function waiverPlan(leagues, opts) {
    var out = [], val = (opts && opts.value) || null;
    (leagues || []).forEach(function (L) {
      if (!L.wire || !L.wire.length) return;
      var slots = L.cfg.lineup || [], kept = L.roster.filter(function (p) { return !p.held; });
      var bench = kept.filter(function (p) { return !p.start; });
      var open = L.cfg.bench ? Math.max(0, slots.length + Number(L.cfg.bench) - kept.length) : 0, spots = open;
      var own = {}, benchAt = {};
      slots.forEach(function (s) { if (PLAYER_POS[s]) own[s] = 1; });
      bench.forEach(function (p) { benchAt[p.pos] = (benchAt[p.pos] || 0) + 1; });
      var rankOf = function (p) { return p.rank === null || p.rank === undefined ? 1e9 : Number(p.rank); };
      var worth = function (p) { return val ? Number(val(L.cfg, p)) || 0 : 0; };
      var worstFirst = bench.slice().sort(function (a, b) { return worth(a) - worth(b) || rankOf(b) - rankOf(a); });
      var claimed = {}, used = {}, claims = [];
      L.wire.forEach(function (w) {
        if (claims.length >= PLAN_MAX) return;
        var pick = w.list.filter(function (x) { return !claimed[norm(x.name)]; });
        if (!pick.length) return;
        var add = pick[0];
        claimed[norm(add.name)] = 1;
        // A kicker or a defense is only ever swapped for one: the claim (a free agent ranked above the one you start)
        // drops a spare kicker or defense on the bench, else the very one he replaces, and never takes an open spot
        // or a skill player's place.
        if (add.pos === 'K' || add.pos === 'DEF') {
          var same = worstFirst.filter(function (p) { return !used[p.id] && p.pos === add.pos; });
          var swap = same[0] || (w.cur && w.cur.pos === add.pos && !w.cur.locked && !used[w.cur.id] ? w.cur : null);
          if (swap) { used[swap.id] = 1; if (!swap.start) benchAt[swap.pos]--; }
          claims.push({pos: w.pos, add: add, alts: pick.slice(1, 3), over: w.cur || null, drop: swap, thin: false, like: true,
            keep: !!swap && !!val && worth(swap) > worth(add), dropAlts: same.slice(swap === same[0] ? 1 : 0, 2)});
          return;
        }
        var free = worstFirst.filter(function (p) {
          return !used[p.id] && !((p.pos === 'K' || p.pos === 'DEF') && p.pos !== add.pos);
        });
        var can = free.filter(function (p) { return !(own[p.pos] && benchAt[p.pos] === 1 && p.pos !== add.pos); });
        // Every spare bench player is someone's only backup: Titan still names the one it likes least, flagged `thin`.
        var thin = !can.length && free.length > 0;
        if (thin) can = free;
        var drop = spots > 0 ? null : can[0] || null;
        if (drop) { used[drop.id] = 1; benchAt[drop.pos]--; } else if (spots > 0) spots--;
        claims.push({pos: w.pos, add: add, alts: pick.slice(1, 3), over: w.cur || null, drop: drop, thin: !!drop && thin,
          keep: !!drop && !!val && worth(drop) > worth(add),
          dropAlts: can.slice(drop ? 1 : 0, (drop ? 1 : 0) + 2)});
      });
      if (claims.length) out.push({cfg: L.cfg, league: L, open: open, claims: claims});
    });
    return out;
  }

  /* A player's usage over the weeks given (Sleeper's stats, trimmed by fetchStats): games, his share
     of the offense's snaps, and targets, carries, red-zone looks and PPR points a game, and whether
     his snap share is rising or falling (his last game against the ones before, by 10 points or
     more). weeks: [{id: stats}], oldest first. Null when he hasn't played in them. */
  function usageOf(weeks, id) {
    var g = 0, snp = 0, tsnp = 0, tgt = 0, car = 0, rz = 0, pts = 0, shares = [];
    (weeks || []).forEach(function (m) {
      var s = m && m[id];
      if (!s || !(Number(s.gp) || Number(s.snp))) return;
      g++;
      snp += s.snp || 0; tsnp += s.tsnp || 0; tgt += s.tgt || 0; car += s.car || 0; rz += s.rz || 0; pts += s.ppr || 0;
      shares.push(s.tsnp ? s.snp / s.tsnp : null);
    });
    if (!g) return null;
    var one = function (n) { return Math.round(n / g * 10) / 10; };
    var last = shares[shares.length - 1], before = shares.slice(0, -1).filter(function (x) { return x !== null; });
    var avg = before.length ? before.reduce(function (t, x) { return t + x; }, 0) / before.length : null;
    var trend = last === null || last === undefined || avg === null ? '' : last - avg >= 0.1 ? 'up' : avg - last >= 0.1 ? 'down' : '';
    return {games: g, snapPct: tsnp ? Math.round(snp / tsnp * 100) : null, tgt: one(tgt), car: one(car), rz: one(rz), pts: one(pts), trend: trend};
  }

  /* The waiver reminder (game-day alerts' 'waivers'): at the 8 PM Eastern alert check on the evening
     before leagues' waivers run, one alert saying how many of them run tonight. Sleeper's waiver day
     counts from Monday and waivers process about 3 AM Eastern, so a league whose waiver day is
     tomorrow runs tonight; leagues with daily waivers aren't counted. opts: {week, etDay (0 is
     Sunday), etHour, date (Eastern, YYYY-MM-DD), sent}. Sleeper leagues only. [] or [{key, kind, title, body, url}]. */
  function waiverReminder(leagues, opts) {
    opts = opts || {};
    if (Number(opts.etHour) !== 20) return [];
    var tomorrow = ((Number(opts.etDay) + 1) % 7 + 6) % 7; // tomorrow, counted from Monday as Sleeper does
    var running = (leagues || []).filter(function (L) {
      var c = L.cfg || {};
      // Sleeper's leagues only (they carry no platform): ESPN's and Yahoo's waiver days aren't read.
      return !c.platform && !c.dailyWaivers && (c.waiverDay === undefined || c.waiverDay === null ? 2 : Number(c.waiverDay)) === tomorrow;
    });
    var key = ['waiver', opts.week, opts.date].join('|'), sent = opts.sent || {};
    if (!running.length || sent[key]) return [];
    sent[key] = 1;
    var n = running.length;
    return [{key: key, kind: 'waivers', url: '/app/waivers', title: 'Waivers run tonight',
      body: (n === 1 ? 'Waivers run tonight in ' + (running[0].cfg.name || running[0].cfg.key) + '.' : 'Waivers run tonight in ' + n + ' of your leagues.') +
        ' Titan\'s waiver plan has your claims, drops and bids.'}];
  }

  /* ------------------------------------------------------------ rankings lab */

  // Average ranks, 1 the best (desc: the biggest value is best), ties sharing their average.
  function avgRanks(values, desc) {
    var idx = values.map(function (v, i) { return i; }).sort(function (a, b) { return desc ? values[b] - values[a] : values[a] - values[b]; });
    var out = new Array(values.length);
    for (var i = 0; i < idx.length;) {
      var j = i;
      while (j + 1 < idx.length && values[idx[j + 1]] === values[idx[i]]) j++;
      for (var k = i; k <= j; k++) out[idx[k]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return out;
  }

  // How closely two lists of ranks agree: 1 the same order, -1 the reverse, null with under three.
  function rankCorrelation(x, y) {
    var n = x.length, mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0, i;
    if (n < 3) return null;
    for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }

  // FantasyCalc's values as rankings rows: QB, RB, WR and TE on one overall scale, most valuable first.
  var LAB_TOP = {QB: 24, RB: 48, WR: 60, TE: 24};
  function valuesRows(values, players) {
    return (values || []).filter(function (x) { return LAB_TOP[x.p] && Number(x.v) > 0; })
      .sort(function (a, b) { return b.v - a.v; })
      .map(function (x, i) {
        var known = x.s && players && players[x.s];
        return {name: known ? players[x.s][0] : x.n, pos: x.p, team: known ? players[x.s][2] : (x.t || ''), rank: i + 1, id: x.s || ''};
      });
  }

  /* Titan's owner's Compare screen: one week's test of three sources of rankings. 'sleeper' is
     Titan's default rankings (Sleeper's projections, in each league's scoring); 'fc' ranks by
     FantasyCalc's values as saved before the games (K and DEF from the defaults, since
     FantasyCalc has none); 'imports' is the owner's imported rankings for the week (with the
     defaults filling what they leave out, as Titan uses them). Two measures:
       lineups  in each league, the lineup each source would have started from the owner's
                roster, scored by what those players actually scored (scoreLeague's by-rank),
                added up over the leagues every source covers so the totals compare
       order    at QB, RB, WR and TE, how closely each source's order matched actual PPR
                points among the players that matter (every source's top 24 QBs, 48 RBs, 60 WRs
                and 24 TEs; a source missing one counts him after its last), from -100 to 100
     opts: {res (collectScores), proj, stats ({id: {ppr}}), players, imports (rows or null),
     fcFor(cfg) (values or null), fcOrder (the values for the order test, or null)}. */
  function labWeek(opts) {
    var res = opts.res || {}, players = opts.players || {}, proj = opts.proj || {};
    var have = {sleeper: true, fc: false, imports: !!(opts.imports && opts.imports.length)};
    var rows = [];
    (res.leagues || []).forEach(function (x) {
      var cfg = x.cfg, dflt = defaultRanks(proj, players, cfg), lists = {sleeper: weeklyMap(dflt)};
      var fv = opts.fcFor ? opts.fcFor(cfg) : null;
      if (fv && fv.length) {
        have.fc = true;
        lists.fc = weeklyMap(valuesRows(fv, players).concat(dflt.filter(function (r) { return r.pos === 'K' || r.pos === 'DEF'; })));
      }
      if (have.imports) lists.imports = rankingsBy(opts.imports, proj, players)(cfg);
      var row = {key: cfg.key};
      Object.keys(lists).forEach(function (k) {
        var r = scoreLeague(cfg, x.rosters, x.matchups, res.userId, players, lists[k], null, proj);
        if (!r.error) { row[k] = r.byRank; row.actual = r.actual; }
      });
      if (row.sleeper !== undefined) rows.push(row);
    });
    var srcs = Object.keys(have).filter(function (k) { return have[k]; });
    var common = rows.filter(function (r) { return srcs.every(function (k) { return r[k] !== undefined; }); });
    var lineups = {leagues: common.length, of: rows.length};
    srcs.concat(['actual']).forEach(function (k) { lineups[k] = round2(common.reduce(function (t, r) { return t + (r[k] || 0); }, 0)); });

    var idx = playerIndex(players), order = {};
    var pts = function (id) { var s = (opts.stats || {})[id]; return s ? Number(s.ppr) || 0 : 0; };
    Object.keys(LAB_TOP).forEach(function (P) {
      var lists = {};
      lists.sleeper = Object.keys(proj).filter(function (id) { return players[id] && players[id][1] === P && (projFor(proj, id, 1) || 0) > 0; })
        .sort(function (a, b) { return projFor(proj, b, 1) - projFor(proj, a, 1); });
      if (have.fc && opts.fcOrder && opts.fcOrder.length) {
        lists.fc = valuesRows(opts.fcOrder, players).filter(function (r) { return r.pos === P; })
          .map(function (r) { return r.id || matchPlayer(idx, players, r.name, P, r.team); }).filter(Boolean);
      }
      if (have.imports) {
        lists.imports = opts.imports.filter(function (r) { return r.pos === P; }).slice().sort(function (a, b) { return rankKey(a) - rankKey(b); })
          .map(function (r) { return matchPlayer(idx, players, r.name, P, r.team); }).filter(Boolean);
      }
      var names = Object.keys(lists), pool = {}, ids = [], out = {};
      names.forEach(function (k) { lists[k].slice(0, LAB_TOP[P]).forEach(function (id) { if (!pool[id]) { pool[id] = 1; ids.push(id); } }); });
      var actual = avgRanks(ids.map(pts), true);
      names.forEach(function (k) {
        var at = {};
        lists[k].forEach(function (id, i) { if (at[id] === undefined) at[id] = i + 1; });
        var c = rankCorrelation(avgRanks(ids.map(function (id) { return at[id] || lists[k].length + 1; }), false), actual);
        out[k] = c === null ? null : Math.round(c * 100);
      });
      order[P] = out;
    });
    return {lineups: lineups, order: order, sources: srcs};
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
     fewer: 12%, 5% or 1% of the budget. Then what he's worth to you and to the league:
     `gain`, the points a game he adds over the starter he'd replace, scales the bid from
     0.6x (nothing) through 1x (about 2.5 points) to 1.6x (6 points or more), and `rivals`,
     how many other teams he'd start for (of `teams` - 1), adds up to a quarter more when
     the whole league wants him. Whole dollars, at least $1, never more than what's left.
     o: {budget, left, bids, heat: 'hot'|'warm'|'cold', gain, rivals, teams}. */
  var STREAM_CAP = 0.03;
  function faabBid(o) {
    var budget = Number(o.budget) || 0, left = o.left === undefined ? budget : Math.max(0, Number(o.left) || 0);
    if (!budget || !left) return {bid: 0, basis: 'none'};
    var bids = (o.bids || []).map(Number).filter(function (b) { return b > 0; }).sort(function (a, b) { return a - b; });
    var q = function (p) { var i = (bids.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return bids[lo] + (bids[hi] - bids[lo]) * (i - lo); };
    var heat = o.heat || 'cold', league = bids.length >= 5;
    var bid = league ? (heat === 'hot' ? q(0.75) : heat === 'warm' ? q(0.5) : q(0.5) / 4)
      : budget * (heat === 'hot' ? 0.12 : heat === 'warm' ? 0.05 : 0.01);
    var why = [];
    if (o.gain !== undefined && o.gain !== null && isFinite(Number(o.gain))) {
      var g = Math.max(0, Number(o.gain)), f = Math.min(1.6, 0.6 + g / 6);
      bid *= f;
      why.push(g >= 2.5 ? 'worth ' + round1(g) + ' more a game than who he replaces' : g > 0 ? 'only ' + round1(g) + ' more a game than who he replaces' : 'no more a game than who he replaces');
    }
    var others = Math.max(1, (Number(o.teams) || 0) - 1);
    if (o.rivals !== undefined && o.rivals !== null && Number(o.teams) > 1) {
      var r = Math.max(0, Math.min(others, Number(o.rivals) || 0));
      bid *= 1 + 0.25 * r / others;
      if (r) why.push(r + ' other ' + (r === 1 ? 'team' : 'teams') + ' would start him');
    }
    // A kicker or defense is a stream, never worth more than STREAM_CAP of the budget ("three bucks at most", Late-Round).
    if (o.pos === 'K' || o.pos === 'DEF') {
      var cap = Math.max(1, Math.round(budget * STREAM_CAP));
      if (bid > cap) { bid = cap; why.push('a stream: never more than ' + Math.round(STREAM_CAP * 100) + '% of the budget'); }
    }
    return {bid: Math.max(1, Math.min(left, Math.round(bid))), basis: league ? 'league' : 'budget', why: why};
  }

  /* How many teams a free agent would start for: each team's best lineup by `pts` with him added
     against without him (draft picks and held players aside), excluding the team `skip`. */
  function rivalsFor(teams, slots, pts, player, skip) {
    var n = 0;
    (teams || []).forEach(function (t) {
      if (skip !== undefined && String(t.id) === String(skip)) return;
      var roster = (t.roster || []).filter(function (p) { return !p.held && p.pos !== 'PICK'; });
      var before = lineupPoints(roster, slots, pts), after = lineupPoints(roster.concat([player]), slots, pts);
      if (after > before + 0.05) n++;
    });
    return n;
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
    leaguesFromSleeper: leaguesFromSleeper, describeLeague: describeLeague, slotLabel: slotLabel, scoringDeltas: scoringDeltas, scoringNotes: scoringNotes,
    SEASON_FORMATS: SEASON_FORMATS, seasonFormat: seasonFormat, seasonValues: seasonValues,
    tradeFormat: tradeFormat, valueIndex: valueIndex, playerValue: playerValue, waiverValue: waiverValue, tradeVerdict: tradeVerdict, titanValues: titanValues, positionStrength: positionStrength,
    lineupPoints: lineupPoints, positionPoints: positionPoints, missWeeks: missWeeks, draftPicks: draftPicks, standings: standings, tradeIdeas: tradeIdeas, tradePartners: tradePartners, impliedValue: impliedValue, spanPoints: spanPoints,
    flexShares: flexShares, ageFactor: ageFactor,
    draftFromSleeper: draftFromSleeper, draftGrades: draftGrades,
    impliedTotals: impliedTotals, impliedTilt: impliedTilt, dvpFrom: dvpFrom, gameTags: gameTags, scheduleStrength: scheduleStrength, transactionsFrom: transactionsFrom,
    splitRows: splitRows, parseRanks: parseRanks, positionHint: positionHint, mergeRanks: mergeRanks, combineRanks: combineRanks,
    weeklyMap: weeklyMap, rankCounts: rankCounts, DEFAULT_POS: DEFAULT_POS, defaultRanks: defaultRanks, rankingsBy: rankingsBy,
    alertsFor: alertsFor, newsWatch: newsWatch, newsAlertsFor: newsAlertsFor,
    depthCharts: depthCharts, backupOf: backupOf, faabBid: faabBid, rivalsFor: rivalsFor, waiverPlan: waiverPlan, usageOf: usageOf, waiverReminder: waiverReminder,
    gameStates: gameStates, weekProgress: weekProgress,
    rankKey: rankKey, rankLabel: rankLabel, rankBits: rankBits, rankNote: rankNote, slotFits: slotFits, optimal: optimal,
    actualLineup: actualLineup, bestByPoints: bestByPoints, sumPts: sumPts,
    closeCalls: closeCalls, freeAgents: freeAgents, spreadOf: spreadOf, closeCallPairs: closeCallPairs, closeByRank: closeByRank,
    disagreements: disagreements, gradeCalls: gradeCalls, kickoffNudge: kickoffNudge, DISAGREE: DISAGREE, parseOffer: parseOffer,
    buildLeague: buildLeague, applyDetails: applyDetails, applyLocks: applyLocks,
    attachRanks: attachRanks, analyzeLeague: analyzeLeague, analyzeAll: analyzeAll,
    exposure: exposure, byeMap: byeMap, scoreLeague: scoreLeague, scoreWeek: scoreWeek,
    trimProjections: trimProjections, projFor: projFor, sumProj: sumProj, freezeWeek: freezeWeek,
    openSlots: openSlots, byeNeeds: byeNeeds, effectiveWeek: effectiveWeek, planWeek: planWeek, sleeperTeamUrl: sleeperTeamUrl, applyPoints: applyPoints,
    keepStartedRanks: keepStartedRanks, winProbability: winProbability, matchStatus: matchStatus, benchMistakes: benchMistakes,
    labWeek: labWeek, rankCorrelation: rankCorrelation
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
