/* Titan Fantasy Football Manager: ESPN fantasy leagues.
 *
 * ESPN has no documented public API; this reads the same JSON the ESPN fantasy
 * site uses. Public leagues answer browsers directly. Private leagues need a
 * member's espn_s2 and SWID cookies, and a browser can't attach cookies to a
 * request to ESPN, so those reads go through Titan's server (setTransport).
 * Every ESPN player is matched to the same player in Sleeper's list, so
 * injuries, game locks, rankings and projections work exactly as they do for
 * Sleeper leagues.
 */
(function (root) {
  'use strict';

  var SCC = root.SCC || (typeof require === 'function' ? require('./engine.js') : null);

  var BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/';
  var VIEWS = 'view=mSettings&view=mTeam&view=mRoster';

  // ESPN lineup slot ids, in Sleeper's slot names. Spots Titan can't fill
  // (punter, head coach) are left out of the lineup.
  var SLOT = {0: 'QB', 2: 'RB', 3: 'WRRB_FLEX', 4: 'WR', 5: 'REC_FLEX', 6: 'TE', 7: 'SUPER_FLEX',
    8: 'DL', 9: 'DL', 10: 'LB', 11: 'DL', 12: 'DB', 13: 'DB', 14: 'DB', 15: 'IDP_FLEX',
    16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX'};
  // Dedicated spots first, then the flex spots: the order Sleeper lists them in.
  var SLOT_ORDER = [0, 2, 4, 6, 23, 3, 5, 7, 17, 16, 8, 9, 11, 10, 12, 13, 14, 15];
  var POS = {1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 9: 'DT', 10: 'DE', 11: 'LB', 12: 'CB', 13: 'S', 16: 'DEF'};
  var TEAM = {1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN',
    11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
    21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX',
    33: 'BAL', 34: 'HOU'};
  // ESPN's injury statuses, as the tags Sleeper uses.
  var INJ = {QUESTIONABLE: 'Questionable', DAY_TO_DAY: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out',
    INJURY_RESERVE: 'IR', SUSPENSION: 'Sus'};

  // How a private league is read in the browser: Titan's server, with the
  // signed-in person's saved ESPN login. Set by sync.js.
  var transport = null;
  function setTransport(fn) { transport = fn; }

  /* A league id typed as a number or pasted as an ESPN link. */
  function parseLeagueId(s) {
    s = String(s || '').trim();
    var m = s.match(/leagueId=(\d+)/i) || s.match(/^(\d{3,12})$/);
    return m ? m[1] : '';
  }

  // SWIDs are GUIDs in braces; people copy them with or without.
  function normSwid(s) {
    s = String(s || '').trim().toUpperCase();
    return s && s[0] !== '{' ? '{' + s + '}' : s;
  }

  function cookieHeader(creds) {
    return 'espn_s2=' + String(creds.s2 || '').trim() + '; SWID=' + normSwid(creds.swid);
  }

  /* One league's settings, teams and rosters. Resolves to {json}, or {error}:
     'private' when ESPN wants a member's login, 'not found' for a bad id. */
  async function fetchLeague(id, season, opts) {
    opts = opts || {};
    var query = VIEWS + (opts.week ? '&scoringPeriodId=' + opts.week : '');
    var url = BASE + season + '/segments/0/leagues/' + id + '?' + query;
    var browser = typeof window !== 'undefined';
    try {
      var res = await fetch(url, browser ? {cache: 'no-store', credentials: 'omit'}
        : {headers: opts.creds && opts.creds.s2 ? {Cookie: cookieHeader(opts.creds)} : {}});
      if (res.ok) return {json: await res.json()};
      if (res.status === 404) return {error: 'not found'};
      if (res.status !== 401) return {error: 'ESPN answered ' + res.status};
    } catch (e) {
      if (!browser || !transport) return {error: 'could not reach ESPN (' + (e.message || e) + ')'};
    }
    if (!browser || !transport) return {error: 'private'};
    try {
      // The server builds the ESPN address itself from these three values.
      return {json: await transport({leagueId: String(id), season: String(season), week: opts.week || undefined})};
    } catch (e) {
      var why = (e && (e.code || '') + ' ' + (e.message || '')) || String(e);
      return {error: /private|permission|precondition|unauthenticated|401/i.test(why) ? 'private' : (e.message || why)};
    }
  }

  function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function teamName(t) { return cleanName(t.name || ((t.location || '') + ' ' + (t.nickname || ''))) || ('Team ' + t.id); }

  function lineupOf(settings) {
    var counts = (settings.rosterSettings && settings.rosterSettings.lineupSlotCounts) || {};
    var out = [];
    SLOT_ORDER.forEach(function (sid) {
      for (var n = Number(counts[sid] || 0); n > 0; n--) out.push(SLOT[sid]);
    });
    return out;
  }

  // Points per catch: ESPN's stat 53 is receptions.
  function pprOf(settings) {
    var items = (settings.scoringSettings && settings.scoringSettings.scoringItems) || [];
    for (var i = 0; i < items.length; i++) if (Number(items[i].statId) === 53) return Number(items[i].points) || 0;
    return 0;
  }

  /* The league as Titan describes every league (see SCC.leaguesFromSleeper).
     `link` is what the person saved: {id, teamId}. */
  function leagueCfg(json, link, prefs) {
    var s = json.settings || {};
    var id = 'espn:' + json.id;
    var pref = (prefs || {})[id] || {};
    var name = cleanName(s.name) || ('ESPN league ' + json.id);
    var teamId = link && link.teamId !== undefined && link.teamId !== null ? Number(link.teamId) : null;
    // ESPN leagues have no picture of their own; Titan shows your team's logo, as ESPN does.
    var mine = teamId === null ? null : (json.teams || []).filter(function (t) { return Number(t.id) === teamId; })[0];
    var logo = mine && /^https?:\/\//.test(mine.logo || '') ? String(mine.logo).replace(/^http:/, 'https:') : '';
    return {
      id: id, platform: 'espn', espnId: String(json.id), teamId: teamId,
      key: name, name: name, pic: logo, lineup: lineupOf(s),
      teams: Number(s.size) || (json.teams || []).length, ppr: pprOf(s),
      kind: s.draftSettings && Number(s.draftSettings.keeperCount) > 0 ? 'Keeper' : 'Redraft',
      bestBall: false, status: '',
      playoffTeams: Number((s.scheduleSettings || {}).playoffTeamCount) || 0,
      faab: s.acquisitionSettings && s.acquisitionSettings.isUsingAcquisitionBudget ? Number(s.acquisitionSettings.acquisitionBudget) || 0 : 0,
      active: pref.active !== undefined ? !!pref.active : true, exposure: true
    };
  }

  /* Every team in the league with its managers, for "which team is yours?". */
  function teamsOf(json) {
    var who = {};
    (json.members || []).forEach(function (m) {
      who[normSwid(m.id)] = cleanName(m.displayName || ((m.firstName || '') + ' ' + (m.lastName || '')));
    });
    return (json.teams || []).map(function (t) {
      var owners = (t.owners || []).map(normSwid);
      return {id: t.id, name: teamName(t), owners: owners,
        manager: owners.map(function (o) { return who[o]; }).filter(Boolean).join(', ')};
    });
  }

  /* The team a SWID manages, if any. */
  function ownedTeam(json, swid) {
    var s = normSwid(swid);
    if (!s) return null;
    var t = teamsOf(json).filter(function (x) { return x.owners.indexOf(s) >= 0; })[0];
    return t ? t.id : null;
  }

  // Each ESPN player is found in Sleeper's list by name, position and team (engine.js, shared with Yahoo).
  var indexPlayers = SCC.playerIndex, matchSleeper = SCC.matchPlayer;

  function entries(team) { return (team && team.roster && team.roster.entries) || []; }

  /* One ESPN league in the shape SCC.buildLeague gives a Sleeper league: the
     person's roster (Sleeper ids where matched) and who's rostered anywhere. */
  function buildLeague(cfg, json, players) {
    if (cfg.teamId === null) return {cfg: cfg, error: 'pick your team in Settings'};
    var mine = (json.teams || []).filter(function (t) { return t.id === cfg.teamId; })[0];
    if (!mine) return {cfg: cfg, error: 'no team found'};
    players = players || {};
    var idx = indexPlayers(players), byes = SCC.setByes(), inLineup = {};
    cfg.lineup.forEach(function (s) { inLineup[s] = 1; });

    var info = function (e) {
      var pl = (e.playerPoolEntry && e.playerPoolEntry.player) || {};
      var pos = POS[pl.defaultPositionId] || '?';
      var team = SCC.teamAbbr(TEAM[pl.proTeamId] || '');
      var name = pos === 'DEF' ? team + ' D/ST' : cleanName(pl.fullName) || ('ESPN player ' + e.playerId);
      var sid = matchSleeper(idx, players, name, pos, team);
      return {sid: sid, name: sid && pos !== 'DEF' ? players[sid][0] : name, pos: pos, team: team,
        inj: INJ[pl.injuryStatus] || ''};
    };

    // Points come with the league for the week it was read for (ESPN player ids).
    var roster = [], startCount = 0, unmatched = 0, espnPoints = {};
    entries(mine).forEach(function (e) {
      var p = info(e), slot = SLOT[e.lineupSlotId] || '';
      var start = !!inLineup[slot];
      var pe = e.playerPoolEntry || {};
      if (start) startCount++;
      if (!p.sid) unmatched++;
      if (pe.appliedStatTotal !== undefined) espnPoints[e.playerId] = pe.appliedStatTotal;
      roster.push({
        id: p.sid || ('espn:' + e.playerId), espnId: e.playerId, name: p.name, pos: p.pos, team: p.team,
        start: start, slot: start ? slot : '', bye: byes[p.team] || '',
        inj: p.inj, outish: false, locked: false, held: slot === 'IR', heldAs: slot === 'IR' ? 'IR' : ''
      });
    });

    var takenNorm = {}, takenAbbr = {};
    (json.teams || []).forEach(function (t) {
      entries(t).forEach(function (e) {
        var p = info(e);
        if (p.pos === 'DEF') takenAbbr[p.team] = 1;
        else takenNorm[SCC.norm(p.name)] = 1;
      });
    });
    return {cfg: cfg, roster: roster, startCount: startCount, takenNorm: takenNorm, takenAbbr: takenAbbr,
      unmatched: unmatched, espnPoints: espnPoints};
  }

  /* The week's box scores, read for one team: 'points' gives that team's points
     so far (ESPN player ids), 'matchup' its head-to-head (both lineups, with
     team names). Much lighter than reading the whole league again. If ESPN's
     week filter finds nothing (a two-week playoff matchup), it asks again
     without it. Private leagues go through Titan's server, like fetchLeague. */
  async function readBoxscore(id, season, week, teamId, kind, opts) {
    opts = opts || {};
    var pick = kind === 'matchup' ? matchupFrom : pointsFromBoxscore;
    var url = BASE + season + '/segments/0/leagues/' + id + '?view=mBoxscore' + (kind === 'matchup' ? '&view=mTeam' : '') +
      '&scoringPeriodId=' + week;
    var browser = typeof window !== 'undefined';
    var filtered = {'x-fantasy-filter': JSON.stringify({schedule: {filterMatchupPeriodIds: {value: [Number(week)]}}})};
    var status = 0;
    for (var i = 0; i < 2; i++) {
      var headers = i === 0 ? Object.assign({}, filtered) : {};
      if (!browser && opts.creds && opts.creds.s2) headers.Cookie = cookieHeader(opts.creds);
      try {
        var res = await fetch(url, browser ? {cache: 'no-store', credentials: 'omit', headers: headers} : {headers: headers});
        status = res.status;
        if (!res.ok) break;
        var got = pick(await res.json(), teamId);
        if (got) return got;
      } catch (e) {
        // The week filter is a custom header, which needs ESPN's OK first; if
        // that fails, the plain request (no custom header) is tried next.
        status = 0;
        if (i === 0) continue;
        break;
      }
    }
    if (browser && transport && (status === 401 || status === 0)) {
      return transport({leagueId: String(id), season: String(season), week: Number(week), kind: kind, teamId: Number(teamId)});
    }
    return null;
  }

  function fetchPoints(id, season, week, teamId, opts) { return readBoxscore(id, season, week, teamId, 'points', opts); }

  /* This week's head-to-head for one team: {me, opp}, each {teamId, name,
     players: [{espnId, name, pos, team, slot, start, pts}]}, or null when the
     team has no matchup this week. */
  function fetchMatchup(id, season, week, teamId, opts) { return readBoxscore(id, season, week, teamId, 'matchup', opts); }

  function matchupFrom(json, teamId) {
    var names = {}, recs = {}, found = null;
    teamsOf(json).forEach(function (t) { names[t.id] = SCC.teamLabel(t.name, t.manager); });
    (json.teams || []).forEach(function (t) {
      var o = t.record && t.record.overall;
      if (o) recs[t.id] = (o.wins || 0) + '-' + (o.losses || 0) + (o.ties ? '-' + o.ties : '');
    });
    (json.schedule || []).forEach(function (m) {
      if (found || !m.home || !m.away) return; // a bye has no away side
      var mine = Number(m.home.teamId) === Number(teamId) ? m.home : Number(m.away.teamId) === Number(teamId) ? m.away : null;
      if (mine) found = {me: boxSide(mine, names, recs), opp: boxSide(mine === m.home ? m.away : m.home, names, recs)};
    });
    return found;
  }

  function boxSide(side, names, recs) {
    var players = ((side.rosterForCurrentScoringPeriod || {}).entries || []).map(function (e) {
      var pe = e.playerPoolEntry || {}, pl = pe.player || {};
      var pos = POS[pl.defaultPositionId] || '?', team = SCC.teamAbbr(TEAM[pl.proTeamId] || '');
      var slot = SLOT[e.lineupSlotId] || '';
      return {espnId: e.playerId, name: pos === 'DEF' ? team + ' D/ST' : cleanName(pl.fullName) || ('ESPN player ' + e.playerId),
        pos: pos, team: team, slot: slot, start: !!slot && slot !== 'BN' && slot !== 'IR', pts: Number(pe.appliedStatTotal) || 0};
    });
    return {teamId: side.teamId, name: names[side.teamId] || ('Team ' + side.teamId), record: (recs || {})[side.teamId] || '', players: players};
  }

  /* Sleeper ids (and Sleeper's spelling of names) for ESPN players, so
     projections and rankings find them. */
  function toSleeper(list, players) {
    players = players || {};
    var idx = indexPlayers(players);
    (list || []).forEach(function (p) {
      var sid = matchSleeper(idx, players, p.name, p.pos, p.team);
      p.id = sid || ('espn:' + p.espnId);
      if (sid && p.pos !== 'DEF') p.name = players[sid][0];
    });
    return list;
  }

  /* Kickoff times for every NFL game of the season, from ESPN's public NFL
     schedule: {team: {week: [kickoff time in ms, time still to be set]}}. */
  /* This week's NFL games from ESPN's public scoreboard, for game context: kickoff, teams
     (Titan's abbreviations), where (indoors, country, neutral site), the game's state, and
     the betting line when ESPN has one (the home team's spread, negative when it's favored,
     and the over/under). */
  var SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  async function fetchScoreboard() {
    var res = await fetch(SCOREBOARD);
    if (!res.ok) throw new Error('ESPN scoreboard answered ' + res.status);
    return scoreboardFrom(await res.json());
  }

  function scoreboardFrom(json) {
    var num = function (x) { return x === undefined || x === null || x === '' || isNaN(Number(x)) ? null : Number(x); };
    var games = ((json && json.events) || []).map(function (e) {
      var c = (e.competitions || [])[0] || {}, v = c.venue || {}, o = (c.odds || [])[0] || null;
      var side = function (k) { return (c.competitors || []).filter(function (t) { return t.homeAway === k; })[0]; };
      var h = side('home'), a = side('away');
      if (!h || !a || !h.team || !a.team) return null;
      return {id: String(e.id || ''), kickoff: Date.parse(e.date) || 0, home: SCC.teamAbbr(h.team.abbreviation), away: SCC.teamAbbr(a.team.abbreviation),
        indoor: !!v.indoor, country: (v.address || {}).country || '', neutral: !!c.neutralSite, state: ((c.status || {}).type || {}).state || '',
        spread: o ? num(o.spread) : null, total: o ? num(o.overUnder) : null};
    }).filter(Boolean);
    return {season: Number(json && json.season && json.season.year) || 0, week: Number(json && json.week && json.week.number) || 0, games: games};
  }

  /* A league's regular-season schedule and scores, for the Standings tab. readSchedule
     gets ESPN's JSON (with a saved login on the server); fetchSchedule (the app) reads it,
     or asks Titan's server for a private league (kind 'schedule', which answers with
     slimSchedule), and gives it the shape of sleeper.js leagueSchedule. */
  var SCHEDULE_VIEWS = 'view=mMatchupScore&view=mTeam&view=mSettings';
  async function readSchedule(id, season, opts) {
    opts = opts || {};
    var browser = typeof window !== 'undefined';
    var res = await fetch(BASE + season + '/segments/0/leagues/' + id + '?' + SCHEDULE_VIEWS,
      browser ? {cache: 'no-store', credentials: 'omit'} : {headers: opts.creds && opts.creds.s2 ? {Cookie: cookieHeader(opts.creds)} : {}});
    if (res.ok) return res.json();
    throw new Error(res.status === 401 || res.status === 403 ? 'private' : 'ESPN answered ' + res.status);
  }

  async function fetchSchedule(id, season, week) {
    var json;
    try { json = await readSchedule(id, season); }
    catch (e) {
      if (typeof window === 'undefined' || !transport) throw e;
      json = await transport({leagueId: String(id), season: String(season), kind: 'schedule'});
    }
    return scheduleFrom(json, week);
  }

  // Byes (no away side) and playoff weeks are left out. A game counts as played once ESPN names a winner.
  function scheduleFrom(json, week) {
    var sched = ((json && json.settings) || {}).scheduleSettings || {};
    var last = Number(sched.matchupPeriodCount) || 14, games = [];
    ((json && json.schedule) || []).forEach(function (m) {
      if (!m.home || !m.away || Number(m.matchupPeriodId) > last) return;
      games.push({week: Number(m.matchupPeriodId), a: String(m.home.teamId), b: String(m.away.teamId),
        aPts: Number(m.home.totalPoints) || 0, bPts: Number(m.away.totalPoints) || 0,
        done: m.winner ? m.winner !== 'UNDECIDED' : Number(m.matchupPeriodId) < Number(week)});
    });
    return {teams: teamsOf(json || {}).map(function (t) { return {id: String(t.id), name: SCC.teamLabel(t.name, t.manager)}; }), games: games,
      playoffTeams: Number(sched.playoffTeamCount) || 6};
  }

  function slimSchedule(json) {
    var sched = ((json && json.settings) || {}).scheduleSettings || {};
    var side = function (x) { return x ? {teamId: x.teamId, totalPoints: x.totalPoints} : null; };
    return {
      settings: {scheduleSettings: {matchupPeriodCount: sched.matchupPeriodCount, playoffTeamCount: sched.playoffTeamCount}},
      schedule: ((json && json.schedule) || []).map(function (m) {
        return {matchupPeriodId: m.matchupPeriodId, winner: m.winner || '', home: side(m.home), away: side(m.away)};
      }),
      teams: ((json && json.teams) || []).map(function (t) {
        return {id: t.id, name: t.name || '', location: t.location || '', nickname: t.nickname || '', owners: t.owners || []};
      }),
      // Members name each team's manager: "Team name (account name)" on Standings.
      members: ((json && json.members) || []).map(function (m) {
        return {id: m.id, displayName: m.displayName || '', firstName: m.firstName || '', lastName: m.lastName || ''};
      })
    };
  }

  /* ESPN's latest NFL news (the public feed behind espn.com/nfl), newest first, trimmed
     to what Titan shows: headline, summary, link, picture, when, whether it's a video or
     ESPN+, and the players and teams the story tags. */
  var NEWS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50';
  async function fetchNews() {
    var browser = typeof window !== 'undefined';
    var res = await fetch(NEWS, browser ? {credentials: 'omit', cache: 'no-store'} : {});
    if (!res.ok) throw new Error('ESPN news answered ' + res.status);
    return newsFrom(await res.json());
  }

  function newsFrom(json) {
    var https = function (u) { return /^https:\/\//.test(u || '') ? u : ''; };
    return ((json && json.articles) || []).map(function (a) {
      var cats = a.categories || [];
      return {
        id: String(a.id || ''), at: Date.parse(a.published || a.lastModified || '') || 0,
        headline: cleanName(a.headline), text: cleanName(a.description),
        url: https(a.links && a.links.web && a.links.web.href), image: https(((a.images || [])[0] || {}).url),
        video: a.type === 'Media', plus: !!a.premium,
        athletes: cats.filter(function (c) { return c.type === 'athlete' && c.description; })
          .map(function (c) { return {id: String(c.athleteId || ''), name: cleanName(c.description)}; }),
        teams: cats.filter(function (c) { return c.type === 'team' && c.team && c.team.abbreviation; })
          .map(function (c) { return c.team.abbreviation; })
      };
    }).filter(function (s) { return s.id && s.headline && s.url; }).sort(function (a, b) { return b.at - a.at; });
  }

  async function fetchKickoffs(season) {
    var browser = typeof window !== 'undefined';
    var res = await fetch(BASE + season + '?view=proTeamSchedules_wl', browser ? {credentials: 'omit'} : {});
    return res.ok ? kickoffsFrom(await res.json()) : null;
  }

  function kickoffsFrom(json) {
    var out = {};
    ((json.settings && json.settings.proTeams) || []).forEach(function (t) {
      var team = TEAM[t.id];
      if (!team) return;
      var weeks = t.proGamesByScoringPeriod || {};
      Object.keys(weeks).forEach(function (w) {
        var g = (weeks[w] || [])[0];
        if (g && g.date) (out[team] = out[team] || {})[w] = [Number(g.date), !!g.startTimeTBD];
      });
    });
    return out;
  }

  function pointsFromBoxscore(json, teamId) {
    var out = null;
    (json.schedule || []).forEach(function (m) {
      [m.home, m.away].forEach(function (side) {
        if (!side || Number(side.teamId) !== Number(teamId)) return;
        out = out || {};
        ((side.rosterForCurrentScoringPeriod || {}).entries || []).forEach(function (e) {
          var pe = e.playerPoolEntry || {};
          if (pe.appliedStatTotal !== undefined) out[e.playerId] = pe.appliedStatTotal;
        });
      });
    });
    return out;
  }

  /* Only the parts of a league Titan reads, so the server's answer for a
     private league is a fraction of ESPN's. */
  function slimLeague(json) {
    var s = json.settings || {};
    return {
      id: json.id, seasonId: json.seasonId, scoringPeriodId: json.scoringPeriodId,
      settings: {
        name: s.name, size: s.size,
        rosterSettings: {lineupSlotCounts: (s.rosterSettings && s.rosterSettings.lineupSlotCounts) || {}},
        scoringSettings: {scoringItems: ((s.scoringSettings && s.scoringSettings.scoringItems) || []).map(function (i) {
          return {statId: i.statId, points: i.points};
        })},
        draftSettings: {keeperCount: (s.draftSettings && s.draftSettings.keeperCount) || 0},
        scheduleSettings: {playoffTeamCount: (s.scheduleSettings || {}).playoffTeamCount, matchupPeriodCount: (s.scheduleSettings || {}).matchupPeriodCount},
        acquisitionSettings: {isUsingAcquisitionBudget: !!(s.acquisitionSettings || {}).isUsingAcquisitionBudget,
          acquisitionBudget: (s.acquisitionSettings || {}).acquisitionBudget}
      },
      members: (json.members || []).map(function (m) {
        return {id: m.id, displayName: m.displayName || '', firstName: m.firstName || '', lastName: m.lastName || ''};
      }),
      teams: (json.teams || []).map(function (t) {
        return {id: t.id, name: t.name || '', location: t.location || '', nickname: t.nickname || '', owners: t.owners || [], logo: t.logo || '',
          roster: {entries: entries(t).map(function (e) {
            var pe = e.playerPoolEntry || {}, pl = pe.player || {};
            return {playerId: e.playerId, lineupSlotId: e.lineupSlotId, playerPoolEntry: {appliedStatTotal: pe.appliedStatTotal, player: {
              fullName: pl.fullName || '', defaultPositionId: pl.defaultPositionId, proTeamId: pl.proTeamId, injuryStatus: pl.injuryStatus || ''}}};
          })}};
      })
    };
  }

  var api = {
    fetchLeague: fetchLeague, setTransport: setTransport, parseLeagueId: parseLeagueId, normSwid: normSwid,
    leagueCfg: leagueCfg, teamsOf: teamsOf, ownedTeam: ownedTeam, buildLeague: buildLeague, slimLeague: slimLeague,
    fetchPoints: fetchPoints, pointsFromBoxscore: pointsFromBoxscore, fetchKickoffs: fetchKickoffs, kickoffsFrom: kickoffsFrom,
    fetchMatchup: fetchMatchup, matchupFrom: matchupFrom, toSleeper: toSleeper, fetchNews: fetchNews, newsFrom: newsFrom,
    readSchedule: readSchedule, fetchSchedule: fetchSchedule, scheduleFrom: scheduleFrom, slimSchedule: slimSchedule,
    fetchScoreboard: fetchScoreboard, scoreboardFrom: scoreboardFrom,
    SLOT: SLOT, POS: POS, TEAM: TEAM
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EspnAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
