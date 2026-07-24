// Auth service — thin wrapper over Firebase Google sign-in. The UI subscribes
// to onChange and reacts; it never touches Firebase auth directly.
import { auth } from '../firebase/config.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';

const provider = new GoogleAuthProvider();

export const authService = {
  user: null, // firebase user or null (guest)

  // Keep the session across reloads/tabs.
  async init() {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {
      /* ignore — falls back to default persistence */
    }
  },

  onChange(cb) {
    return onAuthStateChanged(auth, (u) => {
      this.user = u;
      cb(u);
    });
  },

  async signInWithGoogle() {
    const res = await signInWithPopup(auth, provider);
    return res.user;
  },

  async signOut() {
    await fbSignOut(auth);
  },
};
