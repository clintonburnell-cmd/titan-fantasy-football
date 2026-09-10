/* Titan Fantasy Football Manager — the app.
 *
 * Everything lives in this browser: the linked Sleeper account, the last pull
 * from Sleeper (the snapshot) and the rankings the user imported. Every screen
 * is computed from those, so importing new rankings re-scores the lineups
 * instantly, with no refetch. Sleeper is read-only — lineup changes are still
 * made in the Sleeper app.
 */
(() => {
  'use strict';

  const {SCC, SleeperAPI: API} = window;
  const store = API.store;
  const KEY = {account: 'titan.account.v1', ranks: 'titan.ranks.v1', snap: 'titan.snapshot.v1', ui: 'titan.ui.v1'};
  const STALE_MS = 5 * 60 * 1000;
  const TABS = ['lineups', 'news', 'rosters', 'exposure', 'byes', 'score', 'ranks', 'settings'];
  const AVATAR = 'https://sleepercdn.com/avatars/thumbs/';
  // News-only accounts on the News tab. X doesn't let apps read posts without a
  // paid plan, so each one opens on X.
  const NEWS_ACCOUNTS = [
    {handle: 'UnderdogNFL', name: 'Underdog NFL', about: 'NFL news from Underdog'}
  ];

  // Inside the Google Play app, tips would have to go through Google Play billing,
  // so the Ko-fi tip jar (in the header) shows only on the website. The Play app opens
  // /?source=play (and arrives with an android-app:// referrer); remembering it
  // for the session covers reloads that drop the query string.
  const IN_PLAY_APP = (() => {
    try {
      if (new URLSearchParams(location.search).get('source') === 'play' ||
          document.referrer.startsWith('android-app://com.titanfantasyfootball.app')) {
        sessionStorage.setItem('titan.play', '1');
      }
      return sessionStorage.getItem('titan.play') === '1';
    } catch (e) {
      return false;
    }
  })();

  // iPhone and iPad visitors in the browser get a one-time tip on putting Titan on
  // their home screen. iPadOS reports itself as a Mac, so touch support gives it away.
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = navigator.standalone === true ||
    !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const IOS_HINT_KEY = 'titan.iosHint.v1';
  const SHARE_ICON = '<svg class="share-ico" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12' +
    'a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function iosHint() {
    if (!IS_IOS || STANDALONE || store.get(IOS_HINT_KEY)) return '';
    const device = /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : 'iPad';
    return `<div class="banner ios-hint" role="note"><span><b>Install Titan on your ${device}:</b> tap Share ${SHARE_ICON}, then
      <b>Add to Home Screen</b>.</span><button class="link" data-action="ios-hint-close">Got it</button></div>`;
  }

  const S = {
    account: store.get(KEY.account),
    ranks: store.get(KEY.ranks) || {weeks: {}},
    snap: store.get(KEY.snap),
    ui: Object.assign({tab: 'lineups', filter: 'all', league: 'all'}, store.get(KEY.ui) || {}),
    busy: false,
    error: '',
    A: null, // the snapshot analysed under the current rankings
    score: {week: 0, busy: false, data: null, error: ''},
    draft: {week: 0, text: '', parsed: null, file: '', pos: ''},
    link: {busy: false, error: ''},
    sync: {ready: false, api: null, user: null, state: 'off', error: '', at: 0},
    proj: {}, // Sleeper's projections for the snapshot's week
    view: {week: 0, pos: 'QB'} // the saved rankings open on the Rankings tab
  };
  if (!TABS.includes(S.ui.tab)) S.ui.tab = 'lineups';
  if (S.snap && S.account && S.snap.userId !== S.account.userId) S.snap = null;

  const $ = id => document.getElementById(id);
  const view = $('view');

  /* ------------------------------------------------------------ helpers */

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const fmt = n => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);
  const signed = n => (n > 0 ? '+' : '') + fmt(n);
  const slotName = s => SCC.slotLabel(s);
  const rl = p => SCC.rankLabel(p.pos, p.rank);
  const has = v => v !== '' && v !== null && v !== undefined;
  const pos = p => `<span class="pos" data-pos="${esc(p)}">${esc(p)}</span>`;
  const tile = (n, label, tone) => `<div class="tile t-${tone}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  const saveUi = () => store.set(KEY.ui, S.ui);
  const avatar = (a, size) => a
    ? `<img class="avatar" src="${AVATAR}${esc(a)}" alt="" width="${size}" height="${size}" loading="lazy">`
    : `<span class="avatar blank" style="width:${size}px;height:${size}px"></span>`;

  function when(ts) {
    const d = new Date(ts);
    const t = d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    return d.toDateString() === new Date().toDateString()
      ? t : d.toLocaleDateString([], {month: 'short', day: 'numeric'}) + ', ' + t;
  }

  function countsText(rows) {
    const c = SCC.rankCounts(rows);
    return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(p => c[p]).map(p => `${p} ${c[p]}`).join(' · ');
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  /* ----------------------------------------------------------- rankings */

  /* The rankings for a week. If that week has none yet, fall back to the
     latest earlier week and say so — better than ordering nothing. */
  function ranksFor(week) {
    const weeks = Object.keys(S.ranks.weeks).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return {week: 0, rows: [], exact: false};
    if (S.ranks.weeks[week]) return {week, rows: S.ranks.weeks[week].rows, exact: true};
    const earlier = weeks.filter(w => w < week);
    const w = earlier.length ? earlier[earlier.length - 1] : weeks[weeks.length - 1];
    return {week: w, rows: S.ranks.weeks[w].rows, exact: false};
  }

  function analyze() {
    if (!S.snap) { S.A = null; return; }
    const r = ranksFor(S.snap.week);
    S.A = SCC.analyzeAll(S.snap, SCC.weeklyMap(r.rows));
    S.A.ranks = r;
  }

  /* ------------------------------------------------------------ refresh */

  function setProgress(msg) {
    const el = $('progress');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function refresh() {
    if (S.busy || !S.account) return;
    S.busy = true;
    S.error = '';
    if (S.snap) paintHeader();
    else render(); // swap the empty state for the loading message
    setProgress('Starting…');
    try {
      const snap = await API.collect(S.account, setProgress, S.snap && S.snap.available);
      snap.userId = S.account.userId;
      S.snap = snap;
      store.set(KEY.snap, snap);
      S.proj = await API.fetchProjections(snap.season, snap.week);
      if (S.score.week === snap.week) S.score.data = null; // live points have moved
    } catch (e) {
      S.error = 'Refresh failed: ' + (e && e.message ? e.message : e);
    } finally {
      S.busy = false;
      setProgress('');
      analyze();
      render();
    }
  }

  // Sleeper's projections for the snapshot's week; kept on the device for an hour.
  async function loadProj() {
    if (!S.snap) return;
    const week = S.snap.week;
    const map = await API.fetchProjections(S.snap.season, week);
    if (!S.snap || S.snap.week !== week) return;
    S.proj = map;
    if (S.ui.tab === 'lineups') render();
  }

  /* A week's results, scored against the record the server job froze at each
     kickoff (signed-in users), or against today's rankings and projections. */
  async function loadScore(week) {
    S.score = {week, busy: true, data: null, error: ''};
    if (S.ui.tab === 'score') render();
    try {
      const leagues = S.snap.leagues.map(d => d.cfg);
      const [res, hist, proj] = await Promise.all([
        API.collectScores(S.account, leagues, week, S.snap.season),
        S.sync.api && S.sync.user ? S.sync.api.getHistory(week).catch(() => null) : null,
        API.fetchProjections(S.snap.season, week)
      ]);
      if (S.score.week !== week) return; // another week was picked meanwhile
      if (!res.started) {
        S.score.error = `Week ${week} has not kicked off yet, so there's nothing to score.`;
      } else {
        const r = ranksFor(week);
        const D = SCC.scoreWeek(res, SCC.weeklyMap(r.rows), hist, proj);
        D.ranks = r;
        D.history = hist ? hist.updatedAt || 1 : 0;
        D.provisional = res.done < res.total;
        S.score.data = D;
      }
    } catch (e) {
      if (S.score.week !== week) return;
      S.score.error = `Could not load week ${week}: ${e && e.message ? e.message : e}`;
    }
    S.score.busy = false;
    if (S.ui.tab === 'score') render();
  }

  /* ------------------------------------------------------------- render */

  function paintHeader() {
    const s = S.snap, a = S.account;
    $('meta').textContent = !a ? 'Start/sit for every Sleeper league'
      : s ? `${a.displayName} · Week ${s.week} · updated ${when(s.at)}`
      : `${a.displayName} · not pulled yet`;
    const b = $('refresh');
    b.hidden = !a;
    b.disabled = S.busy;
    b.classList.toggle('spin', S.busy);
    $('tabs').hidden = !a;
    document.querySelectorAll('#tabs [data-tab]').forEach(t =>
      t.setAttribute('aria-current', t.dataset.tab === S.ui.tab ? 'page' : 'false'));
  }

  function render() {
    paintHeader();
    if (!S.account) { view.innerHTML = iosHint() + screenWelcome(); return; }
    const err = S.error ? `<div class="banner stop">${esc(S.error)}</div>` : '';
    view.innerHTML = iosHint() + err + SCREENS[S.ui.tab]();
  }

  function emptyState() {
    return S.busy
      ? `<div class="empty"><h2>Pulling your leagues…</h2><p>The first load also grabs Sleeper's player list, which takes about 10 seconds.</p></div>`
      : `<div class="empty"><h2>Nothing pulled yet</h2><p>Tap Refresh to load your leagues from Sleeper.</p></div>`;
  }

  function ranksBanner(r, week) {
    if (!r.week) {
      return `<div class="banner stop"><b>No rankings yet.</b> Titan orders your lineups by your own rankings. Import them to get start/sit calls.
        <button class="link" data-go="ranks">Import rankings →</button></div>`;
    }
    if (!r.exact) {
      return `<div class="banner swap">Using your <b>week ${r.week}</b> rankings, since nothing is imported for week ${week} yet.
        <button class="link" data-go="ranks">Import week ${week} →</button></div>`;
    }
    return '';
  }

  /* ---- Welcome / link account */

  function screenWelcome() {
    return `<section class="welcome">
      <img src="icon.svg" alt="" width="76" height="76">
      <h2>Titan Fantasy Football Manager</h2>
      <p class="lede">Start/sit calls, waiver upgrades, exposure and bye weeks across every league you play on Sleeper, ordered by your own rankings.</p>
      <form class="card pad" data-form="link" novalidate>
        <label class="field block"><span>Your Sleeper username</span>
          <input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="e.g. fantasyking22" value="${esc(S.link.name || '')}" ${S.link.busy ? 'disabled' : ''}></label>
        ${S.link.error ? `<div class="banner stop">${esc(S.link.error)}</div>` : ''}
        <button class="btn big" type="submit" ${S.link.busy ? 'disabled' : ''}>${S.link.busy ? 'Finding you…' : 'Link Sleeper account'}</button>
        <p class="fine">No password. Titan only reads what Sleeper already shows publicly, and it can't change your lineups.</p>
      </form>
      <div class="sync-welcome" data-sync-slot="welcome">${syncWelcome()}</div>
      <ol class="how">
        <li><b>Link</b> your Sleeper username, and your leagues and lineup formats load automatically.</li>
        <li><b>Import</b> your weekly rankings as a CSV.</li>
        <li><b>Follow</b> the calls: who to start, who to swap, who's on the wire.</li>
      </ol>
    </section>`;
  }

  async function linkAccount(name) {
    if (S.link.busy) return;
    if (!name.trim()) { S.link.error = 'Type your Sleeper username.'; render(); return; }
    // Keep what was typed, so a typo can be corrected rather than retyped.
    S.link = {busy: true, error: '', name};
    render();
    try {
      const u = await API.lookupUser(name);
      if (!u) {
        S.link = {busy: false, name, error: `No Sleeper account called "${name.trim()}". Check the spelling: it's the name on your Sleeper profile.`};
        render();
        return;
      }
      S.account = Object.assign(u, {prefs: {}, updatedAt: Date.now()});
      store.set(KEY.account, S.account);
      pushAccount();
      S.snap = null;
      store.del(KEY.snap);
      S.link = {busy: false, error: ''};
      S.ui.tab = 'lineups';
      saveUi();
      render();
      refresh();
    } catch (e) {
      S.link = {busy: false, name, error: 'Could not reach Sleeper. Check your connection and try again.'};
      render();
    }
  }

  /* ---- Lineups */

  const VERDICT = {'OK': 'ok', 'UNRANKED': 'unranked', 'SWAP OUT': 'swap', 'DO NOT START': 'stop', 'FILL SLOT': 'stop', 'LOCKED': 'locked'};
  const needsAction = L => L.moves.length || L.stops || L.hurt.length;

  function screenLineups() {
    if (!S.snap) return emptyState();
    const A = S.A;
    const nAction = A.leagues.filter(needsAction).length;
    const list = S.ui.filter === 'action' ? A.leagues.filter(needsAction) : A.leagues;
    let h = ranksBanner(A.ranks, S.snap.week);
    h += `<section class="tiles">
      ${tile(A.changes.length, A.changes.length === 1 ? 'lineup change' : 'lineup changes', A.changes.length ? 'swap' : 'ok')}
      ${tile(A.hurtStarters.length, A.hurtStarters.length === 1 ? 'injured starter' : 'injured starters', A.hurtStarters.length ? 'stop' : 'ok')}
      ${tile(A.wireLines.length, A.wireLines.length === 1 ? 'wire upgrade' : 'wire upgrades', A.wireLines.length ? 'wire' : 'ok')}
      ${tile(A.locked, 'players locked', 'muted')}
    </section>`;
    h += `<div class="chips" role="group" aria-label="Filter leagues">
      <button class="chip" data-filter="all" aria-pressed="${S.ui.filter !== 'action'}">All ${A.leagues.length}</button>
      <button class="chip" data-filter="action" aria-pressed="${S.ui.filter === 'action'}">Needs action ${nAction}</button>
    </div>`;
    if (!A.leagues.length) {
      h += `<div class="empty-note">No leagues to show. ${S.snap.available && S.snap.available.length
        ? 'Switch some on in <button class="link" data-go="settings">Settings</button>.'
        : `Sleeper shows no ${esc(S.snap.season)} leagues on this account.`}</div>`;
    } else if (!list.length) h += `<div class="empty-note">Nothing to do. Every lineup matches your rankings.</div>`;
    const credit = Object.keys(S.proj).length ? '<p class="fine">Projections via Sleeper.</p>' : '';
    return h + list.map(leagueCard).join('') + credit;
  }

  const projOf = (p, cfg) => SCC.projFor(S.proj, p.id, cfg.ppr);

  // Sleeper's projection for the lineup as set, and for Titan's lineup when that differs.
  function projLine(L) {
    const mine = SCC.sumProj(L.roster.filter(p => p.start).map(p => ({proj: projOf(p, L.cfg)})));
    if (!mine) return '';
    const titan = SCC.sumProj((L.opt || []).filter(o => o.p).map(o => ({proj: projOf(o.p, L.cfg)})));
    return ` · projected ${fmt(mine)}${Math.abs(titan - mine) >= 0.1 ? `, Titan's lineup ${fmt(titan)}` : ''}`;
  }

  function leagueCard(L) {
    const st = L.stops ? ['stop', plural(L.stops, 'problem')]
      : L.moves.length ? ['swap', plural(L.moves.length, 'change')]
      : ['ok', 'Set'];
    let h = `<article class="card league">
      <header class="card-h"><div><h3>${esc(L.cfg.key)}</h3><p>${esc(SCC.describeLeague(L.cfg) + projLine(L))}</p></div><span class="pill p-${st[0]}">${st[1]}</span></header>`;
    if (L.moves.length) {
      h += `<div class="moves"><h4>Make these changes in Sleeper</h4>${L.moves.map(m => `
        <div class="move"><span class="slot">${esc(slotName(m.slot))}</span>
          <span class="mv out">${m.out ? `${esc(m.out.name)} <em>${esc(rl(m.out))}</em>` : '<em>nobody</em>'}</span>
          <span class="mv in">${esc(m.inn.name)} <em>${esc(rl(m.inn))}${m.inn.opp ? ' vs ' + esc(m.inn.opp) : ''}</em></span>
        </div>`).join('')}</div>`;
    }
    h += `<ol class="lineup">${L.rows.map(r => lineupRow(r, L.cfg)).join('')}</ol>`;
    L.wire.forEach(w => {
      const tail = w.cur ? `, better than ${esc(w.cur.name)} (${esc(rl(w.cur))})`
        : w.anyUnranked ? ', and you are starting someone unranked here' : '';
      h += `<p class="note wire"><b>Wire ${esc(w.pos)}:</b> ${w.list.map(x =>
        `${esc(x.name)} (${esc(SCC.rankLabel(x.pos, x.rank))}${x.opp ? ' ' + esc(x.opp) : ''})`).join(', ')}${tail}</p>`;
    });
    if (L.hurt.length) {
      h += `<p class="note hurt"><b>Injured in your lineup:</b> ${L.hurt.map(p => `${esc(p.name)} (${esc(p.inj)})`).join(', ')}</p>`;
    }
    return h + '</article>';
  }

  function rankCell(p) {
    return `<span class="rank">${p.rank === null ? 'NR' : esc(rl(p))}${has(p.tier) ? `<small>T${esc(p.tier)}</small>` : ''}</span>`;
  }

  function statusText(p) {
    const s = [p.locked && 'Locked', p.inj].filter(Boolean).join(' · ');
    return s ? ` · <span class="${p.outish ? 'bad' : 'warn'}">${esc(s)}</span>` : '';
  }

  function lineupRow(r, cfg) {
    if (!r.p) {
      return `<li class="row r-stop"><span class="slot">${esc(slotName(r.slot))}</span><span class="pos"></span>
        <span class="who"><b>Slot empty</b></span><span class="right"><span class="verdict v-stop">FILL SLOT</span></span></li>`;
    }
    const p = r.p, v = VERDICT[r.verdict] || 'ok';
    const proj = projOf(p, cfg);
    const sub = [p.team, p.opp && 'vs ' + p.opp, p.bye && 'bye ' + p.bye, proj !== null && 'proj ' + fmt(proj)].filter(Boolean).join(' · ');
    return `<li class="row r-${v}"><span class="slot">${esc(slotName(r.slot))}</span>${pos(p.pos)}
      <span class="who"><b>${esc(p.name)}</b><small>${esc(sub)}${statusText(p)}</small></span>
      <span class="right">${rankCell(p)}<span class="verdict v-${v}">${esc(r.verdict)}</span></span></li>`;
  }

  /* ---- News */

  function screenNews() {
    return `<p class="lede">Breaking NFL news from accounts that only post news. Tap one to see its latest posts on X.</p>
      <ul class="card list">${NEWS_ACCOUNTS.map(a => `
        <li class="row xrow"><span class="pos" aria-hidden="true">X</span>
          <span class="who"><b>${esc(a.name)}</b><small>@${esc(a.handle)} · ${esc(a.about)}</small></span>
          <span class="right"><a class="btn small" href="https://x.com/${esc(a.handle)}" target="_blank" rel="noopener">Open on X</a></span>
        </li>`).join('')}</ul>
      <p class="fine">X doesn't let apps show posts without a paid plan, so each account opens in the X app or on x.com.</p>`;
  }

  /* ---- Rosters */

  function screenRosters() {
    if (!S.snap) return emptyState();
    const leagues = S.A.leagues;
    const pick = leagues.some(L => L.cfg.key === S.ui.league) ? S.ui.league : 'all';
    const shown = pick === 'all' ? leagues : leagues.filter(L => L.cfg.key === pick);
    let h = `<div class="bar"><label class="field"><span>League</span><select data-ui="league">
      <option value="all">All leagues</option>
      ${leagues.map(L => `<option ${L.cfg.key === pick ? 'selected' : ''}>${esc(L.cfg.key)}</option>`).join('')}
    </select></label></div>`;
    h += shown.map(L => {
      const list = L.roster.slice().sort((a, b) =>
        a.start !== b.start ? (a.start ? -1 : 1) : SCC.rankKey(a) - SCC.rankKey(b));
      return `<article class="card"><header class="card-h"><div><h3>${esc(L.cfg.key)}</h3>
        <p>${plural(L.roster.length, 'player')} · ${L.roster.filter(p => p.start).length} starting</p></div></header>
        <ul class="roster">${list.map(p => {
          const sub = [p.team, p.opp && 'vs ' + p.opp, has(p.implied) && 'implied ' + p.implied, p.bye && 'bye ' + p.bye].filter(Boolean).join(' · ');
          return `<li class="row${p.start ? ' is-start' : ''}"><span class="slot">${p.start ? 'START' : ''}</span>${pos(p.pos)}
            <span class="who"><b>${esc(p.name)}</b><small>${esc(sub)}${statusText(p)}</small></span>
            <span class="right">${rankCell(p)}</span></li>`;
        }).join('')}</ul></article>`;
    }).join('');
    return h;
  }

  /* ---- Exposure */

  function screenExposure() {
    if (!S.snap) return emptyState();
    const E = SCC.exposure(S.A.leagues);
    let h = `<p class="lede">How many of your ${E.active} teams own each player (anyone on two or more).</p>`;
    if (!E.rows.length) return h + '<div class="empty-note">No player is on more than one of your teams.</div>';
    h += `<ul class="card list">${E.rows.map(r => `
      <li class="row xrow${r.count >= 5 ? ' x-hi' : r.count === 4 ? ' x-mid' : ''}">${pos(r.pos)}
        <span class="who"><b>${esc(r.name)}</b>
          <small>${esc([r.team, r.bye && 'bye ' + r.bye, 'starting in ' + r.starts].filter(Boolean).join(' · '))}</small>
          <small class="leagues">${esc(r.leagues.join(', '))}</small></span>
        <span class="right"><span class="count">${r.count}<small>/${E.active}</small></span>
          <span class="meter"><i style="width:${Math.round(100 * r.count / Math.max(E.active, 1))}%"></i></span></span>
      </li>`).join('')}</ul>`;
    return h;
  }

  /* ---- Byes */

  // "RB, FLEX" or "2 RB": the spots a bye week leaves open.
  function needText(list) {
    const c = {};
    list.forEach(s => { c[s] = (c[s] || 0) + 1; });
    return 'Need ' + Object.keys(c).map(s => (c[s] > 1 ? c[s] + ' ' : '') + s).join(', ');
  }

  function needRow(n, cols) {
    if (!n.needs.length) return '';
    return `<tr class="needs"><td colspan="${cols}"><div class="needs-in">${n.needs.map(x =>
      `<span class="need"><b>Wk ${x.week}</b> ${esc(needText(x.need))}${x.off.length ? `<small>${esc(x.off.join(', '))} off</small>` : ''}</span>`).join('')}</div></td></tr>`;
  }

  function screenByes() {
    if (!S.snap) return emptyState();
    const B = SCC.byeMap(S.A.leagues, S.snap.byes);
    const N = SCC.byeNeeds(S.A.leagues, S.snap.week);
    const short = N.filter(n => n.needs.length).length;
    const cell = n => (n ? `<td style="--heat:${(Math.min(n, 6) / 6).toFixed(2)}">${n}</td>` : '<td class="zero">·</td>');
    let h = `<p class="lede">Players on your current rosters who are off each week. Under a league, each upcoming week where byes
      leave a starting spot you can't fill, and who's off.</p>
      ${short ? `<div class="banner swap">${plural(short, 'league')} will need a pickup for a bye week.</div>`
        : '<div class="banner ok">Every lineup is covered through the byes.</div>'}
      <div class="card table-wrap"><table class="byes">
      <thead><tr><th>Week</th>${B.weeks.map(w => `<th>${w}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${B.rows.map((r, i) => `<tr${N[i].needs.length ? ' class="has-needs"' : ''}><th title="${esc(r.name)}">${esc(r.key)}</th>${
        B.weeks.map(w => cell(r.counts[w] || 0)).join('')}<td class="tot">${r.total}</td></tr>${needRow(N[i], B.weeks.length + 2)}`).join('')}
      <tr class="all"><th>All teams</th>${B.weeks.map(w => cell(B.totals[w] || 0)).join('')}<td class="tot"></td></tr>
      </tbody></table></div>`;
    if (B.clean.length) h += `<div class="banner ok">Week ${B.clean.join(', ')} completely clean: nobody you roster anywhere is off.</div>`;
    return h;
  }

  /* ---- Weeks */

  // How Titan's call on a player reads in a week's record.
  const CALL = {'OK': 'start', 'START': 'start', 'BENCH': 'bench', 'SWAP OUT': 'swap out', 'DO NOT START': "don't start",
    'UNRANKED': 'unranked', 'LOCKED': 'locked', 'FILL SLOT': 'fill slot'};

  function screenScore() {
    if (!S.snap) return emptyState();
    const cur = S.snap.week;
    const wk = S.score.week || cur;
    let h = `<div class="bar">
      <label class="field"><span>Week</span><select data-ui="scoreWeek">
        ${Array.from({length: 18}, (_, i) => i + 1).map(w => `<option value="${w}" ${w === wk ? 'selected' : ''} ${w > cur ? 'disabled' : ''}>Week ${w}${
          w === cur ? ' (this week)' : w > cur ? ' (not played yet)' : ''}</option>`).join('')}
      </select></label>
      <button class="btn" data-action="score" ${S.score.busy ? 'disabled' : ''}>${S.score.busy ? 'Loading…' : S.score.data ? 'Reload' : 'Load'}</button>
    </div>
    <p class="lede"><b>Projected</b> is Sleeper's projection for the players you started. <b>By rank</b> is what your rankings would have
      started from the same bench, and <b>perfect</b> is the best that roster could have done in hindsight. Open a league for every player's
      rank, Titan's call, projection and points.</p>`;
    if (S.score.error) h += `<div class="banner swap">${esc(S.score.error)}</div>`;
    const D = S.score.data;
    if (!D) return h;

    const T = D.totals, gained = Math.round((T.byRank - T.actual) * 10) / 10;
    if (D.provisional) {
      h += `<div class="banner swap"><b>Live:</b> games are still in progress, so these numbers will move. Projections cover the whole week.</div>`;
    }
    h += historyBanner(D);
    if (!D.ranks.exact && !D.history) {
      h += `<div class="banner swap">No rankings saved for week ${D.week}${D.ranks.week
        ? `, so "By rank" is using week ${D.ranks.week}.` : ', so "By rank" has nothing to order by.'}</div>`;
    }
    h += `<section class="tiles">${tile(fmt(T.actual), 'you scored', 'muted')}${tile(T.projActual ? fmt(T.projActual) : 'None', 'projected', 'muted')}${
      tile(fmt(T.byRank), 'by rank', gained > 0 ? 'swap' : 'ok')}${tile(fmt(T.perfect), 'perfect', 'muted')}</section>`;
    const vsProj = !T.projActual ? ''
      : D.provisional ? `So far: <b>${fmt(T.actual)}</b> of <b>${fmt(T.projActual)}</b> projected. `
      : T.vsProj >= 0 ? `You beat the projection by <b class="good">${fmt(T.vsProj)}</b>. `
      : `You finished <b class="amber">${fmt(-T.vsProj)}</b> under the projection. `;
    h += `<p class="verdict-line">${vsProj}${gained > 0 ? `Following your rankings would have scored <b class="amber">${fmt(gained)}</b> more.`
      : gained < 0 ? `Your lineups beat your rankings by <b class="good">${fmt(-gained)}</b>.` : 'Your lineups matched your rankings.'}${
      T.ct ? ` Close calls right: ${T.cw} of ${T.ct}.` : ''}</p>`;
    if (D.skipped.length) h += `<p class="fine">Skipped: ${esc(D.skipped.join('; '))}</p>`;
    h += D.rows.map(r => `<details class="card score"><summary>
        <span class="sname">${esc(r.key)}</span>
        <span class="n"><small>Actual</small>${fmt(r.actual)}</span>
        <span class="n"><small>Projected</small>${r.projActual ? fmt(r.projActual) : 'None'}</span>
        <span class="n${r.projActual && !D.provisional ? (r.vsProj >= 0 ? ' good' : ' amber') : ''}"><small>vs proj</small>${
          !r.projActual ? '' : D.provisional ? 'Live' : signed(r.vsProj)}</span>
        <span class="n${r.leftOnBench > 0 ? ' amber' : ''}"><small>Left on bench</small>${signed(r.leftOnBench)}</span>
      </summary>
      <p class="sub">By rank ${fmt(r.byRank)} · perfect ${fmt(r.perfect)} · close calls ${r.close.total ? `${r.close.wins} of ${r.close.total}` : 'none'}</p>
      <ul class="detail">${r.detail.map(d => detailRow(d, D.provisional)).join('')}</ul>
    </details>`).join('');
    h += `<p class="fine">Projections via Sleeper.${D.ranks.week
      ? ` <button class="link" data-action="ranks-view" data-week="${D.ranks.week}">See your week ${D.ranks.week} rankings</button>` : ''}</p>`;
    return h;
  }

  function historyBanner(D) {
    if (D.history) {
      return `<div class="banner ok">Ranks, Titan's calls and projections are as they stood at each player's kickoff, saved automatically.</div>`;
    }
    const why = `Nothing was saved at kickoff for week ${D.week}, so ranks and calls use your rankings as they are now, with Sleeper's latest projections.`;
    return S.sync.user ? `<div class="banner swap">${why}</div>`
      : `<div class="banner swap">${why} <button class="link" data-go="settings">Sign in with Google</button> and Titan saves them at every kickoff.</div>`;
  }

  // While the week is live, a player who hasn't scored yet shows no gap to his projection.
  function detailRow(d, live) {
    const slot = `<span class="slot">${esc(d.slot === 'bench' ? 'BENCH' : slotName(d.slot))}</span>`;
    if (!d.p) return `<li class="row r-stop">${slot}<span class="pos"></span><span class="who"><b>Empty slot</b></span><span class="right"></span></li>`;
    const p = d.p, proj = has(p.proj) ? Number(p.proj) : null;
    const bits = [p.rank === null ? 'unranked' : rl(p), p.call && 'Titan: ' + (CALL[p.call] || String(p.call).toLowerCase()),
      proj !== null && 'proj ' + fmt(proj)].filter(Boolean).join(' · ');
    const diff = proj !== null && !(live && !p.pts) ? `<small class="${p.pts >= proj ? 'good' : 'amber'}">${signed(p.pts - proj)}</small>` : '';
    return `<li class="row${d.benchWin ? ' r-swap' : ''}">${slot}${pos(p.pos)}
      <span class="who"><b>${esc(p.name)}</b><small>${esc(bits)}${d.benchWin ? ' · outscored your weakest starter' : ''}</small></span>
      <span class="right"><span class="rank pts">${fmt(p.pts)}${diff}</span></span></li>`;
  }

  /* ---- Rankings */

  function screenRanks() {
    const cur = S.snap ? S.snap.week : 1;
    if (!S.draft.week) S.draft.week = cur;
    const weeks = Object.keys(S.ranks.weeks).map(Number).sort((a, b) => b - a);
    return `<p class="lede">Titan orders your lineups only by your own rankings. ${S.sync.user
        ? 'They sync to your devices through your Google sign-in, and only you can see them.'
        : 'They\'re kept on this device and never shared. Sign in on Settings to sync them to your other devices.'}</p>
      <section class="card pad"><h3>Saved rankings</h3>${weeks.length ? `<ul class="saved">${weeks.map(w => {
        const e = S.ranks.weeks[w];
        return `<li><span><b>Week ${w}</b> · ${e.rows.length} players<small>${esc(countsText(e.rows))} · saved ${esc(when(e.savedAt))}${
          e.source ? ' from ' + esc(e.source) : ''}</small></span>
          <span class="saved-btns"><button class="btn ghost small" data-action="ranks-view" data-week="${w}">${S.view.week === w ? 'Hide' : 'View'}</button>
          <button class="btn ghost small" data-action="ranks-del" data-week="${w}">Delete</button></span></li>`;
      }).join('')}</ul>` : '<p class="muted">None yet.</p>'}</section>
      ${ranksViewer()}
      <section class="card pad"><h3>Import rankings</h3>
        <div class="bar">
          <label class="field narrow"><span>Week</span><input type="number" min="1" max="18" data-draft="week" value="${S.draft.week}"></label>
          <label class="btn ghost file">Choose CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" data-draft="file" hidden></label>
        </div>
        <label class="field block"><span>…or paste them as CSV, or copied straight out of a spreadsheet</span>
          <textarea data-draft="text" rows="7" spellcheck="false" placeholder="Player,Pos,Team,Rank,Opp,Implied,Tier&#10;Joe Burrow,QB,CIN,1,TB,27.5,1">${esc(S.draft.text)}</textarea></label>
        <div id="draft-preview" class="draft">${draftPreview()}</div>
        <details class="help"><summary>What format works?</summary>
          <p>Two layouts are read automatically:</p>
          <ul>
            <li><b>One row per player</b> with columns <code>Player, Pos, Team, Rank</code> and optionally <code>Opp, Implied, Tier</code>.
              Rank is your overall (FLEX) rank for RB/WR/TE and your positional rank for QB, K and DEF.</li>
            <li><b>Side-by-side position tables</b>, like the export from Late-Round: <code>QB Rank, QB Player, …, FLEX Rank, FLEX Player, …</code>.
              RB/WR/TE are ranked by the FLEX table.</li>
            <li><b>FantasyPros rankings</b>, one file per position. Import the QB, K and DST files, plus the FLEX
              file for RB/WR/TE. Each file is added to that week and replaces only its own position.</li>
          </ul>
          <p>Name defenses by team (<code>LAC D/ST</code>, <code>Los Angeles Chargers</code> or <code>LAC</code> all work).</p>
        </details>
      </section>`;
  }

  // One saved week's rankings, a position at a time.
  function ranksViewer() {
    const w = S.view.week, e = S.ranks.weeks[w];
    if (!e) return '';
    const counts = SCC.rankCounts(e.rows);
    const shown = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter(p => counts[p]);
    const pick = shown.includes(S.view.pos) ? S.view.pos : shown[0];
    const rows = e.rows.filter(r => r.pos === pick).sort((a, b) => SCC.rankKey(a) - SCC.rankKey(b));
    const flex = pick === 'RB' || pick === 'WR' || pick === 'TE';
    return `<section class="card pad" id="ranks-view">
      <div class="view-h"><h3>Week ${w} rankings</h3><button class="btn ghost small" data-action="ranks-view" data-week="0">Close</button></div>
      <p class="fine">Saved ${esc(when(e.savedAt))}${e.source ? ' from ' + esc(e.source) : ''}.${
        flex ? ' RB, WR and TE are in FLEX order, with each player\'s FLEX rank on the right.' : ''}</p>
      <div class="chips" role="group" aria-label="Position">${shown.map(p =>
        `<button class="chip" data-view-pos="${p}" aria-pressed="${p === pick}">${p} ${counts[p]}</button>`).join('')}</div>
      <ol class="roster">${rows.map((r, i) => `<li class="row"><span class="slot">${esc(pick)}${i + 1}</span>${pos(r.pos)}
        <span class="who"><b>${esc(r.name)}</b><small>${esc([r.team, has(r.opp) && 'vs ' + r.opp, has(r.tier) && 'tier ' + r.tier].filter(Boolean).join(' · '))}</small></span>
        <span class="right"><span class="rank">${flex && r.rank !== null && r.rank < 1000 ? 'FLEX ' + esc(r.rank) : ''}</span></span></li>`).join('')}</ol>
    </section>`;
  }

  // Opens a saved week's rankings on the Rankings tab, or closes them.
  function viewRanks(w) {
    S.view.week = S.ui.tab === 'ranks' && S.view.week === w ? 0 : w;
    if (S.ui.tab !== 'ranks') go('ranks'); else render();
    const el = $('ranks-view');
    if (el) el.scrollIntoView({block: 'start', behavior: 'smooth'});
  }

  const parseDraft = () => (S.draft.text.trim() ? SCC.parseRanks(S.draft.text, {pos: S.draft.pos}) : null);

  // What saving the draft would do to that week: replace it, or add to it.
  function mergePlan(P, w) {
    const prev = S.ranks.weeks[w];
    return Object.assign({prev}, SCC.mergeRanks(prev && prev.rows, P.rows));
  }

  function posPicker() {
    return `<label class="field narrow-select"><span>Which position does this file rank?</span><select data-draft="pos">
      <option value="">Choose…</option>${['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p =>
        `<option ${S.draft.pos === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>`;
  }

  function draftPreview() {
    const P = S.draft.parsed, w = S.draft.week;
    const plan = P && P.rows.length ? mergePlan(P, w) : null;
    const label = plan && plan.merged ? `Add to week ${w} rankings`
      : `Save as week ${w} rankings${S.ranks.weeks[w] ? ' (replaces saved)' : ''}`;
    const save = `<button class="btn" data-action="ranks-save" ${plan ? '' : 'disabled'}>${label}</button>`;
    if (!P) return save;
    if (P.needsPosition) return `<div class="banner swap">${esc(P.error)}</div>${posPicker()}${save}`;
    if (P.error) return `<div class="banner stop">${esc(P.error)}</div>${save}`;
    if (P.format === 'fantasypros' || P.format === 'single') {
      const skippedFp = P.skipped.length ? ` · skipped ${P.skipped.length}` : '';
      const what = plan.merged ? `<p class="fine">Saving replaces week ${w}'s ${esc(plan.positions.join(', '))} rankings and keeps the rest.</p>` : '';
      return `<div class="banner ok"><b>${P.rows.length} players read${P.format === 'fantasypros' ? ' from FantasyPros' : ''}</b> · ${
        esc(countsText(P.rows))}${skippedFp}</div>${P.warning ? `<div class="banner swap">${esc(P.warning)}</div>` : ''}${
        P.position ? posPicker() : ''}${what}${save}`;
    }
    const skipped = P.skipped.length
      ? ` · skipped ${P.skipped.length} (${esc(P.skipped.slice(0, 3).map(s => `${s.text}: ${s.why}`).join('; '))}${P.skipped.length > 3 ? '…' : ''})` : '';
    const from = P.format === 'wide' ? ' from the position tables' : '';
    return `<div class="banner ok"><b>${P.rows.length} players read${from}</b> · ${esc(countsText(P.rows))}${skipped}</div>${save}`;
  }

  function paintDraft() {
    const el = $('draft-preview');
    if (el) el.innerHTML = draftPreview();
  }

  function saveRanks() {
    const P = S.draft.parsed;
    if (!P || !P.rows.length) return;
    const w = S.draft.week;
    const plan = mergePlan(P, w);
    const name = S.draft.file || 'paste';
    S.ranks.weeks[w] = {rows: plan.rows, savedAt: Date.now(),
      source: plan.merged ? `${(plan.prev && plan.prev.source) || 'earlier import'} + ${name}` : name};
    if (!store.set(KEY.ranks, S.ranks)) { toast('Could not save. Browser storage is full or blocked.'); return; }
    pushWeek(w);
    S.draft = {week: w, text: '', parsed: null, file: '', pos: ''};
    if (S.score.week === w) S.score.data = null;
    analyze();
    render();
    toast(plan.merged ? `Week ${w} ${plan.positions.join(', ')} rankings added. Lineups re-scored.`
      : `Week ${w} rankings saved. Lineups re-scored.`);
  }

  function deleteRanks(w) {
    if (!confirm(`Delete your week ${w} rankings from this device?`)) return;
    delete S.ranks.weeks[w];
    store.set(KEY.ranks, S.ranks);
    pushWeek(w);
    analyze();
    render();
  }

  /* ---- Settings */

  function screenSettings() {
    const a = S.account;
    const all = (S.snap && S.snap.available) || [];
    let h = `<section class="card pad" data-sync-slot="settings">${syncSettings()}</section>
      <section class="card pad"><h3>Sleeper account</h3>
      <div class="account">${avatar(a.avatar, 44)}<div><b>${esc(a.displayName)}</b><small>@${esc(a.username)}</small></div>
        <button class="btn ghost small" data-action="unlink">Switch account</button></div></section>
      <section class="card pad"><h3>Leagues</h3>
        <p class="fine">Found automatically on Sleeper, with each league's own lineup format. Switch off any you don't want Titan to manage.</p>
        ${all.length ? `<ul class="lg-list">${all.map(l => `<li><label class="check">
          <input type="checkbox" data-league="${esc(l.id)}" ${l.active ? 'checked' : ''}>
          <span><b>${esc(l.key)}</b><small>${esc(SCC.describeLeague(l))} · ${esc(l.lineup.map(slotName).join(' '))}</small></span></label></li>`).join('')}</ul>
          <div class="bar"><button class="btn" data-action="leagues-save">Save and refresh</button></div>`
        : `<p class="muted">${S.busy ? 'Loading…' : 'No leagues yet. Tap Refresh.'}</p>`}
      </section>
      <section class="card pad"><h3>Player list</h3>
        <p class="fine">Names, positions and teams are saved on this device and refreshed every few days. Injuries and game locks are pulled fresh on every refresh.</p>
        <div class="bar"><button class="btn ghost" data-action="players-reload">Reload player list now</button></div>
      </section>`;
    if (S.snap) {
      const lines = S.snap.log.concat(S.A ? [''].concat(S.A.log) : []);
      h += `<section class="card pad"><h3>Refresh log</h3><pre class="log">${esc(lines.join('\n'))}</pre></section>`;
    }
    return h;
  }

  function saveLeagues() {
    const prefs = Object.assign({}, S.account.prefs);
    view.querySelectorAll('[data-league]').forEach(el => { prefs[el.dataset.league] = {active: el.checked}; });
    S.account.prefs = prefs;
    S.account.updatedAt = Date.now();
    store.set(KEY.account, S.account);
    pushAccount();
    toast('Leagues saved.');
    refresh();
  }

  function unlink() {
    if (!confirm('Unlink this Sleeper account from Titan on this device? Your rankings stay.')) return;
    S.account = null;
    S.snap = null;
    S.A = null;
    store.del(KEY.account);
    store.del(KEY.snap);
    render();
  }

  /* ---- Sync across the person's own devices (sync.js; optional) */

  function pushAccount() {
    if (S.sync.api && S.sync.user && S.account) S.sync.api.pushAccount(S.account);
  }

  function pushWeek(w) {
    if (S.sync.api && S.sync.user) S.sync.api.pushWeek(w, S.ranks.weeks[w] || null);
  }

  function syncSettings() {
    const s = S.sync;
    const head = '<h3>Sync across your devices</h3>';
    if (!s.ready) {
      return head + `<p class="fine">${location.protocol === 'file:'
        ? 'Sync works in the online app.' : 'Sync is loading. It needs an internet connection.'}</p>`;
    }
    if (!s.user) {
      return head + `<p class="fine">Sign in with Google to keep your Sleeper link, league switches and rankings the same on your phone and computer. Only you can see them.</p>
        ${s.error ? `<div class="banner stop">${esc(s.error)}</div>` : ''}
        <div class="bar"><button class="btn" data-action="sync-in">Sign in with Google</button></div>`;
    }
    const status = s.state === 'syncing' ? 'Syncing…' : s.state === 'error' ? s.error : s.at ? `Synced · ${when(s.at)}` : 'Synced';
    const photo = s.user.photo
      ? `<img class="avatar" src="${esc(s.user.photo)}" alt="" width="44" height="44" referrerpolicy="no-referrer">` : avatar('', 44);
    return head + `<div class="account">${photo}<div><b>${esc(s.user.name || s.user.email)}</b><small>${esc(s.user.email)}</small></div>
        <button class="btn ghost small" data-action="sync-out">Sign out</button></div>
      <p class="fine${s.state === 'error' ? ' bad-text' : ''}">${esc(status)}</p>
      <details class="help"><summary>Delete my Titan account</summary>
        <p>Removes your synced Sleeper link and rankings from Titan's database and deletes your Titan sign-in. This device keeps its own copy until you unlink it.</p>
        <p><button class="btn ghost small" data-action="sync-delete">Delete my Titan account</button></p></details>`;
  }

  function syncWelcome() {
    const s = S.sync;
    if (!s.ready) return '';
    if (!s.user) {
      return `<p class="fine">Used Titan on another device? <button class="link" data-action="sync-in">Sign in with Google</button> to bring your account and rankings here.</p>`;
    }
    return `<p class="fine">Signed in as ${esc(s.user.email)}. ${s.state === 'syncing'
      ? 'Loading your Titan account…' : 'Link your Sleeper username above and it will sync to your other devices.'}</p>`;
  }

  // Sync state changes repaint only the sync panels, so nothing being typed is lost.
  function paintSync() {
    view.querySelectorAll('[data-sync-slot]').forEach(el => {
      el.innerHTML = el.dataset.syncSlot === 'welcome' ? syncWelcome() : syncSettings();
    });
  }

  // The bridge sync.js talks to. The app never depends on it being there.
  window.TitanApp = {
    local: () => ({account: S.account, ranks: S.ranks}),
    applyAccount(account) {
      const newUser = !S.account || S.account.userId !== account.userId;
      const newPrefs = !newUser && JSON.stringify(S.account.prefs || {}) !== JSON.stringify(account.prefs || {});
      S.account = Object.assign({}, account);
      store.set(KEY.account, S.account);
      if (newUser) { S.snap = null; S.A = null; store.del(KEY.snap); }
      render();
      if (newUser || newPrefs) refresh();
    },
    applyRanks(changes) {
      Object.keys(changes).forEach(w => {
        if (changes[w]) S.ranks.weeks[w] = changes[w];
        else delete S.ranks.weeks[w];
        if (S.score.week === Number(w)) S.score.data = null;
      });
      store.set(KEY.ranks, S.ranks);
      analyze();
      render();
      toast('Rankings updated from your account.');
    },
    setSync(patch) {
      Object.assign(S.sync, patch);
      paintSync();
      // Signing in makes the week's saved record readable: score again with it.
      if (patch.state === 'on' && S.ui.tab === 'score' && S.score.data && !S.score.data.history && !S.score.busy) loadScore(S.score.week);
    },
    syncReady(api) { S.sync.api = api; S.sync.ready = true; paintSync(); }
  };

  const SCREENS = {
    lineups: screenLineups, news: screenNews, rosters: screenRosters, exposure: screenExposure, byes: screenByes,
    score: screenScore, ranks: screenRanks, settings: screenSettings
  };

  /* ------------------------------------------------------------- events */

  function go(tab) {
    if (!TABS.includes(tab)) return;
    S.ui.tab = tab;
    saveUi();
    render();
    window.scrollTo(0, 0);
    if (tab === 'score' && S.snap && !S.score.data && !S.score.busy && !S.score.error) loadScore(S.score.week || S.snap.week);
  }

  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  $('refresh').addEventListener('click', refresh);

  view.addEventListener('submit', e => {
    if (e.target.dataset.form !== 'link') return;
    e.preventDefault();
    linkAccount(e.target.elements.username.value);
  });

  view.addEventListener('click', e => {
    const t = e.target.closest('[data-go],[data-filter],[data-view-pos],[data-action]');
    if (!t) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.filter) { S.ui.filter = t.dataset.filter; saveUi(); return render(); }
    if (t.dataset.viewPos) { S.view.pos = t.dataset.viewPos; return render(); }
    const a = t.dataset.action;
    if (a === 'score') loadScore(S.score.week || S.snap.week);
    else if (a === 'ranks-view') viewRanks(Number(t.dataset.week));
    else if (a === 'ranks-save') saveRanks();
    else if (a === 'ranks-del') deleteRanks(Number(t.dataset.week));
    else if (a === 'leagues-save') saveLeagues();
    else if (a === 'unlink') unlink();
    else if (a === 'players-reload') { API.clearPlayers(); refresh(); }
    else if (a === 'ios-hint-close') { store.set(IOS_HINT_KEY, 1); render(); }
    else if (a === 'sync-in' && S.sync.api) {
      S.sync.api.signIn().catch(e => window.TitanApp.setSync({state: 'error', error: 'Sign-in failed: ' + (e.code || e.message)}));
    } else if (a === 'sync-out' && S.sync.api) {
      if (confirm('Sign out of sync on this device? Your data stays here and in your account.')) S.sync.api.signOut();
    } else if (a === 'sync-delete' && S.sync.api) {
      if (!confirm('Delete your Titan account and everything synced to it? This cannot be undone.')) return;
      S.sync.api.deleteAccount().then(() => toast('Your Titan account was deleted.'),
        e => window.TitanApp.setSync({state: 'error', error: 'Could not delete: ' + (e.code || e.message)}));
    }
  });

  view.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.ui === 'league') { S.ui.league = t.value; saveUi(); render(); }
    else if (t.dataset.draft === 'pos') { S.draft.pos = t.value; S.draft.parsed = parseDraft(); paintDraft(); }
    else if (t.dataset.ui === 'scoreWeek') loadScore(Number(t.value));
    else if (t.dataset.draft === 'file' && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then(txt => {
        S.draft.text = txt;
        S.draft.file = f.name;
        S.draft.pos = SCC.positionHint(f.name);
        S.draft.parsed = parseDraft();
        const ta = view.querySelector('textarea[data-draft="text"]');
        if (ta) ta.value = txt;
        paintDraft();
      });
    }
  });

  view.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.draft === 'text') {
      S.draft.text = t.value;
      S.draft.file = '';
      S.draft.parsed = parseDraft();
      paintDraft();
    } else if (t.dataset.draft === 'week') {
      const n = parseInt(t.value, 10);
      if (n >= 1 && n <= 18) { S.draft.week = n; paintDraft(); }
    }
  });

  // Coming back to the app on game day should never show stale lineups.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.account && S.snap && Date.now() - S.snap.at > STALE_MS) refresh();
  });

  // Offline shell + installable app. Needs https (or localhost).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* --------------------------------------------------------------- boot */

  if (IN_PLAY_APP) document.querySelectorAll('[data-tip]').forEach(el => { el.hidden = true; });
  analyze();
  render();
  if (S.account && (!S.snap || Date.now() - S.snap.at > STALE_MS)) refresh();
  else loadProj();
})();
