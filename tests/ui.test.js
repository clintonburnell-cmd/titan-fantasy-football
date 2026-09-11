// The app in headless Chrome at phone width, served from this folder. ESPN
// league requests are answered with the test leagues through Chrome's request
// interception, so no real league is read. With TITAN_SLEEPER_USER set it also
// links that Sleeper account from Settings and checks the Weeks tab and the
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
      const ok = url.includes('/leagues/' + L1.id);
      send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: ok ? 200 : 401, responseHeaders: headers,
        body: Buffer.from(ok ? JSON.stringify(L1) : '{}').toString('base64')});
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
  const lineup = await ev(`({h: (document.querySelector('.league .card-h') || {}).innerText || '', n: document.querySelectorAll('.lineup .row').length})`);
  check(/Titan Test League/.test(lineup.h) && /ESPN/.test(lineup.h) && lineup.n === 9, 'Lineups shows the ESPN league, 9 spots');
  await tab('byes');
  check(await ev(`!!document.querySelector('table.byes')`), 'the Byes table renders');
  await tab('score');
  check(await waitFor(`/ESPN weekly scores are coming soon/.test(document.body.innerText)`, 30000), 'the Weeks tab says ESPN scoring is coming');

  if (T.sleeperUser) {
    T.section('linking Sleeper as well');
    await tab('settings');
    await ev(`document.querySelector('[data-link-tab="sleeper"]').click(); true`);
    await sleep(300);
    await submit('link', 'username', T.sleeperUser);
    check(await waitFor(`document.querySelectorAll('.league').length >= 2`, 120000), 'Sleeper and ESPN leagues show together');
    await tab('ranks');
    await ev(`(() => { const ta = document.querySelector('textarea[data-draft="text"]'); ta.value = ${JSON.stringify(T.sampleRanks())};
      ta.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
    await sleep(300);
    await ev(`document.querySelector('[data-action="ranks-save"]').click(); true`);
    await sleep(600);
    await tab('score');
    check(await waitFor(`!!document.querySelector('details.score') || /has not kicked off/.test(document.body.innerText)`, 120000), 'the Weeks tab loads');
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
