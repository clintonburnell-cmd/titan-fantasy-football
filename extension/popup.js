// The popup: connect the extension to Titan (a Google sign-in on Titan's own site hands the credential back),
// refresh the reports, sign out, and two switches the content script reads from chrome.storage.
const $ = id => document.getElementById(id);
const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, res));

function when(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

async function render() {
  const s = await send({type: 'status'}) || {};
  const status = $('status'), actions = $('actions'), report = $('report');
  actions.innerHTML = '';
  if (!s.user) {
    status.innerHTML = 'Not connected to Titan.';
    const b = document.createElement('button');
    b.className = 'primary'; b.textContent = 'Connect to Titan';
    b.onclick = () => send({type: 'connect'});
    actions.appendChild(b);
    report.textContent = 'Connecting opens Titan\'s site, where you sign in with Google once; the extension keeps its own session after that.';
    return;
  }
  status.innerHTML = `Connected as <b>${s.user.email || s.user.uid}</b>` + (s.error ? ` <span class="bad">· ${s.error}</span>` : '');
  const r = document.createElement('button');
  r.textContent = s.busy ? 'Refreshing…' : 'Refresh reports'; r.disabled = !!s.busy;
  r.onclick = async () => { r.disabled = true; r.textContent = 'Refreshing…'; await send({type: 'refresh'}); render(); };
  const o = document.createElement('button');
  o.textContent = 'Sign out';
  o.onclick = async () => { await send({type: 'signOut'}); render(); };
  actions.append(r, o);
  const v = s.value, d = s.dump, l = s.lineup;
  const esc = t => String(t).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const todo = l && l.todo && l.todo.length
    ? `<br><span class="bad">Lineups to fix (${l.todo.reduce((a, x) => a + x.changes + x.hurt, 0)}):</span> ` + l.todo.map(x =>
      `<a href="https://sleeper.com/leagues/${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${esc(x.name)}</a> (${[x.changes ? x.changes + ' change' + (x.changes === 1 ? '' : 's') : '', x.hurt ? x.hurt + ' hurt' : ''].filter(Boolean).join(', ')})`).join(', ')
    : l ? '<br><span class="ok">Every lineup matches your rankings.</span>' : '';
  report.innerHTML = (v ? `<span class="ok">Value report</span> week ${v.week}, ${v.through || ''} (posted ${when(v.at)}); ${v.leagues} leagues.` : '<span class="bad">No Value report yet</span> (your PC posts one each Tuesday).')
    + '<br>' + (d ? `<span class="ok">Data dump</span> week ${d.week} (posted ${when(d.at)}).` : '<span class="muted">No Data dump yet.</span>')
    + (l ? `<br><span class="ok">Lineups</span> week ${l.week}, Titan's engine as of ${when(l.at)}${l.ranked ? '' : ' (no weekly rankings imported: default order)'}.` : s.lineupBusy ? '<br>Reading your lineups…' : s.lineupError ? `<br><span class="bad">Lineups: ${esc(s.lineupError)}</span>` : '')
    + todo + (s.fetched ? `<br>Fetched ${when(s.fetched)}.` : '');
}

chrome.storage.local.get({showPills: true, showPanel: true}, o => {
  $('pills').checked = o.showPills;
  $('panel').checked = o.showPanel;
});
$('pills').onchange = e => chrome.storage.local.set({showPills: e.target.checked});
$('panel').onchange = e => chrome.storage.local.set({showPanel: e.target.checked});
render();
