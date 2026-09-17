// Titan for Sleeper, on Sleeper's pages: a pill after each player name the reports know (his edge on the market, the
// buy, sell or keep call, his archetype, the Late-Round note on hover), and a panel on league pages with Titan's
// calls for that league (start ideas, claims with a bid and a drop, buy-lows, sell-highs, the watch list). Reads the
// reports the service worker cached in chrome.storage.local; asks it only for a league's waiver facts (the bids).
(function () {
  'use strict';
  const SCC = globalThis.SCC;
  const APP = 'https://titanfantasyfootball.com/app/';
  const S = {value: null, dump: null, showPills: true, showPanel: true, leagueId: null, index: null, facts: null, factsFor: null, open: true,
    trade: {give: [], get: []},   // the trade check's picks (Sleeper ids), for the league on screen
    proposal: null,               // a trade being proposed on Sleeper: {league, give, get, partner, text} (kept in storage)
    lineup: null, lineupFor: null, lineupBusy: false};   // Titan's lineup analysis for the league on screen (from the worker)

  const norm = s => String(s || '').toLowerCase().replace(/[.'’]/g, '').replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const pct = v => (v === null || v === undefined ? '' : (v > 0 ? '+' : '') + Math.round(v * 100) + '%');

  /* The name index for the league on screen: every valued row of its format (and the main format's), by full name
     and by "F. Last", with the row and the league's own call on him (buy, sell or keep, the claim's drop). */
  function buildIndex() {
    const V = S.value;
    if (!V) return null;
    const league = (V.leagues || []).find(L => L.id === S.leagueId) || null;
    const fmts = V.formats || {};
    const keys = [league && league.fmt, V.main].concat(Object.keys(fmts)).filter((k, i, a) => k && fmts[k] && a.indexOf(k) === i);
    const byName = new Map(), bySid = new Map();
    keys.forEach(k => (fmts[k].all || []).forEach(r => {
      if (bySid.has(r.s)) return;
      bySid.set(r.s, r);
      const full = norm(r.n), parts = full.split(' ');
      byName.set(full, r);
      if (parts.length > 1) byName.set(parts[0][0] + ' ' + parts.slice(1).join(' '), r);
    }));
    const calls = new Map();
    if (league) {
      ['buy', 'sell', 'add'].forEach(kind => (league[kind] || []).forEach(m => calls.set(norm(m.n), Object.assign({kind}, m))));
    }
    return {league, byName, bySid, calls};
  }

  // ------------------------------------------------------------- pills
  function pillFor(r, call) {
    const tags = [];
    if (call && call.kind === 'buy') tags.push('buy low');
    else if (call && call.kind === 'sell') tags.push(call.k ? 'keep' : 'sell high');
    else if (call && call.kind === 'add') tags.push('claim');
    else if (r.buy) tags.push('buy'); else if (r.sell) tags.push(r.keep ? 'keep' : 'sell');
    if (r.rbk) tags.push(r.rbk);
    const cls = call && call.kind === 'buy' || (!call && r.buy) ? 't-buy' : call && call.kind === 'sell' ? (call.k ? 't-keep' : 't-sell') : (!call && r.sell) ? (r.keep ? 't-keep' : 't-sell') : '';
    const title = [`${r.n} (${r.p}${r.t ? ', ' + r.t : ''}): Titan ${r.p}${r.ur} by projection (${r.proj} a game), the market ${r.p}${r.mr}` + (r.vgap !== null && r.vgap !== undefined ? `, edge ${pct(r.vgap)}` : ''),
      call ? call.why : '', r.pb ? 'Late-Round: ' + r.pb : '', r.dg ? `Draft guide: ${r.dg.k} ${r.dg.c}/10` + (r.dg.a ? '' : ' (off the list)') + (r.dg.n ? ': ' + r.dg.n : '') : '']
      .filter(Boolean).join('\n');
    const el = document.createElement('span');
    el.className = 'titan-pill ' + cls;
    el.title = title;
    el.innerHTML = `<span class="t-edge">${esc(pct(r.vgap) || 'T')}</span>${tags.length ? `<span class="t-tag">${esc(tags.join(' · '))}</span>` : ''}`;
    // A pill on a player in a trade being proposed on Sleeper says which side he's on.
    const prop = S.proposal;
    if (prop && prop.league === S.leagueId) {
      if (prop.give.includes(r.s)) { el.classList.add('t-give'); el.innerHTML += '<span class="t-tag">→ give</span>'; }
      else if (prop.get.includes(r.s)) { el.classList.add('t-get'); el.innerHTML += '<span class="t-tag">← get</span>'; }
    }
    el.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); openCard(r, el); });
    return el;
  }

  // ------------------------------------------------------------- the player card
  let cardHost = null;
  const fmt1 = v => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1));
  const pctOf = v => (v === null || v === undefined ? '–' : Math.round(v * 100) + '%');
  const sgn = v => (v === null || v === undefined ? '–' : (v > 0 ? '+' : '') + fmt1(v));

  // A free agent's bid in this league: what he adds over the lowest-projected starter at his position, in the league's
  // budget (SCC.faabBid on the league's winning bids); null when he isn't free here or the league has no FAAB.
  function freeAgentBid(r) {
    const L = S.index && S.index.league, F = S.facts, LL = S.lineup && S.lineup.league;
    if (!L || !F || !F.faab || F.left === null || !SCC) return null;
    if (L.own && L.own[r.s] !== undefined) return null;   // rostered here
    let gain = null;
    if (LL) {
      const mine = LL.rows.filter(x => x.p && x.p.pos === r.p && x.p.proj !== null && x.p.proj !== undefined).map(x => x.p.proj);
      if (mine.length && r.proj !== null && r.proj !== undefined) gain = Math.round((r.proj - Math.min.apply(null, mine)) * 10) / 10;
    }
    const heat = F.trending.indexOf(r.s) >= 0 ? (F.trending.indexOf(r.s) < 10 ? 'hot' : 'warm') : 'cold';
    const o = {budget: F.budget, left: F.left, bids: F.bids, teams: F.teams, pos: r.p, heat};
    if (gain !== null) o.gain = gain;
    const b = SCC.faabBid(o);
    return b.bid ? {bid: b.bid, left: F.left, gain, why: [b.basis === 'league' ? 'from this league\'s winning bids' : 'a share of the budget'].concat(b.why || []).join('; ')} : null;
  }

  function cardHtml(r) {
    const L = S.index && S.index.league, call = S.index && S.index.calls.get(norm(r.n)), LL = S.lineup && S.lineup.league;
    const ownerIdx = L && L.own ? L.own[r.s] : undefined;
    const where = ownerIdx === undefined ? (L ? 'Free agent in this league' : '') : ownerIdx === 'me' ? 'On your roster' : `On ${(L.teams || [])[ownerIdx] || 'another team'}`;
    const inLineup = LL ? [].concat(LL.rows.map(x => x.p), LL.opt.map(x => x.p)).find(p => p && String(p.id) === String(r.s)) : null;
    const now = r.rt !== null && r.rt !== undefined;
    const rows = [];
    const line = (k, v) => { if (v !== null && v !== undefined && v !== '' && v !== '–') rows.push(`<tr><td>${esc(k)}</td><td>${v}</td></tr>`); };
    line('Projection', `${fmt1(r.proj)} a game${r.fp !== null && r.fp !== undefined ? ` · scoring ${fmt1(r.fp)} · over usage ${sgn(r.fpoe)}` : ''}`);
    line('Market', `${esc(r.p)}${r.mr} · Titan ${esc(r.p)}${r.ur}${r.vgap !== null && r.vgap !== undefined ? ` · edge ${esc(pct(r.vgap))}` : ''}${r.v ? ` · value ${r.v}` : ''}`);
    const usage = [r.snap !== null && r.snap !== undefined ? `snaps ${pctOf(r.snap)}` : '', r.tgt !== null && r.tgt !== undefined && r.p !== 'QB' ? `target share ${pctOf(r.tgt)}` : '',
      r.p !== 'QB' && (now || r.prt !== null) ? `routes ${pctOf(now ? r.rt : r.prt)}${now ? '' : ' (last year)'}` : '',
      (r.p === 'WR' || r.p === 'TE') && (r.tprr || r.ptprr) ? `${pctOf(now ? r.tprr : r.ptprr)} of routes targeted · ${fmt1(now ? r.yprr : r.pyprr)} yds a route${now ? '' : ' (last year)'}` : ''].filter(Boolean);
    line('Usage', esc(usage.join(' · ')));
    if (r.p === 'RB') line('Workload', esc(`${fmt1(r.car)} carries · ${fmt1(r.tg)} targets a game${r.opp ? ` · opportunity ${fmt1(r.opp)}` : ''}${r.rbk ? ` · ${r.rbk}` : ''}${r.gl ? ` · ${pctOf(r.gl)} of carries inside the 10` : ''}`));
    if (r.p === 'QB') line('Workload', esc(`${fmt1(r.rp)} rushing points a game${r.tdr !== null && r.tdr !== undefined ? ` · touchdown on ${(r.tdr * 100).toFixed(1)}% of attempts` : ''}`));
    if ((r.p === 'WR' || r.p === 'TE') && (r.ypt || r.ez)) line('Workload', esc(`${r.ypt ? `${fmt1(r.ypt)} yards a target` : ''}${r.ez ? `${r.ypt ? ' · ' : ''}${fmt1(r.ez)} end-zone targets a game` : ''}`));
    if (inLineup) line('This week', esc(`${rankLabel(inLineup)}${rankNote(inLineup) ? ' · ' + rankNote(inLineup) : ''}${inLineup.inj ? ' · ' + inLineup.inj : ''}${inLineup.onBye ? ' · on bye' : ''}${inLineup.proj !== null && inLineup.proj !== undefined ? ` · projects ${fmt1(inLineup.proj)}` : ''}`));
    if (call) line(call.kind === 'add' ? 'Claim' : call.kind === 'buy' ? 'Buy low' : call.k ? 'Keep' : 'Sell high', esc(call.why) + (call.d ? ` <b>Drop ${esc(call.d)}.</b>` : ''));
    else if (r.buy || r.sell) line(r.buy ? 'Buy low' : r.keep ? 'Keep' : 'Sell high', `${r.buy ? 'The market prices him below his projection' : r.keep ? 'Priced high, but a real role' : 'Priced above his projection'} (${esc(r.p)}${r.mr} against ${esc(r.p)}${r.ur}).`);
    const bid = freeAgentBid(r);
    if (bid) line('Bid', `<b>about $${bid.bid}</b> of $${bid.left} left${bid.gain !== null ? ` · ${bid.gain > 0 ? '+' : ''}${fmt1(bid.gain)} a game over your lowest starter at ${esc(r.p)}` : ''} <span class="x">(${esc(bid.why)})</span>`);
    if (r.pb) line('Late-Round', esc(r.pb));
    if (r.dg) line('Draft guide', esc(`${r.dg.k} ${r.dg.c}/10${r.dg.a ? '' : ' (off the list)'}${r.dg.n ? ': ' + r.dg.n : ''}${r.dg.w ? ' Watch: ' + r.dg.w + '.' : ''}`));
    const tradeBtn = L && ownerIdx !== undefined ? `<button type="button" class="tb" data-trade-side="${ownerIdx === 'me' ? 'give' : 'get'}" data-sid="${esc(r.s)}">${ownerIdx === 'me' ? 'Add to trade: you give' : 'Add to trade: you get'}</button>` : '';
    return `<div class="card"><div class="ch"><b>${esc(r.n)}</b> <span class="x">${esc(r.p)}${r.t ? ', ' + r.t : ''}${where ? ' · ' + esc(where) : ''}</span><button type="button" class="close" title="Close">×</button></div>
      <table>${rows.join('')}</table>
      <div class="cf">${tradeBtn}<a href="${APP}value" target="_blank" rel="noopener">Open in Titan</a></div></div>`;
  }

  function cardStyles() {
    return `:host { all: initial; }
      .card { position: fixed; z-index: 2147483001; width: 380px; max-width: calc(100vw - 24px); max-height: 70vh; overflow: auto; background: #fff; color: #1c2330; border: 1px solid #d9dee7;
        border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.2); font: 12px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 10px 12px; }
      .ch { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; } .ch b { font-size: 14px; } .ch .x { color: #6b7280; flex: 1; }
      .close { border: 0; background: none; font-size: 16px; cursor: pointer; color: #6b7280; }
      table { border-collapse: collapse; width: 100%; } td { padding: 3px 0; vertical-align: top; border-top: 1px solid #eef1f5; }
      td:first-child { width: 78px; color: #6b7280; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding-right: 8px; }
      .x { color: #6b7280; }
      .cf { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
      .cf a { color: #1f4fb8; } .tb { font: inherit; padding: 5px 9px; border-radius: 8px; border: 1px solid #c7d9ff; background: #eaf2ff; color: #1f4fb8; cursor: pointer; }`;
  }

  function openCard(r, anchor) {
    closeCard();
    cardHost = document.createElement('titan-card');
    cardHost.attachShadow({mode: 'open'});
    document.documentElement.appendChild(cardHost);
    cardHost.shadowRoot.innerHTML = `<style>${cardStyles()}</style>${cardHtml(r)}`;
    const card = cardHost.shadowRoot.querySelector('.card'), rect = anchor.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 392)), top = rect.bottom + 8 + 300 > window.innerHeight ? Math.max(12, rect.top - 8 - 300) : rect.bottom + 8;
    card.style.left = left + 'px'; card.style.top = top + 'px';
    cardHost.shadowRoot.querySelector('.close').addEventListener('click', closeCard);
    const tb = cardHost.shadowRoot.querySelector('.tb');
    if (tb) tb.addEventListener('click', () => { const side = tb.dataset.trade; if (!S.trade[tb.dataset.tradeSide].includes(tb.dataset.sid)) S.trade[tb.dataset.tradeSide].push(tb.dataset.sid); closeCard(); S.open = true; renderPanel(); });
    setTimeout(() => { document.addEventListener('mousedown', outsideCard, true); document.addEventListener('keydown', escCard, true); }, 0);
  }
  function outsideCard(e) { if (cardHost && !e.composedPath().includes(cardHost)) closeCard(); }
  function escCard(e) { if (e.key === 'Escape') closeCard(); }
  function closeCard() {
    if (cardHost) cardHost.remove();
    cardHost = null;
    document.removeEventListener('mousedown', outsideCard, true); document.removeEventListener('keydown', escCard, true);
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'TITLE', 'NOSCRIPT']);
  function tagNames(root) {
    if (!S.showPills || !S.index) return;
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const p = n.parentElement;
        if (!p || SKIP.has(p.tagName) || p.closest('.titan-pill, titan-panel')) return NodeFilter.FILTER_REJECT;
        const t = n.nodeValue;
        return t && t.length >= 5 && t.length <= 40 && /[A-Za-z]/.test(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    const hits = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const r = S.index.byName.get(norm(n.nodeValue));
      if (r) hits.push([n, r]);
    }
    hits.forEach(([n, r]) => {
      const p = n.parentElement;
      if (!p || p.dataset.titan === r.s) return;
      p.querySelectorAll(':scope > .titan-pill').forEach(x => x.remove());
      p.dataset.titan = r.s;
      p.insertBefore(pillFor(r, S.index.calls.get(norm(r.n))), n.nextSibling);
    });
  }
  function untag() { document.querySelectorAll('.titan-pill').forEach(x => x.remove()); document.querySelectorAll('[data-titan]').forEach(x => delete x.dataset.titan); }

  // ------------------------------------------------------------- the league panel
  let host = null;
  function panelStyles() {
    return `
      :host { all: initial; }
      .box { position: fixed; right: 16px; top: 72px; z-index: 2147483000; width: 360px; max-width: calc(100vw - 32px); max-height: min(70vh, 640px);
        display: flex; flex-direction: column; background: #fff; color: #1c2330; border: 1px solid #d9dee7; border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,.18); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
      .box.closed { width: auto; max-height: none; }
      .box.closed .body { display: none; }
      .head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #1f4fb8; color: #fff; cursor: pointer; user-select: none; }
      .head b { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .head .mark { width: 18px; height: 18px; border-radius: 5px; background: #fff; color: #1f4fb8; font-weight: 800; font-size: 12px; display: grid; place-items: center; }
      .head small { opacity: .85; }
      .body { overflow: auto; padding: 6px 12px 12px; }
      h4 { margin: 10px 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { padding: 6px 0; border-top: 1px solid #eef1f5; }
      li:first-child { border-top: 0; }
      li b { font-weight: 700; }
      li .x { color: #6b7280; }
      li p { margin: 2px 0 0; color: #374151; }
      .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      .tag.keep { background: #fff4e0; color: #b45309; } .tag.sell { background: #fdecec; color: #b91c1c; } .tag.buy { background: #e6f6ec; color: #15803d; } .tag.bid { background: #eaf2ff; color: #1f4fb8; text-transform: none; }
      .note { color: #6b7280; font-size: 12px; margin: 8px 0 0; }
      a { color: #1f4fb8; }
      .foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 12px; color: #6b7280; }
      details.trade { margin: 8px 0 4px; border: 1px solid #c7d9ff; background: #f5f8ff; border-radius: 10px; padding: 8px 10px; }
      details.trade summary { cursor: pointer; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #1f4fb8; font-weight: 700; }
      .side { margin-top: 8px; }
      .side label { display: block; font-size: 11px; color: #6b7280; margin-bottom: 3px; }
      .side input { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #d9dee7; border-radius: 8px; font: inherit; }
      .sugg { list-style: none; margin: 2px 0 0; padding: 0; border: 1px solid #d9dee7; border-radius: 8px; overflow: hidden; }
      .sugg:empty { display: none; }
      .sugg li { padding: 5px 8px; cursor: pointer; border-top: 0; }
      .sugg li:hover { background: #eaf2ff; }
      .picks { list-style: none; margin: 4px 0 0; padding: 0; }
      .picks li { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-top: 0; }
      .picks li button { border: 0; background: none; color: #b91c1c; cursor: pointer; font: inherit; }
      .totals { margin-top: 8px; padding: 8px; border-radius: 8px; background: #f3f4f6; font-size: 12px; }
      .totals b.win { color: #15803d; } .totals b.lose { color: #b91c1c; }
      .totals table { border-collapse: collapse; width: 100%; margin-top: 4px; }
      .totals td { padding: 2px 0; } .totals td.n { text-align: right; font-variant-numeric: tabular-nums; }
      a.send { display: inline-block; margin-bottom: 4px; padding: 6px 10px; border-radius: 8px; background: #1f4fb8; color: #fff; text-decoration: none; font-weight: 700; }
      .propose { display: inline-block; margin: 0 0 4px 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid #1f4fb8; background: #fff; color: #1f4fb8; font: inherit; font-weight: 700; cursor: pointer; }
      .prop { margin: 4px 0 8px; padding: 8px 10px; border-radius: 8px; background: #fff7e6; border: 1px solid #fcd9a0; font-size: 12px; }
      .prop .give { color: #b91c1c; font-weight: 700; } .prop .get { color: #15803d; font-weight: 700; }
      .prop button { font: inherit; font-size: 11px; margin-top: 4px; padding: 3px 8px; border-radius: 6px; border: 1px solid #d9dee7; background: #fff; cursor: pointer; }
      .match { margin: 6px 0 4px; padding: 8px 10px; border-radius: 10px; background: #f3f4f6; }
      .match .vs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; }
      .match .side b { display: block; font-size: 13px; } .match .side small { color: #6b7280; }
      .match .side.opp { text-align: right; } .match .num { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
      .match .pa { text-align: center; font-size: 11px; color: #6b7280; } .match .pa b { display: block; font-size: 16px; }
      .match .pa b.win { color: #15803d; } .match .pa b.lose { color: #b91c1c; }
      .close-calls li { border-top: 1px solid #eef1f5; padding: 5px 0; } .close-calls .rn { color: #9ca3af; font-size: 11px; }
      .lineup ol { list-style: none; margin: 4px 0 0; padding: 0; }
      .lineup li { display: grid; grid-template-columns: 52px 1fr auto; gap: 8px; padding: 3px 0; border-top: 1px solid #eef1f5; align-items: baseline; }
      .lineup li:first-child { border-top: 0; }
      .lineup .slot { font-size: 11px; font-weight: 700; color: #6b7280; }
      .lineup .rk { font-size: 11px; color: #6b7280; font-variant-numeric: tabular-nums; text-align: right; }
      .lineup .rk .rn { display: block; font-size: 10px; color: #9ca3af; white-space: nowrap; }
      .lineup li.change b { color: #15803d; }
      .lineup li.stop b { color: #b91c1c; }
      .lineup .v { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-left: 6px; }
      .lineup .v.ok { color: #15803d; } .lineup .v.bad { color: #b91c1c; } .lineup .v.warn { color: #b45309; }
      .lineup .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #6b7280; margin-top: 4px; }
      .lineup .meta button { border: 0; background: none; color: #1f4fb8; cursor: pointer; font: inherit; font-size: 11px; padding: 0; }
    `;
  }

  // ------------------------------------------------------------- the trade check
  /* What a player is worth to Titan: the market's value moved by the projection's edge (vgap is the gap as a share of
     the larger of the two, so the market's own curve gives the price at his projected rank). */
  const worth = r => (r.v === null || r.v === undefined ? null : r.vgap >= 0 ? r.v / (1 - Math.min(r.vgap, 0.95)) : r.v * (1 + r.vgap));
  const num1 = v => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1));
  const num0 = v => (v === null || v === undefined ? '–' : String(Math.round(v)));

  function tradeSide(side, label) {
    const rows = S.trade[side].map(sid => S.index.bySid.get(sid)).filter(Boolean);
    return `<div class="side" data-side="${side}"><label>${esc(label)}</label><input type="text" placeholder="Type a name…" autocomplete="off" data-side="${side}"><ul class="sugg"></ul>
      <ul class="picks">${rows.map(r => `<li><span><b>${esc(r.n)}</b> <span class="x">${esc(r.p)}${r.t ? ', ' + r.t : ''} · ${num0(r.v)} · ${num1(r.proj)} a game</span></span><button type="button" data-remove="${esc(r.s)}" data-side="${side}" title="Remove">×</button></li>`).join('')}</ul></div>`;
  }

  function tradeTotals() {
    const sum = (side, f) => S.trade[side].map(sid => S.index.bySid.get(sid)).filter(Boolean).reduce((a, r) => a + (f(r) || 0), 0);
    if (!S.trade.give.length && !S.trade.get.length) return '<p class="note">Pick the players you\'d give and get: each side\'s market value, what Titan says they\'re worth, and the points a game.</p>';
    const picked = S.trade.give.concat(S.trade.get).map(sid => S.index.bySid.get(sid)).filter(Boolean);
    if (picked.length && picked.every(r => r.v === null || r.v === undefined)) {
      return '<p class="note">This report was fetched before market values were added to it: open the extension\'s popup and press Refresh reports, then pick the players again.</p>';
    }
    const give = {v: sum('give', r => r.v), w: sum('give', worth), p: sum('give', r => r.proj)};
    const get = {v: sum('get', r => r.v), w: sum('get', worth), p: sum('get', r => r.proj)};
    const dv = get.w - give.w, base = Math.max(give.w, get.w) || 1, share = dv / base;
    const dp = get.p - give.p;
    let verdict;
    if (!S.trade.give.length || !S.trade.get.length) verdict = 'Add the other side to compare.';
    else if (Math.abs(share) < 0.08) verdict = `Even by Titan's worth (within ${Math.round(Math.abs(share) * 100)}%).` + (dp >= 1 ? ` You gain ${num1(dp)} points a game across the pieces.` : dp <= -1 ? ` You give up ${num1(-dp)} points a game across the pieces.` : '');
    else verdict = `<b class="${share > 0 ? 'win' : 'lose'}">${share > 0 ? 'You win' : 'You lose'} by ${Math.round(Math.abs(share) * 100)}% of Titan's worth</b>` + (dp >= 1 ? `, and gain ${num1(dp)} points a game.` : dp <= -1 ? `, but give up ${num1(-dp)} points a game across the pieces.` : '.');
    return `<div class="totals">${verdict}<table><tr><td></td><td class="n">Market</td><td class="n">Titan's worth</td><td class="n">Pts a game</td></tr>
      <tr><td>You give</td><td class="n">${num0(give.v)}</td><td class="n">${num0(give.w)}</td><td class="n">${num1(give.p)}</td></tr>
      <tr><td>You get</td><td class="n">${num0(get.v)}</td><td class="n">${num0(get.w)}</td><td class="n">${num1(get.p)}</td></tr></table>
      <p class="note">Points are each player's own projection, not your lineup's change: for that (and whether the other side would take it), open Titan's Trade tab.</p></div>`;
  }

  // The partner in a trade: the team holding the players you'd get (the report's own map and team names).
  function partnerOf(L, getIds) {
    if (!L || !L.own) return '';
    const idx = getIds.map(sid => L.own[sid]).find(i => i !== undefined && i !== 'me');
    return idx === undefined ? '' : (L.teams || [])[idx] || '';
  }

  /* Proposing on Sleeper, assisted: Titan never drives Sleeper's trade screen (its markup is undocumented and
     automating it sits near Sleeper's terms), so this copies the pieces, names the partner, and marks each player's
     pill "give" or "get" on Sleeper's pages until the proposal is cleared. */
  function proposalHtml() {
    const P = S.proposal;
    if (!P || P.league !== S.leagueId) return '';
    return `<div class="prop"><b>Proposing on Sleeper</b>${P.partner ? ` with <b>${esc(P.partner)}</b>` : ''}: open the trade screen, pick ${P.partner ? esc(P.partner) : 'the team'}, then add
      <span class="give">you give ${esc(P.giveNames.join(', '))}</span> and <span class="get">you get ${esc(P.getNames.join(', '))}</span>. Their pills on this page are marked give and get.
      <button type="button" data-proposal-copy>Copy again</button> <button type="button" data-proposal-clear>Done</button></div>`;
  }

  function tradeSection() {
    if (!S.index || !S.index.bySid.size) return '';
    // Sending the picks to Titan's Trade tab: /app/trade?trade=<league>:<give ids>:<get ids>; Titan finds the partner from the get side.
    const L = S.index.league, both = S.trade.give.length && S.trade.get.length;
    const link = L && both ? `${APP}trade?trade=${encodeURIComponent(L.id)}:${S.trade.give.join(',')}:${S.trade.get.join(',')}` : `${APP}trade`;
    return `<details class="trade"${S.trade.give.length || S.trade.get.length || (S.proposal && S.proposal.league === S.leagueId) ? ' open' : ''}><summary>Trade check</summary>${proposalHtml()}${tradeSide('give', 'You give')}${tradeSide('get', 'You get')}${tradeTotals()}
      <p class="note">${both ? `<a class="send" href="${link}" target="_blank" rel="noopener">Send this trade to Titan's trade analyzer</a> for the full analysis (your lineup's points, what they'd accept).
          <button type="button" class="propose" data-propose>Propose on Sleeper</button>`
        : `<a href="${link}" target="_blank" rel="noopener">Open Titan's Trade tab</a> for the full analysis (lineup points, partners, what they'd accept). Pick both sides here to send them across.`}</p></details>`;
  }

  function propose() {
    const L = S.index && S.index.league;
    if (!L || !S.trade.give.length || !S.trade.get.length) return;
    const names = ids => ids.map(sid => (S.index.bySid.get(sid) || {}).n || sid);
    const P = {league: L.id, give: S.trade.give.slice(), get: S.trade.get.slice(), giveNames: names(S.trade.give), getNames: names(S.trade.get), partner: partnerOf(L, S.trade.get)};
    P.text = `Trade${P.partner ? ' with ' + P.partner : ''}: I give ${P.giveNames.join(', ')}; I get ${P.getNames.join(', ')}.`;
    S.proposal = P;
    chrome.storage.local.set({proposal: P});
    copyText(P.text);
    untag(); tagNames(); renderPanel();
  }
  function copyText(t) { try { navigator.clipboard.writeText(t).catch(() => {}); } catch (e) { /* no clipboard here */ } }

  // ------------------------------------------------------------- the lineup (Titan's engine, run by the worker)
  const SLOT_LABEL = {QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', SUPER_FLEX: 'SFLEX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', K: 'K', DEF: 'DEF', DST: 'DEF', IDP_FLEX: 'IDP', DL: 'DL', LB: 'LB', DB: 'DB'};
  // Titan's own label (a rank past the overall list's end is kept as a 1000+ sentinel: RB1021 is RB21 at his position).
  const rankLabel = p => (!p ? '' : SCC ? SCC.rankLabel(p.pos, p.rank) : p.rank === null || p.rank === undefined ? 'unranked' : `${p.pos}${p.rank}`);
  // The note that makes a close call readable: overall rank, rank at the position, tier.
  const rankNote = p => (p && SCC && p.rank !== null && p.rank !== undefined ? SCC.rankNote(p) : '');
  const verdictClass = v => (v === 'OK' || v === 'LOCKED' ? 'ok' : v === 'UNRANKED' ? 'warn' : 'bad');

  function lineupSection() {
    const R = S.lineup;
    if (!S.value) return '';
    let inner;
    if (S.lineupBusy && !R) inner = '<p class="note">Reading your rosters and rankings…</p>';
    else if (!R) inner = '<p class="note">No lineup analysis yet: open the extension\'s popup and press Refresh reports.</p>';
    else if (R.error && !R.league) inner = `<p class="note">Titan couldn't build the lineup: ${esc(R.error)}</p>`;
    else if (!R.league) inner = '<p class="note">This league isn\'t among the Sleeper leagues linked to your Titan account.</p>';
    else {
      const L = R.league;
      // The recommended lineup: the optimal one when there are changes to make, else the lineup as it stands (as Titan's Lineups tab).
      const rec = L.moves.length ? L.opt : L.rows.map(r => ({slot: r.slot, p: r.p}));
      const current = {}; L.rows.forEach(r => { if (r.p) current[r.p.id] = r; });
      const rowsBySlot = {}; L.rows.forEach(r => { if (r.p) rowsBySlot[r.p.id] = r.verdict; });
      const list = rec.map(o => {
        const p = o.p, v = p ? rowsBySlot[p.id] : null;
        const isChange = p && !current[p.id];
        return `<li class="${isChange ? 'change' : v && verdictClass(v) === 'bad' ? 'stop' : ''}"><span class="slot">${esc(SLOT_LABEL[o.slot] || o.slot)}</span>
          <span><b>${p ? esc(p.name) : 'Empty'}</b>${p && p.inj ? ` <span class="v warn">${esc(p.inj)}</span>` : ''}${p && p.onBye ? ' <span class="v bad">bye</span>' : ''}${isChange ? ' <span class="v ok">start</span>' : ''}</span>
          <span class="rk">${p ? esc(rankLabel(p)) : ''}${p && rankNote(p) ? `<small class="rn">${esc(rankNote(p))}</small>` : ''}</span></li>`;
      }).join('');
      const changes = L.moves.map(m => `<li><b>${m.from ? `Move ${esc(m.inn.name)} to ${esc(SLOT_LABEL[m.slot] || m.slot)}` : `Start ${esc(m.inn.name)}${m.inn.rank !== null && m.inn.rank !== undefined ? ` (${esc(rankLabel(m.inn))})` : ''}${m.out ? ` over ${esc(m.out.name)}` : ''}`}</b></li>`).join('');
      const hurt = L.hurt.filter(p => !L.moves.some(m => m.out && m.out.id === p.id)).map(p => `<li>${esc(p.name)} is ${esc(String(p.inj).toLowerCase())} and in your lineup.</li>`).join('');
      const wire = L.wire.map(w => `<li><b>${esc(w.pos)}</b>: ${w.list.map(f => `${esc(f.name)} (${esc(rankLabel(f))})`).join(', ')}${w.cur ? ` <span class="x">· over ${esc(w.cur.name)} (${esc(rankLabel(w.cur))})</span>` : w.anyUnranked ? ' <span class="x">· a starter there is unranked</span>' : ''}</li>`).join('');
      inner = `<ol>${list}</ol>`
        + (changes ? `<h4>Changes your rankings want</h4><ul>${changes}</ul>` : `<p class="note">${L.rows.length ? 'This lineup already matches your rankings.' : ''}</p>`)
        + (hurt ? `<h4>Hurt starters</h4><ul>${hurt}</ul>` : '')
        + (wire ? `<h4>Waiver upgrades (free agents ranked above a starter)</h4><ul>${wire}</ul>` : '')
        + (!R.rankedCount ? '<p class="note">No weekly rankings imported in Titan, so this is Titan\'s default order from projections. Import yours on Rankings, Weekly import.</p>' : '');
    }
    const at = R && R.at ? new Date(R.at).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : '';
    return `<div class="lineup"><h4>Lineup${R && R.week ? ` · week ${esc(R.week)}` : ''}</h4>${inner}
      <div class="meta"><span>${at ? `Titan's engine, as of ${esc(at)}` : ''}</span><button type="button" data-lineup-refresh${S.lineupBusy ? ' disabled' : ''}>${S.lineupBusy ? 'Refreshing…' : 'Refresh'}</button></div></div>`;
  }

  /* This week's matchup (from the lineup analysis): both sides' projected finals, the chance to win, and the close
     calls in the lineup with both players' projections and rank notes. */
  function matchupSection() {
    const R = S.lineup, L = R && R.league;
    if (!L) return '';
    const M = L.matchup;
    let inner = '';
    if (M && !M.error) {
      const started = M.me.pts > 0 || M.opp.pts > 0;
      inner = `<div class="vs"><div class="side"><b>${esc(M.me.name)}</b><small>you${M.me.record ? ' · ' + esc(M.me.record) : ''}</small><span class="num">${fmt1(M.me.final)}</span><small>${started ? `${fmt1(M.me.pts)} so far · ` : ''}projects ${fmt1(M.me.proj)}</small></div>
        <div class="pa"><b class="${M.pa >= 60 ? 'win' : M.pa <= 40 ? 'lose' : ''}">${M.pa}%</b>to win</div>
        <div class="side opp"><b>${esc(M.opp.name)}</b><small>${M.opp.record ? esc(M.opp.record) + ' · ' : ''}opponent</small><span class="num">${fmt1(M.opp.final)}</span><small>${started ? `${fmt1(M.opp.pts)} so far · ` : ''}projects ${fmt1(M.opp.proj)}</small></div></div>`;
    } else inner = `<p class="note">${M && M.error ? esc(M.error) : 'No matchup this week (a bye, or the week has not been set up).'}</p>`;
    const calls = (L.close || []).map(c => {
      const s = c.starter, b = c.bench, lean = M && !M.error ? (M.pa >= 60 ? 'You\'re the favorite: the safer, higher-floor start is the play.' : M.pa <= 40 ? 'You\'re the underdog: the higher ceiling gives the better shot.' : '') : '';
      return `<li><b>${esc(s.name)}</b> over <b>${esc(b.name)}</b> is close: ${esc(rankLabel(s))} vs ${esc(rankLabel(b))}${s.proj !== null && s.proj !== undefined && b.proj !== null && b.proj !== undefined ? ` · projects ${fmt1(s.proj)} vs ${fmt1(b.proj)}` : ''}
        <div class="rn">${esc(rankNote(s) || '')}${rankNote(s) && rankNote(b) ? ' | ' : ''}${esc(rankNote(b) || '')}</div>${lean ? `<div class="rn">${esc(lean)}</div>` : ''}</li>`;
    }).join('');
    return `<div class="match"><h4 style="margin-top:0">Matchup${R.week ? ` · week ${esc(R.week)}` : ''}</h4>${inner}${calls ? `<h4>Close calls</h4><ul class="close-calls">${calls}</ul>` : ''}</div>`;
  }

  function loadLineup(force) {
    if (!S.leagueId || !S.value) return;
    if (!force && S.lineupFor === S.leagueId && S.lineup) return;
    S.lineupFor = S.leagueId; S.lineupBusy = true;
    if (force) S.lineup = null;
    renderPanel();
    chrome.runtime.sendMessage({type: 'lineup', id: S.leagueId, force: !!force}, r => {
      S.lineupBusy = false;
      S.lineup = chrome.runtime.lastError ? {error: chrome.runtime.lastError.message} : (r || {error: 'no answer'});
      renderPanel();
    });
  }

  function wireTrade(root) {
    const rb = root.querySelector('[data-lineup-refresh]');
    if (rb) rb.addEventListener('click', () => loadLineup(true));
    const pb = root.querySelector('[data-propose]');
    if (pb) pb.addEventListener('click', propose);
    const pc = root.querySelector('[data-proposal-copy]');
    if (pc) pc.addEventListener('click', () => S.proposal && copyText(S.proposal.text));
    const pd = root.querySelector('[data-proposal-clear]');
    if (pd) pd.addEventListener('click', () => { S.proposal = null; chrome.storage.local.remove('proposal'); untag(); tagNames(); renderPanel(); });
    root.querySelectorAll('.side input').forEach(input => {
      const sugg = input.parentElement.querySelector('.sugg'), side = input.dataset.side;
      input.addEventListener('input', () => {
        const q = norm(input.value);
        sugg.innerHTML = '';
        if (q.length < 2) return;
        const taken = new Set(S.trade.give.concat(S.trade.get));
        const hits = [];
        S.index.bySid.forEach(r => { if (!taken.has(r.s) && norm(r.n).includes(q)) hits.push(r); });
        hits.sort((a, b) => (b.v || 0) - (a.v || 0)).slice(0, 8).forEach(r => {
          const li = document.createElement('li');
          li.textContent = `${r.n} · ${r.p}${r.t ? ', ' + r.t : ''}`;
          li.addEventListener('click', () => { input.focus({preventScroll: true}); S.trade[side].push(r.s); renderPanel(); });
          sugg.appendChild(li);
        });
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = sugg.querySelector('li'); if (first) first.click(); } });
    });
    root.querySelectorAll('button[data-remove]').forEach(b => b.addEventListener('click', () => {
      const side = b.dataset.side; S.trade[side] = S.trade[side].filter(s => s !== b.dataset.remove); renderPanel();
    }));
  }

  function bidLine(m, r) {
    const F = S.facts;
    if (!F || !F.faab || !SCC || F.left === null) return '';
    const o = {budget: F.budget, left: F.left, bids: F.bids, teams: F.teams, pos: r && r.p,
      heat: r && F.trending.indexOf(r.s) >= 0 ? (F.trending.indexOf(r.s) < 10 ? 'hot' : 'warm') : 'cold'};
    // What he adds over the starter he'd replace, from the call's own words.
    let g = /(\d+(?:\.\d+)?) points a game by his projection; he'd start over .*?\((\d+(?:\.\d+)?)\)/.exec(m.why);
    if (g) o.gain = Math.round((Number(g[1]) - Number(g[2])) * 10) / 10;
    else if ((g = /he'd top .*?\((\d+(?:\.\d+)?)\) with (\d+(?:\.\d+)?)/.exec(m.why))) o.gain = Math.round((Number(g[2]) - Number(g[1])) * 10) / 10;
    const b = SCC.faabBid(o);
    if (!b.bid) return '';
    const why = [b.basis === 'league' ? 'from this league\'s winning bids' : 'a share of the budget'].concat(b.why || []).join('; ');
    return ` <span class="tag bid" title="${esc(why)}">bid about $${b.bid} of $${F.left} left</span>`;
  }

  function section(title, items, kind) {
    if (!items || !items.length) return '';
    return `<h4>${esc(title)}</h4><ul>${items.map(m => {
      const r = S.index && S.index.byName.get(norm(m.n));
      const tag = kind === 'sell' && 'k' in m ? `<span class="tag ${m.k ? 'keep' : 'sell'}">${m.k ? 'keep' : 'sell'}</span>` : kind === 'buy' ? '<span class="tag buy">buy</span>' : '';
      const drop = m.d ? ` <span class="x">· drop ${esc(m.d)}</span>` : '';
      return `<li><b>${esc(m.n)}</b>${m.x ? ` <span class="x">${esc(m.x)}</span>` : ''}${tag}${drop}${kind === 'add' ? bidLine(m, r) : ''}<p>${esc(m.why || '')}</p></li>`;
    }).join('')}</ul>`;
  }

  function renderPanel() {
    if (!S.showPanel || !S.leagueId) { if (host) host.remove(); host = null; return; }
    if (!host) {
      host = document.createElement('titan-panel');
      host.attachShadow({mode: 'open'});
      document.documentElement.appendChild(host);
    }
    const V = S.value, D = S.dump;
    const L = S.index && S.index.league, DL = D && (D.leagues || []).find(x => x.id === S.leagueId);
    let body;
    if (!V) body = `<p class="note">Not connected to Titan yet. Open the extension's popup and choose Connect to Titan.</p>`;
    else if (!L && !DL) body = `<p class="note">Titan's reports don't cover this league (they cover your Sleeper leagues each Tuesday).</p>`;
    else body = lineupSection() + matchupSection() + tradeSection() + section('Start ideas (data dump)', DL && DL.start, 'start') + section('Claims', (L && L.add) || [], 'add') + section('Pickups (data dump)', (DL && DL.add) || [], 'add')
      + section('Buy low', (L && L.buy) || [], 'buy') + section('Sell high or keep', (L && L.sell) || [], 'sell') + section('Watch', (DL && DL.watch) || [], 'watch')
      + (L && L.need ? `<p class="note">${esc(L.need)}</p>` : '')
      + `<div class="foot"><span>Week ${esc(V.week)}${V.through ? ' · ' + esc(V.through) : ''}</span><span>In Titan: ${
        [['lineups', 'Lineups'], ['waivers', 'Waivers'], ['value', 'Value']].map(([t, n]) => `<a href="${APP}${t}?league=${encodeURIComponent(S.leagueId)}" target="_blank" rel="noopener">${n}</a>`).join(' · ')}</span></div>`;
    const name = (L && L.name) || (DL && DL.name) || 'this league';
    // A re-render keeps the panel where it was scrolled and, for the trade check, which box was being typed in.
    const prevBody = host.shadowRoot.querySelector('.body'), scrollTop = prevBody ? prevBody.scrollTop : 0;
    const active = host.shadowRoot.activeElement, focusSide = active && active.matches && active.matches('.side input') ? active.dataset.side : null;
    host.shadowRoot.innerHTML = `<style>${panelStyles()}</style><div class="box${S.open ? '' : ' closed'}">
      <div class="head" id="head"><span class="mark">T</span><b>Titan · ${esc(name)}</b><small>${S.open ? '▾' : '▴'}</small></div><div class="body">${body}</div></div>`;
    const newBody = host.shadowRoot.querySelector('.body');
    if (newBody) newBody.scrollTop = scrollTop;
    if (focusSide) { const i = host.shadowRoot.querySelector(`.side input[data-side="${focusSide}"]`); if (i) i.focus({preventScroll: true}); }
    host.shadowRoot.getElementById('head').addEventListener('click', () => { S.open = !S.open; chrome.storage.local.set({panelOpen: S.open}); renderPanel(); });
    wireTrade(host.shadowRoot);
  }

  // ------------------------------------------------------------- wiring
  async function loadFacts() {
    const L = S.index && S.index.league;
    if (!L || S.factsFor === L.id) return;
    S.factsFor = L.id; S.facts = null;
    const mine = Object.keys(L.own || {}).filter(sid => L.own[sid] === 'me');
    chrome.runtime.sendMessage({type: 'league', id: L.id, week: S.value && S.value.week, mine}, f => {
      if (chrome.runtime.lastError || !f || f.error) return;
      S.facts = f;
      renderPanel();
    });
  }

  function refreshAll() {
    S.index = buildIndex();
    untag();
    tagNames();
    renderPanel();
    loadFacts();
    loadLineup(false);
  }

  function watchUrl() {
    let last = '';
    const check = () => {
      const m = /\/leagues\/(\d+)/.exec(location.pathname);
      const id = m ? m[1] : null;
      if (location.href !== last) { last = location.href; if (id !== S.leagueId) { S.leagueId = id; S.trade = {give: [], get: []}; S.lineup = null; S.lineupFor = null; refreshAll(); } else tagNames(); }
    };
    check();
    setInterval(check, 800);
  }

  let pending = null;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; tagNames(); }, 350);
  });

  chrome.storage.local.get({value: null, dump: null, showPills: true, showPanel: true, panelOpen: true, proposal: null}, o => {
    S.value = o.value; S.dump = o.dump; S.showPills = o.showPills; S.showPanel = o.showPanel; S.open = o.panelOpen; S.proposal = o.proposal;
    watchUrl();
    observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.value) S.value = ch.value.newValue;
    if (ch.dump) S.dump = ch.dump.newValue;
    if (ch.showPills) { S.showPills = ch.showPills.newValue; if (!S.showPills) untag(); }
    if (ch.showPanel) S.showPanel = ch.showPanel.newValue;
    if (ch.analysis) { S.lineupFor = null; S.lineup = null; }
    if (ch.proposal) S.proposal = ch.proposal.newValue || null;
    if (ch.value || ch.dump || ch.showPills || ch.showPanel || ch.analysis) { S.factsFor = null; refreshAll(); }
  });
})();
