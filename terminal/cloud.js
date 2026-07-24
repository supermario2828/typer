// Read-only leaderboard access for the terminal client. The global `scores`
// collection is readable only by authenticated users, so the CLI signs in
// ANONYMOUSLY (no interaction) purely to read. It never writes — getting onto
// the leaderboard is done by signing in with Google on the web app.
import { auth } from '../src/firebase/config.js';
import { signInAnonymously } from 'firebase/auth';
import { FirebaseStatsStore } from '../src/store/firebaseStore.js';
import { rankScores, sinceFor } from '../src/core/leaderboard.js';

const fb = new FirebaseStatsStore();
let anon = null;

async function ensureAuth() {
  // If the user signed in with Google, read as them — never anonymously sign in
  // over an existing session (that would replace the current user).
  if (auth.currentUser) return auth.currentUser;
  if (anon) return anon;
  anon = (await signInAnonymously(auth)).user;
  return anon;
}

export async function fetchLeaderboard({ period, metric, mode, difficulty }) {
  await ensureAuth();
  const scores = await fb.getScores(sinceFor(period));
  return rankScores(scores, { metric, mode, difficulty });
}
