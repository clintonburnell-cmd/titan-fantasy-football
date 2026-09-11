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
  getRedirectResult, signOut, deleteUser, reauthenticateWithPopup
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
// The person's ESPN login (espn_s2 and SWID), for private ESPN leagues. Owner-only
// like everything under users/{uid}; only Titan's server reads the cookie back.
const espnDoc = uid => doc(db, 'users', uid, 'private', 'espn');
// Private ESPN leagues are read by Titan's server with that login (functions/index.js).
const readEspnLeague = httpsCallable(getFunctions(app, 'us-central1'), 'espnLeague');
// Totals for Titan's owner only; the server refuses everyone else.
const readOwnerStats = httpsCallable(getFunctions(app, 'us-central1'), 'ownerStats');
// "Send a test alert": the server sends one alert to this device.
const sendTestAlert = httpsCallable(getFunctions(app, 'us-central1'), 'testAlert');

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
    on: !!(t && data.tokens && data.tokens[t]), prefs: Object.assign({out: true, check: true, news: true}, data.prefs || {})};
}
const ESPN = window.EspnAPI;
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
  else if (act === 'push') await setDoc(userDoc(uid), {account: App.local().account}, {merge: true});

  const remote = {};
  (await getDocs(collection(db, 'users', uid, 'ranks'))).forEach(d => { remote[d.id] = d.data(); });
  const plan = Plan.ranksPlan(App.local().ranks.weeks, remote);
  if (Object.keys(plan.pull).length) App.applyRanks(plan.pull);
  await Promise.all(plan.push.map(w => setDoc(weekDoc(uid, w), App.local().ranks.weeks[w])));

  listen(uid);
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
    keepToken(token);
    App.setAlerts(await alertsState(u.uid));
  },

  async alertsOff() {
    const u = auth.currentUser, t = localToken();
    if (u && t) await setDoc(alertsDoc(u.uid), {tokens: {[t]: deleteField()}}, {merge: true});
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

  pushWeek(week, entry) {
    const u = auth.currentUser;
    if (!u) return;
    return (entry ? setDoc(weekDoc(u.uid, week), entry) : deleteDoc(weekDoc(u.uid, week))).catch(saveFailed);
  },

  ownerStats() {
    return readOwnerStats().then(r => r.data);
  },

  /* A week's frozen record of Titan's calls, saved by the server job at each
     kickoff, or null if there isn't one. */
  async getHistory(week) {
    const u = auth.currentUser;
    if (!u) return null;
    const s = await getDoc(doc(db, 'users', u.uid, 'history', String(week)));
    return s.exists() ? s.data() : null;
  },

  async saveEspnLogin(creds) {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    await setDoc(espnDoc(u.uid), {s2: String(creds.s2 || '').trim(), swid: ESPN.normSwid(creds.swid), savedAt: Date.now()});
  },

  async deleteEspnLogin() {
    const u = auth.currentUser;
    if (u) await deleteDoc(espnDoc(u.uid));
  },

  /* Removes everything Titan stores for this person, then the sign-in itself.
     Google asks for a fresh sign-in first if the last one was a while ago. */
  async deleteAccount() {
    const u = auth.currentUser;
    if (!u) return;
    stopListening();
    for (const sub of ['ranks', 'history', 'private']) {
      const docs = await getDocs(collection(db, 'users', u.uid, sub));
      await Promise.all(docs.docs.map(d => deleteDoc(d.ref)));
    }
    await deleteDoc(userDoc(u.uid));
    try { await deleteToken(getMessaging(app)); } catch (e) { /* no push address on this device */ }
    keepToken('');
    try {
      await deleteUser(u);
    } catch (e) {
      if (e.code !== 'auth/requires-recent-login') throw e;
      // No popup there either; a fresh sign-in does the same job.
      if (navigator.standalone === true) throw new Error('For security, sign out and sign back in, then delete your account.');
      await reauthenticateWithPopup(u, provider);
      await deleteUser(u);
    }
  }
};

getRedirectResult(auth).catch(e => App.setSync({state: 'error', error: 'Sign-in failed: ' + why(e)}));

onAuthStateChanged(auth, user => {
  if (!user) {
    stopListening();
    if (ESPN) ESPN.setTransport(null);
    App.setEspnLogin(null);
    App.setSync({user: null, state: 'off', at: 0});
    App.setOwner(false);
    App.setAlerts(null);
    return;
  }
  if (ESPN) ESPN.setTransport(args => readEspnLeague(args).then(r => r.data));
  // The app only learns whether a login is saved, and the SWID (to find the person's team).
  getDoc(espnDoc(user.uid)).then(s => App.setEspnLogin(s.exists() ? {saved: true, swid: s.data().swid, savedAt: s.data().savedAt} : null))
    .catch(() => App.setEspnLogin(null));
  App.setSync({user: {name: user.displayName || '', email: user.email || '', photo: user.photoURL || ''}});
  // Titan's owner (a custom claim on that one account) gets the stats card in Settings.
  user.getIdTokenResult(true).then(t => App.setOwner(t.claims.titanOwner === true)).catch(() => App.setOwner(false));
  alertsState(user.uid).then(a => App.setAlerts(a)).catch(() => App.setAlerts(null));
  reconcile(user.uid).catch(e => App.setSync({state: 'error', error: 'Sync failed: ' + why(e)}));
});

App.syncReady(api);
