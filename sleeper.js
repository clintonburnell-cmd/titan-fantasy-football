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
  var YAHOO = root.YahooAPI || (typeof require === 'function' ? require('./yahoo.js') : null);

  var API = 'https://api.sleeper.app/v1';
  var SCHEDULE = 'https://api.sleeper.app/schedule/nfl/regular/';
  var PLAYERS_KEY = 'titan.players.v2'; // v2 keeps each player's depth chart order (backup alerts)
  var OLD_PLAYERS_KEYS = ['titan.players.v1'];
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
    OLD_PLAYERS_KEYS.forEach(function (k) { store.del(k); }); // an older copy only takes up room
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

  // Sleeper's own leagues carry no platform; ESPN's and Yahoo's do.
  function isSleeper(l) { return !l.platform || l.platform === 'sleeper'; }

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
    // Yahoo is read through Titan's server, where the person's Yahoo link lives (sync.js sets the way in).
    var yahooOn = !!(YAHOO && account.yahoo && account.yahoo.linked && YAHOO.canRead());
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
      // The demo names its players from the week's projections instead (demoPlayers).
      account.demo ? null : loadPlayers(say),
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
    var yahooJob = yahooOn ? YAHOO.fetchAll(leagueSeason, week).catch(function (e) { return {error: (e && e.message) || String(e)}; }) : null;
    var espnRes = await Promise.all(espnLinks.map(function (l) {
      return ESPN.fetchLeague(l.id, leagueSeason, {creds: opts.espnCreds, week: week})
        .catch(function (e) { return {error: e.message || String(e)}; });
    }));
    var yahooRes = yahooJob ? await yahooJob : null;
    if (!all) {
      all = (known || []).filter(isSleeper).map(function (l) {
        var p = prefs[l.id];
        return Object.assign({}, l, p && p.active !== undefined ? {active: !!p.active} : {});
      });
      say('Could not load your league list from Sleeper, so using the last one we had.');
    }
    var byes = SCC.setByes(sched && sched.length ? SCC.byesFromSchedule(sched) : null);
    // "Try a demo": sample leagues from this week's projections instead of anyone's leagues.
    if (account.demo) {
      return demoSnapshot(account, {week: week, season: season, sched: sched, players: players, byes: byes,
        kickMap: kickMap, log: log, say: say, progress: progress});
    }

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
    var yahooData = {};
    if (yahooRes && yahooRes.noaccess) say('Yahoo: Titan\'s access to Yahoo leagues is still in review with Yahoo, so they can\'t load yet.');
    else if (yahooRes && yahooRes.error) say('Yahoo: ' + yahooRes.error + '.');
    ((yahooRes && yahooRes.leagues) || []).forEach(function (l) {
      if (l.error) { say('Yahoo league ' + l.name + ': ' + l.error + '.'); return; }
      var cfg = YAHOO.leagueCfg(l, prefs);
      yahooData[cfg.id] = l;
      all.push(cfg);
    });
    uniqueKeys(all);

    var leagues = all.filter(function (l) { return l.active; });
    var fromSleeper = leagues.filter(isSleeper);
    var fromEspn = leagues.filter(function (l) { return l.platform === 'espn'; });
    var fromYahoo = leagues.filter(function (l) { return l.platform === 'yahoo'; });
    if (account.userId) {
      say(all.filter(isSleeper).length + ' league(s) on ' + account.displayName + '\'s Sleeper account, ' + fromSleeper.length + ' switched on.');
    }
    if (espnLinks.length) say(espnLinks.length + ' ESPN league(s) saved, ' + fromEspn.length + ' switched on.');
    if (Object.keys(yahooData).length) say(Object.keys(yahooData).length + ' Yahoo league(s), ' + fromYahoo.length + ' switched on.');

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
    fromYahoo.forEach(function (lg) {
      var d = YAHOO.buildLeague(lg, yahooData[lg.id], players);
      if (d.error) { say(lg.key + ' (Yahoo): ' + d.error + ', skipped.'); return; }
      live.push(d);
      say(lg.key + ' (Yahoo): ' + d.roster.length + ' players, ' + d.startCount + ' starting' +
        (d.unmatched ? ', ' + d.unmatched + ' not found in Sleeper\'s player list' : '') + '.');
    });

    // v2: rosters carry what live scores need (roster ids, ESPN ids, the game clock).
    // v3: this week's kickoff times.
    var snap = {v: 3, at: Date.now(), week: week, season: season, available: all, byes: byes, leagues: live, log: log,
      kickoffs: weekKickoffs(kickMap, week)};
    return finish(snap, {players: players, sched: sched, say: say, progress: progress});
  }

  /* "Try a demo": the demo leagues (demo.js) in place of anyone's leagues, then
     the same injury tags, game clock and kickoff times as a real refresh. */
  async function demoSnapshot(account, c) {
    c.progress('Building the demo leagues…');
    // Names come from the week's projections (about 2 MB) rather than Sleeper's full
    // player list (about 14 MB), so a first visit to the demo loads quickly.
    var got = await demoPlayers(c.season, c.week);
    c.players = got.players;
    c.demo = true;
    var built = root.TitanDemo ? root.TitanDemo.build(got.proj, got.players, account.prefs) : [];
    var live = built.filter(function (d) { return d.cfg.active; });
    c.say(built.length ? 'Demo: ' + built.length + ' sample leagues built from week ' + c.week + '\'s projections.'
      : 'Demo: this week\'s projections aren\'t out yet, so there are no demo leagues to build.');
    var snap = {v: 3, at: Date.now(), week: c.week, season: c.season, available: built.map(function (d) { return d.cfg; }),
      byes: c.byes, leagues: live, log: c.log, kickoffs: weekKickoffs(c.kickMap, c.week), players: got.players};
    return finish(snap, c);
  }

  /* The demo's players and projections from one download: Sleeper's weekly
     projections carry each player's name, position and team. The trimmed
     projections are cached for the app, as fetchProjections does. */
  async function demoPlayers(season, week) {
    var list = (await getJson(projectionsUrl(season, week)).catch(function () { return null; })) || [];
    var proj = SCC.trimProjections(list);
    if (Object.keys(proj).length) store.set('titan.proj.v1.' + season + '.' + week, {ts: Date.now(), map: proj});
    var players = {};
    list.forEach(function (e) {
      var p = e && e.player, id = e ? String(e.player_id) : '';
      // Defenses are named from their team (SCC.playerInfo), so only numeric ids are kept.
      if (!p || !proj[id] || !/^\d+$/.test(id)) return;
      players[id] = [((p.first_name || '') + ' ' + (p.last_name || '')).trim() || ('id ' + id), p.position || '', p.team || e.team || ''];
    });
    return {players: players, proj: proj};
  }

  /* The end of every refresh, once the rosters are in: fresh injury tags, the
     game clock (locks) and points for games under way. */
  async function finish(snap, c) {
    var live = snap.leagues, players = c.players, say = c.say, progress = c.progress, sched = c.sched;
    var week = snap.week, season = snap.season;
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
    // The demo's small list must never replace the saved full one.
    if (moved && !c.demo) savePlayers(players);
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
      // Demo leagues have no matchups to read points from.
      if (d.cfg.demo || !d.roster.some(function (p) { return p.locked; })) return null;
      // Yahoo's live points come in the next step; until then a Yahoo league shows none.
      if (d.cfg.platform === 'yahoo') return null;
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

  /* This week's head-to-head in every league: your lineup and your opponent's,
     spot by spot, with points so far and both team names. Sleeper: the week's
     matchups, the rosters (who owns which) and the league's members. ESPN: the
     week's box score. Locks, kickoff times and projections are added by the app. */
  async function collectMatchups(snap) {
    var players = await loadPlayers();
    return Promise.all(snap.leagues.map(function (d) {
      var lg = d.cfg;
      if (lg.platform === 'yahoo') return Promise.resolve({cfg: lg, error: 'Yahoo matchups are coming next'});
      var job = lg.platform === 'espn'
        ? ESPN.fetchMatchup(lg.espnId, snap.season, snap.week, lg.teamId).then(function (m) {
            return m ? {cfg: lg, me: espnSide(lg, m.me, players), opp: espnSide(lg, m.opp, players)} : {cfg: lg, none: true};
          })
        : sleeperLeagueMatchup(lg, d.rosterId, snap.week, players);
      return job.catch(function (e) { return {cfg: lg, error: (e && e.message) || String(e)}; });
    }));
  }

  async function sleeperLeagueMatchup(lg, rosterId, week, players) {
    var r = await Promise.all(['/matchups/' + week, '/rosters', '/users'].map(function (p) { return getJson(API + '/league/' + lg.id + p); }));
    // Opponents' players Titan hasn't met yet are looked up by id.
    var missing = missingIds((r[0] || []).map(function (m) { return m.starters; }), players);
    if (missing.length) await resolveMissing(missing, players);
    return sleeperMatchup(lg, rosterId, r[0], r[1], r[2], players);
  }

  /* Every team in a league with its players, for the Trade tab. Sleeper: the league's
     rosters and members. ESPN: the league read again, each team's roster built the way
     the person's own is (Sleeper ids where matched). `rosterId` (Sleeper) or the
     league's teamId (ESPN) marks the person's own team. */
  async function leagueTeams(lg, rosterId, season) {
    if (lg.platform === 'yahoo') throw new Error('Yahoo trades are coming next');
    var players = await loadPlayers();
    var slim = function (p) { return {id: p.id, espnId: p.espnId, name: p.name, pos: p.pos, team: p.team, held: !!p.held}; };
    if (lg.platform === 'espn') {
      var r = await ESPN.fetchLeague(lg.espnId, season);
      if (!r.json) throw new Error(r.error === 'private' ? 'it\'s private, so it needs your ESPN login (Settings)' : (r.error || 'could not read ESPN'));
      var names = {};
      ESPN.teamsOf(r.json).forEach(function (t) { names[t.id] = t; });
      return (r.json.teams || []).map(function (t) {
        var d = ESPN.buildLeague(Object.assign({}, lg, {teamId: t.id}), r.json, players), n = names[t.id] || {};
        return {id: String(t.id), name: SCC.teamLabel(n.name, n.manager, 'Team ' + t.id), manager: n.manager || '', mine: t.id === lg.teamId,
          roster: (d.roster || []).map(slim)};
      });
    }
    // A dynasty league also brings its traded draft picks (a failure there just means no picks).
    var dynasty = lg.kind === 'Dynasty';
    var got = await Promise.all(['/rosters', '/users'].concat(dynasty ? ['/traded_picks'] : []).map(function (p) {
      var job = getJson(API + '/league/' + lg.id + p);
      return p === '/traded_picks' ? job.catch(function () { return []; }) : job;
    }));
    var rosters = got[0] || [], who = {};
    var missing = missingIds(rosters.map(function (x) { return x.players; }), players);
    if (missing.length) await resolveMissing(missing, players);
    (got[1] || []).forEach(function (u) { who[u.user_id] = u; });
    var teams = rosters.map(function (x) {
      var u = who[x.owner_id] || {}, held = {};
      (x.reserve || []).concat(x.taxi || []).forEach(function (id) { held[String(id)] = 1; });
      return {id: String(x.roster_id), name: SCC.teamLabel(u.metadata && u.metadata.team_name, u.display_name, 'Team ' + x.roster_id),
        manager: u.display_name || '', mine: x.roster_id === rosterId,
        roster: (x.players || []).map(function (id) {
          var info = SCC.playerInfo(players, id);
          return slim({id: String(id), name: info.name, pos: info.pos, team: info.team, held: !!held[String(id)]});
        })};
    });
    if (dynasty) {
      // The next three drafts, which are the ones FantasyCalc prices.
      var seasons = [1, 2, 3].map(function (n) { return String(Number(season) + n); }), name = {};
      var picks = SCC.draftPicks(rosters.map(function (x) { return x.roster_id; }), got[2], seasons, lg.rounds);
      teams.forEach(function (t) { name[t.id] = t.name; });
      teams.forEach(function (t) {
        t.picks = picks[Number(t.id)].map(function (p) {
          return Object.assign(p, {via: String(p.from) === t.id ? '' : (name[String(p.from)] || 'Team ' + p.from)});
        });
      });
    }
    return teams;
  }

  // Sleeper's most-added players over the last day, most first: [{id, count}] (the Waivers tab).
  async function trendingAdds(limit) {
    var list = await getJson(API + '/players/nfl/trending/add?lookback_hours=24&limit=' + (limit || 40));
    return (list || []).map(function (x) { return {id: String(x.player_id), count: Number(x.count) || 0}; });
  }

  /* A Sleeper league's completed transactions over the last `weeks` weeks (trades, waiver
     claims, free-agent moves, commissioner moves), with team names, for the Transactions
     tab (SCC.transactionsFrom). Players Titan hasn't met yet are looked up by id. */
  async function leagueTransactions(lg, rosterId, week, weeks) {
    var paths = ['/rosters', '/users'];
    for (var w = Math.max(1, Number(week) - (weeks || 3) + 1); w <= Number(week); w++) paths.push('/transactions/' + w);
    var got = await Promise.all(paths.map(function (p, i) {
      var job = getJson(API + '/league/' + lg.id + p);
      return i < 2 ? job : job.catch(function () { return []; });
    }));
    var who = {}, names = {}, all = [], ids = [];
    (got[1] || []).forEach(function (u) { who[u.user_id] = u; });
    (got[0] || []).forEach(function (r) {
      var u = who[r.owner_id] || {};
      names[r.roster_id] = SCC.teamLabel(u.metadata && u.metadata.team_name, u.display_name, 'Team ' + r.roster_id);
    });
    got.slice(2).forEach(function (list) { all = all.concat(list || []); });
    all.forEach(function (t) { ids = ids.concat(Object.keys(t.adds || {}), Object.keys(t.drops || {})); });
    var players = await loadPlayers(), missing = missingIds([ids], players);
    if (missing.length) await resolveMissing(missing, players);
    return SCC.transactionsFrom(all, names, players, rosterId);
  }

  /* A Sleeper league's waiver budget (FAAB), for bid suggestions on the Waivers tab: the
     budget, what's left on the person's roster, and the league's winning bids over the last
     six weeks (completed waiver claims). */
  async function leagueWaivers(lg, rosterId, week) {
    var paths = ['/rosters'];
    for (var w = Math.max(1, Number(week) - 5); w <= Number(week); w++) paths.push('/transactions/' + w);
    var got = await Promise.all(paths.map(function (p, i) {
      var job = getJson(API + '/league/' + lg.id + p);
      return i ? job.catch(function () { return []; }) : job;
    }));
    var mine = (got[0] || []).filter(function (r) { return r.roster_id === rosterId; })[0] || {};
    var used = Number((mine.settings || {}).waiver_budget_used) || 0, bids = [];
    got.slice(1).forEach(function (list) {
      (list || []).forEach(function (t) {
        if (t.type === 'waiver' && t.status === 'complete' && t.settings && t.settings.waiver_bid !== undefined) bids.push(Number(t.settings.waiver_bid) || 0);
      });
    });
    return {budget: Number(lg.faab) || 0, left: Math.max(0, (Number(lg.faab) || 0) - used), bids: bids};
  }

  /* A league's regular season for the Standings tab: {teams: [{id, name}], games:
     [{week, a, b, aPts, bPts, done}], playoffTeams}. A week before `week` counts as
     played. Sleeper: the rosters, members and each week's matchups up to the playoffs
     (roster ids are the team ids, as in leagueTeams). ESPN: the league's schedule. */
  async function leagueSchedule(lg, season, week) {
    if (lg.platform === 'yahoo') throw new Error('Yahoo standings are coming next');
    if (lg.platform === 'espn') return ESPN.fetchSchedule(lg.espnId, season, week);
    var last = (Number(lg.playoffStart) || 15) - 1, paths = ['/rosters', '/users'];
    for (var w = 1; w <= last; w++) paths.push('/matchups/' + w);
    var got = await Promise.all(paths.map(function (p, i) {
      var job = getJson(API + '/league/' + lg.id + p);
      return i < 2 ? job : job.catch(function () { return []; });
    }));
    var who = {}, games = [];
    (got[1] || []).forEach(function (u) { who[u.user_id] = u; });
    got.slice(2).forEach(function (list, i) {
      var pairs = {};
      (list || []).forEach(function (m) {
        if (m.matchup_id !== null && m.matchup_id !== undefined) (pairs[m.matchup_id] = pairs[m.matchup_id] || []).push(m);
      });
      Object.keys(pairs).forEach(function (k) {
        var p = pairs[k];
        if (p.length === 2) {
          games.push({week: i + 1, a: String(p[0].roster_id), b: String(p[1].roster_id),
            aPts: Number(p[0].points) || 0, bPts: Number(p[1].points) || 0, done: i + 1 < Number(week)});
        }
      });
    });
    return {teams: (got[0] || []).map(function (x) {
      var u = who[x.owner_id] || {};
      return {id: String(x.roster_id), name: SCC.teamLabel(u.metadata && u.metadata.team_name, u.display_name, 'Team ' + x.roster_id)};
    }), games: games, playoffTeams: Number(lg.playoffTeams) || 6};
  }

  /* One Sleeper league's matchup from its matchups, rosters and members. Each
     side's starters come in lineup order (Sleeper's `starters` follows it). */
  function sleeperMatchup(lg, rosterId, matchups, rosters, users, players) {
    var ms = matchups || [];
    var me = ms.filter(function (m) { return m.roster_id === rosterId; })[0];
    var opp = me && me.matchup_id !== null && me.matchup_id !== undefined
      ? ms.filter(function (m) { return m.matchup_id === me.matchup_id && m.roster_id !== rosterId; })[0] : null;
    if (!me || !opp) return {cfg: lg, none: true};
    var owner = {}, who = {}, pic = {}, rec = {};
    (rosters || []).forEach(function (r) {
      var s = r.settings || {};
      owner[r.roster_id] = r.owner_id;
      rec[r.roster_id] = (s.wins || 0) + '-' + (s.losses || 0) + (s.ties ? '-' + s.ties : '');
    });
    (users || []).forEach(function (u) {
      who[u.user_id] = SCC.teamLabel(u.metadata && u.metadata.team_name, u.display_name);
      pic[u.user_id] = u.avatar || '';
    });
    var side = function (m) {
      return {name: who[owner[m.roster_id]] || ('Team ' + m.roster_id), avatar: pic[owner[m.roster_id]] || '', record: rec[m.roster_id] || '',
        players: lg.lineup.map(function (slot, i) {
        var id = (m.starters || [])[i];
        if (!id || id === '0') return {slot: slot, empty: true};
        var info = SCC.playerInfo(players, id);
        return {id: String(id), name: info.name, pos: info.pos, team: info.team, slot: slot, pts: Number((m.players_points || {})[id]) || 0};
      })};
    };
    return {cfg: lg, me: side(me), opp: side(opp)};
  }

  // An ESPN side in lineup order, with Sleeper ids for projections.
  function espnSide(lg, s, players) {
    ESPN.toSleeper(s.players, players);
    var used = {};
    return {name: s.name, avatar: '', record: s.record || '', players: lg.lineup.map(function (slot) {
      for (var i = 0; i < s.players.length; i++) {
        if (!used[i] && s.players[i].start && s.players[i].slot === slot) { used[i] = 1; return s.players[i]; }
      }
      return {slot: slot, empty: true};
    })};
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

  /* Rosters, matchups and the schedule for one week, for the Results tab.
     Sleeper leagues: the week's rosters and matchups. ESPN leagues: the week's
     box score for the person's team, shaped the same way (espnWeek). */
  async function collectScores(account, leagues, week, season) {
    var sched = await getJson(SCHEDULE + season);
    if (!sched || !sched.length) throw new Error('could not read the NFL schedule');
    var prog = SCC.weekProgress(sched, week);
    var userId = String(account.userId || '');
    var espn = leagues.filter(function (l) { return l.platform === 'espn'; });
    var yahoo = leagues.filter(function (l) { return l.platform === 'yahoo'; });
    leagues = leagues.filter(isSleeper);
    var out = {week: week, userId: userId, started: prog.started, done: prog.done,
      total: prog.total, leagues: [], players: {}, skipped: []};
    yahoo.forEach(function (l) { out.skipped.push(l.key + ': Yahoo leagues come to Results in a later step'); });
    if (!prog.started) return out;

    var players = await loadPlayers();
    var sets = await Promise.all(leagues.map(function (l) {
      return Promise.all([
        getJson(API + '/league/' + l.id + '/rosters').catch(function () { return null; }),
        getJson(API + '/league/' + l.id + '/matchups/' + week).catch(function () { return null; })
      ]);
    }));
    var boxes = await Promise.all(espn.map(function (l) {
      if (l.teamId === null || l.teamId === undefined) return {error: 'pick your team in Settings'};
      return ESPN.fetchMatchup(l.espnId, season, week, l.teamId)
        .then(function (m) { return m || {error: 'no matchup that week'}; })
        .catch(function (e) {
          var why = String((e && (e.code || '') + ' ' + (e.message || '')) || e);
          return {error: /private|permission|precondition|unauthenticated/i.test(why) ? 'private, so it needs your ESPN login (Settings)' : 'could not read ESPN'};
        });
    }));
    var missing = missingIds([].concat.apply([], sets.map(function (s) {
      return (s[1] || []).map(function (m) { return m.players; });
    })), players);
    if (missing.length) await resolveMissing(missing, players);

    // ESPN players Sleeper's list doesn't have are added for this week only,
    // on top of the shared list rather than into it.
    var pmap = Object.create(players);
    out.players = pmap;
    out.leagues = leagues.map(function (l, i) { return {cfg: l, rosters: sets[i][0], matchups: sets[i][1]}; });
    espn.forEach(function (l, i) {
      var b = boxes[i];
      if (b.error) out.skipped.push(l.key + ': ' + b.error);
      else out.leagues.push(espnWeek(l, b.me, pmap, userId));
    });
    return out;
  }

  /* One ESPN team's week in the shape of Sleeper's rosters and matchups, so
     SCC.scoreWeek scores it like any league: its players (Sleeper ids where
     matched), its starters in lineup order, and each player's points. */
  function espnWeek(lg, me, players, userId) {
    ESPN.toSleeper(me.players, players);
    var ids = [], pts = {}, used = {};
    me.players.forEach(function (p) {
      ids.push(p.id);
      pts[p.id] = p.pts;
      if (!players[p.id]) players[p.id] = [p.name, p.pos, p.team];
    });
    var starters = lg.lineup.map(function (slot) {
      for (var i = 0; i < me.players.length; i++) {
        var p = me.players[i];
        if (!used[i] && p.start && p.slot === slot) { used[i] = 1; return p.id; }
      }
      return '0';
    });
    var rosterId = Number(me.teamId);
    return {cfg: lg,
      rosters: [{roster_id: rosterId, owner_id: userId, players: ids}],
      matchups: [{roster_id: rosterId, matchup_id: 1, players: ids, starters: starters, players_points: pts}]};
  }

  /* Sleeper's weekly projections (RotoWire's numbers), trimmed and kept for an hour. */
  var PROJ_POS = '&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF';
  function projectionsUrl(season, week) {
    return 'https://api.sleeper.app/projections/nfl/' + season + '/' + week + '?season_type=regular' + PROJ_POS;
  }
  async function fetchProjections(season, week) {
    var key = 'titan.proj.v1.' + season + '.' + week;
    var cached = store.get(key);
    if (cached && Date.now() - cached.ts < 3600 * 1000) return cached.map;
    try {
      var list = await getJson(projectionsUrl(season, week));
      var map = SCC.trimProjections(list || []);
      store.set(key, {ts: Date.now(), map: map});
      return map;
    } catch (e) {
      return cached ? cached.map : {};
    }
  }

  /* Sleeper's season-long projections, trimmed and kept for 12 hours: Titan's own trade
     values (SCC.titanValues) on the Trade tab. Never throws: no projections, no values. */
  async function fetchSeasonProjections(season) {
    var key = 'titan.sproj.v1.' + season, cached = store.get(key);
    if (cached && Date.now() - cached.ts < 12 * 3600 * 1000) return cached.map;
    try {
      var map = SCC.trimProjections((await getJson('https://api.sleeper.app/projections/nfl/' + season + '?season_type=regular' + PROJ_POS)) || []);
      store.set(key, {ts: Date.now(), map: map});
      return map;
    } catch (e) {
      return cached ? cached.map : {};
    }
  }

  var api = {
    fetchSeasonProjections: fetchSeasonProjections,
    store: store, getJson: getJson, lookupUser: lookupUser, discoverLeagues: discoverLeagues,
    collect: collect, collectScores: collectScores, livePoints: livePoints,
    collectMatchups: collectMatchups, sleeperMatchup: sleeperMatchup, leagueTeams: leagueTeams, leagueSchedule: leagueSchedule,
    trendingAdds: trendingAdds, leagueWaivers: leagueWaivers, leagueTransactions: leagueTransactions,
    loadPlayers: loadPlayers, clearPlayers: clearPlayers, fetchDetails: fetchDetails,
    fetchProjections: fetchProjections, PLAYERS_KEY: PLAYERS_KEY
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SleeperAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
