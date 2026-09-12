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
  '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
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
  // A stand-in for ESPN's news feed: a story about the test team's QB, and one about nobody on it.
  const newsQb = inLeague.find(p => p.pos === 'QB').name, newsAt = new Date(Date.now() - 10 * 60000).toISOString();
  const NEWS = JSON.stringify({articles: [
    {id: 101, type: 'HeadlineNews', headline: newsQb + ' is set to start', description: 'Test story.', published: newsAt,
      links: {web: {href: 'https://www.espn.com/nfl/story/_/id/101'}}, categories: [{type: 'athlete', athleteId: 1, description: newsQb}]},
    {id: 102, type: 'Story', headline: 'Another NFL story', description: '', published: newsAt,
      links: {web: {href: 'https://www.espn.com/nfl/story/_/id/102'}}, categories: [{type: 'athlete', athleteId: 2, description: 'Somebody Else'}]}]});
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
    // Titan's /api/scores: one game on, one to come.
    if (u === '/api/scores') {
      res.writeHead(200, {'content-type': 'application/json'});
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
  let seq = 0;
  const pending = {}, problems = [];
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({id, method, params})); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', {accept: true});
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.url;
      const headers = [{name: 'access-control-allow-origin', value: ORIGIN}, {name: 'content-type', value: 'application/json'}];
      // The browser's CORS check before a request with ESPN's week-filter header.
      if (m.params.request.method === 'OPTIONS') {
        send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 204, body: '', responseHeaders: [
          {name: 'access-control-allow-origin', value: ORIGIN}, {name: 'access-control-allow-headers', value: 'x-fantasy-filter'},
          {name: 'access-control-allow-methods', value: 'GET'}]});
        return;
      }
      const ok = url.includes('/leagues/' + L1.id);
      const body = !ok ? '{}' : /mBoxscore/.test(url) ? BOX : /mMatchupScore/.test(url) ? SCHED : JSON.stringify(L1);
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
  await send('Fetch.enable', {patterns: [{urlPattern: '*fantasy.espn.com*leagues*'}]});
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
  check(/Sleeper, ESPN and Yahoo/.test(seo.title) && seo.types === 'WebSite,WebApplication,FAQPage' && !seo.bad,
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
    return {open: d.open, score: d.querySelector('.mh-score').innerText.replace(/\\n/g, ' '), wp: w}; })()`);
  check(!head.open && /Team 1/.test(head.score) && /Team 2/.test(head.score), 'each league starts collapsed, its header showing both teams and scores: ' + head.score);
  check(head.wp.length === 2 && head.wp[0] + head.wp[1] === 100, `a chance-to-win bar in the header (${head.wp.join('% / ')}%)`);
  await ev(`document.querySelector('details.match > summary').click(); true`);
  await sleep(300);
  await tab('lineups');
  await tab('matchup');
  await waitFor(`!!document.querySelector('details.match')`, 30000);
  check(await ev(`document.querySelector('details.match').open`), 'opening a league is remembered after leaving the tab');
  const mu = await ev(`({board: ((document.querySelector('.match .board') || {}).innerText || (document.querySelector('.card.league') || {}).innerText || '').replace(/\\n/g, ' '),
    rows: document.querySelectorAll('.match .mrow').length,
    opp: [...document.querySelectorAll('.match .minfo.opp b')].map(b => b.innerText).filter(Boolean).length,
    tabs: [...document.querySelectorAll('#tabs .sec-name')].map(b => b.innerText).join(' | ')})`);
  check(/Team 1/.test(mu.board) && /Team 2/.test(mu.board) && mu.rows === 9 && mu.opp === 9, `scoreboard (${mu.board}) and both lineups, 9 spots each`);
  check(mu.tabs === 'Lineups | Matchup | League | Players | Rankings', `five sections (${mu.tabs})`);
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
  check(nav.fixed === 'fixed' && nav.gap <= 1 && nav.subs === 'Waivers | News | Exposure | Byes' && nav.on === 'players',
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
  check(await ev(`[...document.querySelectorAll('.trade-sum *')].every(el => el.getBoundingClientRect().right <= document.querySelector('.trade-sum').getBoundingClientRect().right + 1)`),
    'on a phone the trade fits inside its card (nothing cut off on the right)');
  check(await ev(`document.querySelectorAll('.trade-sum .tlineup p').length === 3`),
    'each team\'s projected starters, before and after: ' + (await text('.trade-sum .tlineup')).replace(/\s+/g, ' ').slice(0, 90));

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
    'searching a player in the league shows who has him: ' + team3Player + ', on Team 3 (' + (await text('#tsearch')).replace(/\s+/g, ' ').slice(0, 80) + ')');
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

  T.section('game context on Lineups');
  await tab('lineups');
  check(await waitFor(`[...document.querySelectorAll('.lineup .gctx')].some(s => /team expected 28.5 pts/.test(s.textContent) && /wind 20 mph/.test(s.textContent))`, 10000),
    'each starter shows his team\'s expected points and windy weather: ' + await ev(`((document.querySelector('.lineup .gctx') || {}).textContent || 'none').trim()`));
  check(await ev(`/nflverse/.test(document.getElementById('view').textContent) && !!document.querySelector('a[href="https://github.com/nflverse"]')`),
    'ESPN, the National Weather Service and nflverse are credited');

  T.section('the Transactions tab');
  await tab('moves');
  check(await waitFor(`/ESPN leagues aren't in this list yet/.test(document.getElementById('view').textContent) && document.querySelectorAll('[data-moves]').length === 4 &&
    !document.querySelector('[data-ui="movesLeague"]')`, 5000),
    'the Transactions tab has its kind filters (the league dropdown at the top picks the league), and says ESPN leagues aren\'t read yet');
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
    check(await ev(`document.querySelectorAll('[data-ui=scoreWeek] option').length === 18`), 'weeks 1 to 18 are listed');
    if (await ev(`!!document.querySelector('[data-action="ranks-view"]')`)) {
      await ev(`document.querySelector('[data-action="ranks-view"]').click(); true`);
      check(await waitFor(`!!document.getElementById('ranks-view')`, 5000), 'the week\'s rankings open in the viewer');
    }
  } else {
    T.skip('linking a Sleeper account (set TITAN_SLEEPER_USER to run it)');
  }

  T.section('the demo');
  await send('Page.navigate', {url: ORIGIN + '/app/?demo'});
  check(await waitFor(`document.querySelectorAll('.card.league').length === 2`, 90000), 'Try a demo builds two sample leagues');
  const demo = await ev(`({note: !!document.querySelector('.demo-note'), names: [...document.querySelectorAll('.card.league h3')].map(h => h.innerText).join(', '),
    sync: [...document.scripts].some(s => /sync\\.js/.test(s.src)), open: document.querySelectorAll('.card.league a.open-site').length})`);
  check(demo.note && /Demo League/.test(demo.names) && !demo.sync && demo.open === 0,
    `${demo.names}, with the demo note, no sign-in and no Open in Sleeper button`);
  await tab('matchup');
  check(/need your real leagues/.test(await text('#view')), 'Matchup explains it needs real leagues');
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
    [...cards].every(c => c.querySelector('h3 .licon .lsite') && c.querySelector('h3 .licon .lini svg')) &&
    [...document.querySelectorAll('.side [data-jump]')].every(b => b.querySelector('.licon')); })()`),
    'each league shows its picture (or a football) with a badge for its site, on the cards and in the sidebar');
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
