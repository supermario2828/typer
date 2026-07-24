// Signed-in session for the terminal. Turns Google OAuth tokens into a Firebase
// user (so CLI runs can post to the leaderboard as the real account) and
// persists the login across runs via a stored refresh token.
import { auth } from '../src/firebase/config.js';
import { GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { FirebaseStatsStore } from '../src/store/firebaseStore.js';
import { loadCreds, interactiveLogin, refresh } from './google-auth.js';
import { store } from './store.js';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const AUTH_FILE = join(os.homedir(), '.typer', 'auth.json');
const fb = new FirebaseStatsStore();

function readAuth() {
  try { return JSON.parse(readFileSync(AUTH_FILE, 'utf8')); } catch { return null; }
}
function writeAuth(data) {
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function clearAuth() {
  try { rmSync(AUTH_FILE); } catch { /* already gone */ }
}

export const session = {
  user: null,

  hasCreds() {
    return !!loadCreds();
  },

  displayName() {
    return this.user?.displayName || this.user?.email || 'Player';
  },

  async _firebaseSignIn(idToken) {
    const cred = GoogleAuthProvider.credential(idToken);
    const { user } = await signInWithCredential(auth, cred);
    this.user = user;
    return user;
  },

  // Best-effort silent restore from a stored refresh token (called at startup).
  async restore() {
    const saved = readAuth();
    if (!saved?.refresh_token) return null;
    try {
      const t = await refresh(saved.refresh_token);
      return await this._firebaseSignIn(t.id_token);
    } catch {
      clearAuth(); // token revoked/expired — require a fresh login
      return null;
    }
  },

  // Interactive browser login. onUrl(url) is called with the consent URL so the
  // CLI can display it in case the browser doesn't open automatically.
  async signIn(onUrl) {
    const t = await interactiveLogin(onUrl);
    const user = await this._firebaseSignIn(t.id_token);
    if (t.refresh_token) writeAuth({ refresh_token: t.refresh_token, uid: user.uid });
    return user;
  },

  async signOut() {
    try { await signOut(auth); } catch { /* ignore */ }
    this.user = null;
    clearAuth();
  },

  // Publish a finished run to the global leaderboard (only when signed in).
  async submitScore(run) {
    if (!this.user) return;
    await fb.addScore({
      uid: this.user.uid,
      name: this.displayName(),
      photo: this.user.photoURL || null,
      device: store.device(),
      wpm: run.wpm,
      accuracy: run.accuracy,
      mode: run.mode,
      difficulty: run.difficulty,
      at: run.at || Date.now(),
    });
  },
};
