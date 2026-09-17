// The Chrome extension (extension/) in headless Chrome: loaded unpacked, its service worker seeded with a stand-in
// Value report and Data dump (chrome.storage.local, as bg.js fills it after a sign-in), a stand-in Sleeper league
// page served through request interception (no real Sleeper page or league), and Sleeper's API answered in the
// service worker the same way. Checks the pills after player names, the league panel and a claim's bid.
const {spawn} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./lib');
// (message, ok, detail): the detail prints only on a failure.
const check = (msg, ok, detail = '') => T.check(ok, msg + (ok ? '' : ': ' + String(detail)));

// Google's branded Chrome ignores --load-extension (since Chrome 137), so this needs Chrome for Testing (Puppeteer's
// cache has one) or Chromium: CHROME_EXT, else the newest chrome-win64 under ~/.cache/puppeteer.
function findChrome() {
  if (process.env.CHROME_EXT) return process.env.CHROME_EXT;
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(cache)) return null;
  const found = fs.readdirSync(cache).sort().reverse().map(v => path.join(cache, v, 'chrome-win64', 'chrome.exe')).find(p => fs.existsSync(p));
  return found || null;
}
const CHROME = findChrome();
if (!CHROME) { T.skip('Chrome for Testing not found (set CHROME_EXT to a Chromium that allows --load-extension)'); process.exit(0); }
const EXT = path.join(T.ROOT, '..', 'extension');
if (!fs.existsSync(path.join(EXT, 'dist', 'firebase.js'))) { T.skip('extension/dist/firebase.js missing (run npm run build in extension/)'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VALUE = {v: 2, season: 2026, week: 3, through: 'Through week 2 of 2026', at: Date.now(), main: 'redraft', notes: [], tiles: [],
  leagues: [{id: '999', fmt: 'redraft', name: 'Test League', format: 'Redraft', teams: ['A', 'B'], own: {'111': 'me', '333': 0}, n: 10, ranks: {},
    need: 'Your team by position: QB 2nd, RB 9th of 10. Thin at RB.',
    buy: [{n: 'Jaylen Warren', why: 'His projection says RB17 (12.3 points a game); the market says RB29. Late-Round: 12 carries and 3.6 targets a game.', x: 'RB, PIT'}],
    sell: [{n: 'Josh Allen', why: 'The market says QB1; still a solid starter, so keep him unless the offer is strong.', x: 'QB, BUF', k: true}],
    add: [{n: 'Kenny Gainwell', why: '9.8 points a game by his projection; he\'d start over Bench Guy (6.2). Drop Bench Guy for him.', x: 'RB, PIT', d: 'Bench Guy'}]}],
  formats: {redraft: {name: 'Redraft', buys: [], sells: [], risers: [], all: [
    {s: '111', n: 'Patrick Mahomes', p: 'QB', t: 'KC', proj: 22.1, ur: 3, mr: 10, vgap: 0.18, v: 4000, buy: false, sell: false, keep: false, pb: '5.2 rushing points a game last year', rbk: null, dg: null},
    {s: '222', n: 'Jaylen Warren', p: 'RB', t: 'PIT', proj: 12.3, ur: 17, mr: 29, vgap: 0.31, v: 2000, buy: true, sell: false, keep: false, pb: null, rbk: 'mini bell cow', dg: {k: 'target', c: 2, a: true, n: 'A thesis.', w: ''}},
    {s: '333', n: 'Josh Allen', p: 'QB', t: 'BUF', proj: 24.0, ur: 1, mr: 1, vgap: 0, v: 6000, buy: false, sell: true, keep: true, pb: null, rbk: null, dg: null},
    {s: '444', n: 'Kenny Gainwell', p: 'RB', t: 'PIT', proj: 9.8, ur: 30, mr: 42, vgap: 0.2, v: 900, buy: true, sell: false, keep: false, pb: null, rbk: null, dg: null}]}}};
const DUMP = {v: 1, week: 3, at: Date.now(), leagues: [{id: '999', name: 'Test League', start: [{n: 'Josh Allen', why: 'Start him over the other one this week.', x: 'QB'}], add: [], watch: []}]};
// Titan's lineup analysis for the league, as bg.js caches it (trimLeague): the lineup as it stands, the optimal one, the changes, the wire.
const pl = (id, name, pos, team, rank, extra) => Object.assign({id, name, pos, team, rank, inj: null, onBye: false, locked: false, outish: false}, extra || {});
const allen = pl('333', 'Josh Allen', 'QB', 'BUF', 1, {tier: 1, proj: 24}), warren = pl('222', 'Jaylen Warren', 'RB', 'PIT', 17, {posRank: 9, tier: 2, proj: 12.3}),
  gain = pl('444', 'Kenny Gainwell', 'RB', 'PIT', 30, {inj: 'Questionable', posRank: 14, tier: 3, proj: 9.8}),
  bench = pl('555', 'Bench Back', 'RB', 'NYG', 40, {posRank: 19, tier: 3, proj: 6.2}), te = pl('666', 'Some Tight End', 'TE', 'DAL', 1008, {tier: 2, proj: 8});
const mside = (name, record, players, pts) => ({name, record, players, pts, proj: players.reduce((a, p) => a + p.proj, 0), final: players.reduce((a, p) => a + p.proj, 0)});
const ANALYSIS = {at: Date.now(), week: 3, season: '2026', rankedCount: 150, leagues: {'999': {id: '999', name: 'Test League', lineup: ['QB', 'RB', 'RB', 'TE'], week: 3,
  rows: [{slot: 'QB', verdict: 'OK', p: allen}, {slot: 'RB', verdict: 'OK', p: warren}, {slot: 'RB', verdict: 'SWAP OUT', p: bench}, {slot: 'TE', verdict: 'OK', p: te}],
  opt: [{slot: 'QB', p: allen}, {slot: 'RB', p: warren}, {slot: 'RB', p: gain}, {slot: 'TE', p: te}],
  moves: [{slot: 'RB', from: null, inn: gain, out: bench}], hurt: [gain], stops: 0,
  wire: [{pos: 'TE', cur: te, anyUnranked: false, list: [pl('777', 'Free Tight End', 'TE', 'SEA', 6)]}],
  close: [{starter: warren, bench: gain}],
  matchup: {me: mside('My Team', '2-0', [{id: '333', name: 'Josh Allen', pos: 'QB', team: 'BUF', slot: 'QB', pts: 0, proj: 24, state: 'pre'}, {id: '222', name: 'Jaylen Warren', pos: 'RB', team: 'PIT', slot: 'RB', pts: 0, proj: 12.3, state: 'pre'}], 0),
    opp: mside('Rival Team', '1-1', [{id: '888', name: 'Their QB', pos: 'QB', team: 'KC', slot: 'QB', pts: 0, proj: 20, state: 'pre'}, {id: '889', name: 'Their RB', pos: 'RB', team: 'DET', slot: 'RB', pts: 0, proj: 11, state: 'pre'}], 0), pa: 62}}}};
const PAGE = `<!doctype html><html><head><title>Sleeper</title></head><body><header><span>Sleeper</span></header>
  <div class="roster"><div class="row"><span class="name">Patrick Mahomes</span><span>QB - KC</span></div>
  <div class="row"><span class="name">J. Warren</span><span>RB - PIT</span></div>
  <div class="row"><span class="name">Josh Allen</span></div><div class="row"><span class="name">Nobody Here</span></div>
  <div class="row"><span class="name">Kenny Gainwell</span><span>RB - PIT</span></div></div></body></html>`;

(async () => {
  const PORT = 9900 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ext-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--load-extension=' + EXT, '--disable-extensions-except=' + EXT, 'about:blank'], {stdio: 'ignore'});
  const list = async () => { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { return []; } };
  let page, worker;
  for (let i = 0; i < 150 && !(page && worker); i++) {
    const ts = await list();
    page = ts.find(t => t.type === 'page');
    worker = ts.find(t => t.type === 'service_worker' && /bg\.js$/.test(t.url));
    if (!(page && worker)) await sleep(200);
  }
  const problems = [];
  const client = async info => {
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let seq = 0; const pending = {}, handlers = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; return; }
      if (m.method === 'Runtime.exceptionThrown') problems.push(info.type + ' EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      handlers.forEach(h => h(m));
    });
    const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({id, method, params})); });
    const evaluate = async (expression, awaitPromise = true) => {
      const r = await send('Runtime.evaluate', {expression, awaitPromise, returnByValue: true});
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const fulfill = (m, status, body, type = 'application/json') => send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: status,
      responseHeaders: [{name: 'content-type', value: type}, {name: 'access-control-allow-origin', value: '*'}], body: Buffer.from(body).toString('base64')});
    return {ws, send, evaluate, fulfill, on: h => handlers.push(h)};
  };
  try {
    check('the extension loaded (its service worker is running)', !!worker, worker ? worker.url : 'no service worker target');
    if (!worker) throw new Error('no service worker');
    const W = await client(worker), P = await client(page);
    await W.send('Runtime.enable');
    // Sleeper's API, answered in the service worker: a FAAB league with $100 budgets, $20 spent by the owner, two winning bids.
    await W.send('Fetch.enable', {patterns: [{urlPattern: '*api.sleeper.app*'}]});
    W.on(m => {
      if (m.method !== 'Fetch.requestPaused') return;
      const u = m.params.request.url;
      if (/\/league\/999\/rosters/.test(u)) W.fulfill(m, 200, JSON.stringify([{roster_id: 1, players: ['111', '222'], settings: {waiver_budget_used: 20}}, {roster_id: 2, players: ['333'], settings: {}}]));
      else if (/\/league\/999\/transactions\/1$/.test(u)) W.fulfill(m, 200, JSON.stringify([{type: 'waiver', status: 'complete', settings: {waiver_bid: 12}}, {type: 'waiver', status: 'complete', settings: {waiver_bid: 30}}]));
      else if (/\/league\/999\/transactions\//.test(u)) W.fulfill(m, 200, '[]');
      else if (/\/league\/999$/.test(u)) W.fulfill(m, 200, JSON.stringify({league_id: '999', settings: {waiver_type: 2, waiver_budget: 100}}));
      else if (/trending/.test(u)) W.fulfill(m, 200, JSON.stringify([{player_id: '444', count: 900}]));
      else W.fulfill(m, 404, '{}');
    });
    // The reports the worker would have fetched after a sign-in.
    await W.evaluate(`chrome.storage.local.set(${JSON.stringify({value: VALUE, dump: DUMP, analysis: ANALYSIS, fetched: Date.now(), showPills: true, showPanel: true, panelOpen: true})})`);
    const stored = await W.evaluate('chrome.storage.local.get("value").then(o => o.value && o.value.week)');
    check('the worker stored the stand-in reports', stored === 3, String(stored));
    // The popup, as a page: it asks the worker for its status and shows it.
    await P.send('Runtime.enable'); await P.send('Page.enable');
    await P.send('Emulation.setFocusEmulationEnabled', {enabled: true}); // headless pages have no focus, so focus() would be a no-op
    const extId = new URL(worker.url).host;
    await P.send('Page.navigate', {url: `chrome-extension://${extId}/popup.html`});
    await sleep(800);
    const status = await P.evaluate('new Promise(r => chrome.runtime.sendMessage({type: "status"}, r))').catch(e => ({error: e.message}));
    check('the worker answers the popup\'s status (not signed in, reports present)', status && !status.user && status.value && status.value.week === 3, JSON.stringify(status || null).slice(0, 200));
    const popupText = await P.evaluate('document.body.textContent', false);
    check('the popup offers Connect to Titan when not signed in', /Not connected to Titan/.test(popupText) && /Connect to Titan/.test(popupText), popupText.slice(0, 160));

    // A stand-in Sleeper league page.
    await P.send('Fetch.enable', {patterns: [{urlPattern: '*sleeper.com*'}]});
    P.on(m => { if (m.method === 'Fetch.requestPaused') P.fulfill(m, 200, PAGE, 'text/html'); });
    await P.send('Page.navigate', {url: 'https://sleeper.com/leagues/999/team'});
    let pills = 0, panel = '';
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      pills = await P.evaluate('document.querySelectorAll(".titan-pill").length', false).catch(() => 0);
      panel = await P.evaluate('(document.querySelector("titan-panel") && document.querySelector("titan-panel").shadowRoot.textContent) || ""', false).catch(() => '');
      if (pills >= 4 && /bid about/.test(panel)) break;
    }
    check('four names got a pill (the full names and "J. Warren"); the unknown name did not', pills === 4, String(pills));
    const pillText = await P.evaluate('[...document.querySelectorAll(".titan-pill")].map(p => p.textContent).join(" | ")', false);
    check('the pills carry the edge and the call (+31% buy low, mini bell cow; keep)', /\+31%buy low · mini bell cow/.test(pillText) && /keep/.test(pillText), pillText);
    const titles = await P.evaluate('[...document.querySelectorAll(".titan-pill")].map(p => p.title).join(" | ")', false);
    check('a pill\'s hover carries the Late-Round note and the draft guide take', /Late-Round: 5.2 rushing points/.test(titles) && /Draft guide: target 2\/10/.test(titles), titles.slice(0, 200));
    check('the league panel names the league and its sections', /Titan · Test League/.test(panel) && /Start/.test(panel) && /Claims/.test(panel) && /Buy low/.test(panel) && /Sell high or keep/.test(panel), panel.slice(0, 300));
    check('the claim shows its drop and a bid from the league\'s winning bids', /drop Bench Guy/.test(panel) && /bid about \$\d+ of \$80 left/.test(panel), panel.slice(panel.indexOf('Claims'), panel.indexOf('Claims') + 220));
    const foot = await P.evaluate('[...document.querySelector("titan-panel").shadowRoot.querySelectorAll(".foot a")].map(a => a.href).join(" ")', false);
    check('the panel carries the position note and links to Titan\'s Lineups, Waivers and Value for this league', /Thin at RB/.test(panel) && /app\/lineups\?league=999/.test(foot) && /app\/waivers\?league=999/.test(foot), foot);
    // The lineup: Titan's recommended lineup for the league (the cached analysis), the change it wants, the hurt starter, the wire.
    const lineup = await P.evaluate('(document.querySelector("titan-panel").shadowRoot.querySelector(".lineup") || {}).textContent || ""', false);
    check('the panel shows Titan\'s recommended lineup by slot with ranks', /QB\s*Josh Allen\s*QB1/.test(lineup.replace(/\s+/g, ' ')) && /RB\s*Kenny Gainwell/.test(lineup.replace(/\s+/g, ' ')) && /TE\s*Some Tight End\s*TE8/.test(lineup.replace(/\s+/g, ' ')), lineup.slice(0, 200));
    check('the new starter is marked, and the change is spelled out with both players\' ranks and notes', /Kenny Gainwell\s*Questionable\s*start/.test(lineup.replace(/\s+/g, ' ')) && /Start Kenny Gainwell \(RB30\) over Bench Back \(RB40\)/.test(lineup)
      && /Kenny Gainwell: #30 overall · RB14 at position · tier 3 \| Bench Back: #40 overall · RB19 at position · tier 3/.test(lineup), lineup.slice(0, 400));
    check('each starter carries the note for close calls: overall rank, rank at the position, tier (a rank past the overall list shows at the position only)',
      /RB17\s*#17 overall · RB9 at position · tier 2/.test(lineup.replace(/\s+/g, ' ')) && /QB1\s*tier 1/.test(lineup.replace(/\s+/g, ' ')) && /TE8\s*tier 2/.test(lineup.replace(/\s+/g, ' ')), lineup.slice(0, 260));
    check('waiver upgrades list free agents ranked above a starter, each with his rank note', /Waiver upgrades/.test(lineup) && /Free Tight End \(TE6, #6 overall\)/.test(lineup) && /over Some Tight End \(TE8, tier 2\)/.test(lineup)
      && /Gainwell \(RB30, #30 overall · RB14 at position · tier 3\) is questionable/.test(lineup), lineup.slice(-300));
    check('the section says whose engine and when, with a refresh', /Titan's engine, as of/.test(lineup) && /Refresh/.test(lineup), '');
    // The matchup: both sides' projected finals, the chance to win, and the close calls with projections and rank notes.
    const match = await P.evaluate('(document.querySelector("titan-panel").shadowRoot.querySelector(".match") || {}).textContent || ""', false);
    const m1 = match.replace(/\s+/g, ' ');
    check('the matchup shows both teams, records, projected finals and the chance to win', /My Team/.test(m1) && /2-0/.test(m1) && /36\.3/.test(m1) && /Rival Team/.test(m1) && /31\.0/.test(m1) && /62%\s*to win/.test(m1), m1.slice(0, 200));
    check('the close calls compare projections and rank notes, with a lean from the win chance', /Jaylen Warren over Kenny Gainwell is close: RB17 vs RB30 · projects 12\.3 vs 9\.8/.test(m1) && /#17 overall · RB9 at position · tier 2 \| #30 overall · RB14 at position · tier 3/.test(m1) && /favorite/.test(m1), m1.slice(-300));
    // The badge: lineup changes plus hurt starters across every league (one change, one hurt starter who isn't the one being benched).
    const badge = await W.evaluate('setBadge(null).then(n => chrome.action.getBadgeText({}).then(t => n + ":" + t))');
    check('the icon badge counts the lineup changes and hurt starters', badge === '2:2', badge);
    // The player card: a pill click opens it with usage, market, workload, the Late-Round note; a free agent gets a bid; a rostered player a trade button.
    const pillOf = name => `[...document.querySelectorAll('.titan-pill')].find(p => p.title.startsWith(${JSON.stringify(name)}))`;
    await P.evaluate(`${pillOf('Patrick Mahomes')}.click()`, false);
    await sleep(200);
    const card1 = await P.evaluate('(document.querySelector("titan-card") && document.querySelector("titan-card").shadowRoot.textContent) || ""', false);
    const c1 = card1.replace(/\s+/g, ' ');
    check('a pill click opens the player card: projection, market, workload and the Late-Round note', /Patrick Mahomes/.test(c1) && /On your roster/.test(c1) && /Projection\s*22\.1 a game/.test(c1) && /Market\s*QB10 · Titan QB3 · edge \+18%/.test(c1) && /5\.2 rushing points a game last year/.test(c1) && /Add to trade: you give/.test(c1), c1.slice(0, 300));
    await P.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))', false);
    await sleep(100);
    check('Escape closes it', await P.evaluate('!document.querySelector("titan-card")', false), '');
    await P.evaluate(`${pillOf('Kenny Gainwell')}.click()`, false);
    await sleep(200);
    const c2 = (await P.evaluate('(document.querySelector("titan-card") && document.querySelector("titan-card").shadowRoot.textContent) || ""', false)).replace(/\s+/g, ' ');
    check('a free agent\'s card carries a bid from the league\'s budget and what he adds over your lowest starter at the position', /Free agent in this league/.test(c2) && /Bid\s*about \$\d+ of \$80 left · \+3\.6 a game over your lowest starter at RB/.test(c2) && /Claim/.test(c2), c2.slice(0, 300));
    await P.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))', false);
    // The trade check: type a name on each side, pick the suggestion, read the totals and the verdict.
    const sr = 'document.querySelector("titan-panel").shadowRoot';
    const type = async (side, text) => {
      // As a person would: open the Trade check, click into the box, type.
      await P.evaluate(`(() => { ${sr}.querySelector('details.trade').open = true; const i = ${sr}.querySelector('.side input[data-side="${side}"]'); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); })()`, false);
      await sleep(150);
      return P.evaluate(`[...${sr}.querySelectorAll('.side[data-side="${side}"] .sugg li')].map(l => l.textContent).join(" | ")`, false);
    };
    const sugg = await type('give', 'jos');
    check('the trade check suggests a valued player from a few letters', /Josh Allen · QB, BUF/.test(sugg), sugg);
    await P.evaluate(`${sr}.querySelector('.side[data-side="give"] .sugg li').click()`, false);
    await sleep(200);
    const focused = await P.evaluate(`(() => { const a = ${sr}.activeElement; return (a ? a.tagName + ':' + (a.dataset.side || '') : 'none')
      + ' / doc=' + document.activeElement.tagName + ' hasFocus=' + document.hasFocus() + ' inputs=' + ${sr}.querySelectorAll('.side input').length; })()`, false);
    check('picking a name keeps you in that box (the panel re-renders without losing focus or its scroll)', /^INPUT:give/.test(focused), focused);
    await type('get', 'mahom');
    await P.evaluate(`${sr}.querySelector('.side[data-side="get"] .sugg li').click()`, false);
    await sleep(200);
    await type('get', 'warren');
    await P.evaluate(`${sr}.querySelector('.side[data-side="get"] .sugg li').click()`, false);
    await sleep(200);
    const totals = await P.evaluate(`${sr}.querySelector('.totals').textContent`, false);
    // Give Allen (6000, even), get Mahomes (4000 with an 18% edge: worth 4878) and Warren (2000 with 31%: 2899): you win by about 23% of Titan's worth, and gain 10.4 points a game across the pieces.
    check('the trade check totals both sides and gives a verdict', /You win by 2[0-9]% of Titan's worth/.test(totals) && /gain 10\.4 points a game/.test(totals) && /Yougive6000/.test(totals.replace(/\s+/g, '')) && /Youget6000/.test(totals.replace(/\s+/g, '')), totals.slice(0, 260));
    const send = await P.evaluate(`(${sr}.querySelector('a.send') || {}).href || ''`, false);
    check('the trade can be sent to Titan\'s Trade tab with the league and both sides in the address', send === 'https://titanfantasyfootball.com/app/trade?trade=999:333:111,222', send);
    // Proposing on Sleeper, assisted: the pieces named (and copied), the partner from the get side, and the pills marked give and get.
    await P.evaluate(`${sr}.querySelector('[data-propose]').click()`, false);
    await sleep(300);
    const prop = (await P.evaluate(`(${sr}.querySelector('.prop') || {}).textContent || ''`, false)).replace(/\s+/g, ' ');
    check('Propose on Sleeper names the pieces to add on Sleeper\'s trade screen', /you give Josh Allen/.test(prop) && /you get Patrick Mahomes, Jaylen Warren/.test(prop), prop.slice(0, 200));
    const marked = await P.evaluate(`[...document.querySelectorAll('.titan-pill')].map(p => (p.classList.contains('t-give') ? 'give:' : p.classList.contains('t-get') ? 'get:' : '') + p.title.split(' (')[0]).filter(x => /^(give|get):/.test(x)).sort().join(' | ')`, false);
    check('and marks those players\' pills on the page', marked === 'get:Jaylen Warren | get:Patrick Mahomes | give:Josh Allen', marked);
    const kept = await W.evaluate('chrome.storage.local.get("proposal").then(o => o.proposal && o.proposal.text)');
    check('the proposal is kept until Done, so it follows you to Sleeper\'s trade screen', kept === 'Trade: I give Josh Allen; I get Patrick Mahomes, Jaylen Warren.', String(kept));
    await P.evaluate(`${sr}.querySelector('[data-proposal-clear]').click()`, false);
    await sleep(300);
    check('Done clears it', await P.evaluate(`!${sr}.querySelector('.prop') && !document.querySelector('.titan-pill.t-give')`, false), '');
    await P.evaluate(`${sr}.querySelector('button[data-remove="222"]').click()`, false);
    await sleep(200);
    const after1 = await P.evaluate(`${sr}.querySelector('.totals').textContent`, false);
    check('removing a piece re-totals (Allen for Mahomes alone: you lose)', /You lose by/.test(after1), after1.slice(0, 160));
    // Collapsing the panel keeps the header and hides the body; the choice is remembered.
    await P.evaluate('document.querySelector("titan-panel").shadowRoot.getElementById("head").click()', false);
    await sleep(300);
    const closed = await P.evaluate('document.querySelector("titan-panel").shadowRoot.querySelector(".box").className', false);
    const remembered = await W.evaluate('chrome.storage.local.get("panelOpen").then(o => o.panelOpen)');
    check('the panel collapses and remembers it', /closed/.test(closed) && remembered === false, closed + ' ' + remembered);
    // Turning the pills off from the popup's switch clears them.
    await W.evaluate('chrome.storage.local.set({showPills: false})');
    await sleep(500);
    const after = await P.evaluate('document.querySelectorAll(".titan-pill").length', false);
    check('the pills switch clears the pills', after === 0, String(after));
    check('no page or worker errors', problems.length === 0, problems.join('\n'));
  } finally {
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {}
  }
  T.done();
})().catch(e => { console.error(e); process.exit(1); });
