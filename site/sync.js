/* Titan Fantasy Football Manager — sync across a person's own devices.
 *
 * Google sign-in (Firebase Authentication) plus one private Firestore area per
 * person: users/{uid} holds the linked Sleeper account and league switches,
 * users/{uid}/ranks/{week} holds each week's rankings. The security rules let
 * only the signed-in owner read or write their own area.
 *
 * Optional by design: if this module or Firebase can't load (offline, blocked,
 * opened from a file), Titan keeps working on the device alone.
 */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, reauthenticateWithPopup
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, doc, getDoc, setDoc, deleteDoc, deleteField, collection, getDocs, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import {getMessaging, getToken, deleteToken, isSupported} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';

const App = window.TitanApp;
const Plan = window.TitanSyncPlan;
const HOST = location.hostname;

// Web app identifiers from the Firebase console. They are public by design;
// access is controlled by the security rules, not by keeping these secret.
const CONFIG = {
  apiKey: 'AIzaSyDjOaXVvwa9JxSjrLe3Ihnmlbd0Te4jS4Q',
  // Signing in through the app's own domain keeps the redirect flow same-site
  // (titanfantasyfootball.com is Titan's own domain; Firebase serves /__/auth there too).
  authDomain: /\.(web\.app|firebaseapp\.com)$/.test(HOST) || HOST === 'titanfantasyfootball.com' ? HOST : 'titan-fantasy-football.firebaseapp.com',
  projectId: 'titan-fantasy-football',
  storageBucket: 'titan-fantasy-football.firebasestorage.app',
  messagingSenderId: '544453683345',
  appId: '1:544453683345:web:567b48f38a839e321b7730'
};

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const db = initializeFirestore(app, {ignoreUndefinedProperties: true});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: 'select_account'});

const userDoc = uid => doc(db, 'users', uid);
const weekDoc = (uid, w) => doc(db, 'users', uid, 'ranks', String(w));
// Season rankings, one document per kind of league (redraft-1qb, dynasty-sf-tep, ...).
const seasonDoc = (uid, key) => doc(db, 'users', uid, 'seasonRanks', key);
// That a person saved an ESPN login (the SWID and when), for private ESPN leagues. The login itself
// (espn_s2) is kept by Titan's server where no browser can read it (functions/index.js, espnCreds).
const espnDoc = uid => doc(db, 'users', uid, 'private', 'espn');
const saveEspnLoginOnServer = httpsCallable(getFunctions(app, 'us-central1'), 'espnLogin');
// Private ESPN leagues are read by Titan's server with that login (functions/index.js).
const readEspnLeague = httpsCallable(getFunctions(app, 'us-central1'), 'espnLeague');
// "Delete my Titan account": the server removes everything, then the sign-in.
const deleteMyAccount = httpsCallable(getFunctions(app, 'us-central1'), 'deleteMyAccount');
// Totals for Titan's owner only; the server refuses everyone else.
const readOwnerStats = httpsCallable(getFunctions(app, 'us-central1'), 'ownerStats');
// "Send a test alert": the server sends one alert to this device.
const sendTestAlert = httpsCallable(getFunctions(app, 'us-central1'), 'testAlert');
// Yahoo: Titan's server keeps each person's Yahoo tokens where no browser can read them,
// so linking, listing leagues and unlinking all go through it.
const startYahoo = httpsCallable(getFunctions(app, 'us-central1'), 'yahooStart');
const readYahooLeagues = httpsCallable(getFunctions(app, 'us-central1'), 'yahooLeagues');
const unlinkYahoo = httpsCallable(getFunctions(app, 'us-central1'), 'yahooUnlink');
// Each refresh's read of the person's Yahoo leagues (yahoo.js fetchAll).
const readYahooLeague = httpsCallable(getFunctions(app, 'us-central1'), 'yahooLeague');

// Game-day alerts: each device's push address (Firebase Cloud Messaging) and
// the alerts wanted, in users/{uid}/private/alerts. Titan's server job sends
// them and forgets addresses that stop working. This device's address is also
// kept locally, to know whether alerts are on here.
const alertsDoc = uid => doc(db, 'users', uid, 'private', 'alerts');
const TOKEN_KEY = 'titan.alerts.token';
const localToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const keepToken = t => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} };

