// Firebase over its public REST APIs — no SDK, no dependencies. This is what
// lets the terminal client install as a tiny zero-dependency package while
// still doing auth + leaderboard against the same project as the web app.
//
//   Identity Toolkit : anonymous sign-in, Google credential sign-in
//   Secure Token     : refresh id tokens
//   Firestore        : query + create `scores`
import { firebaseConfig } from '../src/firebase/project.js';

const KEY = firebaseConfig.apiKey;
const PROJECT = firebaseConfig.projectId;
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';
const SECURE = 'https://securetoken.googleapis.com/v1';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json())?.error?.message || msg; } catch { /* keep status */ }
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// ---- auth ---------------------------------------------------------------
export async function signInAnonymously() {
  const j = await postJson(`${IDENTITY}/accounts:signUp?key=${KEY}`, { returnSecureToken: true });
  return { idToken: j.idToken, refreshToken: j.refreshToken, uid: j.localId };
}

export async function signInWithGoogle(googleIdToken) {
  const j = await postJson(`${IDENTITY}/accounts:signInWithIdp?key=${KEY}`, {
    postBody: `id_token=${googleIdToken}&providerId=google.com`,
    requestUri: 'http://localhost',
    returnSecureToken: true,
  });
  return {
    idToken: j.idToken,
    refreshToken: j.refreshToken,
    uid: j.localId,
    name: j.displayName || j.fullName || j.email || 'Player',
    photo: j.photoUrl || null,
    email: j.email || null,
  };
}

export async function refreshIdToken(refreshToken) {
  const r = await fetch(`${SECURE}/token?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!r.ok) {
    const e = new Error(`token refresh failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  return { idToken: j.id_token, refreshToken: j.refresh_token, uid: j.user_id };
}

// ---- Firestore value <-> JS --------------------------------------------
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { stringValue: String(v) };
}
function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = encodeValue(v);
  return { fields };
}
function decodeValue(v) {
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  return undefined;
}
function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decodeValue(v);
  return out;
}

// ---- Firestore: scores --------------------------------------------------
export async function getScores(idToken, sinceMs = 0, limit = 1000) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'scores' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'at' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { integerValue: String(sinceMs) },
        },
      },
      orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }],
      limit,
    },
  };
  const rows = await postJson(`${FS}:runQuery`, body, idToken);
  return rows
    .filter((x) => x.document)
    .map((x) => ({ id: x.document.name.split('/').pop(), ...decodeDoc(x.document) }));
}

export async function addScore(idToken, data) {
  return postJson(`${FS}/scores`, encodeFields(data), idToken);
}
