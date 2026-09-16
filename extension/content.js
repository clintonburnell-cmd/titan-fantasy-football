// Titan for Sleeper, on Sleeper's pages: a pill after each player name the reports know (his edge on the market, the
// buy, sell or keep call, his archetype, the Late-Round note on hover), and a panel on league pages with Titan's
// calls for that league (start ideas, claims with a bid and a drop, buy-lows, sell-highs, the watch list). Reads the
// reports the service worker cached in chrome.storage.local; asks it only for a league's waiver facts (the bids).
(function () {
  'use strict';
  const SCC = globalThis.SCC;
  const APP = 'https://titanfantasyfootball.com/app/';
  const S = {value: null, dump: null, showPills: true, showPanel: true, leagueId: null, index: null, facts: null, factsFor: null, open: true};

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
    el.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); window.open(APP + 'value', '_blank', 'noopener'); });
    return el;
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
      .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 360px; max-width: calc(100vw - 32px); max-height: min(70vh, 640px);
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
    `;
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
    else body = section('Start', DL && DL.start, 'start') + section('Claims', (L && L.add) || [], 'add') + section('Pickups (data dump)', (DL && DL.add) || [], 'add')
      + section('Buy low', (L && L.buy) || [], 'buy') + section('Sell high or keep', (L && L.sell) || [], 'sell') + section('Watch', (DL && DL.watch) || [], 'watch')
      + (L && L.need ? `<p class="note">${esc(L.need)}</p>` : '')
      + `<div class="foot"><span>Week ${esc(V.week)}${V.through ? ' · ' + esc(V.through) : ''}</span><a href="${APP}value" target="_blank" rel="noopener">Open in Titan</a></div>`;
    const name = (L && L.name) || (DL && DL.name) || 'this league';
    host.shadowRoot.innerHTML = `<style>${panelStyles()}</style><div class="box${S.open ? '' : ' closed'}">
      <div class="head" id="head"><span class="mark">T</span><b>Titan · ${esc(name)}</b><small>${S.open ? '▾' : '▴'}</small></div><div class="body">${body}</div></div>`;
    host.shadowRoot.getElementById('head').addEventListener('click', () => { S.open = !S.open; chrome.storage.local.set({panelOpen: S.open}); renderPanel(); });
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
  }

  function watchUrl() {
    let last = '';
    const check = () => {
      const m = /\/leagues\/(\d+)/.exec(location.pathname);
      const id = m ? m[1] : null;
      if (location.href !== last) { last = location.href; if (id !== S.leagueId) { S.leagueId = id; refreshAll(); } else tagNames(); }
    };
    check();
    setInterval(check, 800);
  }

  let pending = null;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; tagNames(); }, 350);
  });

  chrome.storage.local.get({value: null, dump: null, showPills: true, showPanel: true, panelOpen: true}, o => {
    S.value = o.value; S.dump = o.dump; S.showPills = o.showPills; S.showPanel = o.showPanel; S.open = o.panelOpen;
    watchUrl();
    observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.value) S.value = ch.value.newValue;
    if (ch.dump) S.dump = ch.dump.newValue;
    if (ch.showPills) { S.showPills = ch.showPills.newValue; if (!S.showPills) untag(); }
    if (ch.showPanel) S.showPanel = ch.showPanel.newValue;
    if (ch.value || ch.dump || ch.showPills || ch.showPanel) { S.factsFor = null; refreshAll(); }
  });
})();
