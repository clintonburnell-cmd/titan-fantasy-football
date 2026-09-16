// The Firebase pieces the extension's service worker needs, bundled by esbuild into dist/firebase.js (Chrome
// extensions can't load remote code, so the SDK ships inside the extension). Auth uses the web-extension entry
// point, which keeps the session in the extension's own IndexedDB; Firestore is read over REST with the ID token.
export {initializeApp} from 'firebase/app';
export {getAuth, signInWithCredential, signOut, onAuthStateChanged, GoogleAuthProvider} from 'firebase/auth/web-extension';
