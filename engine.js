/* Titan Fantasy Football — engine
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

  var ALIAS = {JAC: 'JAX', WSH: 'WAS', LA: 'LAR', ARZ: 'ARI'};
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
      map[id] = [fullName(p) || ('id ' + id), p.position, p.team || ''];
    }
    return map;
  }

  /* Sleeper roster ids are numeric, except team defences, whose id IS the team
     abbreviation. Those are named "<ABBR> D/ST" to match the rankings. */
  function playerInfo(players, id) {
    var key = String(id);
    if (!/^\d+$/.test(key)) return {name: key + ' D/ST', pos: 'DEF', team: key};
    var e = players && players[key];
    if (e) return {name: e[0], pos: e[1], team: e[2]};
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
        lineup: (l.roster_positions || []).filter(function (p) { return !NOT_STARTERS[p]; }),
        teams: l.total_rosters || s.num_teams || 0,
        ppr: l.scoring_settings ? Number(l.scoring_settings.rec || 0) : 0,
        kind: s.type === 2 ? 'Dynasty' : s.type === 1 ? 'Keeper' : 'Redraft',
        bestBall: bestBall,
        status: l.status || '',
        active: pref.active !== undefined ? !!pref.active : !bestBall,
        exposure: true
      };
    });
  }

  function describeLeague(l) {
    var scoring = l.ppr >= 1 ? 'PPR' : l.ppr >= 0.5 ? 'Half PPR' : l.ppr > 0 ? l.ppr + ' PPR' : 'Standard';
    return [l.teams ? l.teams + ' teams' : '', scoring, l.kind, l.bestBall ? 'Best ball' : '']
      .filter(Boolean).join(' · ');
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
    team: 'team', rank: 'rank', rk: 'rank', wkrank: 'rank', overall: 'rank', opp: 'opp', opponent: 'opp',
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
        var k = HEADERS[h.replace(/[^a-z]/g, '')];
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
        opp: String(r[cols.opp] == null ? '' : r[cols.opp]).trim().replace(/^(at|vs\.?|@)\s+/i, ''),
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
    return {rows: rows, skipped: skipped, format: fantasyPros ? 'fantasypros' : single ? 'single' : 'rows',
      position: single ? fixedPos : '', warning: warning, error: rows.length ? '' : 'No player rows found.'};
  }

  /* A file that ranks only some positions (FantasyPros exports one per position)
     is added to the week, replacing just those positions. A file covering QB, RB,
     WR and TE replaces the whole week. */
  function mergeRanks(prevRows, newRows) {
    var c = rankCounts(newRows);
    var positions = Object.keys(c);
    var full = ['QB', 'RB', 'WR', 'TE'].every(function (p) { return c[p]; });
    if (full || !prevRows || !prevRows.length) return {rows: newRows, merged: false, positions: positions};
    return {rows: prevRows.filter(function (r) { return !c[r.pos]; }).concat(newRows), merged: true, positions: positions};
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

  /* ------------------------------------------------------ start/sit core */

  function rankKey(p) {
    // ONLY the imported rank orders players. Unranked always sits last, and
    // anyone tagged Out/Doubtful/IR sits below even the unranked — the optimiser
    // must never hand you an injured player as a recommendation.
    var base = (p.rank === null || p.rank === undefined) ? 100000 : Number(p.rank);
    return p.outish ? 900000 + base : base;
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

  /* Ranked players nobody in the league rosters, better than the bar. Returns at
     most `limit`, best rank first. */
  function freeAgents(posSet, weekly, takenNorm, takenAbbr, curRank, limit) {
    var out = [];
    for (var k in weekly) {
      var w = weekly[k];
      if (!posSet[w.pos] || w.rank === null) continue;
      if (w.pos === 'DEF' ? takenAbbr[teamAbbr(w.team)] : takenNorm[k]) continue;
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

    var roster = ids.map(function (id) {
      var info = playerInfo(players, id);
      return {
        id: String(id), name: info.name, pos: info.pos, team: info.team,
        start: starters.indexOf(String(id)) >= 0,
        slot: slotOf[String(id)] || '',
        bye: byeOf(info.team),
        inj: '', outish: false, locked: false
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

    return {cfg: lg, roster: roster, startCount: starters.length, takenNorm: takenNorm, takenAbbr: takenAbbr};
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
        p.inj = x ? x.inj : '';
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

  function analyzeLeague(d, weekly) {
    var slots = d.cfg.lineup;
    // With no ranks there is no order to follow, so nothing counts as a swap —
    // otherwise every unranked starter would "lose" to an unranked bench player.
    var ranked = Object.keys(weekly).length > 0;
    var act = actualLineup(d.roster, slots);
    var opt = optimal(d.roster, slots);
    var optIds = {}, actIds = {};
    opt.forEach(function (o) { if (o.p) optIds[o.p.id] = 1; });
    act.forEach(function (o) { if (o.p) actIds[o.p.id] = 1; });

    var rows = [], stops = 0;
    act.forEach(function (o) {
      if (!o.p) { rows.push({slot: o.slot, p: null, verdict: 'FILL SLOT'}); stops++; return; }
      var p = o.p, verdict = 'OK';
      if (p.outish) verdict = 'DO NOT START';
      else if (!optIds[p.id] && ranked) verdict = 'SWAP OUT';
      else if (p.rank === null) verdict = 'UNRANKED';
      if (p.locked) verdict = 'LOCKED';
      if (verdict === 'DO NOT START') stops++;
      rows.push({slot: o.slot, p: p, verdict: verdict});
    });

    // The real swaps. Compare the SET of players, not slot order: the same nine
    // guys arranged differently is not a change to go and make.
    var comingIn = opt.filter(function (o) { return o.p && !actIds[o.p.id]; });
    var goingOut = act.filter(function (o) { return o.p && !optIds[o.p.id]; });
    var moves = !ranked ? [] : comingIn.map(function (o, i) {
      return {slot: o.slot, out: goingOut[i] ? goingOut[i].p : null, inn: o.p};
    });

    // Wire scan. The bar is the WORST player currently filling a slot of this
    // kind — he is the one a pickup would actually replace. Unranked means anyone
    // ranked wins.
    var wire = [];
    WIRE_GROUPS.forEach(function (g) {
      if (slots.indexOf(g.slot) < 0) return;
      var worst = null, anyUnranked = false, held = 0;
      opt.forEach(function (o) {
        if (o.slot !== g.slot || !o.p) return;
        held++;
        if (o.p.rank === null) { anyUnranked = true; return; }
        if (worst === null || o.p.rank > worst.rank) worst = o.p;
      });
      if (!held) return;
      var bar = anyUnranked ? 100000 : (worst ? worst.rank : null);
      var open = freeAgents(g.set, weekly, d.takenNorm, d.takenAbbr, bar, 3);
      if (open.length) wire.push({pos: g.label, cur: anyUnranked ? null : worst, anyUnranked: anyUnranked, list: open});
    });

    var hurt = d.roster.filter(function (p) { return p.start && p.inj; });
    return {cfg: d.cfg, roster: d.roster, rows: rows, moves: moves, wire: wire, hurt: hurt, stops: stops};
  }

  function analyzeAll(snap, weekly) {
    var leagues = ((snap && snap.leagues) || []).map(function (d) {
      return analyzeLeague({
        cfg: d.cfg, roster: attachRanks(d.roster, weekly),
        takenNorm: d.takenNorm || {}, takenAbbr: d.takenAbbr || {}
      }, weekly);
    });

    var changes = [], hurtStarters = [], wireLines = [], stops = 0, locked = 0;
    leagues.forEach(function (L) {
      L.moves.forEach(function (m) { changes.push({league: L.cfg, move: m}); });
      L.hurt.forEach(function (p) { hurtStarters.push({league: L.cfg, p: p}); });
      L.wire.forEach(function (w) { wireLines.push({league: L.cfg, w: w}); });
      stops += L.stops;
      L.roster.forEach(function (p) { if (p.locked) locked++; });
    });

    var rankedCount = Object.keys(weekly).length;
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
        log.push('   ' + c.league.name + ': start ' + c.move.inn.name + ' (' + rankLabel(c.move.inn.pos, c.move.inn.rank) + ')');
      });
      log.push('', 'Make the changes in the Sleeper app. Titan cannot set lineups.');
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

  /* ------------------------------------------------ results + scorecard

     Not "are the rankings good in the abstract" but "given the players I
     actually had on my bench that week, did following them beat what I did?"

       actual   what the lineup I really started scored
       byRank   what the rank-ordered lineup would have scored
       perfect  the best any lineup off that roster could have scored

     Points come from Sleeper's matchups, so they are already under each
     league's own scoring rules. */

  function scoreLeague(lg, rosters, matchups, userId, players, weekly) {
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

    var roster = ids.map(function (id) {
      var info = playerInfo(players, id);
      var w = weekly[norm(info.name)] || null;
      return {
        id: String(id), name: info.name, pos: info.pos, team: info.team,
        rank: w && w.rank !== null ? w.rank : null,
        pts: Number(pp[String(id)] || 0),
        start: !!startedIds[String(id)],
        locked: false, outish: false, slot: slotOf[String(id)] || ''
      };
    });

    var actual = sumPts(roster.filter(function (p) { return p.start; }));
    var byRank = sumPts(optimal(roster, lg.lineup).map(function (o) { return o.p; }));
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
      close: cc, detail: detail, roster: roster};
  }

  function scoreWeek(res, weekly) {
    var rows = [], skipped = [];
    var T = {actual: 0, byRank: 0, perfect: 0, cw: 0, ct: 0};
    res.leagues.forEach(function (x) {
      var r = scoreLeague(x.cfg, x.rosters, x.matchups, res.userId, res.players, weekly);
      if (r.error) { skipped.push(x.cfg.key + ': ' + r.error); return; }
      rows.push(r);
      T.actual += r.actual; T.byRank += r.byRank; T.perfect += r.perfect;
      T.cw += r.close.wins; T.ct += r.close.total;
    });
    T.actual = round2(T.actual); T.byRank = round2(T.byRank); T.perfect = round2(T.perfect);
    return {week: res.week, rows: rows, totals: T, skipped: skipped};
  }

  var api = {
    INJ_OUT: INJ_OUT, WIRE_GROUPS: WIRE_GROUPS, SLOT_POS: SLOT_POS,
    norm: norm, teamAbbr: teamAbbr, byeOf: byeOf, byesFromSchedule: byesFromSchedule, setByes: setByes,
    fullName: fullName, trimPlayers: trimPlayers, playerInfo: playerInfo,
    leaguesFromSleeper: leaguesFromSleeper, describeLeague: describeLeague, slotLabel: slotLabel,
    splitRows: splitRows, parseRanks: parseRanks, positionHint: positionHint, mergeRanks: mergeRanks,
    weeklyMap: weeklyMap, rankCounts: rankCounts,
    gameStates: gameStates, weekProgress: weekProgress,
    rankKey: rankKey, rankLabel: rankLabel, slotFits: slotFits, optimal: optimal,
    actualLineup: actualLineup, bestByPoints: bestByPoints, sumPts: sumPts,
    closeCalls: closeCalls, freeAgents: freeAgents,
    buildLeague: buildLeague, applyDetails: applyDetails, applyLocks: applyLocks,
    attachRanks: attachRanks, analyzeLeague: analyzeLeague, analyzeAll: analyzeAll,
    exposure: exposure, byeMap: byeMap, scoreLeague: scoreLeague, scoreWeek: scoreWeek
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
