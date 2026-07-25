// Signed-in session for the terminal, over Firebase REST (no SDK). Turns Google
// OAuth tokens into a Firebase session so CLI runs post to the leaderboard as
// the real account, and persists the login across runs via a refresh token.
import { signInWithGoogle, refreshIdToken, addScore } from './firebase-rest.js';
import { interactiveLogin } from './google-auth.js';
import { hasAnyCreds } from './oauth-client.js';
import { store } from './store.js';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const AUTH_FILE = join(os.homedir(), '.typer', 'auth.json');
const TOKEN_TTL = 50 * 60 * 1000;

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
  user: null, // { uid, name, photo }
  _idToken: null,
  _refresh: null,
  _ts: 0,

  hasCreds() {
    return hasAnyCreds();
  },

  displayName() {
    return this.user?.name || 'Player';
  },

  _set(fbUser, saved) {
    this._idToken = fbUser.idToken;
    this._refresh = fbUser.refreshToken || saved?.refresh_token || null;
    this._ts = Date.now();
    this.user = { uid: fbUser.uid, name: fbUser.name ?? saved?.name, photo: fbUser.photo ?? saved?.photo ?? null };
  },

  // Best-effort silent restore from a stored refresh token (called at startup).
  async restore() {
    const saved = readAuth();
    if (!saved?.refresh_token) return null;
    try {
      const t = await refreshIdToken(saved.refresh_token);
      this._set({ ...t, name: saved.name, photo: saved.photo }, saved);
      if (t.refreshToken && t.refreshToken !== saved.refresh_token) {
        writeAuth({ ...saved, refresh_token: t.refreshToken });
        this._refresh = t.refreshToken;
      }
      return this.user;
    } catch {
      clearAuth(); // token revoked/expired — require a fresh login
      return null;
    }
  },

  /**
   * Interactive login. The flow (browser loopback vs. device code) is chosen to
   * suit the machine — see google-auth.js.
   *
   * @param {object} [opts]
   * @param {'auto'|'browser'|'device'} [opts.mode]
   * @param {number} [opts.port] fixed loopback port, for `ssh -L`.
   * @param {(info:object)=>void} [opts.onProgress] consent URL / user code.
   * @param {AbortSignal} [opts.signal] cancel the attempt.
   */
  async signIn(opts = {}) {
    const google = await interactiveLogin(opts);
    if (!google.id_token) throw new Error('Google returned no id_token — check the OAuth client scopes');
    const fbUser = await signInWithGoogle(google.id_token);
    this._set(fbUser);
    writeAuth({ refresh_token: fbUser.refreshToken, uid: fbUser.uid, name: fbUser.name, photo: fbUser.photo });
    return this.user;
  },

  async signOut() {
    this.user = null;
    this._idToken = null;
    this._refresh = null;
    clearAuth();
  },

  // A currently-valid id token, refreshing if the cached one is near expiry.
  async getIdToken() {
    if (this._idToken && Date.now() - this._ts < TOKEN_TTL) return this._idToken;
    if (this._refresh) {
      const t = await refreshIdToken(this._refresh);
      this._idToken = t.idToken;
      this._refresh = t.refreshToken || this._refresh;
      this._ts = Date.now();
      return this._idToken;
    }
    return null;
  },

  // Publish a finished run to the global leaderboard (only when signed in).
  async submitScore(run) {
    if (!this.user) return;
    const token = await this.getIdToken();
    await addScore(token, {
      uid: this.user.uid,
      name: this.displayName(),
      photo: this.user.photo || null,
      device: store.device(),
      wpm: run.wpm,
      accuracy: run.accuracy,
      mode: run.mode,
      difficulty: run.difficulty,
      at: run.at || Date.now(),
    });
  },
};