async function alertsState(uid) {
  const supported = await isSupported().catch(() => false);
  const snap = await getDoc(alertsDoc(uid)).catch(() => null);
  const data = snap && snap.exists() ? snap.data() : {};
  const t = localToken();
  return {supported, permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    on: !!(t && data.tokens && data.tokens[t]), prefs: Object.assign({out: true, check: true, news: true, waivers: true}, data.prefs || {})};
}
const ESPN = window.EspnAPI;
const YAHOO = window.YahooAPI;
const why = e => (e && (e.code || e.message)) || String(e);
let listeners = [];

function stopListening() {
  listeners.forEach(stop => stop());
  listeners = [];
}

/* First contact after sign-in: bring this device and the account level, the
   newer copy winning, then follow live changes from other devices. */
async function reconcile(uid) {
  App.setSync({state: 'syncing', error: ''});

  const snap = await getDoc(userDoc(uid));
  const remoteAccount = snap.exists() ? snap.data().account || null : null;
  const act = Plan.accountAction(App.local().account, remoteAccount);
  if (act === 'pull') App.applyAccount(remoteAccount);
  // lastSeen: the server job leaves an account alone after 45 days without a visit (unless alerts are on).
  await setDoc(userDoc(uid), Object.assign({lastSeen: Date.now()}, act === 'push' ? {account: App.local().account} : {}), {merge: true});

  const remote = {};
  (await getDocs(collection(db, 'users', uid, 'ranks'))).forEach(d => { remote[d.id] = d.data(); });
  const plan = Plan.ranksPlan(App.local().ranks.weeks, remote);
  if (Object.keys(plan.pull).length) App.applyRanks(plan.pull);
  await Promise.all(plan.push.map(w => setDoc(weekDoc(uid, w), App.local().ranks.weeks[w])));

  // Season rankings, the same way (an app from before season rankings has none to offer).
  const localSeason = App.local().seasonRanks;
  if (localSeason) {
    const remoteSeason = {};
    (await getDocs(collection(db, 'users', uid, 'seasonRanks'))).forEach(d => { remoteSeason[d.id] = d.data(); });
    const sp = Plan.ranksPlan(localSeason.formats, remoteSeason);
    if (Object.keys(sp.pull).length) App.applySeasonRanks(sp.pull);
    await Promise.all(sp.push.map(k => setDoc(seasonDoc(uid, k), App.local().seasonRanks.formats[k])));
  }

  listen(uid);
  listenSeason(uid);
  App.setSync({state: 'on', at: Date.now()});
}

function listen(uid) {
  stopListening();
  listeners.push(onSnapshot(userDoc(uid), s => {
    if (s.metadata.hasPendingWrites || !s.exists()) return;
    const account = s.data().account;
    if (account && Plan.accountAction(App.local().account, account) === 'pull') App.applyAccount(account);
    App.setSync({at: Date.now()});
  }, pause));
  listeners.push(onSnapshot(collection(db, 'users', uid, 'ranks'), s => {
    if (s.metadata.hasPendingWrites) return;
    const changes = {};
    s.docChanges().forEach(c => {
      const mine = App.local().ranks.weeks[c.doc.id];
      if (c.type === 'removed') {
        if (Plan.acceptRemoteDelete(mine, c.doc.data())) changes[c.doc.id] = null;
      } else if (Plan.acceptRemoteWeek(mine, c.doc.data())) {
        changes[c.doc.id] = c.doc.data();
      }
    });
    if (Object.keys(changes).length) App.applyRanks(changes);
    App.setSync({at: Date.now()});
  }, pause));
}

function listenSeason(uid) {
  if (!App.local().seasonRanks) return;
  listeners.push(onSnapshot(collection(db, 'users', uid, 'seasonRanks'), s => {
    if (s.metadata.hasPendingWrites) return;
    const changes = {};
    s.docChanges().forEach(c => {
      const mine = App.local().seasonRanks.formats[c.doc.id];
      if (c.type === 'removed') {
        if (Plan.acceptRemoteDelete(mine, c.doc.data())) changes[c.doc.id] = null;
      } else if (Plan.acceptRemoteWeek(mine, c.doc.data())) {
        changes[c.doc.id] = c.doc.data();
      }
    });
    if (Object.keys(changes).length) App.applySeasonRanks(changes);
    App.setSync({at: Date.now()});
  }, pause));
}

function pause(e) { App.setSync({state: 'error', error: 'Sync paused: ' + why(e)}); }
function saveFailed(e) { App.setSync({state: 'error', error: 'Could not save to your account: ' + why(e)}); }

