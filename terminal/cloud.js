// Read-only leaderboard access for the terminal client, over the Firestore REST
// API. Reads as the signed-in Google user if there is one, otherwise signs in
// anonymously (both satisfy the "any authenticated user may read" rule).
import { signInAnonymously, getScores } from './firebase-rest.js';
import { rankScores, sinceFor } from '../src/core/leaderboard.js';
import { session } from './session.js';

let anon = null; // { idToken, ts }
const TOKEN_TTL = 50 * 60 * 1000;

async function readerToken() {
  if (session.user) return session.getIdToken();
  if (anon && Date.now() - anon.ts < TOKEN_TTL) return anon.idToken;
  const a = await signInAnonymously();
  anon = { idToken: a.idToken, ts: Date.now() };
  return anon.idToken;
}

export async function fetchLeaderboard({ period, metric, mode, difficulty }) {
  const token = await readerToken();
  const scores = await getScores(token, sinceFor(period));
  return rankScores(scores, { metric, mode, difficulty });
}
