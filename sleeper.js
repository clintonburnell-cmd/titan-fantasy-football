/* Titan Fantasy Football Manager — Sleeper API + browser storage.
 *
 * Read-only: Sleeper has no API for setting lineups, claiming waivers or making
 * trades, and none is needed to read a public account. Every endpoint used here
 * answers browsers directly (CORS *), so each person's phone talks to Sleeper
 * itself and Titan needs no server for this part.
 */
(function (root) {
  'use strict';

  var SCC = root.SCC || (typeof require === 'function' ? require('./engine.js') : null);
  var ESPN = root.EspnAPI || (typeof require === 'function' ? require('./espn.js') : null);

  var API = 'https://api.sleeper.app/v1';
  var SCHEDULE = 'https://api.sleeper.app/schedule/nfl/regular/';
  var PLAYERS_KEY = 'titan.players.v1';
  // Names, positions and teams barely move week to week, and the full list is
  // ~14 MB, so it is kept for a few days. Injuries are pulled fresh every refresh.
  var PLAYERS_TTL = 3 * 24 * 3600 * 1000;
  var BATCH = 25;
  var FETCH_OPTS = typeof window !== 'undefined' ? {cache: 'no-store'} : {};

  /* localStorage in the browser, plain memory under Node. Every access is
     guarded: private windows and full storage throw. */
  var mem = {};
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  var store = {
    get: function (k) {
      try {
        var s = ls(), v = s ? s.getItem(k) : mem[k];
        return v == null ? null : JSON.parse(v);
      } catch (e) { return null; }
    },
    set: function (k, v) {
      var j = JSON.stringify(v);
      try { var s = ls(); if (s) s.setItem(k, j); else mem[k] = j; return true; } catch (e) { return false; }
    },
    del: function (k) {
      try { var s = ls(); if (s) s.removeItem(k); else delete mem[k]; } catch (e) {}
    }
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function getJson(url) {
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        var res = await fetch(url, FETCH_OPTS);
        if (res.ok) return await res.json();
        if (res.status === 404) return null;
      } catch (e) {
        if (attempt === 3) throw e;
      }
      await sleep(attempt * 800);
    }
    return null;
  }

  function stamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ------------------------------------------------------------ account */

  /* Sleeper answers an unknown username with 200 and a body of `null`. */
  async function lookupUser(name) {
    name = String(name || '').trim().replace(/^@/, '');
    if (!name) return null;
    var u = await getJson(API + '/user/' + encodeURIComponent(name));
    if (!u || !u.user_id) return null;
    return {userId: String(u.user_id), username: u.username || name,
      displayName: u.display_name || u.username || name, avatar: u.avatar || ''};
  }

  async function discoverLeagues(userId, season, prefs) {
    var list = await getJson(API + '/user/' + userId + '/leagues/nfl/' + season);
    return list ? SCC.leaguesFromSleeper(list, prefs) : null;
  }

  /* ------------------------------------------------------------ players */

  async function loadPlayers(say) {
    var cached = store.get(PLAYERS_KEY);
    if (cached && cached.map && Date.now() - cached.ts < PLAYERS_TTL) return cached.map;
    try {
      var full = await getJson(API + '/players/nfl');
      if (!full) throw new Error('empty response');
      var map = SCC.trimPlayers(full);
      store.set(PLAYERS_KEY, {ts: Date.now(), map: map});
      if (say) say('Refreshed the Sleeper player list (' + Object.keys(map).length + ' players).');
      return map;
    } catch (e) {
      if (cached && cached.map) {
        if (say) say('Could not refresh the player list, using the saved copy (' + (e.message || e) + ').');
        return cached.map;
      }
      throw new Error('could not load the Sleeper player list (' + (e.message || e) + ')');
    }
  }

  function savePlayers(map) {
    var cached = store.get(PLAYERS_KEY);
    store.set(PLAYERS_KEY, {ts: cached ? cached.ts : Date.now(), map: map});
  }

  function clearPlayers() { store.del(PLAYERS_KEY); }

  /* Per-player lookups, in parallel batches: fresh injury tag and current team
     for each rostered player. ~150 players cost a second or two. */
  async function fetchDetails(ids) {
    var need = [], seen = {}, out = {};
    ids.forEach(function (id) {
      id = String(id);
      if (/^\d+$/.test(id) && !seen[id]) { seen[id] = 1; need.push(id); }
    });
    for (var b = 0; b < need.length; b += BATCH) {
      var chunk = need.slice(b, b + BATCH);
      var res = await Promise.all(chunk.map(function (id) {
        return getJson(API + '/players/nfl/' + id).catch(function () { return null; });
      }));
      res.forEach(function (p, j) {
        if (!p) return;
        out[chunk[j]] = {
          name: SCC.fullName(p), pos: p.position || '', team: p.team || '',
          inj: p.injury_status ? p.injury_status + (p.injury_body_part ? ' (' + p.injury_body_part + ')' : '') : ''
        };
      });
    }
    return out;
  }

  async function resolveMissing(ids, players) {
    var got = await fetchDetails(ids);
    var n = 0;
    for (var id in got) {
      players[id] = [got[id].name || ('id ' + id), got[id].pos || '?', got[id].team];
      n++;
    }
    if (n) savePlayers(players);
    return n;
  }

  function missingIds(lists, players) {
    var out = [];
    lists.forEach(function (ids) {
      (ids || []).forEach(function (id) {
        id = String(id);
        if (/^\d+$/.test(id) && !players[id]) out.push(id);
      });
    });
    return out;
  }

  /* ------------------------------------------------------------- refresh */

  /* Every NFL team's kickoff times for the season (ESPN's public schedule), kept
     for 12 hours: {team: {week: [time, time still to be set]}}. */
  var KICK_TTL = 12 * 3600 * 1000;
  async function loadKickoffs(season) {
    var key = 'titan.kickoffs.v1.' + season, cached = store.get(key);
    if (cached && cached.map && Date.now() - cached.ts < KICK_TTL) return cached.map;
    try {
      var map = await ESPN.fetchKickoffs(season);
      if (map && Object.keys(map).length) {
        store.set(key, {ts: Date.now(), map: map});
        return map;
      }
    } catch (e) {
      // Kickoff times are a nicety: without them the screens show the game day.
    }
    return cached ? cached.map : null;
  }

  function weekKickoffs(map, week) {
    var out = {};
    for (var team in map || {}) if (map[team][week]) out[team] = map[team][week];
    return out;
  }

  // League names are how the screens tell leagues apart, so a name used on both
  // Sleeper and ESPN gets a number.
  function uniqueKeys(list) {
    var seen = {};
    list.forEach(function (l) {
      var k = l.key;
      for (var n = 2; seen[k]; n++) k = l.key + ' (' + n + ')';
      seen[k] = 1;
      l.key = k;
    });
  }

  // A saved ESPN league that couldn't be read this time: listed with the reason.
  function unreadEspn(link, known, error) {
    var id = 'espn:' + link.id;
    var old = (known || []).filter(function (k) { return k.id === id; })[0];
    return Object.assign({}, old || {id: id, platform: 'espn', espnId: String(link.id), teamId: link.teamId === undefined ? null : link.teamId,
      key: link.name || ('ESPN league ' + link.id), name: link.name || ('ESPN league ' + link.id),
      lineup: [], teams: 0, ppr: 0, kind: '', bestBall: false, exposure: true}, {error: error, active: false});
  }

  /* Everything the lineup screens need, pulled live for one account: its Sleeper
     leagues (if a Sleeper username is linked) and its saved ESPN leagues. Nothing
     here depends on the rankings, so new rankings can be applied later without
     refetching. `known` is the last league list, used if Sleeper's fails.
     `opts.espnCreds` is an ESPN login for private leagues (server only; the
     browser reads those through Titan's server instead). */
  async function collect(account, progress, known, opts) {
    progress = progress || function () {};
    opts = opts || {};
    var prefs = account.prefs || {};
    var espnLinks = ESPN && account.espn ? account.espn.leagues || [] : [];
    var log = [];
    var say = function (m) { log.push(m); };
    say('Refresh started ' + stamp(new Date()));

    progress('Checking the NFL week…');
    var state = await getJson(API + '/state/nfl');
    var week = state && state.week ? Number(state.week) : 1;
    if (week < 1) week = 1;
    var season = state && state.season ? String(state.season) : String(new Date().getFullYear());
    var leagueSeason = state && state.league_season ? String(state.league_season) : season;
    progress('Finding your leagues…');
    var found = await Promise.all([
      account.userId ? discoverLeagues(account.userId, leagueSeason, prefs).catch(function () { return null; }) : [],
      getJson(SCHEDULE + season).catch(function () { return null; }),
      loadPlayers(say),
      // Kickoff times are only for the screens, so the server job skips them.
      typeof window !== 'undefined' ? loadKickoffs(season) : null
    ]);
    var all = found[0], sched = found[1], players = found[2], kickMap = found[3];
    // The schedule also settles the week: on the Tuesday after a week's last
    // game Titan moves on, even if Sleeper hasn't yet. ESPN lineups are per
    // week, so ESPN is read after this.
    var sleeperWeek = week;
    if (sched && sched.length) week = SCC.effectiveWeek(week, sched, Date.now());
    say('NFL ' + season + ', week ' + week + '.' +
      (week !== sleeperWeek ? ' Week ' + sleeperWeek + '\'s games are over, so Titan shows week ' + week + '.' : ''));
    var espnRes = await Promise.all(espnLinks.map(function (l) {
      return ESPN.fetchLeague(l.id, leagueSeason, {creds: opts.espnCreds, week: week})
        .catch(function (e) { return {error: e.message || String(e)}; });
    }));
    if (!all) {
      all = (known || []).filter(function (l) { return l.platform !== 'espn'; }).map(function (l) {
        var p = prefs[l.id];
        return Object.assign({}, l, p && p.active !== undefined ? {active: !!p.active} : {});
      });
      say('Could not load your league list from Sleeper, so using the last one we had.');
    }
    var byes = SCC.setByes(sched && sched.length ? SCC.byesFromSchedule(sched) : null);

    var espnJson = {};
    espnLinks.forEach(function (link, i) {
      var r = espnRes[i] || {error: 'not read'};
      if (!r.json) {
        all.push(unreadEspn(link, known, r.error));
        say('ESPN league ' + link.id + ': ' + (r.error === 'private'
          ? 'private, so it needs your ESPN login (Settings)' : r.error) + '.');
        return;
      }
      var cfg = ESPN.leagueCfg(r.json, link, prefs);
      espnJson[cfg.id] = r.json;
      all.push(cfg);
    });
    uniqueKeys(all);

    var leagues = all.filter(function (l) { return l.active; });
    var fromSleeper = leagues.filter(function (l) { return l.platform !== 'espn'; });
    var fromEspn = leagues.filter(function (l) { return l.platform === 'espn'; });
    if (account.userId) {
      say(all.length - espnLinks.length + ' league(s) on ' + account.displayName + '\'s Sleeper account, ' + fromSleeper.length + ' switched on.');
    }
    if (espnLinks.length) say(espnLinks.length + ' ESPN league(s) saved, ' + fromEspn.length + ' switched on.');

    progress('Pulling ' + leagues.length + ' leagues…');
    var sets = await Promise.all(fromSleeper.map(function (l) {
      return getJson(API + '/league/' + l.id + '/rosters').catch(function () { return null; });
    }));

    var missing = missingIds([].concat.apply([], sets.map(function (rs) {
      return (rs || []).map(function (r) { return r.players; });
    })), players);
    if (missing.length) {
      progress('Looking up ' + missing.length + ' new players…');
      say('Looked up ' + (await resolveMissing(missing, players)) + ' new player name(s).');
    }

    var live = [];
    fromSleeper.forEach(function (lg, i) {
      var d = SCC.buildLeague(lg, sets[i], account.userId, players);
      if (d.error) { say(lg.key + ': ' + d.error + ', skipped.'); return; }
      live.push(d);
      say(lg.key + ': ' + d.roster.length + ' players, ' + d.startCount + ' starting.');
    });
    fromEspn.forEach(function (lg) {
      var d = ESPN.buildLeague(lg, espnJson[lg.id], players);
      if (d.error) { say(lg.key + ' (ESPN): ' + d.error + ', skipped.'); return; }
      live.push(d);
      say(lg.key + ' (ESPN): ' + d.roster.length + ' players, ' + d.startCount + ' starting' +
        (d.unmatched ? ', ' + d.unmatched + ' not found in Sleeper\'s player list' : '') + '.');
    });

    // v2: rosters carry what live scores need (roster ids, ESPN ids, the game clock).
    // v3: this week's kickoff times.
    var snap = {v: 3, at: Date.now(), week: week, season: season, available: all, byes: byes, leagues: live, log: log,
      kickoffs: weekKickoffs(kickMap, week)};
    if (!live.length) { say('No rosters loaded. Nothing to show.'); return snap; }

    progress('Checking injuries…');
    var ids = [];
    live.forEach(function (d) { d.roster.forEach(function (p) { ids.push(p.id); }); });
    var details = await fetchDetails(ids);
    var moved = 0;
    for (var id in details) {
      var e = players[id];
      if (e && details[id].team && e[2] !== details[id].team) { e[2] = details[id].team; moved++; }
    }
    if (moved) savePlayers(players);
    say(SCC.applyDetails(live, details) + ' rostered player(s) carry an injury tag right now.');

    var games = sched && sched.length ? SCC.gameStates(sched, week) : {};
    var lk = SCC.applyLocks(live, games);
    snap.games = games;
    if (!Object.keys(games).length) {
      say('Could not read the NFL game clock, so every player is being treated as still movable.');
    } else if (lk.total) {
      say(lk.total + ' of your rostered players are LOCKED (their game has kicked off): ' +
          lk.teams.join(', ') + '. Locks clear when the new fantasy week opens Tuesday.');
    } else {
      say('No games have kicked off yet. Every slot is still editable.');
    }
    if (lk.total) {
      progress('Getting this week\'s scores…');
      say(await attachPoints(live, week, season, false) + ' of them have points so far.');
    }
    return snap;
  }

  /* This week's points for every rostered player whose game has started: each
     Sleeper league's matchup, and each ESPN league's box score (or, straight
     after a refresh, the points that came with the league). A league whose
     points can't be read keeps the ones it had. Returns how many players have points. */
  async function attachPoints(live, week, season, fresh, creds) {
    var sets = await Promise.all(live.map(function (d) {
      if (!d.roster.some(function (p) { return p.locked; })) return null;
      if (d.cfg.platform === 'espn') {
        if (!fresh) return d.espnPoints || null;
        return ESPN.fetchPoints(d.cfg.espnId, season, week, d.cfg.teamId, {creds: creds}).catch(function () { return null; });
      }
      return getJson(API + '/league/' + d.cfg.id + '/matchups/' + week).then(function (ms) {
        var m = (ms || []).filter(function (x) { return x.roster_id === d.rosterId; })[0];
        return m ? m.players_points || {} : null;
      }).catch(function () { return null; });
    }));
    var n = 0;
    live.forEach(function (d, i) {
      if (sets[i]) SCC.applyPoints(d, sets[i], d.cfg.platform === 'espn');
      d.roster.forEach(function (p) { if (typeof p.pts === 'number') n++; });
    });
    return n;
  }

  /* Fresh scores for a week in progress, without a full refresh: the game
     clock, then each league's points. Updates `snap` in place. `withEspn`
     false skips ESPN's larger box scores this time. */
  async function livePoints(snap, withEspn) {
    var sched = await getJson(SCHEDULE + snap.season);
    if (!sched || !sched.length) return 0;
    snap.games = SCC.gameStates(sched, snap.week);
    SCC.applyLocks(snap.leagues, snap.games);
    var leagues = withEspn === false ? snap.leagues.filter(function (d) { return d.cfg.platform !== 'espn'; }) : snap.leagues;
    var n = await attachPoints(leagues, snap.week, snap.season, true);
    snap.pointsAt = Date.now();
    return n;
  }

  /* Rosters, matchups and the schedule for one week, for the Scorecard. */
  async function collectScores(account, leagues, week, season) {
    var sched = await getJson(SCHEDULE + season);
    if (!sched || !sched.length) throw new Error('could not read the NFL schedule');
    var prog = SCC.weekProgress(sched, week);
    var espn = leagues.filter(function (l) { return l.platform === 'espn'; });
    leagues = leagues.filter(function (l) { return l.platform !== 'espn'; });
    var out = {week: week, userId: account.userId, started: prog.started, done: prog.done,
      total: prog.total, leagues: [], players: {},
      skipped: espn.map(function (l) { return l.key + ': ESPN weekly scores are coming soon'; })};
    if (!prog.started) return out;

    var players = await loadPlayers();
    var sets = await Promise.all(leagues.map(function (l) {
      return Promise.all([
        getJson(API + '/league/' + l.id + '/rosters').catch(function () { return null; }),
        getJson(API + '/league/' + l.id + '/matchups/' + week).catch(function () { return null; })
      ]);
    }));
    var missing = missingIds([].concat.apply([], sets.map(function (s) {
      return (s[1] || []).map(function (m) { return m.players; });
    })), players);
    if (missing.length) await resolveMissing(missing, players);

    out.players = players;
    out.leagues = leagues.map(function (l, i) { return {cfg: l, rosters: sets[i][0], matchups: sets[i][1]}; });
    return out;
  }

  /* Sleeper's weekly projections (RotoWire's numbers), trimmed and kept for an hour. */
  var PROJ_POS = '&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF';
  async function fetchProjections(season, week) {
    var key = 'titan.proj.v1.' + season + '.' + week;
    var cached = store.get(key);
    if (cached && Date.now() - cached.ts < 3600 * 1000) return cached.map;
    try {
      var list = await getJson('https://api.sleeper.app/projections/nfl/' + season + '/' + week + '?season_type=regular' + PROJ_POS);
      var map = SCC.trimProjections(list || []);
      store.set(key, {ts: Date.now(), map: map});
      return map;
    } catch (e) {
      return cached ? cached.map : {};
    }
  }

  var api = {
    store: store, getJson: getJson, lookupUser: lookupUser, discoverLeagues: discoverLeagues,
    collect: collect, collectScores: collectScores, livePoints: livePoints,
    loadPlayers: loadPlayers, clearPlayers: clearPlayers, fetchDetails: fetchDetails,
    fetchProjections: fetchProjections, PLAYERS_KEY: PLAYERS_KEY
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SleeperAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
