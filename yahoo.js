/* Titan Fantasy Football Manager: Yahoo Fantasy leagues.
 *
 * Yahoo's Fantasy API needs each person's own Yahoo sign-in (OAuth 2.0), which
 * Titan's server keeps (functions/index.js), so every Yahoo read goes through
 * the server. This file turns Yahoo's answers into what Titan reads; it has no
 * page or network code, so the app, the server and the tests share it.
 *
 * Yahoo's JSON nests everything: a resource is a [details, {sub-resources}]
 * pair, a collection is {"0": {...}, "1": {...}, "count": n}, and a team's or
 * player's details come as a list of one-key objects with empty [] fillers.
 */
(function (root) {
  'use strict';

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

  var api = {flat: flat, list: list, details: details, subs: subs, leaguesFrom: leaguesFrom, teamsFrom: teamsFrom, yourLeagues: yourLeagues};

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YahooAPI = api;
})(typeof self !== 'undefined' ? self : this);
