// Firestore-backed stats store. Implements the same run methods as
// LocalStatsStore, keyed by a Firebase uid. Data model:
//   users/{uid}/runs/{runId}  -> a single completed test
import { db } from '../firebase/config.js';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from 'firebase/firestore';

export class FirebaseStatsStore {
  runsCol(uid) {
    return collection(db, 'users', uid, 'runs');
  }

  async getRuns(uid) {
    // Most recent first, capped so we never pull an unbounded history.
    const q = query(this.runsCol(uid), orderBy('at', 'desc'), limit(500));
    const snap = await getDocs(q);
    const runs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // The rest of the app expects oldest-first (charts, "recent" slicing).
    return runs.reverse();
  }

  async addRun(uid, run) {
    const ref = await addDoc(this.runsCol(uid), run);
    return { id: ref.id, ...run };
  }

  async clearRuns(uid) {
    const snap = await getDocs(this.runsCol(uid));
    // Firestore batches are limited to 500 ops; chunk to be safe.
    let batch = writeBatch(db);
    let n = 0;
    for (const d of snap.docs) {
      batch.delete(doc(db, 'users', uid, 'runs', d.id));
      if (++n === 450) {
        await batch.commit();
        batch = writeBatch(db);
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  }

  // ---- device names: users/{uid}/devices/{machineId} = { name, updatedAt }
  async getDeviceName(uid, machineId) {
    const snap = await getDoc(doc(db, 'users', uid, 'devices', machineId));
    return snap.exists() ? snap.data().name : null;
  }

  async setDeviceName(uid, machineId, name) {
    await setDoc(doc(db, 'users', uid, 'devices', machineId), {
      name,
      updatedAt: Date.now(),
    });
  }

  // ---- global leaderboard: top-level `scores` collection, readable by any
  // signed-in user. One doc per submitted run (denormalised name/device).
  async addScore(score) {
    return addDoc(collection(db, 'scores'), score);
  }

  async getScores(sinceMs = 0, max = 1000) {
    // Single-field range + orderBy on `at` — no composite index needed.
    const q = query(
      collection(db, 'scores'),
      where('at', '>=', sinceMs),
      orderBy('at', 'desc'),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}