const api = {
  async signIn() {
    // A home-screen web app on iPhone can't hand a sign-in popup back to the app,
    // so it signs in with a full-page redirect instead.
    if (navigator.standalone === true) return signInWithRedirect(auth, provider);
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user') return;
      // Some installed-app and in-app browsers block popups; a full-page redirect works there.
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        return signInWithRedirect(auth, provider);
      }
      throw e;
    }
  },

  async signOut() {
    stopListening();
    // Alerts stop for this device along with the sign-in.
    await api.alertsOff().catch(() => {});
    return signOut(auth);
  },

  /* Turns alerts on for this device: asks for permission, gets its push
     address and saves it with the alerts wanted ({out, check}). */
  async alertsOn(prefs) {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    if (!(await isSupported().catch(() => false))) throw new Error('This browser can\'t show alerts.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      throw new Error(perm === 'denied' ? 'Notifications are blocked for Titan in this browser\'s settings.' : 'Notifications weren\'t allowed.');
    }
    const token = await getToken(getMessaging(app), {serviceWorkerRegistration: await navigator.serviceWorker.ready});
    await setDoc(alertsDoc(u.uid), {tokens: {[token]: {at: Date.now()}}, prefs}, {merge: true});
    await setDoc(userDoc(u.uid), {alertsOn: true}, {merge: true}); // what the server job queries on
    keepToken(token);
    App.setAlerts(await alertsState(u.uid));
  },

  async alertsOff() {
    const u = auth.currentUser, t = localToken();
    if (u && t) {
      await setDoc(alertsDoc(u.uid), {tokens: {[t]: deleteField()}}, {merge: true});
      const rest = await getDoc(alertsDoc(u.uid)).catch(() => null);
      const devices = rest && rest.exists() ? Object.keys(rest.data().tokens || {}).length : 0;
      await setDoc(userDoc(u.uid), {alertsOn: devices > 0}, {merge: true});
    }
    try { await deleteToken(getMessaging(app)); } catch (e) { /* no push address on this device */ }
    keepToken('');
    if (u) App.setAlerts(await alertsState(u.uid));
  },

  testAlert() {
    return sendTestAlert({token: localToken()}).then(r => r.data);
  },

  alertPrefs(prefs) {
    const u = auth.currentUser;
    return u ? setDoc(alertsDoc(u.uid), {prefs}, {merge: true}) : Promise.resolve();
  },

  pushAccount(account) {
    const u = auth.currentUser;
    if (u && account) return setDoc(userDoc(u.uid), {account}, {merge: true}).catch(saveFailed);
  },

  pushSeason(key, entry) {
    const u = auth.currentUser;
    if (!u) return;
    return (entry ? setDoc(seasonDoc(u.uid, key), entry) : deleteDoc(seasonDoc(u.uid, key))).catch(saveFailed);
  },

  pushWeek(week, entry) {
    const u = auth.currentUser;
    if (!u) return;
    return (entry ? setDoc(weekDoc(u.uid, week), entry) : deleteDoc(weekDoc(u.uid, week))).catch(saveFailed);
  },

  // Last week's recap (Results' totals, the close calls graded, the bench's biggest miss): users/{uid}/private/recap,
  // which the owner's Tuesday briefing reads. Quiet on failure: it's a nicety.
  pushRecap(entry) {
    const u = auth.currentUser;
    if (!u || !entry) return;
    return setDoc(doc(db, 'users', u.uid, 'private', 'recap'), entry).catch(() => {});
  },

  ownerStats() {
    return readOwnerStats().then(r => r.data);
  },

  /* The rankings lab (Compare rankings; Titan's owner only, the rules refuse everyone else):
     the formats of the owner's leagues, for the server's weekly FantasyCalc snapshot, and a
     week's snapshot (null if there isn't one). */
  labFormats(formats) {
    return setDoc(doc(db, 'lab', 'config'), {formats, at: Date.now()});
  },
  async labWeek(season, week) {
    const s = await getDoc(doc(db, 'lab', `${season}-${week}`));
    return s.exists() ? s.data() : null;
  },
  // The weekly value report the owner's PC posts (Value report; the rules let only the owner read lab/).
  async valueReport() {
    const s = await getDoc(doc(db, 'lab', 'value-latest'));
    return s.exists() ? s.data() : null;
  },
  // The weekly data dump the owner's PC posts (Data dump; owner-only lab/ too).
  async dumpReport() {
    const s = await getDoc(doc(db, 'lab', 'dump-latest'));
    return s.exists() ? s.data() : null;
  },
  // Any lab/ document holding a report as a JSON string (the Match Up data screen's lab/matchups-<season>: the rules let
  // the owner and titanLab accounts read it), parsed; null when there isn't one.
  async labJson(name) {
    const s = await getDoc(doc(db, 'lab', name));
    return s.exists() && s.data().json ? JSON.parse(s.data().json) : null;
  },
  // Writes one (the owner only, by the rules: lab/matchups-<season>).
  labWrite(name, data) {
    return setDoc(doc(db, 'lab', name), {json: JSON.stringify(data), at: Date.now()});
  },

  /* A week's frozen record of Titan's calls, saved by the server job at each
     kickoff, or null if there isn't one. */
  async getHistory(week) {
    const u = auth.currentUser;
    if (!u) return null;
    const s = await getDoc(doc(db, 'users', u.uid, 'history', String(week)));
    return s.exists() ? s.data() : null;
  },

  // The login goes to Titan's server, which keeps it where no browser can read it.
  async saveEspnLogin(creds) {
    if (!auth.currentUser) throw new Error('Sign in first.');
    await saveEspnLoginOnServer({s2: String(creds.s2 || '').trim(), swid: String(creds.swid || '')});
  },

  async deleteEspnLogin() {
    if (auth.currentUser) await saveEspnLoginOnServer({remove: true});
  },

  /* "Sign in with Yahoo": the server makes a one-time sign-in address, and
     Yahoo sends the person back to Settings (/app/settings?yahoo=<result>). */
  async yahooLink() {
    const r = await startYahoo();
    location.assign(r.data.url);
  },

  yahooLeagues(season) {
    return readYahooLeagues({season}).then(r => r.data);
  },

  yahooUnlink() {
    return unlinkYahoo().then(r => r.data);
  },

  /* Removes everything Titan stores for this person, then the sign-in itself: Titan's server does it in
     one go (deleteMyAccount), so a lost connection halfway can't leave anything behind. The server wants
     a sign-in from the last few minutes, like Google's own account deletion. */
  async deleteAccount() {
    const u = auth.currentUser;
    if (!u) return;
    stopListening();
    try { await deleteToken(getMessaging(app)); } catch (e) { /* no push address on this device */ }
    keepToken('');
    try {
      await deleteMyAccount();
    } catch (e) {
      if (!/recent-login/.test(String((e && e.message) || ''))) throw e;
      // No popup there either; a fresh sign-in does the same job.
      if (navigator.standalone === true) throw new Error('For security, sign out and sign back in, then delete your account.');
      await reauthenticateWithPopup(u, provider);
      await deleteMyAccount();
    }
    await signOut(auth).catch(() => {});
  }
};

