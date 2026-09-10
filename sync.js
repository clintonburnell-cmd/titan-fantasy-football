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
  initializeFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const App = window.TitanApp;
const Plan = window.TitanSyncPlan;
const HOST = location.hostname;

// Web app identifiers from the Firebase console. They are public by design;
// access is controlled by the security rules, not by keeping these secret.
const CONFIG = {
  apiKey: 'AIzaSyDjOaXVvwa9JxSjrLe3Ihnmlbd0Te4jS4Q',
  // Signing in through the app's own domain keeps the redirect flow same-site.
  authDomain: /\.(web\.app|firebaseapp\.com)$/.test(HOST) ? HOST : 'titan-fantasy-football.firebaseapp.com',
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

  signOut() {
    stopListening();
    return signOut(auth);
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

  /* Removes everything Titan stores for this person, then the sign-in itself.
     Google asks for a fresh sign-in first if the last one was a while ago. */
  async deleteAccount() {
    const u = auth.currentUser;
    if (!u) return;
    stopListening();
    const weeks = await getDocs(collection(db, 'users', u.uid, 'ranks'));
    await Promise.all(weeks.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(userDoc(u.uid));
    try {
      await deleteUser(u);
    } catch (e) {
      if (e.code !== 'auth/requires-recent-login') throw e;
      await reauthenticateWithPopup(u, provider);
      await deleteUser(u);
    }
  }
};

getRedirectResult(auth).catch(e => App.setSync({state: 'error', error: 'Sign-in failed: ' + why(e)}));

onAuthStateChanged(auth, user => {
  if (!user) {
    stopListening();
    App.setSync({user: null, state: 'off', at: 0});
    return;
  }
  App.setSync({user: {name: user.displayName || '', email: user.email || '', photo: user.photoURL || ''}});
  reconcile(user.uid).catch(e => App.setSync({state: 'error', error: 'Sync failed: ' + why(e)}));
});

App.syncReady(api);
