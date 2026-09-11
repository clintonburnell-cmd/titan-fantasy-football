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
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(T.ROOT, u === '/' ? 'index.html' : u);
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
      const body = !ok ? '{}' : /mBoxscore/.test(url) ? BOX : JSON.stringify(L1);
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
  await send('Page.navigate', {url: ORIGIN + '/'});
  check(await waitFor('!!document.querySelector("[data-form=link]")', 20000), 'the welcome screen loads');
  check(/Sleeper and ESPN/.test(await text('.welcome .lede')), 'the welcome mentions Sleeper and ESPN');

  T.section('starting with ESPN only');
  await ev(`document.querySelector('[data-action="espn-start"]').click(); true`);
  await sleep(500);
  check(/^Sleeper \| ESPN\* \| Yahoo Soon$/.test(await linkTabs()), 'Settings opens at Link more leagues?, ESPN tab: ' + await linkTabs());
  await submit('espn-add', 'league', 'abc');
  await sleep(200);
  check(/league ID/.test(await text('.banner.stop')), 'junk input is explained');
  await submit('espn-add', 'league', 'https://fantasy.espn.com/football/league?leagueId=99999903');
  check(await waitFor(`/private/i.test((document.querySelector('.banner.stop') || {}).innerText || '')`, 10000), 'a private league asks for the ESPN login');
  await submit('espn-add', 'league', String(L1.id));
  check(await waitFor(`document.querySelectorAll('.pick .chip').length === 10`, 10000), 'the team picker lists all 10 teams');
  await ev(`document.querySelector('.pick [data-team="1"]').click(); true`);
  check(await waitFor(`/ESPN · 10 teams/.test((document.querySelector('.link-pane') || {}).innerText || '')`, 60000), 'the league is saved and loaded');
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
    tabs: [...document.querySelectorAll('#tabs [data-tab]')].map(b => b.innerText).slice(0, 3).join(' | ')})`);
  check(/Team 1/.test(mu.board) && /Team 2/.test(mu.board) && mu.rows === 9 && mu.opp === 9, `scoreboard (${mu.board}) and both lineups, 9 spots each`);
  check(mu.tabs === 'Lineups | Matchup | Rosters', 'the Matchup tab sits between Lineups and Rosters');
  await tab('byes');
  check(await ev(`!!document.querySelector('table.byes')`), 'the Byes table renders');
  await tab('score');
  check(await waitFor(`/ESPN weekly scores are coming soon/.test(document.body.innerText)`, 30000), 'the Results tab says ESPN scoring is coming');
  check(await ev(`document.querySelector('#tabs [data-tab="score"]').innerText === 'Results'`), 'the tab is called Results');

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

  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'nothing is wider than a 390px phone');
  check(!problems.length, problems.length ? 'page errors:\n    ' + problems.join('\n    ') : 'no page errors');
  await send('Browser.close').catch(() => {});
  chrome.kill();
  server.close();
  setTimeout(() => { try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {} T.done(); }, 500);
})().catch(T.crash);