getRedirectResult(auth).catch(e => App.setSync({state: 'error', error: 'Sign-in failed: ' + why(e)}));

onAuthStateChanged(auth, user => {
  if (!user) {
    stopListening();
    if (ESPN) ESPN.setTransport(null);
    if (YAHOO) YAHOO.setTransport(null);
    App.setEspnLogin(null);
    App.setSync({user: null, state: 'off', at: 0});
    App.setOwner(false);
    App.setAlerts(null);
    return;
  }
  if (ESPN) ESPN.setTransport(args => readEspnLeague(args).then(r => r.data));
  if (YAHOO) YAHOO.setTransport(args => readYahooLeague(args).then(r => r.data));
  // The app only learns whether a login is saved, and the SWID (to find the person's team). A login saved
  // before 2026-09-15 still holds the cookie here: it goes to the server, which keeps it and strips it here.
  getDoc(espnDoc(user.uid)).then(async s => {
    const d = s.exists() ? s.data() : null;
    if (d && d.s2) await saveEspnLoginOnServer({s2: d.s2, swid: d.swid}).catch(() => {});
    App.setEspnLogin(d ? {saved: true, swid: d.swid, savedAt: d.savedAt} : null);
  }).catch(() => App.setEspnLogin(null));
  App.setSync({user: {name: user.displayName || '', email: user.email || '', photo: user.photoURL || ''}});
  // Titan's owner (a custom claim on that one account) gets the stats card in Settings.
  // The owner (titanOwner) and, since v1.65.0, anyone granted the rankings lab alone (titanLab: Compare rankings, nothing else).
  user.getIdTokenResult(true).then(t => App.setOwner(t.claims.titanOwner === true, t.claims.titanLab === true)).catch(() => App.setOwner(false, false));
  alertsState(user.uid).then(a => App.setAlerts(a)).catch(() => App.setAlerts(null));
  reconcile(user.uid).catch(e => App.setSync({state: 'error', error: 'Sync failed: ' + why(e)}));
});

App.syncReady(api);
