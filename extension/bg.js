// Titan for Sleeper, the service worker: holds the extension's own Firebase session (handed over from Titan's site by
// ext/connect.html), reads the owner's reports (Firestore lab/value-latest and lab/dump-latest, owner-only by the
// rules) over REST into chrome.storage.local for the content script, and fetches a league's waiver-budget facts from
// Sleeper's public API for the bids. Nothing here writes to Sleeper.
import {initializeApp, getAuth, signInWithCredential, signOut, onAuthStateChanged, GoogleAuthProvider} from './dist/firebase.js';

const SITE = 'https://titanfantasyfootball.com';
const PROJECT = 'titan-fantasy-football';
const SLEEPER = 'https://api.sleeper.app/v1';
const REFRESH_HOURS = 6;
// Web app identifiers from the Firebase console: public by design (the rules decide who reads what).
const CONFIG = {
  apiKey: 'AIzaSyDjOaXVvwa9JxSjrLe3Ihnmlbd0Te4jS4Q',
  authDomain: 'titan-fantasy-football.firebaseapp.com',
  projectId: PROJECT,
  appId: '1:544453683345:web:567b48f38a839e321b7730'
};

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const state = {busy: false, error: null};
const ready = new Promise(resolve => { const off = onAuthStateChanged(auth, () => { off(); resolve(); }); });

async function currentUser() { await ready; return auth.currentUser; }

async function labDoc(id, user) {
  const token = await user.getIdToken();
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/lab/${id}`,
    {headers: {Authorization: 'Bearer ' + token}});
  if (res.status === 404) return null;
  if (res.status === 403) throw new Error('this account is not Titan\'s owner');
  if (!res.ok) throw new Error(`Titan's database answered ${res.status}`);
  const d = await res.json();
  const f = d.fields || {};
  return f.json && f.json.stringValue ? JSON.parse(f.json.stringValue) : null;
}

async function refresh() {
  const user = await currentUser();
  if (!user || state.busy) return;
  state.busy = true; state.error = null;
  try {
    const [value, dump] = await Promise.all([labDoc('value-latest', user), labDoc('dump-latest', user)]);
    await chrome.storage.local.set({value, dump, fetched: Date.now()});
  } catch (e) {
    state.error = e && e.message ? e.message : String(e);
  }
  state.busy = false;
}

async function status() {
  const user = await currentUser();
  const o = await chrome.storage.local.get(['value', 'dump', 'fetched']);
  const v = o.value, d = o.dump;
  return {
    user: user ? {email: user.email, uid: user.uid} : null, busy: state.busy, error: state.error, fetched: o.fetched || 0,
    value: v ? {week: v.week, through: v.through, at: v.at, leagues: (v.leagues || []).length} : null,
    dump: d ? {week: d.week, at: d.at} : null
  };
}

/* A league's waiver facts for the bids (SCC.faabBid in the content script): the budget, what's left of it for the
   owner's team, the league's winning bids this season, and Sleeper's trending adds (how hot a pickup is). `mine` is
   any Sleeper id on the owner's roster there (the report's own map says which are his). */
async function leagueFacts(id, week, mine) {
  const get = async p => { const r = await fetch(SLEEPER + p); return r.ok ? r.json() : null; };
  const lg = await get(`/league/${id}`);
  if (!lg) return null;
  const s = lg.settings || {};
  const out = {faab: s.waiver_type === 2 && s.waiver_budget > 0, budget: s.waiver_budget || 0, left: null, bids: [], teams: 0, trending: []};
  const rosters = await get(`/league/${id}/rosters`) || [];
  out.teams = rosters.length;
  const my = rosters.find(r => (r.players || []).some(p => mine.includes(String(p))));
  if (my) out.left = Math.max(0, out.budget - (((my.settings || {}).waiver_budget_used) || 0));
  if (out.faab) {
    const weeks = []; for (let w = 1; w <= Math.min(18, week || 1); w++) weeks.push(w);
    const all = await Promise.all(weeks.map(w => get(`/league/${id}/transactions/${w}`)));
    all.forEach(list => (list || []).forEach(t => {
      if (t.type === 'waiver' && t.status === 'complete' && t.settings && t.settings.waiver_bid > 0) out.bids.push(t.settings.waiver_bid);
    }));
  }
  out.trending = ((await get('/players/nfl/trending/add?lookback_hours=24&limit=25')) || []).map(t => String(t.player_id));
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'status') return status();
    if (msg.type === 'refresh') { await refresh(); return status(); }
    if (msg.type === 'connect') { await chrome.tabs.create({url: `${SITE}/ext/connect.html?ext=${chrome.runtime.id}`}); return {ok: true}; }
    if (msg.type === 'signOut') { await signOut(auth); await chrome.storage.local.remove(['value', 'dump', 'fetched']); return status(); }
    if (msg.type === 'league') return leagueFacts(String(msg.id), msg.week, msg.mine || []);
    return {error: 'unknown message'};
  })().then(sendResponse, e => sendResponse({error: e && e.message ? e.message : String(e)}));
  return true;
});

// The credential from Titan's connect page (externally_connectable lists the site). Google's ID token becomes the
// extension's own Firebase sign-in; the page never sees the extension's session.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!sender.url || !sender.url.startsWith(SITE + '/')) return;
  if (!msg || msg.type !== 'titan-credential' || !msg.idToken) { sendResponse({ok: false, error: 'no credential'}); return; }
  signInWithCredential(auth, GoogleAuthProvider.credential(msg.idToken, msg.accessToken || undefined))
    .then(async r => { await refresh(); sendResponse({ok: true, email: r.user.email, error: state.error}); })
    .catch(e => sendResponse({ok: false, error: e && e.message ? e.message : String(e)}));
  return true;
});

chrome.alarms.create('titan-refresh', {periodInMinutes: REFRESH_HOURS * 60});
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'titan-refresh') refresh(); });
chrome.runtime.onStartup.addListener(async () => {
  const o = await chrome.storage.local.get('fetched');
  if (!o.fetched || Date.now() - o.fetched > REFRESH_HOURS * 3600e3) refresh();
});
