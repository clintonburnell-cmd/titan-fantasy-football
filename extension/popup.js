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
  const v = s.value, d = s.dump;
  report.innerHTML = (v ? `<span class="ok">Value report</span> week ${v.week}, ${v.through || ''} (posted ${when(v.at)}); ${v.leagues} leagues.` : '<span class="bad">No Value report yet</span> (your PC posts one each Tuesday).')
    + '<br>' + (d ? `<span class="ok">Data dump</span> week ${d.week} (posted ${when(d.at)}).` : '<span class="muted">No Data dump yet.</span>')
    + (s.fetched ? `<br>Fetched ${when(s.fetched)}.` : '');
}

chrome.storage.local.get({showPills: true, showPanel: true}, o => {
  $('pills').checked = o.showPills;
  $('panel').checked = o.showPanel;
});
$('pills').onchange = e => chrome.storage.local.set({showPills: e.target.checked});
$('panel').onchange = e => chrome.storage.local.set({showPanel: e.target.checked});
render();
