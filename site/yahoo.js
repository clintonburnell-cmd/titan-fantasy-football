/* Titan Fantasy Football Manager: Yahoo Fantasy leagues.
 *
 * Yahoo's Fantasy API needs each person's own Yahoo sign-in (OAuth 2.0), which
 * Titan's server keeps (functions/index.js), so every Yahoo read goes through
 * the server (setTransport, set by sync.js). This file turns Yahoo's answers
 * into Titan's shapes; it has no page code, so the app, the server and the
 * tests share it. Every Yahoo player is matched to the same player in Sleeper's
 * list, so injuries, locks, rankings and projections work as they do for Sleeper.
 *
 * Yahoo's JSON nests everything: a resource is a [details, {sub-resources}]
 * pair, a collection is {"0": {...}, "1": {...}, "count": n}, and a team's or
 * player's details come as a list of one-key objects with empty [] fillers.
 * Numbers arrive as strings, and a missing value as false.
 */
(function (root) {
  'use strict';

  var SCC = root.SCC || (typeof require === 'function' ? require('./engine.js') : null);

  // Yahoo's lineup spots, in Sleeper's slot names.
  var SLOT = {QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', 'W/R/T': 'FLEX', 'W/R': 'WRRB_FLEX', 'W/T': 'REC_FLEX',
    'Q/W/R/T': 'SUPER_FLEX', K: 'K', DEF: 'DEF', D: 'IDP_FLEX', DL: 'DL', DE: 'DL', DT: 'DL', LB: 'LB',
    DB: 'DB', CB: 'DB', S: 'DB', BN: 'BN', IR: 'IR'};
  // Dedicated spots first, then the flex spots: the order Sleeper lists them in.
  var SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'W/R/T', 'W/R', 'W/T', 'Q/W/R/T', 'K', 'DEF', 'DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'D'];
  // Yahoo's player statuses, as the tags Sleeper uses.
  var INJ = {Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'IR', 'IR-R': 'IR', 'IR-NR': 'IR', PUP: 'PUP', 'PUP-R': 'PUP',
    'PUP-P': 'PUP', 'NFI-R': 'Out', 'NFI-A': 'Out', NA: 'NA', SUSP: 'Sus', CEL: 'Out'};

  // How Yahoo is read: through Titan's server, with the signed-in person's Yahoo link. Set by sync.js.
  var transport = null;
  function setTransport(fn) { transport = fn; }
  function canRead() { return !!transport; }

  // One object from Yahoo's list of one-key objects, skipping its [] fillers.
  function flat(a) {
    if (!Array.isArray(a)) return a && typeof a === 'object' ? a : {};
    var out = {};
    a.forEach(function (x) { if (x && typeof x === 'object' && !Array.isArray(x)) Object.assign(out, x); });
    return out;
  }

  // The items of a Yahoo collection ({"0": {key: item}, ..., "count": n}), in order.
  function list(o, key) {
    if (!o || typeof o !== 'object') return [];
    return Object.keys(o).filter(function (k) { return /^\d+$/.test(k); })
      .sort(function (a, b) { return a - b; })
      .map(function (k) { return o[k] && o[k][key]; })
      .filter(function (x) { return x !== undefined && x !== null; });
  }

  // A resource's details, and its sub-resources.
  function details(r) { return flat(Array.isArray(r) ? r[0] : r); }
  function subs(r) { return Array.isArray(r) && r[1] && typeof r[1] === 'object' ? r[1] : {}; }

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  // Yahoo sends false for a missing picture or link.
  function https(u) { return /^https?:\/\//.test(u || '') ? String(u).replace(/^http:/, 'https:') : ''; }

  // The signed-in person's games (one per season asked for) from a /users;use_login=1/games answer.
  function games(json) {
    var user = list(((json || {}).fantasy_content || {}).users, 'user')[0];
    return list(subs(user).games, 'game');
  }

  /* The person's leagues, from /users;use_login=1/games;game_codes=nfl;seasons=N/leagues:
     [{key, id, name, teams, url, logo, season, week, scoring}]. */
  function leaguesFrom(json) {
    var out = [];
    games(json).forEach(function (g) {
      list(subs(g).leagues, 'league').forEach(function (l) {
        var m = details(l);
        if (!m.league_key) return;
        out.push({key: String(m.league_key), id: String(m.league_id || ''), name: clean(m.name) || 'Yahoo league',
          teams: Number(m.num_teams) || 0, url: https(m.url), logo: https(m.logo_url), season: String(m.season || ''),
          week: Number(m.current_week) || 0, scoring: String(m.scoring_type || '')});
      });
    });
    return out;
  }

  /* The person's own teams, from /users;use_login=1/games;game_codes=nfl;seasons=N/teams:
     [{key, id, league, name, logo}], `league` being the league key the team is in. */
  function teamsFrom(json) {
    var out = [];
    games(json).forEach(function (g) {
      list(subs(g).teams, 'team').forEach(function (t) {
        var m = details(t);
        if (!m.team_key) return;
        var logo = ((m.team_logos || [])[0] || {}).team_logo || {};
        out.push({key: String(m.team_key), id: String(m.team_id || ''), league: String(m.team_key).replace(/\.t\.\d+$/, ''),
          name: clean(m.name), logo: https(logo.url)});
      });
    });
    return out;
  }

  // Each league with the person's team in it (null if Yahoo didn't list one).
  function yourLeagues(leaguesJson, teamsJson) {
    var teams = teamsJson ? teamsFrom(teamsJson) : [];
    return leaguesFrom(leaguesJson).map(function (l) {
      var t = teams.filter(function (x) { return x.league === l.key; })[0];
      return Object.assign(l, {team: t ? {key: t.key, id: t.id, name: t.name, logo: t.logo} : null});
    });
  }

  /* Yahoo's football stat ids, in Sleeper's scoring keys (the rest of a league's scoring, beyond receptions,
     as SCC.scoringDeltas reads it). 16 is one two-point stat for passing, rushing and receiving. */
  var YAHOO_STAT = {4: 'pass_yd', 5: 'pass_td', 6: 'pass_int', 9: 'rush_yd', 10: 'rush_td', 12: 'rec_yd', 13: 'rec_td', 18: 'fum_lost',
    19: 'fgm_0_19', 20: 'fgm_20_29', 21: 'fgm_30_39', 22: 'fgm_40_49', 23: 'fgm_50p', 29: 'xpm', 31: 'sack', 32: 'int', 33: 'fum_rec',
    34: 'def_td', 35: 'safe', 36: 'blk_kick', 50: 'pts_allow_0', 51: 'pts_allow_1_6', 52: 'pts_allow_7_13', 53: 'pts_allow_14_20',
    54: 'pts_allow_21_27', 55: 'pts_allow_28_34', 56: 'pts_allow_35p'};
  var YAHOO_2PT = ['pass_2pt', 'rush_2pt', 'rec_2pt'];

  /* A league's settings, from /league/{key}/settings: its lineup spots, points per
     catch (Yahoo's stat 11 is receptions), the rest of its scoring as differences from
     Sleeper's standard, the playoffs and whether it bids for players. */
  function settingsFrom(json) {
    var lg = ((json || {}).fantasy_content || {}).league;
    var m = details(lg), s = flat(subs(lg).settings);
    var positions = (s.roster_positions || []).map(function (x) {
      var r = x.roster_position || x;
      return {pos: String(r.position || ''), count: Number(r.count) || 0};
    });
    var rec = 0, asSleeper = {};
    (((s.stat_modifiers || {}).stats) || []).forEach(function (x) {
      var st = x.stat || x, id = Number(st.stat_id), v = Number(st.value) || 0;
      if (id === 11) rec = v;
      else if (id === 16) YAHOO_2PT.forEach(function (k) { asSleeper[k] = v; });
      else if (YAHOO_STAT[id]) asSleeper[YAHOO_STAT[id]] = v;
    });
    return {key: String(m.league_key || ''), id: String(m.league_id || ''), name: clean(m.name) || 'Yahoo league',
      url: https(m.url), logo: https(m.logo_url), teams: Number(m.num_teams) || 0, season: String(m.season || ''),
      week: Number(m.current_week) || 0, positions: positions, ppr: rec, scoring: SCC ? SCC.scoringDeltas(asSleeper) : {},
      playoffStart: Number(s.playoff_start_week) || 0, playoffTeams: Number(s.num_playoff_teams) || 0,
      faab: String(s.uses_faab) === '1' || s.uses_faab === true};
  }

  // One rostered player: Yahoo's id, name, position, NFL team, lineup spot and status.
  function playerFrom(p) {
    var m = details(p), sel = flat(subs(p).selected_position);
    return {id: String(m.player_id || ''), name: clean((m.name || {}).full), team: SCC.teamAbbr(m.editorial_team_abbr || ''),
      pos: String(m.primary_position || String(m.display_position || '').split(',')[0] || ''),
      slot: String(sel.position || ''), status: String(m.status || '')};
  }

  // One team with its roster, from a /league/{key}/teams/roster answer.
  function teamFrom(t) {
    var m = details(t), roster = subs(t).roster || {};
    var managers = Array.isArray(m.managers) ? m.managers.map(function (x) { return x.manager || x; }) : list(m.managers, 'manager');
    var nick = clean((managers[0] || {}).nickname);
    var logo = ((m.team_logos || [])[0] || {}).team_logo || {};
    return {key: String(m.team_key || ''), id: String(m.team_id || ''), name: clean(m.name), url: https(m.url), logo: https(logo.url),
      manager: nick === '--hidden--' ? '' : nick,
      mine: Number(m.is_owned_by_current_login) === 1 || managers.some(function (x) { return Number(x.is_current_login) === 1; }),
      players: list((roster['0'] || {}).players, 'player').map(playerFrom)};
  }

  // Every team in a league with its roster for the week.
  function rostersFrom(json) {
    var lg = ((json || {}).fantasy_content || {}).league;
    return list(subs(lg).teams, 'team').map(teamFrom).filter(function (t) { return t.key; });
  }

  /* One league as Titan's server sends it to the app: its settings and every team's
     roster for the week. `teamKey` is the person's team, when Yahoo listed it. */
  function leagueFrom(settingsJson, rostersJson, teamKey) {
    var rosters = rostersFrom(rostersJson);
    var mine = rosters.filter(function (t) { return t.mine; })[0];
    return Object.assign(settingsFrom(settingsJson), {teamKey: teamKey || (mine ? mine.key : ''), rosters: rosters});
  }

  function lineupOf(positions) {
    var out = [];
    SLOT_ORDER.forEach(function (p) {
      positions.forEach(function (x) { if (x.pos === p) for (var n = 0; n < x.count; n++) out.push(SLOT[p]); });
    });
    return out;
  }

  /* The league as Titan describes every league (see SCC.leaguesFromSleeper). The
     picture is the person's team logo, as for ESPN; `url` opens their team on Yahoo. */
  function leagueCfg(l, prefs) {
    var id = 'yahoo:' + l.key, pref = (prefs || {})[id] || {};
    var mine = (l.rosters || []).filter(function (t) { return t.key === l.teamKey; })[0] || {};
    return {id: id, platform: 'yahoo', yahooKey: l.key, teamKey: l.teamKey || '', key: l.name, name: l.name,
      pic: mine.logo || l.logo || '', url: mine.url || l.url || '', lineup: lineupOf(l.positions || []),
      teams: l.teams || (l.rosters || []).length, ppr: l.ppr || 0, scoring: l.scoring || {}, kind: 'Redraft', bestBall: false, status: '',
      playoffStart: l.playoffStart || 0, playoffTeams: l.playoffTeams || 0, faab: 0,
      active: pref.active !== undefined ? !!pref.active : true, exposure: true};
  }

  /* One Yahoo league in the shape SCC.buildLeague gives a Sleeper league: the
     person's roster (Sleeper ids where matched) and who's rostered anywhere. */
  function buildLeague(cfg, l, players) {
    var mine = (l.rosters || []).filter(function (t) { return t.key === cfg.teamKey; })[0];
    if (!mine) return {cfg: cfg, error: 'no team of yours found'};
    players = players || {};
    var idx = SCC.playerIndex(players), byes = SCC.setByes(), inLineup = {};
    cfg.lineup.forEach(function (s) { inLineup[s] = 1; });

    var info = function (p) {
      var name = p.pos === 'DEF' ? p.team + ' D/ST' : p.name || ('Yahoo player ' + p.id);
      var sid = SCC.matchPlayer(idx, players, name, p.pos, p.team);
      return {sid: sid, name: sid && p.pos !== 'DEF' ? players[sid][0] : name};
    };

    var roster = [], startCount = 0, unmatched = 0;
    mine.players.forEach(function (p) {
      var x = info(p), slot = SLOT[p.slot] || '', start = !!inLineup[slot];
      if (start) startCount++;
      if (!x.sid) unmatched++;
      roster.push({
        id: x.sid || ('yahoo:' + p.id), yahooId: p.id, name: x.name, pos: p.pos, team: p.team,
        start: start, slot: start ? slot : '', bye: byes[p.team] || '',
        inj: INJ[p.status] || '', outish: false, locked: false, held: slot === 'IR', heldAs: slot === 'IR' ? 'IR' : ''
      });
    });

    var takenNorm = {}, takenAbbr = {};
    (l.rosters || []).forEach(function (t) {
      t.players.forEach(function (p) {
        if (p.pos === 'DEF') takenAbbr[p.team] = 1;
        else takenNorm[SCC.norm(info(p).name)] = 1;
      });
    });
    return {cfg: cfg, roster: roster, startCount: startCount, takenNorm: takenNorm, takenAbbr: takenAbbr, unmatched: unmatched};
  }

  /* Every Yahoo league of the person's for a season, read for one week, through
     Titan's server: {linked, leagues: [leagueFrom, or {key, name, error}]},
     {noaccess: true} while Yahoo hasn't opened its fantasy data to Titan, or
     {linked: false}. */
  async function fetchAll(season, week) {
    if (!transport) return {linked: false};
    return transport({kind: 'all', season: String(season), week: Number(week)});
  }

  var api = {
    flat: flat, list: list, details: details, subs: subs, leaguesFrom: leaguesFrom, teamsFrom: teamsFrom, yourLeagues: yourLeagues,
    settingsFrom: settingsFrom, rostersFrom: rostersFrom, leagueFrom: leagueFrom, leagueCfg: leagueCfg, buildLeague: buildLeague,
    setTransport: setTransport, canRead: canRead, fetchAll: fetchAll, SLOT: SLOT, INJ: INJ
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YahooAPI = api;
})(typeof self !== 'undefined' ? self : this);
