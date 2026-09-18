// The home page's three product screenshots, taken from the live demo at phone width, so they can be remade rather
// than hand-kept: `node tools/shots.js` writes site/shots/*.png. Run it when a screen it shows changes shape.
// Needs the Chrome for Testing that the UI test uses (~/.cache/puppeteer).
const {spawn} = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const OUT = path.join(__dirname, '..', 'site', 'shots');
const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
const CHROME = fs.readdirSync(cache).sort().reverse().map(v => path.join(cache, v, 'chrome-win64', 'chrome.exe')).find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WANT = [
  {tab: 'lineups', name: 'lineups', to: '.card.league'},
  {tab: 'waivers', name: 'waivers', to: '.wplan'},
  {tab: 'rosters', name: 'rosters', to: '.card.roster-card'},
];
(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const PORT = 9930 + Math.floor(Math.random() * 60), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-s-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore'});
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(200); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let seq = 0; const pending = {};
  const send = (m, p = {}) => new Promise(r => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 780, deviceScaleFactor: 2, mobile: true});
  const ev = async x => (await send('Runtime.evaluate', {expression: x, awaitPromise: true, returnByValue: true})).result?.result?.value;
  await send('Page.navigate', {url: 'https://titanfantasyfootball.com/app/?demo'});
  for (let i = 0; i < 200; i++) { if (await ev(`!!document.querySelector('.lu-cmp')`) === true) break; await sleep(300); }
  for (const w of WANT) {
    await ev(`(() => { const b = document.querySelector('[data-tab="${w.tab}"]') || document.querySelector('.subtabs [data-go="${w.tab}"]'); if (b) b.click(); return !!b; })()`);
    await sleep(2500);
    // Land on the thing worth showing, not the banners above it.
    await ev(`(() => { const el = document.querySelector('${w.to}'); if (!el) return false;
      if (el.tagName === 'DETAILS') el.open = true;
      el.scrollIntoView({block: 'start'}); window.scrollBy(0, -12); return true; })()`);
    await sleep(700);
    const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
    const file = path.join(OUT, w.name + '.png');
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(w.name, Math.round(fs.statSync(file).size / 1024) + ' KB');
  }
  chrome.kill(); process.exit(0);
})();
