/* What a visit actually costs, measured rather than guessed at.

   `node tools/perf.js` walks a cold first visit on a throttled phone and prints the waterfall: when each file was
   asked for, when it arrived and what it cost over the wire, then first paint and the moment a readable lineup is on
   screen. `node tools/perf.js --warm` loads once to install the service worker and then measures the second visit,
   which is the one most people get.

   Why it exists: every speed change in v1.89.0 was decided by these numbers, and two ideas that read well on paper
   lost when measured (warming Sleeper's requests from an inline script, v1.85.0; compressing the projections
   endpoint, v1.89.0). Re-run it before and after anything meant to make the app faster, and put the numbers in the
   save point. Needs the Chrome for Testing that the UI test uses (~/.cache/puppeteer), or set CHROME.

   Options: a URL as the first argument to measure another page, and --ready=<css selector> for what counts as drawn. */
const {spawn} = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
const CHROME = process.env.CHROME || fs.readdirSync(cache).sort().reverse()
  .map(v => path.join(cache, v, 'chrome-win64', 'chrome.exe')).find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const WARM = args.includes('--warm');
const READY = (args.find(a => a.startsWith('--ready=')) || '--ready=.lu-cmp').slice(8);
const URL = args.find(a => a.startsWith('http')) || 'https://titanfantasyfootball.com/app/?demo';
// A middling phone on a decent mobile connection. Keep these fixed, or two runs cannot be compared.
const NET = {offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8};
const CPU = 4;

(async () => {
  const PORT = 9830 + Math.floor(Math.random() * 60), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-perf-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore'});
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {}
    if (!page) await sleep(200);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let seq = 0, watching = false;
  const pending = {}; let net = {}, order = [];
  const send = (m, p = {}) => new Promise(r => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; return; }
    if (!watching) return;
    const r = net[m.params && m.params.requestId];
    if (m.method === 'Network.requestWillBeSent') { net[m.params.requestId] = {url: m.params.request.url, start: m.params.timestamp}; order.push(m.params.requestId); }
    if (m.method === 'Network.responseReceived' && r) { r.enc = m.params.response.headers['content-encoding'] || ''; r.status = m.params.response.status; }
    if (m.method === 'Network.loadingFinished' && r) { r.bytes = m.params.encodedDataLength; r.end = m.params.timestamp; }
  });
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 780, deviceScaleFactor: 2, mobile: true});
  const ev = async x => (await send('Runtime.evaluate', {expression: x, awaitPromise: true, returnByValue: true})).result?.result?.value;
  const draw = async () => {
    let paint = 0, ready = 0;
    const t0 = Date.now();
    await send('Page.navigate', {url: URL});
    for (let i = 0; i < 400; i++) {
      if (!paint) { const p = await ev(`(performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime||0`); if (p) paint = Math.round(p); }
      if (await ev(`!!document.querySelector('${READY}')`) === true) { ready = Date.now() - t0; break; }
      await sleep(100);
    }
    return {paint, ready};
  };

  if (WARM) {
    // A first visit at full speed, only to install the worker and fill its cache; then the real measurement.
    await draw();
    for (let i = 0; i < 60; i++) { if (await ev('!!navigator.serviceWorker.controller') === true) break; await sleep(300); }
    await sleep(2500);
  } else {
    await send('Network.setCacheDisabled', {cacheDisabled: true});
  }
  await send('Network.emulateNetworkConditions', NET);
  await send('Emulation.setCPUThrottlingRate', {rate: CPU});
  net = {}; order = []; watching = true;
  const {paint, ready} = await draw();

  const rows = order.map(id => net[id]).filter(r => r && r.bytes !== undefined);
  const mine = rows.filter(r => r.url.includes('titanfantasyfootball.com'));
  const kb = n => (n / 1024).toFixed(0);
  console.log(`\n${URL}${WARM ? '\nSECOND visit (service worker installed, cache on)' : '\nFIRST visit (cache off)'}`);
  console.log(`throttled phone: 1.6 Mbps, 150ms latency, ${CPU}x CPU slowdown\n`);
  console.log(`first paint        ${paint} ms`);
  console.log(`readable lineup    ${ready} ms`);
  console.log(`over the wire      ${kb(rows.reduce((a, r) => a + r.bytes, 0))} KB total, ${kb(mine.reduce((a, r) => a + r.bytes, 0))} KB from Titan\n`);
  if (rows.length) {
    // In the order things actually started, which is what says whether a delay is size or waiting.
    const nav = Math.min(...rows.map(r => r.start));
    console.log('  start     end    size   what');
    rows.filter(r => r.bytes > 400).sort((a, b) => a.start - b.start).forEach(r => {
      const name = r.url.replace(/^https?:\/\//, '').split('?')[0];
      console.log(`  ${String(Math.round((r.start - nav) * 1000)).padStart(5)} ${String(Math.round((r.end - nav) * 1000)).padStart(6)}  ${
        kb(r.bytes).padStart(5)}K  ${name.length > 60 ? name.slice(0, 60) + '…' : name}`);
    });
  }
  // The document's own time swings by about a second between runs (Firebase's edge), so compare several runs,
  // and compare runs whose first paint is similar. One slow document makes everything after it look worse.
  ws.close(); chrome.kill();
  process.exit(0);
})();
