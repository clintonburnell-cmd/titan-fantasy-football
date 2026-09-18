/* The PNG icons, rendered from the two SVGs so they can be remade rather than hand-kept:
   `node tools/icons.js` writes site/icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png.
   Run it after changing site/icon.svg or site/icon-maskable.svg. Needs the Chrome for Testing the UI test uses.
   Apple's icon gets no transparency and no rounding of its own: iOS masks it, and a transparent one turns black. */
const {spawn} = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const SITE = path.join(__dirname, '..', 'site');
const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
const CHROME = process.env.CHROME || fs.readdirSync(cache).sort().reverse()
  .map(v => path.join(cache, v, 'chrome-win64', 'chrome.exe')).find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WANT = [
  {svg: 'icon.svg', out: 'icon-192.png', size: 192},
  {svg: 'icon.svg', out: 'icon-512.png', size: 512},
  {svg: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512},
  // iOS draws its own rounded corners, so this one is the square art edge to edge.
  {svg: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180}
];

(async () => {
  const PORT = 9530 + Math.floor(Math.random() * 60), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ic-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore'});
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {}
    if (!page) await sleep(200);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let seq = 0; const pending = {};
  const send = (m, p = {}) => new Promise(r => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } });
  await send('Page.enable'); await send('Runtime.enable');

  for (const w of WANT) {
    const svg = fs.readFileSync(path.join(SITE, w.svg), 'utf8');
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#0a0f1a}
      img{display:block;width:${w.size}px;height:${w.size}px}</style>
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
    const tmp = path.join(os.tmpdir(), 'titan-icon-' + w.out + '.html');
    fs.writeFileSync(tmp, html);
    await send('Emulation.setDeviceMetricsOverride', {width: w.size, height: w.size, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url: 'file:///' + tmp.replace(/\\/g, '/')});
    await sleep(700);
    const shot = await send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(path.join(SITE, w.out), Buffer.from(shot.result.data, 'base64'));
    fs.unlinkSync(tmp);
    console.log(`${w.out}  ${w.size}x${w.size}  from ${w.svg}`);
  }
  ws.close(); chrome.kill();
  process.exit(0);
})();
