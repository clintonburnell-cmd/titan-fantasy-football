// The bridge between Titan's site and the Titan for Sleeper extension: the extension's popup opens this page with
// its id in the query (?ext=...), the owner signs in with Google here (a normal popup sign-in on Titan's own domain),
// and the Google credential goes to the extension through chrome.runtime.sendMessage (the extension's manifest lists
// this site under externally_connectable). The extension then signs into Firebase with it and reads the owner's
// reports itself. No Firebase session is created on this page beyond the sign-in, and nothing is stored here.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth, GoogleAuthProvider, signInWithPopup, signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const CONFIG = {
  apiKey: 'AIzaSyDjOaXVvwa9JxSjrLe3Ihnmlbd0Te4jS4Q',
  authDomain: location.hostname === 'titanfantasyfootball.com' ? location.hostname : 'titan-fantasy-football.firebaseapp.com',
  projectId: 'titan-fantasy-football',
  appId: '1:544453683345:web:567b48f38a839e321b7730'
};
const status = document.getElementById('status'), go = document.getElementById('go');
const ext = new URLSearchParams(location.search).get('ext');
const say = (t, cls) => { status.textContent = t; status.className = 'status ' + (cls || ''); };

if (!ext || !/^[a-p]{32}$/.test(ext) || !(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
  go.disabled = true;
  say('Open this page from the extension\'s popup (Connect to Titan) so it knows which extension to hand the sign-in to.', 'bad');
}

go.addEventListener('click', async () => {
  go.disabled = true;
  say('Signing in…');
  try {
    const app = initializeApp(CONFIG);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({prompt: 'select_account'});
    const result = await signInWithPopup(auth, provider);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    if (!cred || !cred.idToken) throw new Error('Google did not return a credential.');
    const reply = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(ext, {type: 'titan-credential', idToken: cred.idToken, accessToken: cred.accessToken || null}, r => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(r);
      });
    });
    // This page's own session isn't needed once the extension has its own.
    await signOut(auth).catch(() => {});
    if (reply && reply.ok) say(`Connected as ${reply.email || result.user.email}. You can close this tab and open Sleeper.`, 'ok');
    else say('The extension did not accept the sign-in' + (reply && reply.error ? ': ' + reply.error : '.'), 'bad');
  } catch (e) {
    say('Sign-in failed: ' + (e && e.message ? e.message : e), 'bad');
  }
  go.disabled = false;
});
