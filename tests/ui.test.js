// The app in headless Chrome at phone width, served from this folder. ESPN
// league requests are answered with the test leagues through Chrome's request
// interception, so no real league is read. With TITAN_SLEEPER_USER set it also
// links that Sleeper account from Settings and checks the Results tab and the
// rankings viewer. Needs Chrome (set CHROME if it isn't in the default place).
const {spawn} = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./lib');
const {check} = T;

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!fs.existsSync(CHROME)) { T.skip('Chrome not found (set CHROME to its path)'); process.exit(0); }
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const {league: L1} = await T.espnLeagues();
  const BOX = JSON.stringify(T.espnBoxscore(L1));
  // A stand-in for Titan's /api/trade-values: a value for every player in the test
  // league, best first, shaped the way the server trims FantasyCalc's.
  T.app('engine.js');
  const ESPNJS = T.app('espn.js'), tradePlayers = await T.sleeperPlayers(), tradeAsked = [];
  const inLeague = [].concat(...L1.teams.map(t => ESPNJS.buildLeague(ESPNJS.leagueCfg(L1, {id: L1.id, teamId: t.id}, {}), L1, tradePlayers).roster));
  const VALUES = JSON.stringify({at: Date.now(), values: inLeague.filter(p => p.pos !== 'DEF' && p.pos !== 'K').map((p, i) => ({
    s: /^\d+$/.test(p.id) ? p.id : '', e: String(p.espnId), n: p.name, p: p.pos, t: p.team, v: 9000 - i * 40, r: i + 1, pr: 1, tr: i % 3 ? 120 : -80}))});
  // A stand-in schedule for the test league: 14 weeks of round robin, nothing played yet, four playoff spots.
  const rr = [], ten = L1.teams.map(t => t.id);
  for (let w = 1; w <= 14; w++) {
    const rest = ten.slice(1);
    for (let k = 0; k < (w - 1) % 9; k++) rest.push(rest.shift());
    const order = [ten[0], ...rest];
    for (let i = 0; i < 5; i++) rr.push({matchupPeriodId: w, winner: 'UNDECIDED', home: {teamId: order[i], totalPoints: 0}, away: {teamId: order[9 - i], totalPoints: 0}});
  }
  const SCHED = JSON.stringify({id: L1.id, settings: {scheduleSettings: {matchupPeriodCount: 14, playoffTeamCount: 4}}, schedule: rr,
    members: L1.members, teams: L1.teams.map(t => ({id: t.id, location: t.location, nickname: t.nickname, owners: t.owners}))});
  // A stand-in for the test league's draft: a snake draft of every roster, round by round, and ESPN's player list for its players.
  const ROUNDS = Math.min(...L1.teams.map(t => t.roster.entries.length)), dpicks = [];
  for (let r = 1; r <= ROUNDS; r++) {
    (r % 2 ? L1.teams : L1.teams.slice().reverse()).forEach((t, i) => dpicks.push({overallPickNumber: dpicks.length + 1, roundId: r, roundPickNumber: i + 1,
      teamId: t.id, playerId: t.roster.entries[r - 1].playerId, keeper: false, bidAmount: 0}));
  }
  // ESPN's transactions (view=mTransactions2): one free-agent pickup by team 1 an hour ago, the player from its roster.
  const TX = JSON.stringify({transactions: [{id: 'tx1', type: 'FREEAGENT', status: 'EXECUTED', teamId: 1, processDate: Date.now() - 3600e3, scoringPeriodId: 1,
    items: [{type: 'ADD', playerId: L1.teams[0].roster.entries[0].playerId, fromTeamId: -1, toTeamId: 1}]}], teams: L1.teams, members: L1.members});
  const DRAFT = JSON.stringify({seasonId: 2026, settings: {size: L1.teams.length, draftSettings: {type: 'SNAKE', keeperCount: 0}},
    draftDetail: {drafted: true, inProgress: false, picks: dpicks}});
  const POOL = JSON.stringify([].concat(...L1.teams.map(t => t.roster.entries.map(e => {
    const p = e.playerPoolEntry.player;
    return {id: p.id, fullName: p.fullName, defaultPositionId: p.defaultPositionId, proTeamId: p.proTeamId};
  }))));
  // A stand-in for ESPN's news feed: a story about the test team's QB, and one about nobody on it.
  const newsQb = inLeague.find(p => p.pos === 'QB').name, newsAt = new Date(Date.now() - 10 * 60000).toISOString();
  const NEWS = JSON.stringify({articles: [
    {id: 101, type: 'HeadlineNews', headline: newsQb + ' is set to start', description: 'Test story.', published: newsAt,
      links: {web: {href: 'https://www.espn.com/nfl/story/_/id/101'}}, categories: [{type: 'athlete', athleteId: 1, description: newsQb}]},
    {id: 102, type: 'Story', headline: 'Another NFL story', description: '', published: newsAt,
      links: {web: {href: 'https://www.espn.com/nfl/story/_/id/102'}}, categories: [{type: 'athlete', athleteId: 2, description: 'Somebody Else'}]}]});
  // A stand-in for ESPN's scoreboard, for when Titan's server says scores are unavailable (scoresDown) and the browser asks ESPN.
  let scoresDown = false;
  const ESPN_BOARD = JSON.stringify({season: {year: 2026}, week: {number: 1}, events: [{id: '403', date: new Date(Date.now() - 1800e3).toISOString(),
    competitions: [{venue: {}, status: {type: {state: 'in', shortDetail: '3rd - 1:00'}},
      competitors: [{homeAway: 'home', score: '21', team: {abbreviation: 'NYJ'}}, {homeAway: 'away', score: '17', team: {abbreviation: 'NE'}}]}]}]});
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // Titan's /api/game-context: every test team expects 28.5 points, with a windy forecast.
    if (u === '/api/game-context') {
      const abbrs = [...new Set(inLeague.map(p => p.team).filter(Boolean))];
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify({at: Date.now(), season: 2026, week: 1, dvpSeason: 2025, dvp: {}, teams: Object.fromEntries(abbrs.map((t, i) =>
        [t, {opp: abbrs[(i + 1) % abbrs.length], home: i % 2 === 0, implied: 28.5, weather: {temp: 60, wind: 20, precip: 0, text: 'Sunny'}}]))}));
    }
    // Titan's /api/news: the stand-in stories, trimmed the way the server trims ESPN's.
    if (u === '/api/news') {
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify({at: Date.now(), stories: ESPNJS.newsFrom(JSON.parse(NEWS))}));
    }
    // Titan's /api/scores: one game on, one to come (or, with scoresDown, the answer when ESPN turns the server away).
    if (u === '/api/scores') {
      res.writeHead(200, {'content-type': 'application/json'});
      if (scoresDown) return res.end(JSON.stringify({at: Date.now(), unavailable: true, games: []}));
      return res.end(JSON.stringify({at: Date.now(), season: 2026, week: 1, games: [
        {id: '401', kickoff: Date.now() - 3600e3, home: 'KC', away: 'LAC', state: 'in', hs: 14, as: 7, detail: '2nd - 5:12'},
        {id: '402', kickoff: Date.now() + 3600e3, home: 'BUF', away: 'MIA', state: 'pre', hs: 0, as: 0, detail: ''}]}));
    }
    if (u === '/api/trade-values') {
      tradeAsked.push(req.url);
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(VALUES);
    }
    let f = path.join(T.ROOT, u.endsWith('/') ? u + 'index.html' : u);
    // Like Firebase Hosting's rewrite: any /app/ address is the app page.
    if (u.startsWith('/app/') && !fs.existsSync(f)) f = path.join(T.ROOT, 'app', 'index.html');
    if (!f.startsWith(path.normalize(T.ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache'});
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  await new Promise(r => server.on('listening', r));
  const ORIGIN = 'http://localhost:' + server.address().port;
  const PORT = 9400 + Math.floor(Math.random() * 500);
  // Chrome's profile goes in the OS temp folder; some sandboxed folders break its cache.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ui-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore'});
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {}
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('Chrome did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let seq = 0, bumpWeek = false; // bumpWeek: the demo's section moves Sleeper's NFL week on one, so no game has started
  const kitPosts = []; // signups the newsletter test sends to Kit's form address (answered here, never sent to Kit)
  const pending = {}, problems = [];
  const ESPN_PATTERNS = [{urlPattern: '*fantasy.espn.com*leagues*'}, {urlPattern: '*fantasy.espn.com*players*'}];
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({id, method, params})); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', {accept: true});
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.url;
      const headers = [{name: 'access-control-allow-origin', value: ORIGIN}, {name: 'content-type', value: 'application/json'}];
      // Sleeper's NFL week, a week on (bumpWeek) when there's one to move to: Sleeper's real answer otherwise.
      if (url.includes('api.sleeper.app/v1/state/nfl')) {
        fetch(url).then(r => r.json()).then(s => {
          const w = Number(s.week);
          if (bumpWeek && w >= 1 && w < 18) s = Object.assign({}, s, {week: w + 1, display_week: w + 1, leg: w + 1});
          send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(JSON.stringify(s)).toString('base64')});
        }, () => send('Fetch.continueRequest', {requestId: m.params.requestId}));
        return;
      }
      // Titan's public copy of this week's Waiver Wire (the newsletter page): a stand-in issue, so the test never reads the real one.
      if (url.includes('firestore.googleapis.com') && url.includes('/documents/public/waiver-wire-latest')) {
        const doc = {fields: {html: {stringValue: '<h1>Titan Waiver Wire, week 9</h1><p>A stand-in issue for the test.</p>'},
          subject: {stringValue: 'Titan Waiver Wire, week 9: a test'}, through: {stringValue: 'Through week 8 of 2026 (16 of 16 games)'}, week: {integerValue: '9'}}};
        send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 200, body: Buffer.from(JSON.stringify(doc)).toString('base64'),
          responseHeaders: [{name: 'access-control-allow-origin', value: '*'}, {name: 'content-type', value: 'application/json'}]});
        return;
      }
      // Kit's form address (the weekly email's signups): recorded and answered here.
      if (url.includes('app.kit.com/forms/')) {
        kitPosts.push({url, method: m.params.request.method, body: m.params.request.postData || ''});
        send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 200, body: '', responseHeaders: [{name: 'content-type', value: 'text/html'}]});
        return;
      }
      // ESPN's scoreboard, which the browser reads itself when Titan's server can't (ESPN allows any site).
      if (url.includes('site.api.espn.com') && url.includes('/scoreboard')) {
        send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 200, body: Buffer.from(ESPN_BOARD).toString('base64'),
          responseHeaders: [{name: 'access-control-allow-origin', value: '*'}, {name: 'content-type', value: 'application/json'}]});
        return;
      }
      // The browser's CORS check before a request with ESPN's week-filter header.
      if (m.params.request.method === 'OPTIONS') {
        send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 204, body: '', responseHeaders: [
          {name: 'access-control-allow-origin', value: ORIGIN}, {name: 'access-control-allow-headers', value: 'x-fantasy-filter'},
          {name: 'access-control-allow-methods', value: 'GET'}]});
        return;
      }
      const pool = /\/players\?/.test(url), ok = pool || url.includes('/leagues/' + L1.id);
      const body = pool ? POOL : !ok ? '{}' : /mBoxscore/.test(url) ? BOX : /mMatchupScore/.test(url) ? SCHED : /mDraftDetail/.test(url) ? DRAFT
        : /mTransactions2/.test(url) ? TX : JSON.stringify(L1);
      send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: ok ? 200 : 401, responseHeaders: headers,
        body: Buffer.from(body).toString('base64')});
    }
  });
  const ev = async x => (await send('Runtime.evaluate', {expression: x, awaitPromise: true, returnByValue: true})).result?.result?.value;
  const waitFor = async (x, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(x) === true) return true; await sleep(250); } return false; };
  const text = sel => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const submit = (form, field, value) => ev(`(() => { const f = document.querySelector('[data-form="${form}"]');
    f.elements.${field}.value = ${JSON.stringify(value)}; f.requestSubmit(); return true; })()`);
  const tab = async t => { await ev(`document.querySelector('[data-tab="${t}"]').click(); true`); await sleep(500); };
  const linkTabs = () => ev(`[...document.querySelectorAll('[data-link-tab]')].map(b => b.innerText.replace(/\\s+/g, ' ') +
    (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' | ')`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', {patterns: ESPN_PATTERNS});
  // TITAN_SHOTS=<folder> saves screenshots of new screens there (phone and computer widths, both themes).
  const shot = async name => {
    if (!process.env.TITAN_SHOTS) return;
    const r = await send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(path.join(process.env.TITAN_SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
  T.section('the website');
  await send('Page.navigate', {url: ORIGIN + '/'});
  check(await waitFor('!!document.querySelector(".hero h1")', 20000), 'a first visit to / shows the website');
  const web = await ev(`({h1: document.querySelector('.hero h1').innerText.replace(/\\n/g, ' '), open: document.querySelectorAll('a[href="/app/"]').length,
    wide: document.documentElement.scrollWidth <= innerWidth, tip: !!document.querySelector('.site-foot .tip') && !document.querySelector('.site-top .tip')})`);
  check(/one place/i.test(web.h1) && web.open >= 3 && web.wide && web.tip, `"${web.h1}", ${web.open} Open Titan links, fits a 390px phone, the tip jar at the bottom`);
  const seo = await ev(`(() => { let ld = null; try { ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch (e) {}
    const faq = ld ? ld['@graph'].find(x => x['@type'] === 'FAQPage').mainEntity : [];
    // textContent: a closed <details> isn't rendered, so its innerText can come back empty.
    const shown = [...document.querySelectorAll('.faq details')].map(d => [d.querySelector('summary').textContent.trim(), d.querySelector('p').textContent.trim()]);
    const bad = faq.length !== shown.length ? 'count ' + faq.length + ' vs ' + shown.length
      : (faq.map((q, i) => q.name !== shown[i][0] || q.acceptedAnswer.text !== shown[i][1] ? q.name : '').filter(Boolean)[0] || '');
    return {title: document.title, types: ld ? ld['@graph'].map(x => x['@type']).join(',') : 'invalid JSON-LD', bad}; })()`);
  // The title leads with what people search for, and doesn't promise Yahoo (the page's own Yahoo mentions say "coming soon").
  check(/^Fantasy Football Start\/Sit Tool for Sleeper and ESPN \| Titan$/.test(seo.title) && seo.types === 'Organization,WebSite,WebApplication,FAQPage' && !seo.bad,
    `search: "${seo.title}", structured data ${seo.types}, ` + (seo.bad ? 'FAQ differs at: ' + seo.bad : 'its FAQ identical to the page\'s'));

  T.section('the app, at /app/');
  await send('Page.navigate', {url: ORIGIN + '/app/'});
  check(await waitFor('!!document.querySelector("[data-form=link]")', 20000), 'the welcome screen loads');
  check(await ev(`!!document.querySelector('.foot #feedback[href^="mailto:"]') && !!document.querySelector('.foot a[href="/terms.html"]')`),
    'the app footer links Feedback and the Terms of Use');
  check(await ev(`(document.querySelector('meta[name="robots"]') || {}).content`) === 'noindex', 'the app page is kept out of search results (noindex)');
  check(/Sleeper and ESPN/.test(await text('.welcome .lede')), 'the welcome mentions Sleeper and ESPN');

  T.section('starting with ESPN only');
  await ev(`document.querySelector('[data-action="espn-start"]').click(); true`);
  await sleep(500);
  check(/^Sleeper \| ESPN\* \| Yahoo Soon$/.test(await linkTabs()), 'Settings opens at Link more leagues?, ESPN tab: ' + await linkTabs());
  check(await ev(`/Game-day alerts/.test(document.querySelector('#view').innerText) && /Sign in with Google above/.test(document.querySelector('#view').innerText)`),
    'Settings offers game-day alerts, once signed in');
  await submit('espn-add', 'league', 'abc');
  await sleep(200);
  check(/league ID/.test(await text('.banner.stop')), 'junk input is explained');
  await submit('espn-add', 'league', 'https://fantasy.espn.com/football/league?leagueId=99999903');
  check(await waitFor(`/private/i.test((document.querySelector('.banner.stop') || {}).innerText || '')`, 10000), 'a private league asks for the ESPN login');
  await submit('espn-add', 'league', String(L1.id));
  check(await waitFor(`document.querySelectorAll('.pick .chip').length === 10`, 10000), 'the team picker lists all 10 teams');
  await ev(`document.querySelector('.pick [data-team="1"]').click(); true`);
  check(await waitFor(`/ESPN · 10 teams/.test((document.querySelector('.link-pane') || {}).innerText || '')`, 60000), 'the league is saved and loaded');
  check(await waitFor(`!document.getElementById('ticker').hidden && document.querySelectorAll('#ticker .tk-game').length === 2`, 10000),
    'the scores ticker shows this week\'s games under the header');
  check(await ev(`(() => { const g = document.querySelector('#ticker .tk-in'); return !!g && /14/.test(g.innerText) && /2nd/.test(g.innerText) &&
    /espn\\.com\\/nfl\\/game\\/_\\/gameId\\/401/.test(g.href) && !!document.querySelector('#ticker .tk-credit'); })()`),
    'a live game shows its score and clock, opens on ESPN, and ESPN is credited');
  check(/ESPN 1 league\*/.test(await linkTabs()), 'the ESPN tab shows its count');
  await ev(`document.querySelector('[data-link-tab="yahoo"]').click(); true`);
  await sleep(300);
  check(await ev(`document.querySelector('.link-pane button.btn').disabled`), 'the Yahoo tab waits, its button disabled');

  await tab('lineups');
  check(await waitFor(`/default rankings/.test((document.querySelector('.banner.ok') || {}).innerText || '')`, 30000),
    'with nothing imported, Lineups runs on the default rankings');
  const lineup = await ev(`({h: (document.querySelector('.league .card-h') || {}).innerText || '', n: document.querySelectorAll('.lineup .row').length})`);
  check(/Titan Test League/.test(lineup.h) && /ESPN/.test(lineup.h) && lineup.n === 9, 'Lineups shows the ESPN league, 9 spots');
  const site = await ev(`[...document.querySelectorAll('.card.league a.open-site')].map(a => a.innerText + ' ' + a.getAttribute('href'))`);
  check(site.length === 1 && /^Open in ESPN/.test(site[0]) && site[0].includes('fantasy.espn.com/football/team?leagueId=' + L1.id + '&teamId=1&seasonId='),
    'the league has a button to its team page: ' + site[0]);
  const chips = await ev(`[...document.querySelectorAll('[data-filter]')].map(b => ({id: b.dataset.filter, n: Number(b.innerText.match(/(\\d+)$/)[1])}))`);
  let chipsOk = chips.length >= 2 && chips[0].id === 'all' && chips[1].id === 'action';
  for (const c of chips) {
    await ev(`document.querySelector('[data-filter="${c.id}"]').click(); true`);
    await sleep(150);
    if (await ev(`document.querySelectorAll('.card.league').length`) !== c.n) chipsOk = false;
  }
  await ev(`document.querySelector('[data-filter="all"]').click(); true`);
  await sleep(150);
  check(chipsOk, `each filter shows exactly its leagues (${chips.map(c => c.id + ' ' + c.n).join(', ')})`);
  const kicks = await ev(`[...document.querySelectorAll('.lineup .kick')].map(k => k.innerText)`);
  check(kicks.length >= 8 && kicks.every(k => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|^Bye$/.test(k)),
    `kickoff day and time beside each name (${kicks.length} of 9), e.g. "${kicks[0]}"`);
  check(await ev(`getComputedStyle(document.querySelector('.lineup .kick')).fontStyle === 'italic'`), 'in italics');
  check(await ev(`document.querySelector('details.league').open`), 'Lineups leagues start open');
  await ev(`document.querySelector('details.league > summary').click(); true`);
  await sleep(200);
  await tab('rosters');
  await tab('lineups');
  check(await ev(`!document.querySelector('details.league').open`), 'folding a league on Lineups is remembered');
  await ev(`document.querySelector('[data-action="fold-all"][data-kind="lineup"]').click(); true`);
  await sleep(200);
  check(await ev(`document.querySelector('details.league').open`), 'Expand all opens them again');
  const pics = await ev(`({faces: [...document.querySelectorAll('.lineup .pphoto img.hs')].map(i => i.getAttribute('src')),
    logos: document.querySelectorAll('.lineup .pphoto img.tl').length})`);
  check(pics.faces.length === 9 && pics.faces.filter(s => /sleepercdn\.com\/content\/nfl\/players\/thumb\/\d+\.jpg$/.test(s)).length === 8 &&
    pics.faces.some(s => /team_logos\/nfl\/[a-z]+\.png$/.test(s)) && pics.logos === 8,
    `Sleeper headshots with team logos (${pics.faces.length} photos, ${pics.logos} logos; the defense is its logo)`);
  const games = await ev(`[...document.querySelectorAll('.tiles-games .tile')].map(t => t.innerText.replace(/\\n/g, ' '))`);
  const count = label => Number((games.find(t => t.endsWith(label)) || '').split(' ')[0]);
  check(games.length === 4 && ['starters locked', 'starters yet to play', 'bench locked', 'bench yet to play'].every(l => games.some(t => t.endsWith(l))),
    'game tiles: ' + games.join(' | '));
  check(count('starters locked') + count('starters yet to play') <= 9, 'starter counts fit the lineup');
  // Each league card opens with where the roster is deep or thin and its playoff odds (leagueAdvice), loaded quietly.
  check(await waitFor(`/to make the playoffs/.test((document.querySelector('.league .lg-advice') || {}).textContent || '')`, 40000),
    'a league card leads with where you stand and your playoff odds: ' + (await text('.league .lg-advice')).replace(/\s+/g, ' ').slice(0, 150));
  T.section('player search on Rosters');
  await tab('rosters');
  const order = await ev(`[...document.querySelectorAll('.roster-card .roster > li')].map(li => li.classList.contains('rdiv') ? '|' + li.innerText.toUpperCase() + '|'
    : li.querySelector('.slot').innerText + ':' + ((li.querySelector('.who small') || {}).innerText || '').split(' · ')[0])`);
  const startLabels = order.slice(0, 9).map(x => x.split(':')[0]).join(' ');
  const benchPos = order.slice(order.indexOf('|BENCH|') + 1, order.indexOf('|RESERVE|')).map(x => x.split(':')[1]);
  const posRank = {QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5};
  check(startLabels === 'QB RB RB WR WR TE FLEX K DEF', 'Rosters list the starters spot by spot, like Sleeper: ' + startLabels);
  check(benchPos.length === 6 && benchPos.every((p, i) => i === 0 || posRank[benchPos[i - 1]] <= posRank[p]) &&
    order[order.length - 1].startsWith('IR:'), `then the bench by position (${benchPos.join(' ')}) and the IR player under Reserve`);
  check(await waitFor(`/to make the playoffs/.test((document.querySelector('.roster-card .lg-advice') || {}).textContent || '')`, 20000),
    'Rosters leads each league with the same advice');
  const someone = (await ev(`(document.querySelector('.roster .row .name-line b') || {}).innerText || ''`)).split(' ').pop();
  const search = async q => {
    await ev(`(() => { const i = document.querySelector('[data-roster-search]'); i.focus(); i.value = ${JSON.stringify(q)};
      i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await sleep(150);
    return ev(`({rows: [...document.querySelectorAll('.roster .row')].filter(r => !r.hidden).length, none: !document.querySelector('[data-find-none]').hidden,
      count: document.querySelector('[data-find-count]').innerText, focused: !!document.activeElement && 'rosterSearch' in document.activeElement.dataset})`);
  };
  const found = await search(someone);
  check(found.rows >= 1 && !found.none && found.focused && /match/.test(found.count), `searching "${someone}" finds ${found.count}, the box keeps its cursor`);
  const nobody = await search('zzqqxx');
  check(nobody.rows === 0 && nobody.none, 'a search with no match says so');
  const cleared = await search('');
  check(cleared.rows === 16 && !cleared.none, 'clearing the search shows every player again');
  await ev(`document.querySelector('details.roster-card > summary').click(); true`);
  await sleep(200);
  const folded = await ev(`!document.querySelector('details.roster-card').open`);
  const during = await search(someone);
  const openWhile = await ev(`document.querySelector('details.roster-card').open`);
  await search('');
  const after = await ev(`document.querySelector('details.roster-card').open`);
  check(folded && during.rows >= 1 && openWhile && !after, 'a folded league opens while a search matches in it, then folds back');
  await ev(`document.querySelector('[data-action="fold-all"][data-kind="roster"]').click(); true`);
  await sleep(200);

  await tab('matchup');
  check(await waitFor(`!!document.querySelector('.match .board')`, 30000), 'the Matchup tab loads');
  const head = await ev(`(() => { const d = document.querySelector('details.match'); const w = [...d.querySelectorAll('.winbar .wp')].map(x => parseInt(x.innerText, 10));
    return {open: d.open, score: d.querySelector('.mh-score').innerText.replace(/\\n/g, ' '), wp: w, status: d.querySelector('.mh-status').innerText}; })()`);
  check(!head.open && /Team 1/.test(head.score) && /Team 2/.test(head.score), 'each league starts collapsed, its header showing both teams and scores: ' + head.score);
  check(head.wp.length === 2 && head.wp[0] + head.wp[1] === 100, `a chance-to-win bar in the header (${head.wp.join('% / ')}%)`);
  check(/^(Winning|Losing) by \d+\.\d|^Tied|^Projected to (win|lose) by \d|^Projected to tie|^(Won|Lost) by \d/.test(head.status), 'where you stand, in words: ' + head.status);
  const mchips = await ev(`[...document.querySelectorAll('[data-mfilter]')].map(b => ({id: b.dataset.mfilter, n: Number(b.innerText.match(/(\\d+)$/)[1])}))`);
  let mchipsOk = mchips.length === 4 && mchips[0].id === 'all' && await ev(`document.querySelectorAll('.match-sum .tile').length === 3`);
  for (const c of mchips) {
    await ev(`document.querySelector('[data-mfilter="${c.id}"]').click(); true`);
    await sleep(150);
    if (await ev(`document.querySelectorAll('details.match').length`) !== c.n) mchipsOk = false;
  }
  await ev(`document.querySelector('[data-mfilter="all"]').click(); true`);
  await sleep(150);
  check(mchipsOk, `a summary of where you stand, each count a filter showing exactly its leagues (${mchips.map(c => c.id + ' ' + c.n).join(', ')})`);
  await shot('matchup-collapsed-390');
  await ev(`document.querySelector('details.match > summary').click(); true`);
  await sleep(300);
  await shot('matchup-open-390');
  if (process.env.TITAN_SHOTS) {
    await ev(`document.documentElement.dataset.theme = 'dark'; true`);
    await sleep(200);
    await shot('matchup-open-390-dark');
    await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
    await sleep(500);
    await shot('matchup-open-1280-dark');
    await ev(`delete document.documentElement.dataset.theme; true`);
    await sleep(200);
    await shot('matchup-open-1280');
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    await sleep(500);
  }
  await tab('lineups');
  await tab('matchup');
  await waitFor(`!!document.querySelector('details.match')`, 30000);
  check(await ev(`document.querySelector('details.match').open`), 'opening a league is remembered after leaving the tab');
  const mu = await ev(`({board: ((document.querySelector('.match .board') || {}).innerText || (document.querySelector('.card.league') || {}).innerText || '').replace(/\\n/g, ' '),
    rows: document.querySelectorAll('.match .mrow').length,
    opp: [...document.querySelectorAll('.match .minfo.opp b')].map(b => b.innerText).filter(Boolean).length,
    tabs: [...document.querySelectorAll('#tabs .sec-name')].map(b => b.innerText).join(' | ')})`);
  check(/Team 1/.test(mu.board) && /Team 2/.test(mu.board) && mu.rows === 9 && mu.opp === 9, `scoreboard (${mu.board}) and both lineups, 9 spots each`);
  const sb = await ev(`(() => { const d = document.querySelector('details.match'); return {pts: d.querySelectorAll('.board .sb-pts').length,
    hidden: getComputedStyle(d.querySelector('.mh-score')).display === 'none', fits: d.scrollWidth <= d.clientWidth + 1,
    yet: [...d.querySelectorAll('.mpts-col.yet small')].every(s => s.innerText === 'proj')}; })()`);
  check(sb.pts === 2 && sb.hidden && sb.fits && sb.yet, 'opened, one scoreboard with both scores (the header\'s score row steps aside), nothing cut off, players still to play showing their projection');
  check(mu.tabs === 'Lineups | Matchup | League | Players | Rankings | Results', `six sections (${mu.tabs})`);
  const addr = await ev(`({path: location.pathname, title: document.title})`);
  check(addr.path === '/app/matchup' && /^Matchup · Titan/.test(addr.title), `each screen has its own address and title (${addr.path}, "${addr.title}")`);
  await ev('history.back(), true');
  await sleep(700);
  check(await ev(`location.pathname === '/app/lineups' && document.querySelector('#tabs [aria-current="page"]').dataset.tab === 'lineups'`),
    'Back goes to the screen before');
  await send('Page.navigate', {url: ORIGIN + '/app/byes'});
  check(await waitFor(`!!document.querySelector('table.byes')`, 30000), 'an address opens its screen directly (/app/byes)');
  await tab('byes');
  check(await ev(`!!document.querySelector('table.byes')`), 'the Byes table renders');
  const nav = await ev(`(() => { const t = document.getElementById('tabs'), r = t.getBoundingClientRect();
    return {fixed: getComputedStyle(t).position, gap: Math.round(innerHeight - r.bottom),
      subs: [...document.querySelectorAll('.subtabs button')].map(b => b.innerText).join(' | '),
      on: (document.querySelector('[data-section][aria-current="page"]') || {}).dataset?.section}; })()`);
  check(nav.fixed === 'fixed' && nav.gap <= 1 && nav.subs === 'Waivers | News | Exposure | Byes | Schedule' && nav.on === 'players',
    `on a phone the sections sit along the bottom, and Players shows its screens as sub-tabs (${nav.subs})`);
  await tab('trade');
  await tab('byes');
  await ev(`document.querySelector('[data-section="league"]').click(); true`);
  await sleep(500);
  const lastLeague = await ev('location.pathname');
  check(lastLeague === '/app/trade', `a section opens on the screen used there last (${lastLeague})`);
  await tab('score');
  check(await waitFor(`[...document.querySelectorAll('details.score .sname')].some(s => /Titan Test League/.test(s.innerText))`, 30000),
    'the Results tab scores the ESPN league');
  check(await ev(`document.querySelector('#tabs [data-tab="score"]').innerText === 'Results'`), 'the tab is called Results');
  await ev(`document.querySelector('[data-action="fold-all"][data-kind="score"]').click(); true`);
  const scoreOpen = await ev(`[...document.querySelectorAll('details.score')].every(d => d.open)`);
  await ev(`document.querySelector('[data-action="fold-none"][data-kind="score"]').click(); true`);
  check(scoreOpen && await ev(`[...document.querySelectorAll('details.score')].every(d => !d.open)`),
    'Results has Expand all and Collapse all, like the other tabs');
  const rs = await ev(`({pts: !!document.querySelector('.wsum-pts b'), res: [...document.querySelectorAll('details.score .sres')].map(s => s.innerText),
    // This week: no arrow ahead. The week before (Tuesday until the first kickoff): the arrow to this week opens only once a game has started.
    ahead: (() => { const b = document.querySelectorAll('.wstep [data-sweek]')[1], now = !!document.querySelector('.wstep h3 small');
      return now ? b.disabled : true; })(), help: !!document.querySelector('.results-help'),
    fits: document.documentElement.scrollWidth <= innerWidth, sec: document.querySelector('#tabs .sec-btn[data-tab="score"]').getAttribute('aria-current')})`);
  check(rs.pts && rs.res.length === 1 && /^(W|L|T|Winning|Losing|Tied) \d/.test(rs.res[0]) && rs.ahead && rs.help && rs.fits && rs.sec === 'page',
    `Results is its own section: the week's points up top, won or lost in each league (${rs.res.join(', ')}), no arrow past this week, the explanations in one fold`);
  await shot('results-espn-390');
  await send('Page.navigate', {url: ORIGIN + '/app/results'});
  check(await waitFor(`!!document.querySelector('.wsum-pts b')`, 30000), 'opened straight onto Results (its address, or a reload there), the week loads by itself');

  T.section('the Trade tab');
  await tab('trade');
  check(await waitFor(`document.querySelectorAll('[data-ui="tradePartner"] option').length > 1`, 30000), 'the Trade tab lists the other teams in the league');
  check(tradeAsked.some(q => /dynasty=0/.test(q) && /qbs=1/.test(q) && /teams=10/.test(q) && /ppr=0\.5/.test(q)),
    'values come from Titan\'s server, for the league\'s format: ' + (tradeAsked[0] || 'not asked'));
  check(await ev(`!!document.querySelector('.credit a[href="https://fantasycalc.com"]')`), 'FantasyCalc is credited, with a link');
  check(fs.readFileSync(path.join(T.ROOT, 'app', 'index.html'), 'utf8').includes('href="https://fantasycalc.com"'),
    'the app page links FantasyCalc in its own HTML, not only through JavaScript (FantasyCalc asks for that)');
  await ev(`(() => { const s = document.querySelector('[data-ui="tradePartner"]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  check(await waitFor(`document.querySelectorAll('.tteam').length === 2 && document.querySelectorAll('.tteam .trow').length > 20`, 5000),
    'picking a partner shows both rosters');
  check(await waitFor(`/You are/.test((document.querySelector('.tfit') || {}).textContent || '')`, 20000),
    'with a partner picked, a card says where each team is thin or deep: ' + (await text('.tfit p')).replace(/\s+/g, ' ').slice(0, 110));
  check(await ev(`document.querySelectorAll('.tteam .trow .pos[data-pos]').length > 20 && !!document.querySelector('.tteam .trow .pos[data-pos="QB"]')`),
    'every player on both rosters carries a colored position tag');
  await ev(`document.querySelector('[data-tsort="posvalue"]').click(); true`);
  const sorted = await ev(`(() => { const t = document.querySelector('.tteam'), heads = [...t.querySelectorAll('.rdiv')].map(d => d.textContent.trim());
    const first = t.querySelector('.trow .pos'); return {heads: heads.join(' '), first: first && first.textContent}; })()`);
  check(/^QB RB WR TE/.test(sorted.heads) && sorted.first === 'QB' && await ev(`document.querySelector('[data-tsort="posvalue"]').getAttribute('aria-pressed') === 'true'`),
    `sorting by position, then value groups each roster under position headers (${sorted.heads})`);
  await ev(`document.querySelector('[data-tsort="value"]').click(); true`);
  check(await ev(`!document.querySelector('.tteam .rdiv')`), 'sorting by value goes back to one list, most valuable first');
  await ev(`document.querySelector('.tteam [data-trade="give"]').click(); true`);
  await ev(`document.querySelector('.tteam [data-trade="get"]').click(); true`);
  check(await waitFor(`/win|Fair/.test((document.querySelector('.trade-sum .tverdict') || {}).textContent || '') && document.querySelectorAll('.trade-sum .tchip').length === 2`, 3000),
    'a player from each side gets a verdict: ' + await text('.trade-sum .tverdict'));
  check(await waitFor(`!document.querySelector('.trade-sum .ttot') && /%/.test(document.querySelector('.trade-sum .tverdict').textContent) &&
    [...document.querySelectorAll('.tteam .tval')].some(v => /\\d/.test(v.textContent))`, 20000),
    'without the owner flag: no FantasyCalc totals, the verdict in percent, and Titan\'s own values beside players');
  check(await ev(`!document.querySelector('.tdyn')`), 'a redraft league has no dynasty note (Titan\'s values are this season only)');
  check(await ev(`/rest of this season/.test(document.getElementById('view').textContent) && !document.querySelector('.tstance')`),
    'Titan\'s values are for the rest of this season; a redraft league has no contender or rebuilder line');
  check(await ev(`[...document.querySelectorAll('.trade-sum *')].every(el => el.getBoundingClientRect().right <= document.querySelector('.trade-sum').getBoundingClientRect().right + 1)`),
    'on a phone the trade fits inside its card (nothing cut off on the right)');
  check(await waitFor(`document.querySelectorAll('.trade-sum .tl-t tbody tr').length === 3 && document.querySelectorAll('.trade-sum .tl-t thead th').length === 3 &&
    /Rest of season/.test(document.querySelector('.trade-sum .tl-t').textContent) && /Playoffs \\(weeks 15-17\\)/.test(document.querySelector('.trade-sum .tl-t').textContent)`, 20000),
    'each team\'s projected starters before and after, this week, the rest of the season and the playoff weeks: ' + (await text('.trade-sum .tlineup')).replace(/\s+/g, ' ').slice(0, 120));
  check(await ev(`/By Titan's own values/.test((document.querySelector('.trade-sum .tedge') || {}).textContent || '')`),
    'and what Titan\'s own values say about the trade: ' + (await text('.trade-sum .tedge')).replace(/\s+/g, ' ').slice(0, 120));

  await ev(`document.querySelector('[data-action="trade-find"]').click(); true`);
  check(await waitFor(`document.querySelectorAll('.tideas .idea').length > 0 || /No fair trade/.test((document.querySelector('.tideas') || {}).textContent || '')`, 8000),
    'Find trades suggests fair trades, or says there are none: ' + await ev(`document.querySelectorAll('.tideas .idea').length + ' idea(s)'`));
  if (await ev(`document.querySelectorAll('.tideas .idea').length > 0`)) {
    await ev(`document.querySelector('.tideas [data-idea]').click(); true`);
    check(await waitFor(`document.querySelectorAll('.trade-sum .tchip').length >= 2 && /Fair/.test((document.querySelector('.trade-sum .tverdict') || {}).textContent || '')`, 3000),
      'opening an idea fills in the trade, and it checks out as fair: ' + await text('.trade-sum .tverdict'));
  }
  await ev(`document.querySelector('[data-action="trade-ideas-clear"]').click(); true`);
  check(await waitFor(`document.querySelector('.tideas').classList.contains('min') && !document.querySelector('.tideas .fine') &&
    document.querySelector('.tideas [data-action="trade-find"]').textContent.trim() === 'Find trades'`, 3000), 'Clear folds the trade ideas back to one line');
  const team3Player = ESPNJS.buildLeague(ESPNJS.leagueCfg(L1, {id: L1.id, teamId: 3}, {}), L1, tradePlayers).roster[0].name;
  await ev(`(() => { const i = document.querySelector('[data-trade-search]'); i.value = ${JSON.stringify(team3Player)}; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  check(await waitFor(`[...document.querySelectorAll('#tsearch .wrow')].some(r => r.querySelector('b').textContent === ${JSON.stringify(team3Player)} && /on Team 3/.test(r.textContent))`, 3000),
    'searching a player shows who has him in each league: ' + team3Player + ', on Team 3 (' + (await text('#tsearch')).replace(/\s+/g, ' ').slice(0, 80) + ')');
  check(await ev(`(() => { const n = (JSON.parse(localStorage.getItem('titan.snapshot.v1') || '{}').leagues || []).length, rows = [...document.querySelectorAll('#tsearch .wrow')];
    return n > 0 && rows.length > 0 && rows.every(r => r.querySelectorAll('.wst').length === n); })()`),
    'every player found has a line for every league: the team that has him, yours, or free agent');
  await shot('trade-search');
  await ev(`(([...document.querySelectorAll('#tsearch .wrow')].find(r => r.querySelector('b').textContent === ${JSON.stringify(team3Player)}) || document).querySelector('[data-tsearch]') || {click() {}}).click(); true`);
  check(await waitFor(`document.querySelector('[data-ui="tradePartner"]').value === '3' && [...document.querySelectorAll('.trade-sum .tchip')].some(c => c.textContent.includes(${JSON.stringify(team3Player)}))`, 3000),
    'Trade for him makes his team the partner and puts him on the get side');
  check(await ev(`!document.querySelector('[data-trade-copy]')`), 'with nobody on your side yet, there\'s nothing to send');
  await ev(`document.querySelector('.tteam [data-trade="give"]').click(); true`);
  check(await waitFor(`(() => { const a = document.querySelector('.trade-sum [data-trade-copy]');
    return !!a && /^Copy and open ESPN/.test(a.textContent) && a.href.startsWith('https://fantasy.espn.com/football/team?leagueId=') && a.target === '_blank' &&
      a.dataset.tradeCopy.startsWith('Trade offer: my ') && a.dataset.tradeCopy.endsWith(' for your ' + ${JSON.stringify(team3Player)}); })()`, 3000),
    'a two-sided trade can be copied and taken to the league\'s site: ' + await ev(`((document.querySelector('[data-trade-copy]') || {dataset: {}}).dataset.tradeCopy || 'none')`));

  // The partner's roster card picks the partner too, and Clear all starts over.
  const cardPick = await ev(`(() => { const s = document.querySelector('.tteam .tp-select'); return s ? {value: s.value, n: s.options.length} : null; })()`);
  check(!!cardPick && cardPick.value === '3' && cardPick.n > 2, 'the partner\'s roster card has the partner picker too, set to the same team');
  await ev(`(() => { const s = document.querySelector('.tteam .tp-select'); s.value = s.options[1].value === '3' ? s.options[2].value : s.options[1].value;
    s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await sleep(400);
  const switched = await ev(`({top: document.querySelector('.bar [data-ui="tradePartner"]').value, card: (document.querySelector('.tteam .tp-select') || {}).value,
    chips: document.querySelectorAll('.trade-sum .tchip').length})`);
  check(switched.top === switched.card && switched.top !== '3' && switched.chips === 0,
    `switching partner on the card switches it at the top too, and starts a new trade (team ${switched.top})`);
  await ev(`document.querySelector('[data-action="trade-reset"]').click(); true`);
  await sleep(400);
  check(await ev(`document.querySelector('.bar [data-ui="tradePartner"]').value === '' && !document.querySelector('.tp-select') && !document.querySelector('.trade-sum') &&
    document.querySelector('[data-action="trade-reset"]').disabled`), 'Clear all starts over: no partner, no trade, and the button rests until there\'s something to clear');

  // Draft results: the league's draft in a pop-up, every pick graded by Titan's values.
  await ev(`document.querySelector('[data-action="draft-open"]').click(); true`);
  check(await waitFor(`!!document.querySelector('dialog.dlg[open]') && document.querySelectorAll('.dgrades .dteam').length === 10`, 20000),
    'See the draft opens the league\'s draft in a pop-up, every team graded: ' + (await text('.dlg-body')).replace(/\s+/g, ' ').slice(0, 90));
  const dg = await ev(`(() => { const b = document.querySelector('.dlg-body');
    return {grades: [...document.querySelectorAll('.dteam .dgrade')].map(x => x.textContent).join(' '), mine: document.querySelectorAll('.dteam.mine').length,
      fits: b.scrollWidth <= b.clientWidth + 1, full: document.querySelector('dialog.dlg').getBoundingClientRect().width >= innerWidth - 1}; })()`);
  check(/^[A-D][+-]?( [A-D][+-]?){9}$/.test(dg.grades) && dg.mine === 1 && dg.fits && dg.full,
    `a grade for each team, best first (${dg.grades}), yours marked, the whole screen on a phone with nothing cut off`);
  await ev(`document.querySelector('.dteam.mine > summary').click(); true`);
  check(await waitFor(`document.querySelectorAll('.dteam.mine[open] .dpick').length === ${ROUNDS}`, 3000) &&
    await ev(`/^[A-Z]+\\d+ taken, [A-Z]+\\d+ now$/.test(document.querySelector('.dteam.mine .dpick small').textContent.split(' · ').pop())`),
    `your team opens to its ${ROUNDS} picks, each with its place at its position: ` + await ev(`document.querySelector('.dteam.mine .dpick small').textContent`));
  await ev(`document.querySelector('[data-dview="board"]').click(); true`);
  check(await waitFor(`document.querySelectorAll('.dboard tbody tr').length === ${ROUNDS} && document.querySelectorAll('.dboard thead th').length === 11`, 3000),
    'Board shows the draft round by round, a column for each team');
  if (process.env.TITAN_SHOTS) {
    await shot('draft-board-390');
    await ev(`document.querySelector('[data-dview="grades"]').click(); true`);
    await sleep(200);
    await shot('draft-grades-390');
    await ev(`document.documentElement.dataset.theme = 'dark'; true`);
    await sleep(200);
    await shot('draft-grades-390-dark');
    await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
    await sleep(500);
    await shot('draft-grades-1280-dark');
    await ev(`document.querySelector('[data-dview="board"]').click(); true`);
    await sleep(200);
    await shot('draft-board-1280-dark');
    await ev(`delete document.documentElement.dataset.theme; true`);
    await sleep(200);
    await shot('draft-board-1280');
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    await sleep(500);
  }
  await ev(`document.querySelector('[data-dview="grades"]').click(); true`);
  await ev(`document.querySelector('[data-action="draft-close"]').click(); true`);
  check(await waitFor(`!document.querySelector('dialog.dlg[open]') && location.pathname === '/app/trade'`, 3000), 'Close shuts it, back on the Trade tab');
  await ev(`document.querySelector('[data-action="draft-open"]').click(); true`);
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  await ev(`history.back(); true`);
  check(await waitFor(`!document.querySelector('dialog.dlg[open]') && location.pathname === '/app/trade' && !!document.querySelector('[data-action="draft-open"]')`, 3000),
    'Back closes it too (the Android app\'s Back button) and stays on the Trade tab');

  T.section('game context on Lineups');
  await tab('lineups');
  check(await waitFor(`[...document.querySelectorAll('.lineup .gctx')].some(s => /team expected 28.5 pts/.test(s.textContent) && /wind 20 mph/.test(s.textContent))`, 10000),
    'each starter shows his team\'s expected points and windy weather: ' + await ev(`((document.querySelector('.lineup .gctx') || {}).textContent || 'none').trim()`));
  check(await ev(`/nflverse/.test(document.getElementById('view').textContent) && !!document.querySelector('a[href="https://github.com/nflverse"]')`),
    'ESPN, the National Weather Service and nflverse are credited');

  T.section('season rankings');
  await tab('season');
  check(await waitFor(`location.pathname === '/app/season' && document.querySelectorAll('[data-sfmt]').length === 4 && document.querySelectorAll('[data-step]').length === 2 &&
    document.querySelector('[data-sfmt="redraft-1qb"]').getAttribute('aria-pressed') === 'true' && /Used by Titan Test League/.test(document.querySelector('.season-slot').textContent)`, 5000),
    'Season rankings sit under Rankings at /app/season: four kinds of league and a TE Premium choice, opening on your league\'s kind (1QB Redraft), which it names');
  // A list the market would disagree with: every valued player in the league, least valuable first.
  const seasonCsv = 'Overall,Player,Position,Team\n' + JSON.parse(VALUES).values.slice().reverse().map((v, i) => `${i + 1},"${v.n}",${v.p},${v.t}`).join('\n');
  await ev(`(() => { const t = document.querySelector('textarea[data-sdraft="text"]'); t.value = ${JSON.stringify(seasonCsv)};
    t.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  check(await waitFor(`/players read/.test(document.getElementById('sdraft-preview').textContent) && /ranked overall/.test(document.getElementById('sdraft-preview').textContent) &&
    !document.querySelector('[data-action="season-save"]').disabled`, 3000), 'pasting a list previews it: how many players, and that it\'s ranked overall');
  await ev(`document.querySelector('[data-action="season-save"]').click(); true`);
  check(await waitFor(`/saved/.test(document.querySelector('.season-slot').textContent) && !!document.querySelector('[data-sfmt="redraft-1qb"] .sdot.good') &&
    !!document.querySelector('[data-step="0"] .sdot.good') && !!document.querySelector('.season-legend') &&
    !!JSON.parse(localStorage.getItem('titan.seasonranks.v1') || '{}').formats['redraft-1qb']`, 3000),
    'saving keeps the list on the device, and its kind of league and the Standard chip get the green dot (with a legend under the chips)');
  await tab('trade');
  await ev(`(() => { const s = document.querySelector('[data-ui="tradePartner"]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  check(await waitFor(`document.querySelectorAll('.tteam').length === 2 && !!document.querySelector('.tseason') && document.querySelectorAll('.tteam .tyours').length > 0`, 20000),
    'on the Trade tab your season rankings set your own values: a note says so, and "yours" shows beside players you rank apart from the market');
  await ev(`document.querySelector('.tteam [data-trade="give"]').click(); true`);
  await ev(`document.querySelector('.tteam [data-trade="get"]').click(); true`);
  const seasonEdge = await ev(`(() => { const e = document.querySelector('.trade-sum .tedge'); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`);
  check(/season rankings/i.test(seasonEdge) && !/\d,\d{3}/.test(seasonEdge),
    'the trade\'s edge reads by your season rankings, as a share and never in FantasyCalc\'s numbers (not the owner): ' + seasonEdge.slice(0, 120));
  await ev(`document.querySelector('[data-action="trade-reset"]').click(); true`);
  await tab('season');
  await ev(`document.querySelector('[data-action="season-del"]').click(); true`);
  check(await waitFor(`!document.querySelector('[data-action="season-del"]') && !JSON.parse(localStorage.getItem('titan.seasonranks.v1') || '{}').formats['redraft-1qb']`, 3000),
    'Delete removes the list (after a confirmation)');

  T.section('the Transactions tab');
  await tab('moves');
  check(await waitFor(`document.querySelectorAll('[data-moves]').length === 4 && !document.querySelector('[data-ui="movesLeague"]') &&
    document.querySelectorAll('.txlist li').length === 1 && /Free agent/.test(document.querySelector('.txlist').textContent) &&
    !/aren't in this list yet/.test(document.getElementById('view').textContent)`, 10000),
    'the Transactions tab has its kind filters (the league dropdown at the top picks the league) and reads the ESPN league\'s moves: ' +
      (await text('.txlist')).replace(/\s+/g, ' ').slice(0, 100));
  check(await ev(`location.pathname === '/app/transactions' && document.title.startsWith('Transactions')`), 'it has its own address: /app/transactions');

  T.section('the Waivers tab');
  await tab('waivers');
  check(await waitFor(`!!document.querySelector('[data-waiver-search]') && /Trending pickups/.test(document.getElementById('view').textContent)`, 5000),
    'the Waivers tab opens, with the search and trending pickups');
  await ev(`(() => { const i = document.querySelector('[data-waiver-search]'); i.value = ${JSON.stringify(newsQb)}; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  check(await waitFor(`document.querySelectorAll('#wsearch .wst.mine').length === 1 && document.activeElement === document.querySelector('[data-waiver-search]')`, 3000) ||
    await waitFor(`document.querySelectorAll('#wsearch .wst.mine').length === 1`, 1000),
    'searching for your QB shows him as yours in the test league: ' + (await text('#wsearch')).replace(/\s+/g, ' ').slice(0, 90));
  check(await ev(`document.getElementById('dot-players').hidden`), 'opening Waivers marks its pickups as seen: the Players dot goes out');
  await tab('lineups');
  check(await ev(`document.getElementById('dot-players').hidden`), 'and it stays out on other screens until a new pickup turns up');

  T.section('the waiver plan and the player card');
  await tab('waivers');
  check(await waitFor(`/Your waiver plan/.test(document.getElementById('view').textContent)`, 5000), 'the waiver plan leads the Waivers tab (its claims are checked in the demo)');
  await tab('lineups');
  await ev(`(() => { const b = document.querySelector('.lineup [data-pcard]'); b.focus(); b.click(); return true; })()`);
  check(await waitFor(`!!document.querySelector('dialog.pcard[open]') && location.pathname === '/app/lineups'`, 3000), 'tapping a starter\'s name opens his card');
  check(await waitFor(`!!document.querySelector('dialog.pcard .pctable') || /No games for him/.test(document.querySelector('dialog.pcard').textContent)`, 20000),
    'his stats load from Sleeper: ' + await ev(`(document.querySelector('dialog.pcard .dlg-body') || {}).textContent.replace(/\\s+/g, ' ').trim().slice(0, 120)`));
  await shot('player-card');
  await ev(`history.back(); true`);
  check(await waitFor(`!document.querySelector('dialog.pcard[open]') && location.pathname === '/app/lineups'`, 3000), 'Back closes the card and stays on Lineups');
  check(await ev(`document.activeElement === document.querySelector('.lineup [data-pcard]')`), 'and keyboard focus returns to the name that opened it');
  check(await ev(`!document.querySelector('.moves') || !!document.querySelector('.moves [data-copy]')`), 'a league with changes to make offers to copy them as text');

  // Find a player: the magnifier in the header, from any screen.
  const starter = await ev(`document.querySelector('.lineup [data-pcard]').textContent.trim()`);
  await ev(`document.getElementById('psearch-btn').click(); true`);
  check(await waitFor(`!!document.querySelector('dialog.psearch[open]') && document.activeElement === document.querySelector('dialog.psearch [data-psearch]')`, 3000),
    'the magnifier opens Find a player, with the cursor in the box');
  await ev(`(() => { const i = document.querySelector('dialog.psearch [data-psearch]'); i.value = ${JSON.stringify(starter)}; i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  check(await waitFor(`[...document.querySelectorAll('dialog.psearch .wrow')].some(r => r.querySelector('b').textContent === ${JSON.stringify(starter)} && /yours/.test(r.textContent))`, 3000),
    'searching a starter\'s name finds him, marked yours in his league: ' + starter);
  await ev(`[...document.querySelectorAll('dialog.psearch .wrow b[data-pcard]')].find(b => b.textContent === ${JSON.stringify(starter)}).click(); true`);
  check(await waitFor(`!!document.querySelector('dialog.pcard[open]')`, 3000), 'tapping him opens his card on top of the search');
  await ev(`history.back(); true`);
  await waitFor(`!document.querySelector('dialog.pcard[open]')`, 3000);
  await ev(`history.back(); true`);
  check(await waitFor(`!document.querySelector('dialog.psearch[open]') && location.pathname === '/app/lineups'`, 3000), 'Back closes the card, then the search, and stays on Lineups');

  T.section('the Standings tab');
  await tab('standings');
  check(await waitFor(`document.querySelectorAll('table.stand tbody tr').length === 10`, 30000), 'every team in the league is listed');
  check(await waitFor(`document.querySelectorAll('table.pstr tbody tr').length === 10 && document.querySelectorAll('table.pstr tr.mine').length === 1 &&
    document.querySelectorAll('table.pstr .ps.g-deep').length > 0 && document.querySelectorAll('table.pstr .ps.g-thin').length > 0`, 30000),
    'Position strength ranks every team at each position, deep in green and thin in red: ' +
      await ev(`[...document.querySelectorAll('table.pstr thead th')].map(t => t.textContent).join(' ')`));
  check(await ev(`(() => { const rows = [...document.querySelectorAll('table.stand tbody tr')];
    return rows.filter(r => r.classList.contains('mine')).length === 1 && rows.every(r => /%$/.test(r.querySelector('.st-odds b').textContent)) &&
      rows.findIndex(r => r.classList.contains('cut')) === 3; })()`), 'your team is marked, every team has playoff odds, and the line falls after the 4th');
  check(/Your playoff chances/.test(await text('#view .banner.ok')), 'your own chances lead the page: ' + (await text('#view .banner.ok')).slice(0, 80));
  check(await waitFor(`document.querySelectorAll('.ppic li').length >= 1 && /Your game/.test(document.querySelector('.ppic').textContent)`, 20000),
    'the playoff picture: your game\'s win-or-lose odds, then who to root for this week: ' + (await text('.ppic')).replace(/\s+/g, ' ').slice(0, 120));

  T.section('Schedule strength');
  await tab('sos');
  check(await waitFor(`location.pathname === '/app/schedule' && document.querySelectorAll('.sos-t tbody tr').length >= 30`, 30000),
    'Schedule strength lists every NFL team\'s road ahead at /app/schedule (under Players)');
  await ev(`document.querySelector('[data-sos-pos="WR"]').click(); true`);
  check(await waitFor(`document.querySelector('[data-sos-pos="WR"]').getAttribute('aria-pressed') === 'true' && /Your WRs/.test(document.querySelector('.sos-t thead').textContent)`, 3000),
    'a position chip switches the table to that position');
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'it fits a 390px phone');

  T.section('the News tab');
  await tab('news');
  check(await waitFor(`document.querySelectorAll('.news-item').length === 2`, 15000), 'ESPN\'s latest stories show');
  check(await ev(`document.querySelectorAll('.news-item.mine .ntag').length === 1`), 'a story about a player on your roster is marked: ' + await text('.ntag'));
  await ev(`document.querySelector('[data-news="mine"]').click(); true`);
  check(await waitFor(`document.querySelectorAll('.news-item').length === 1 && document.querySelectorAll('.news-item.mine').length === 1`, 3000),
    'the Your players filter shows just those');
  await ev(`document.querySelector('[data-news="all"]').click(); true`);
  check(await ev(`!!document.querySelector('.news-item a[href="https://www.espn.com/nfl/story/_/id/101"][target="_blank"]') && document.querySelectorAll('.xrow').length > 0`),
    'each story opens on ESPN, and the insiders on X are still listed');

  T.section('import multiple sources');
  await tab('multi');
  check(await waitFor(`!!document.querySelector('textarea[data-multi="text"]')`, 5000) && await ev(`location.pathname === '/app/multiple'`),
    'Import multiple sources opens under Rankings, at /app/multiple');
  check(await ev(`document.querySelector('#tabs [data-tab="lab"]').hidden && !document.querySelector('.subtabs [data-go="lab"]') &&
    document.querySelector('#tabs [data-tab="value"]').hidden && !document.querySelector('.subtabs [data-go="value"]') &&
    document.querySelectorAll('.subtabs [data-go]').length === 3`), 'Compare rankings and the value report stay hidden from everyone but Titan\'s owner (Import, Season and Import multiple show)');
  // Two sources: the sample rankings, and the same with its top three QBs reordered (A: q0 q1 q2, B: q1 q2 q0).
  const csvA = T.sampleRanks(), linesA = csvA.split(/\r?\n/);
  const qbLines = linesA.map((l, i) => [l.split(','), i]).filter(([c]) => c[1] === 'QB').slice(0, 3);
  const linesB = linesA.slice();
  [3, 1, 2].forEach((r, j) => { const c = qbLines[j][0].slice(); c[3] = String(r); linesB[qbLines[j][1]] = c.join(','); });
  const [q0, q1] = qbLines.map(([c]) => c[0]);
  const addSource = async (name, csv) => {
    await ev(`(() => { const n = document.querySelector('input[data-multi="name"]'); n.value = ${JSON.stringify(name)}; n.dispatchEvent(new Event('input', {bubbles: true}));
      const ta = document.querySelector('textarea[data-multi="text"]'); ta.value = ${JSON.stringify(csv)}; ta.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await sleep(200);
    await ev(`document.querySelector('[data-action="multi-add"]').click(); true`);
    await sleep(300);
  };
  await addSource('Source A', csvA);
  check(await ev(`document.querySelectorAll('.msources li').length === 1 && document.querySelector('[data-action="multi-save"]').disabled`),
    'one source listed; saving waits for a second');
  await addSource('Source B', linesB.join('\n'));
  await ev(`document.querySelector('.mcombined') && document.querySelector('[data-view-pos="QB"]').click(); true`);
  await sleep(200);
  const firstQb = () => ev(`document.querySelector('.mcombined .row b').innerText`);
  const mc = await ev(`({n: document.querySelectorAll('.msources li').length, save: !document.querySelector('[data-action="multi-save"]').disabled,
    places: document.querySelector('.mcombined .row small').innerText, fits: document.documentElement.scrollWidth <= innerWidth})`);
  const even = await firstQb();
  check(mc.n === 2 && mc.save && /Source A QB\d/.test(mc.places) && /Source B QB\d/.test(mc.places) && mc.fits && even === q1,
    `two sources combined, each player showing his place in both ("${mc.places}"); at equal weight the QB1 is ${even}`);
  await ev(`(() => { const s = document.querySelectorAll('.mweight')[0]; s.value = '3'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await sleep(300);
  const heavy = await firstQb();
  check(heavy === q0, `with Source A at 3x its QB1 comes out on top (${heavy})`);
  await shot('multi-390');
  await ev(`document.querySelector('[data-action="multi-save"]').click(); true`);
  await sleep(600);
  await tab('ranks');
  check(await waitFor(`/combined: Source A 3x \\+ Source B/.test(document.querySelector('.saved').innerText)`, 5000),
    'saved as the week\'s rankings, named for its sources: ' + (await text('.saved')).replace(/\s+/g, ' ').slice(0, 110));
  await tab('multi');
  check(await waitFor(`document.querySelectorAll('.msources li').length === 2 && document.querySelectorAll('.mweight')[0].value === '3'`, 5000),
    'back on Import multiple, the week\'s sources and weights are there to change');

  if (process.env.TITAN_SHOTS) {
    // Screenshots only: Season so far needs two weeks, so a made-up week 0 stands in beside week 1 (removed after).
    await ev(`(() => { const a = JSON.parse(localStorage.getItem('titan.account.v1')), s = JSON.parse(localStorage.getItem('titan.snapshot.v1'));
      const cur = JSON.parse(localStorage.getItem('titan.season.v1') || 'null');
      const weeks = Object.assign({}, cur && cur.weeks, {0: {week: 0, actual: 124.6, proj: 118.2, byRank: 130.1, perfect: 151.3, wins: 1, losses: 0, ties: 0, done: true, sig: ''}});
      localStorage.setItem('titan.season.v1', JSON.stringify({season: s.season, user: String(a.userId || a.username || ''), weeks})); return true; })()`);
    await send('Page.navigate', {url: ORIGIN + '/app/results'});
    if (await waitFor(`!!document.querySelector('.season .sc-chart')`, 30000)) {
      await ev(`document.querySelector('.season').scrollIntoView(); true`);
      await sleep(300);
      await shot('season-390');
      await ev(`document.documentElement.dataset.theme = 'dark'; true`);
      await sleep(200);
      await shot('season-390-dark');
      await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
      await sleep(500);
      await ev(`window.scrollTo(0, 0); true`);
      await shot('results-1280-dark');
      await ev(`delete document.documentElement.dataset.theme; true`);
      await sleep(200);
      await shot('results-1280');
      await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
      await sleep(500);
    } else T.skip('the season chart didn\'t draw for the screenshots');
    await ev(`localStorage.removeItem('titan.season.v1'); true`);
  }

  if (T.sleeperUser) {
    T.section('linking Sleeper as well');
    await tab('settings');
    await ev(`document.querySelector('[data-link-tab="sleeper"]').click(); true`);
    await sleep(300);
    await submit('link', 'username', T.sleeperUser);
    check(await waitFor(`document.querySelectorAll('.league').length >= 2`, 120000), 'Sleeper and ESPN leagues show together');
    const jumps = await ev(`document.querySelectorAll('.jump [data-jump]').length`);
    check(jumps >= 2 && jumps === await ev(`document.querySelectorAll('.card.league').length`), `a chip for every league at the top of Lineups (${jumps})`);
    const sl = await ev(`[...document.querySelectorAll('.card.league a.open-site')].map(a => a.getAttribute('href')).filter(h => h.includes('sleeper.com'))`);
    check(sl.length >= 1 && sl.every(h => /^https:\/\/sleeper\.com\/leagues\/\d+\/team$/.test(h)), `Sleeper leagues open their team page on sleeper.com (${sl.length})`);
    // The second league: the last sits at the page's end, which can't scroll to the top.
    await ev(`document.querySelectorAll('.jump [data-jump]')[1].click(); true`);
    await sleep(1200);
    const landed = await ev(`Math.round(document.getElementById(document.querySelectorAll('.jump [data-jump]')[1].dataset.jump).getBoundingClientRect().top)`);
    check(landed >= 0 && landed < 260, `a chip jumps to its league (the card now starts ${landed}px from the top, below the header)`);
    await tab('ranks');
    await ev(`(() => { const ta = document.querySelector('textarea[data-draft="text"]'); ta.value = ${JSON.stringify(T.sampleRanks())};
      ta.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await sleep(300);
    await ev(`document.querySelector('[data-action="ranks-save"]').click(); true`);
    await sleep(600);
    await tab('lineups');
    check(await waitFor(`/DEF uses? the default rankings/.test(document.body.innerText) && !/Using Titan's default rankings/.test(document.body.innerText)`, 5000),
      'after importing rankings without defenses, those rankings win and DEF uses the defaults');
    await tab('score');
    check(await waitFor(`!!document.querySelector('details.score') || /has not kicked off/.test(document.body.innerText)`, 120000), 'the Results tab loads');
    check(await ev(`/^Week \\d+/.test((document.querySelector('.wstep h3') || {}).innerText || '') && document.querySelectorAll('.wstep [data-sweek]').length === 2`),
      'a week at a time, with arrows to step through the weeks played');
    await shot('results-390');
    if (process.env.TITAN_SHOTS && await ev(`!!document.querySelector('details.score')`)) {
      await ev(`document.querySelector('details.score > summary').click(); true`);
      await sleep(300);
      await shot('results-open-390');
    }
    if (await ev(`!!document.querySelector('[data-action="ranks-view"]')`)) {
      await ev(`document.querySelector('[data-action="ranks-view"]').click(); true`);
      check(await waitFor(`!!document.getElementById('ranks-view')`, 5000), 'the week\'s rankings open in the viewer');
    }
  } else {
    T.skip('linking a Sleeper account (set TITAN_SLEEPER_USER to run it)');
  }

  T.section('scores when ESPN turns Titan\'s server away');
  scoresDown = true;
  await send('Fetch.enable', {patterns: [...ESPN_PATTERNS, {urlPattern: '*site.api.espn.com*scoreboard*'}]});
  await send('Page.navigate', {url: ORIGIN + '/app/'});
  const direct = await waitFor(`!document.getElementById('ticker').hidden && [...document.querySelectorAll('#ticker .tk-game')].some(g => /21/.test(g.innerText) && /3rd/.test(g.innerText))`, 20000);
  check(direct, 'Titan\'s server says scores are unavailable, so the ticker reads ESPN\'s scoreboard itself: ' + (await text('#ticker')).replace(/\s+/g, ' ').slice(0, 80));
  scoresDown = false;
  await send('Fetch.enable', {patterns: ESPN_PATTERNS});

  T.section('the demo');
  // Built a week ahead, before any of that week's games, so its leagues have waiver upgrades for the plan on any day.
  bumpWeek = true;
  await send('Fetch.enable', {patterns: [...ESPN_PATTERNS, {urlPattern: '*api.sleeper.app/v1/state/nfl*'}]});
  await send('Page.navigate', {url: ORIGIN + '/app/?demo'});
  check(await waitFor(`document.querySelectorAll('.card.league').length === 2`, 90000), 'Try a demo builds two sample leagues');
  const demo = await ev(`({note: !!document.querySelector('.demo-note'), names: [...document.querySelectorAll('.card.league h3')].map(h => h.innerText).join(', '),
    sync: [...document.scripts].some(s => /sync\\.js/.test(s.src)), open: document.querySelectorAll('.card.league a.open-site').length})`);
  check(demo.note && /Demo League/.test(demo.names) && !demo.sync && demo.open === 0,
    `${demo.names}, with the demo note, no sign-in and no Open in Sleeper button`);
  // The demo's leagues have waiver upgrades, so its Waivers tab shows the plan's claims.
  await tab('waivers');
  check(await waitFor(`document.querySelectorAll('.wclaim').length > 0`, 20000), 'the waiver plan lists claims: ' +
    await ev(`[...document.querySelectorAll('.wclaim .wc-add b')].map(b => b.textContent).join(', ')`));
  const pick = await ev(`(() => { const s = document.querySelector('[data-wdrop]'); return s && s.selectedOptions[0] ? s.selectedOptions[0].textContent : ''; })()`);
  check(/Titan's pick|Nobody/.test(pick), 'each claim names the drop Titan picks, in a list to change him: ' + pick);
  await ev(`document.querySelector('[data-wdone]').click(); true`);
  check(await waitFor(`document.querySelector('[data-wdone]').getAttribute('aria-pressed') === 'true' && /1 of \\d+ claims? done/.test(document.querySelector('.wplan').textContent)`, 3000),
    'Done ticks a claim off: ' + await ev(`document.querySelector('.wplan-h .wmeta').textContent`));
  await shot('waivers-plan');
  await ev(`document.querySelector('[data-wdone]').click(); true`);
  // A repaint patches the page in place: a filter chip keeps keyboard focus after its click redraws the screen, and the
  // same league card element is still there afterwards.
  await tab('lineups');
  const kept = await ev(`(() => { const chip = document.querySelector('.chips [data-filter="action"]') || document.querySelector('.chips [data-filter]');
    const card = document.querySelector('.card.league'); chip.focus(); chip.click();
    return {focus: document.activeElement === document.querySelector('.chips [data-filter="' + chip.dataset.filter + '"]'), same: card.isConnected,
      pressed: document.querySelector('.chips [data-filter="' + chip.dataset.filter + '"]').getAttribute('aria-pressed')}; })()`);
  check(kept.focus && kept.pressed === 'true', `a repaint keeps keyboard focus on the chip just pressed (same card element kept: ${kept.same})`);
  await ev(`document.querySelector('.chips [data-filter="all"]').click(); true`);
  // Each league card: the recommended lineup first, then yours beside it (or one line when they match).
  const cmp = await ev(`(() => { const c = document.querySelector('.card.league'), t = c.querySelector('.lu-cmp');
    return {rec: c.querySelectorAll('.lineup-rec .row').length, head: (c.querySelector('.lu-h') || {}).textContent || '', rows: t ? t.querySelectorAll('tbody tr').length : 0,
      diff: t ? t.querySelectorAll('tr.lu-diff').length : 0, fresh: c.querySelectorAll('.lineup-rec .r-new').length, same: !!c.querySelector('.lu-same'),
      moves: c.querySelectorAll('.move').length}; })()`);
  check(cmp.rec > 0 && /^Recommended lineup/.test(cmp.head.trim()) && (cmp.same ? cmp.moves === 0 && cmp.fresh === 0 : cmp.rows === cmp.rec && cmp.diff > 0 && cmp.fresh > 0),
    `each league leads with its recommended lineup (${cmp.rec} spots, ${cmp.fresh} new), then yours beside it (${cmp.same ? 'they match' : cmp.diff + ' of ' + cmp.rows + ' spots differ'})`);
  await shot('lineups-compare');
  // Lineups' week dropdown: this week, then every week to come, each a plan.
  const weeks = await ev(`[...document.querySelectorAll('select[data-ui="lineWeek"] option')].map(o => o.value)`);
  check(weeks.length >= 2 && weeks[0] === '0' && weeks[weeks.length - 1] === '18', `Lineups has a week dropdown: this week, then every week to 18 (${weeks.length} choices)`);
  const later = weeks[Math.min(2, weeks.length - 1)];
  const pickWeek = v => ev(`(() => { const s = document.querySelector('select[data-ui="lineWeek"]'); s.value = '${v}'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await pickWeek(later);
  check(await waitFor(`!!document.querySelector('.plan-note') && document.querySelector('.plan-note').innerText.includes('Planning week ${later}') &&
    document.querySelectorAll('.card.league').length === 2`, 30000), `picking week ${later} plans both leagues for that week`);
  const planned = await ev(`({vs: [...document.querySelectorAll('.card.league .row .who small')].filter(s => / vs [A-Z]{2,3}\\b/.test(s.textContent)).length,
    games: !!document.querySelector('.tiles-games'), picked: document.querySelector('select[data-ui="lineWeek"]').value})`);
  check(planned.vs > 0 && !planned.games && planned.picked === later, `each player shows that week's opponent (${planned.vs} rows), without this week's game tiles`);
  await shot('lineups-plan');
  await ev(`document.querySelector('.banner [data-rweek]').click(); true`);
  check(await waitFor(`(document.querySelector('input[data-draft="week"]') || {}).value === '${later}'`, 5000),
    `its "Import week ${later}" link opens the import on week ${later}`);
  await tab('lineups');
  check(await waitFor(`!!document.querySelector('.plan-note')`, 10000), 'and back on Lineups the planned week is still picked');
  await pickWeek('0');
  check(await waitFor(`!document.querySelector('.plan-note') && !!document.querySelector('.tiles-games')`, 5000), 'This week goes back to this week\'s lineups');
  await tab('matchup');
  check(/need your real leagues/.test(await text('#view')), 'Matchup explains it needs real leagues');
  bumpWeek = false;
  await send('Fetch.enable', {patterns: ESPN_PATTERNS});
  await send('Page.navigate', {url: ORIGIN + '/app/'});
  // The real app reopens on the tab it was last on there, so go to Lineups first.
  await waitFor(`!!document.querySelector('#tabs:not([hidden])')`, 30000);
  await tab('lineups');
  check(await waitFor(`[...document.querySelectorAll('.card.league h3')].some(h => /Titan Test League/.test(h.innerText))`, 60000) &&
    await ev(`[...document.scripts].some(s => /sync\\.js/.test(s.src))`), 'back in the app, the real leagues are untouched and sign-in loads');

  T.section('on a computer');
  await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  await sleep(400);
  const desk = await ev(`({cols: getComputedStyle(document.querySelector('.league-grid')).gridTemplateColumns.split(' ').length,
    menu: getComputedStyle(document.querySelector('#tabs [aria-current="page"]')).borderBottomStyle,
    foot: getComputedStyle(document.querySelector('.foot-cols')).gridTemplateColumns.split(' ').length, wide: document.documentElement.scrollWidth <= innerWidth,
    width: Math.round(document.getElementById('view').getBoundingClientRect().width),
    art: getComputedStyle(document.body, '::before').backgroundImage,
    tip: !document.querySelector('.top .tip') && getComputedStyle(document.querySelector('.foot .tip')).display !== 'none'})`);
  check(desk.cols === 1 && desk.menu === 'solid' && desk.foot === 3 && desk.wide && /titan\.svg/.test(desk.art) && desk.tip === true,
    `a computer gets the website look: a menu with the section underlined, one league per row (${desk.width}px), a three-column footer, the Titan beside the page, the tip jar at the bottom`);
  check(await waitFor(`!document.getElementById('acct').hidden && getComputedStyle(document.getElementById('acct')).display === 'block' &&
    /Sign in/.test(document.getElementById('acct').innerText)`, 20000), 'the header offers Sign in at the top right');
  // Signed in (a stand-in account, shown only): the menu at the top right has Settings, then Guides, then Sign out.
  await ev(`window.TitanApp.setSync({user: {name: 'Test Person', email: 'test@example.com', photo: ''}}); true`);
  await ev(`document.querySelector('#acct [data-acct="menu"]').click(); true`);
  const acctItems = await ev(`[...document.querySelectorAll('#acct .acct-menu [role="menuitem"]')].map(x => x.textContent.trim() + (x.getAttribute('href') ? ' ' + x.getAttribute('href') : '')).join(' | ')`);
  check(acctItems === 'Settings | Guides /guides/ | Sign out', `the account menu at the top right: ${acctItems}`);
  await ev(`window.TitanApp.setSync({user: null}); true`);
  // Themes: white and blue by default; the header switch turns on dark mode, remembered on the device.
  const bodyBg = () => ev(`getComputedStyle(document.body).backgroundColor`);
  check(await ev(`!document.documentElement.dataset.theme`) && /243, 246, 252/.test(await bodyBg()), 'white and blue by default: ' + await bodyBg());
  await ev(`document.querySelector('.top [data-theme-toggle]').click(); true`);
  check(await ev(`document.documentElement.dataset.theme === 'dark' && localStorage.getItem('titan.theme') === 'dark' &&
    document.querySelector('meta[name="theme-color"]').content === '#0a0f1a'`) && /10, 15, 26/.test(await bodyBg()), 'the header switch turns on dark mode: ' + await bodyBg());
  await send('Page.reload');
  await sleep(500);
  check(await waitFor(`document.readyState === 'complete' && document.querySelectorAll('.card.league').length > 0`, 30000) &&
    await ev(`document.documentElement.dataset.theme === 'dark'`), 'dark mode stays after a reload');
  await ev(`document.querySelector('.top [data-theme-toggle]').click(); true`);
  check(await ev(`!document.documentElement.dataset.theme && !localStorage.getItem('titan.theme')`) && /243, 246, 252/.test(await bodyBg()), 'and switches back to white and blue');
  // The league sidebar: one link per card, left of the cards, sticky, and no chips.
  const sideOk = `(() => { const s = document.querySelector('.with-side > .side'), cards = document.querySelectorAll('.side-main [id^="lg-"]');
    if (!s || !cards.length) return false;
    return s.querySelectorAll('[data-jump]').length === cards.length && !document.querySelector('.jump') &&
      s.getBoundingClientRect().right < cards[0].getBoundingClientRect().left && getComputedStyle(s).position === 'sticky'; })()`;
  check(await waitFor(sideOk, 5000), 'Lineups list the leagues down the left side, beside the cards, with the filters still on top');
  check(await ev(`(() => { const cards = document.querySelectorAll('.card.league'); return cards.length > 0 &&
    [...cards].every(c => c.querySelector('h3 .licon .lsite') && c.querySelector('h3 .licon .lini img[src="/icon.svg"]')) &&
    [...document.querySelectorAll('.side [data-jump]')].every(b => b.querySelector('.licon')); })()`),
    'each league shows its picture (or the Titan icon) with a badge for its site, on the cards and in the sidebar');
  if (await ev(`document.querySelectorAll('.side [data-jump]').length > 1`)) {
    await ev(`document.querySelectorAll('.side [data-jump]')[1].click(); true`);
    check(await waitFor(`document.querySelectorAll('.side [data-jump]')[1].classList.contains('on')`, 4000),
      'a league in the sidebar takes you to its card and stays marked');
  }
  await ev('scrollTo(0, 0); true');
  await tab('rosters');
  check(await waitFor(`document.querySelectorAll('.rtable').length > 0 && document.querySelector('.rtable thead tr').children.length >= 7`, 5000),
    'Rosters show as tables on a computer');
  check(await waitFor(sideOk, 5000), 'Rosters list the leagues down the left side too');
  await tab('score');
  check(await waitFor(sideOk, 30000), 'and so does Results, one link per scored league');
  await tab('rosters');
  await send('Emulation.setDeviceMetricsOverride', {width: 1000, height: 900, deviceScaleFactor: 1, mobile: false});
  await sleep(500);
  check(await ev(`!document.querySelector('.side')`), 'a narrower computer window (1000px) drops the sidebar');
  check(await ev(`(() => { const j = document.querySelector('.jump'); if (!j) return true; const r = j.getBoundingClientRect().right;
    return getComputedStyle(j).flexWrap === 'wrap' && [...j.querySelectorAll('.jump-chip')].every(c => c.getBoundingClientRect().right <= r + 1 && c.scrollWidth <= c.clientWidth + 1); })()`),
    'the league chips wrap onto more lines instead of running off the edge');
  await tab('lineups');
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
  await sleep(400);
  check(await ev(`getComputedStyle(document.querySelector('.league-grid')).gridTemplateColumns.split(' ').length === 1 &&
    !/titan\\.svg/.test(getComputedStyle(document.body, '::before').backgroundImage)`), 'a phone keeps the app look, without the background Titan');

  T.section('the value report (Titan\'s owner only)');
  // A made-up report, in the shape titan-analytics posts to lab/value-latest (version 2), handed over as the sync bridge
  // would. Its first league is the test league (so the league dropdown can pick it), in a dynasty superflex format.
  const lid = await ev(`((JSON.parse(localStorage.getItem('titan.snapshot.v1') || '{}').leagues || [])[0] || {cfg: {}}).cfg.id || ''`);
  const vrow = (s, n, p, buy, sell, keep) => ({s, n, p, t: 'KC', proj: 12.3, val: 12, fp: 10, fpoe: -2.1, snap: 0.8, tgt: 0.2, rz: 1, ur: 12, mr: 30, gap: 18, tr: 5, ch: null, buy, sell,
    keep: !!keep});
  const RD = 'redraft-1qb-12teams-1ppr', DY = 'dynasty-2qb-10teams-1ppr';
  const vlg = (id, name, fmt, own) => ({id, fmt, name, own, teams: ['Rival Team (rival)', 'My Team (me)'], caveat: '',
    format: fmt === RD ? 'Redraft, 12 teams, PPR' : 'Dynasty, 10 teams, PPR, superflex', need: 'Your team by position: QB 1st, RB 11th of 12. Thin at RB.',
    sell: [{n: 'Sell Guy', why: 'The market says WR10; his projection says WR30.', x: 'WR, KC', k: fmt === RD}],
    buy: [{n: 'Buy Guy', why: 'His projection says RB12; the market says RB30.', x: 'RB, KC'}],
    add: [{n: 'Claim Guy', why: 'He\'d start over Someone. Drop Drop Guy (WR, KC) for him: no trade value on the market.', x: 'TE, KC', d: 'Drop Guy'}]});
  const VR = {v: 2, season: 2026, week: 2, through: 'Through week 1 of 2026 (16 of 16 games)', at: Date.now(), notes: ['Only 1 week of 2026 so far.'],
    format: 'Redraft, 12 teams, PPR', main: RD, tiles: [['leagues', 2], ['sell-high moves', 2], ['buy-low targets', 2], ['claims', 2], ['players valued', 3]],
    leagues: [vlg(lid, 'Value Test League', DY, {1: 'me', 2: 0}), vlg('other', 'Another League', RD, {})],
    formats: {
      [RD]: {name: 'Redraft, 12 teams, PPR', buys: [vrow('1', 'Buy Guy', 'RB', true, false)], sells: [vrow('2', 'Sell Guy', 'WR', false, true, true)], risers: [],
        all: [vrow('1', 'Buy Guy', 'RB', true, false), vrow('2', 'Sell Guy', 'WR', false, true, true), vrow('3', 'Other Guy', 'QB', false, false)]},
      [DY]: {name: 'Dynasty, 10 teams, PPR, superflex', buys: [vrow('4', 'Dynasty Guy', 'QB', true, false)], sells: [], risers: [],
        // Forty more players, so the table's box has to scroll (its header row and player column stay in view).
        all: [vrow('1', 'Buy Guy', 'RB', false, false), vrow('2', 'Sell Guy', 'WR', false, false), vrow('4', 'Dynasty Guy', 'QB', true, false),
          ...Array.from({length: 40}, (_, i) => vrow(String(100 + i), 'Depth Guy ' + i, 'WR', false, false))]}}};
  // Picks a league the way the dropdown at the top does (the test app has one league, so the dropdown itself stays hidden).
  const pickLeague = id => ev(`(() => { const s = document.createElement('select'); s.dataset.ui = 'league'; s.innerHTML = '<option selected></option>';
    s.options[0].value = ${JSON.stringify(id)}; document.getElementById('view').appendChild(s); s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  const vsec = i => `(document.querySelectorAll('.vr-sec')[${i}] || {}).textContent || ''`;
  check(await ev(`document.querySelector('#tabs [data-tab="value"]').hidden`), 'it isn\'t on the menu for anyone but Titan\'s owner');
  // A made-up data dump too, in the shape titan-analytics' data_dump.py posts to lab/dump-latest (version 1).
  const drow = (s, n, p, x) => Object.assign({s, n, p, t: 'KC', g: 1, fp: 10, x: 14, oe: -4, xr: 5, sh: 0.2, rs: null, o: 'DAL', h: true, mu: 3, n4: 5, ros: 10,
    po: 30, adj: 15, buy: true, sell: false, keep: false}, x);
  const dlg = (id, name) => ({id, name, format: 'Redraft, 12 teams, PPR', teams: ['Rival Team (rival)'], own: {d1: 'me', d2: 0},
    start: [{n: 'Start Guy over Bench Guy', why: 'Start Guy (vs DAL, the 3rd-softest for WRs) has 15.0; Bench Guy has 9.0.', x: 'WR, KC · FLEX'}],
    buy: [{n: 'Buy Guy', why: 'His usage is worth 14.0 a game but he\'s scored 10.0.', x: 'RB, KC'}],
    sell: [{n: 'Sell Guy', why: 'He\'s scored 18.0 a game on usage worth 10.0. But the work is real (WR5), so keep him.', x: 'WR, KC', k: true}],
    add: [{n: 'Add Guy', why: 'Usage worth 12.0 a game.', x: 'TE, KC'}], watch: []});
  const DR = {v: 1, season: 2026, week: 2, fileWeek: 1, file: 'week1-data-dump.xlsx', updated: '2026-09-15 09:36', at: Date.now(),
    notes: ['1 game of data so far.'], tiles: [['ideas', 6], ['leagues', 2], ['players', 3], ['teams', 1]],
    // Listed by name, as data_dump.py writes them: the screen puts them in the app's own league order instead.
    leagues: [dlg('other-dump', 'Another Dump League'), dlg(lid, 'Dump Test League')],
    players: [drow('d1', 'Buy Guy', 'RB'), drow('d2', 'Sell Guy', 'WR', {buy: false, sell: true, keep: true, oe: 8}), drow('d3', 'Other Guy', 'QB', {buy: false})],
    lists: {buys: [drow('d1', 'Buy Guy', 'RB')], sells: [drow('d2', 'Sell Guy', 'WR', {buy: false, sell: true, keep: true, oe: 8})], soft: [drow('d3', 'Other Guy', 'QB', {buy: false})],
      tough: [], next4easy: [], next4hard: [], playoffEasy: [], playoffHard: []},
    teams: [{t: 'KC', pr: 0.6, npr: 0.58, i10: 0.5, i5: 0.4, tpg: 34, rbt: 0.15, wrt: 0.6, tet: 0.25, rbx: 20, wrx: 30, tex: 15, ptd: 2, rtd: 1}],
    highlights: ['KC throws the most when the game is close.']};
  await ev(`window.TitanApp.syncReady({valueReport: async () => ({json: ${JSON.stringify(JSON.stringify(VR))}})
    , dumpReport: async () => ({json: ${JSON.stringify(JSON.stringify(DR))}})}); window.TitanApp.setOwner(true); true`);
  await tab('value');
  check(await waitFor(`location.pathname === '/app/value' && document.querySelectorAll('.vr-lg').length === 2 && document.querySelectorAll('.vr-moves li').length === 6 &&
    document.querySelectorAll('.subtabs [data-go]').length === 6`, 5000), 'the owner sees it under Rankings, at /app/value: each league\'s sells, buys and claims');
  check(await ev(`document.querySelectorAll('[data-vfmt]').length === 2 && /Buy Guy/.test(${vsec(0)}) &&
    [...document.querySelectorAll('.vr-t th')].every(th => th.textContent !== 'Where')`), 'under All leagues, the lists are in the format most leagues play, with a chip for each format');
  check(await ev(`/Sell high or keep/.test(document.getElementById('view').textContent) && document.querySelectorAll('.vr-moves .pill.p-swap').length === 1 &&
    document.querySelectorAll('.vr-t .pill.p-swap').length === 2`),
    'the sell-high list is "Sell high or keep": a sell with a real role is tagged keep, in the league\'s moves and in the tables');
  await ev(`document.querySelector('[data-vpos="QB"]').click(); true`);
  check(await ev(`[...document.querySelectorAll('tr[data-vp]')].filter(r => !r.hidden).map(r => r.dataset.vp).join() === 'QB' && !!document.querySelector('tr[data-vp] .pill.p-ok')`),
    'the position chips filter the players table, and buys and sells are tagged');
  await ev(`document.querySelector('[data-vpos="ALL"]').click(); true`);
  await ev(`document.querySelector('[data-vfmt="${DY}"]').click(); true`);
  check(await waitFor(`/Dynasty Guy/.test(${vsec(0)}) && document.querySelector('[data-vfmt="${DY}"]').getAttribute('aria-pressed') === 'true' &&
    /Value Test League/.test(document.querySelector('.vr-lg h3').textContent)`, 3000), 'a format chip switches the lists to that format; the leagues keep the app\'s own order (yours first)');
  check(!!lid, 'the test league has an id to pick: ' + lid);
  await pickLeague(lid);
  check(await waitFor(`document.querySelectorAll('.vr-lg').length === 1 && !document.querySelector('[data-vfmt]') && /Dynasty Guy/.test(${vsec(0)}) &&
    /\\(Value Test League\\)/.test(${vsec(0)})`, 3000), 'picking a league shows just its moves, and the lists in its own format');
  const wh = await ev(`[...document.querySelectorAll('tr[data-vp]')].slice(0, 3).map(r => r.cells[0].querySelector('b').textContent + ': ' + r.cells[1].textContent).join(' | ')`);
  check(wh === 'Buy Guy: Yours | Sell Guy: Rival Team (rival) | Dynasty Guy: Free agent', 'and a Where column says who has each player there: ' + wh);
  const dropPill = await ev(`(document.querySelector('.vr-drop') || {}).textContent || ''`);
  check(dropPill === 'drop Drop Guy' && await ev(`document.body.textContent.includes('Drop Drop Guy (WR, KC) for him')`),
    'a claim says who to drop for him, as a pill beside the name and in its reason: ' + dropPill);
  const vsearch = q => ev(`(() => { const i = document.querySelector('[data-value-search]'); i.focus(); i.value = ${JSON.stringify(q)};
    i.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
  const shownNames = `[...document.querySelectorAll('tr[data-find]')].filter(r => !r.hidden && !r.closest('[hidden]')).map(r => r.cells[0].querySelector('b').textContent)`;
  await vsearch('dynasty');
  check(await ev(`${shownNames}.length > 0 && ${shownNames}.every(n => n === 'Dynasty Guy') && document.querySelector('.vr-lg').hidden &&
    document.activeElement === document.querySelector('[data-value-search]')`),
    'the player search narrows every list to the players who match, hides a league with no move for them, and keeps its cursor');
  await vsearch('buy guy');
  check(await ev(`!document.querySelector('.vr-lg').hidden && [...document.querySelectorAll('.vr-lg li[data-find]')].filter(li => !li.hidden).length === 1`),
    'and shows the moves that name him');
  await vsearch('zzzz');
  check(await ev(`!document.querySelector('[data-value-none]').hidden`), 'when nobody matches, it says so');
  await vsearch('');
  // Scrolling the page down the long table keeps its header row just under Titan's header, and scrolling the table
  // across keeps the player column at its left; past the table's end, the header row stays inside it.
  const scrollPage = y => ev(`(() => { window.scrollTo(0, ${y}); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
  const lastBox = `[...document.querySelectorAll('.vr-scroll')].pop()`;
  await scrollPage(Math.round(await ev(`${lastBox}.getBoundingClientRect().top + scrollY + 600`)));
  const pinned = await ev(`(() => { const box = ${lastBox}; box.scrollLeft = 200;
    const bar = document.querySelector('.top').getBoundingClientRect().bottom, b = box.getBoundingClientRect(),
      th = box.querySelector('thead th:nth-child(5)').getBoundingClientRect(), td = box.querySelector('tbody tr:nth-child(20) td').getBoundingClientRect();
    return {into: Math.round(bar - b.top), across: box.scrollLeft, head: Math.round(th.top - bar), name: Math.round(td.left - b.left)}; })()`);
  check(pinned.into > 300 && pinned.across > 0 && Math.abs(pinned.head) <= 2 && Math.abs(pinned.name) <= 2,
    `${pinned.into}px down the table, its header row sits right under Titan's header (${pinned.head}px); ${pinned.across}px across, the player column stays at its left (${pinned.name}px)`);
  await shot('value-report-scrolled');
  await scrollPage(Math.round(await ev(`${lastBox}.getBoundingClientRect().bottom + scrollY + 200`)));
  check(await ev(`(() => { const box = ${lastBox}; return box.querySelector('thead th').getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1; })()`),
    'past the table\'s end, its header row stays inside the table');
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'it fits a 390px phone (the tables scroll in their own boxes)');
  await scrollPage(0);
  await shot('value-report');
  // On a computer too (screenshots only): the top of the page, and the first table.
  if (process.env.TITAN_SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
    await sleep(500);
    await scrollPage(0);
    await shot('value-report-1280');
    await scrollPage(Math.round(await ev(`document.querySelector('.vr-sec').getBoundingClientRect().top + scrollY - 140`)));
    await shot('value-report-1280-table');
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    await sleep(500);
  }
  await pickLeague('all');

  T.section('the data dump (Titan\'s owner only)');
  await tab('dump');
  check(await waitFor(`location.pathname === '/app/data-dump' && document.querySelectorAll('.vr-lg').length === 2 && document.querySelectorAll('.vr-lg .vr-moves li').length === 8`, 5000),
    'the owner sees it at /app/data-dump: each league\'s ideas (start, pick up, buy, sell or keep)');
  // Each heading's own text, without its league icon's site badge (the "E" on an ESPN league).
  const ddOrder = await ev(`[...document.querySelectorAll('.vr-lg h3')].map(h => [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()).join(' | ')`);
  check(ddOrder === 'Dump Test League | Another Dump League',
    'its leagues come in the same order as every other tab (the app\'s leagues first), not by name: ' + ddOrder);
  check(await ev(`[...document.querySelectorAll('.subtabs [data-go]')].map(b => b.textContent).join('|') === 'Import|Season|Import multiple|Compare|Value|Data dump'`),
    'Data dump is its own screen under Rankings, right after Value');
  check(await ev(`(() => { const nav = document.querySelector('.subtabs'), n = nav.getBoundingClientRect(), b = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
    return b.left >= n.left - 1 && b.right <= n.right + 1; })()`), 'on a phone the sub-tab row scrolls so Data dump shows in full');
  const ddText = await text('#view');
  check(/Buy low/.test(ddText) && /This week's matchups/.test(ddText) && /Schedule outlook/.test(ddText) && /Team tendencies/.test(ddText) && /KC throws/.test(ddText),
    'it has buy and sell from expected points, this week\'s matchups, the schedule outlook and team tendencies');
  check(/Sell high or keep/.test(ddText) && await ev(`document.querySelectorAll('.vr-moves .pill.p-swap').length === 2 && !!document.querySelector('tr[data-vp] .pill.p-swap')`),
    'its sells read "Sell high or keep" too, with a keep tag on a real role in each league\'s ideas and the tables');
  await pickLeague(lid);
  check(await waitFor(`document.querySelectorAll('.vr-lg').length === 1 && [...document.querySelectorAll('.vr-t th')].some(th => th.textContent === 'Where')`, 3000),
    'picking a league shows just its ideas, and who has each player there');
  const dwho = await ev(`(() => { const r = [...document.querySelectorAll('tr[data-vp]')].find(x => /buy guy/.test(x.dataset.find)); return r ? r.cells[1].textContent : ''; })()`);
  check(dwho === 'Yours', 'the Where column says Yours for a player on your team: ' + dwho);
  await vsearch('sell guy');
  check(await ev(`${shownNames}.length > 0 && ${shownNames}.every(n => n === 'Sell Guy')`), 'the player search narrows the tables here too');
  await vsearch('');
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'it fits a 390px phone');
  await shot('data-dump');
  // On the Trade tab, the owner's Value report adds the usage edge: the line under the verdict reads by it.
  await tab('trade');
  await ev(`(() => { const s = document.querySelector('[data-ui="tradePartner"]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await waitFor(`document.querySelectorAll('.tteam').length === 2`, 5000);
  await ev(`document.querySelector('.tteam [data-trade="give"]').click(); true`);
  await ev(`document.querySelector('.tteam [data-trade="get"]').click(); true`);
  check(await waitFor(`/usage edge/i.test((document.querySelector('.trade-sum .tedge') || {}).textContent || '')`, 5000),
    'for the owner, the trade\'s edge line reads by the Value report\'s usage numbers: ' + (await text('.trade-sum .tedge')).replace(/\s+/g, ' ').slice(0, 100));
  await ev(`document.querySelector('[data-action="trade-find"]').click(); true`);
  check(await waitFor(`/usage edge counts on your side/.test((document.querySelector('.tideas') || {}).textContent || '')`, 8000),
    'and Find trades says the usage edge counts on the owner\'s side');
  await ev(`document.querySelector('[data-action="trade-reset"]').click(); true`);
  await tab('dump');
  await pickLeague('all');
  await ev(`window.TitanApp.setOwner(false); true`);
  check(await waitFor(`/Only Titan's owner sees this screen/.test(document.getElementById('view').textContent) && document.querySelector('#tabs [data-tab="value"]').hidden &&
    document.querySelector('#tabs [data-tab="dump"]').hidden`, 3000), 'without the owner account Value and Data dump hide again');
  await tab('lineups');

  // Screenshots of every screen at phone and computer widths (TITAN_SHOTS only), to compare a change to the whole app's look.
  if (process.env.TITAN_SHOTS) {
    T.section('a tour of every screen (screenshots only)');
    const TOUR = ['lineups', 'matchup', 'standings', 'rosters', 'trade', 'moves', 'waivers', 'news', 'exposure', 'byes', 'sos', 'score', 'ranks', 'season', 'multi', 'settings'];
    for (const [w, h, dpr, mobile] of [[390, 844, 2, true], [1280, 900, 1, false]]) {
      await send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: dpr, mobile});
      for (const t of TOUR) {
        await tab(t);
        await sleep(1500);
        await ev('window.scrollTo(0, 0); true');
        await shot(`tour-${w}-${t}`);
      }
    }
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    await tab('lineups');
    check(true, `${TOUR.length} screens photographed at 390px and 1280px`);
  }

  T.section('the free weekly email (newsletter.js)');
  check(await ev(`!!window.TitanNewsletter && window.TitanNewsletter.ready()`), 'Kit\'s form number is set in newsletter.js, so the signup boxes can show');
  // With no form number (the override ''), nothing half-working shows.
  await send('Page.addScriptToEvaluateOnNewDocument', {source: 'window.TitanNewsletterForm = "";'});
  await send('Page.navigate', {url: ORIGIN + '/app/waivers'});
  check(await waitFor(`!!window.TitanNewsletter && !window.TitanNewsletter.ready() && /Your waiver plan/.test(document.body.innerText) && !document.querySelector('.nl-card')`, 30000),
    'without a form number, the app shows no signup card');
  await send('Page.navigate', {url: ORIGIN + '/guides/'});
  check(await waitFor(`!!document.querySelector('.nl-box') && document.querySelector('.nl-box').hidden`, 10000), 'and the website hides its boxes too');
  // A stand-in form number (it runs after the one above, so it wins); Kit's address is answered by the test, never sent to Kit.
  await send('Page.addScriptToEvaluateOnNewDocument', {source: 'window.TitanNewsletterForm = "1234567";'});
  await send('Fetch.enable', {patterns: [...ESPN_PATTERNS, {urlPattern: '*app.kit.com*'}, {urlPattern: '*firestore.googleapis.com*documents/public/*'}]});
  await send('Page.navigate', {url: ORIGIN + '/?home'});
  check(await waitFor(`!!document.querySelector('.nl-hero') && !document.querySelector('.nl-hero').hidden && !document.querySelector('#newsletter').hidden`, 10000),
    'with it set up, the home page shows its signup boxes: under the main buttons, and a section of their own');
  // In the HTML as served (newsletter.js rewrites the action to the test's stand-in form once it runs).
  const homeHtml = require('fs').readFileSync(require('path').join(T.ROOT, 'index.html'), 'utf8');
  const homeForms = homeHtml.match(/<form[^>]*data-newsletter=[^>]*>/g) || [];
  check(homeForms.length === 2 && homeForms.every(f => /action="https:\/\/app\.kit\.com\/forms\/9921118\/subscriptions"/.test(f) && /method="post"/.test(f)),
    'each box\'s form carries Kit\'s address in the HTML itself, so a signup works even without newsletter.js');
  // The boxes ship visible, so the wait above can pass before the stylesheet applies: wait for it.
  await waitFor(`getComputedStyle(document.querySelector('.site-nav')).display === 'none'`, 5000);
  const menu = await ev(`(() => { const s = document.querySelector('.site-menu'), skip = document.querySelector('.skip');
    return {menu: !!s && getComputedStyle(s).display !== 'none', navHidden: getComputedStyle(document.querySelector('.site-nav')).display === 'none',
      links: s ? s.querySelectorAll('nav a[href="/guides/"], nav a[href="/newsletter/"]').length : 0, skip: skip ? skip.getAttribute('href') : 'none',
      main: !!document.getElementById('main'), width: innerWidth}; })()`);
  check(menu.menu && menu.navHidden && menu.links === 2 && menu.skip === '#main' && menu.main,
    `on a phone the header shows a Menu with Guides and the weekly email in place of the nav, and every page starts with a skip link (${JSON.stringify(menu)})`);
  await shot('home-newsletter');
  await ev(`document.querySelector('#newsletter').scrollIntoView({block: 'start', behavior: 'instant'}); true`);
  await sleep(300);
  await shot('home-newsletter-section');
  await send('Page.navigate', {url: ORIGIN + '/app/waivers'});
  check(await waitFor(`!!document.querySelector('.nl-card form[data-newsletter="app-waivers"]')`, 30000), 'and Waivers shows the free weekly guide\'s signup card');
  await ev(`document.querySelector('.nl-card').scrollIntoView({block: 'center'}); true`);
  await sleep(300);
  await shot('app-newsletter-card');
  await ev(`(() => { const f = document.querySelector('.nl-card form'); f.querySelector('input').value = 'fan@example.com'; f.querySelector('button').click(); return true; })()`);
  check(await waitFor(`/check your inbox/.test(document.querySelector('.nl-card').textContent) && /spam/.test(document.querySelector('.nl-card').textContent)`, 5000) &&
    kitPosts.some(p => p.method === 'POST' && /forms\/1234567\/subscriptions/.test(p.url) && /email_address=fan%40example\.com/.test(p.body)),
    'signing up sends the email to Kit\'s form and says to check the inbox, and the spam folder: ' + JSON.stringify(kitPosts.map(p => p.body)));
  check(await waitFor(`(() => { const d = document.querySelector('dialog.nl-pop');
    return !!d && d.open && /Subscription successful/.test(d.textContent) && /Check your email to finish/.test(d.textContent); })()`, 3000),
    'and a pop-up says the subscription worked and to check email to finish');
  await shot('newsletter-popup');
  await ev(`document.querySelector('dialog.nl-pop button').click(); true`);
  check(await waitFor(`!document.querySelector('dialog.nl-pop')`, 3000), 'OK closes the pop-up');
  await tab('settings');
  check(await ev(`!document.querySelector('.nl-card')`), 'once this device has joined, the app stops asking (no card in Settings)');
  check(await ev(`(() => { const a = document.querySelector('.nl-top');
    return !!a && a.getAttribute('href') === '/newsletter/' && getComputedStyle(a).display === 'none' && !!document.querySelector('.foot-cols a[href="/newsletter/"]'); })()`),
    'the header\'s Free weekly email link hides on a phone, and the footer links the weekly email on every width, joined or not');
  await send('Page.navigate', {url: ORIGIN + '/?home'});
  check(await waitFor(`!!document.querySelector('.nl-hero') && document.querySelector('.nl-hero').hidden && document.querySelector('#newsletter').hidden`, 10000),
    'the home page\'s signup boxes stay hidden for someone who joined');
  check(await ev(`!!document.querySelector('.site-foot .foot-links a[href="/newsletter/"]')`), 'but the footer still links the weekly email, as every guide\'s does');
  await send('Page.navigate', {url: ORIGIN + '/newsletter/?joined=1'});
  check(await waitFor(`!document.querySelector('[data-newsletter-joined]').hidden && document.querySelector('.nl-box').hidden &&
    document.querySelector('form[data-newsletter]').action.endsWith('/forms/1234567/subscriptions')`, 10000),
    'the newsletter page welcomes someone back from Kit\'s confirmation and puts its signup box away (they\'ve joined), its form pointing at Kit');
  check(await waitFor(`(() => { const s = document.querySelector('[data-nl-issue]'), f = s && s.querySelector('iframe');
    return !!f && !s.hidden && /week 9/.test(f.srcdoc) && !!f.contentDocument && /stand-in issue/.test(f.contentDocument.body.textContent) &&
      /Through week 8/.test(s.querySelector('[data-nl-issue-meta]').textContent) && f.offsetHeight > 100; })()`, 10000),
    'and shows this week\'s issue right there, read from Titan\'s public copy, in a frame of its own');
  await shot('newsletter-issue');
  await shot('newsletter-page');
  await send('Fetch.enable', {patterns: ESPN_PATTERNS});
  await send('Page.navigate', {url: ORIGIN + '/app/'});
  await waitFor('!!document.querySelector("#tabs")', 20000);

  T.section('who the website sends to the app');
  const go = async url => { await send('Page.navigate', {url: ORIGIN + url}); await sleep(1500); return ev('location.pathname + location.search'); };
  check(await go('/') === '/' && await ev('!!document.querySelector(".hero h1")'), 'someone already using Titan who opens / still sees the website');
  check(await go('/?home') === '/?home' && await ev('!!document.querySelector(".hero h1")'), '/?home shows the website even so');
  const playAt = await go('/?source=play');
  check(/^\/app\/[a-z]*\?source=play$/.test(playAt), `the Android app's address (/?source=play) goes straight to the app (${playAt})`);
  await waitFor('!!document.querySelector("#tabs")', 20000);

  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'nothing is wider than a 390px phone');
  check(!problems.length, problems.length ? 'page errors:\n    ' + problems.join('\n    ') : 'no page errors');
  await send('Browser.close').catch(() => {});
  chrome.kill();
  server.close();
  setTimeout(() => { try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {} T.done(); }, 500);
})().catch(T.crash);
