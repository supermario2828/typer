// Stats service. Routes run reads/writes to the right backend based on the
// current identity: a signed-in Google user (Firestore) or a local guest
// (localStorage). Machine id is always local — it identifies this browser /
// keyboard, and every run is tagged with it so stats can be filtered per
// machine even for an account used across several devices.
import { LocalStatsStore } from './storage.js';
import { FirebaseStatsStore } from './firebaseStore.js';
import { deviceService } from './device.js';
import { rankScores, sinceFor } from '../core/leaderboard.js';

const local = new LocalStatsStore();
const cloud = new FirebaseStatsStore();

// Sanity bounds so the public leaderboard can't be polluted by junk/instant
// runs. The typing world record is ~216 wpm; personal stats still save either
// way, only the *global* submission is gated.
const LB_MAX_WPM = 300;
const LB_MIN_SECONDS = 2;

export const statsService = {
  machineIdValue: '',
  // identity: { kind: 'guest' | 'cloud', id, name, photo }
  identity: { kind: 'guest', id: 'guest', name: 'Guest', photo: null },

  async init() {
    this.machineIdValue = await local.getMachineId();
    return this.machineIdValue;
  },

  machineId() {
    return this.machineIdValue;
  },

  setGuest() {
    this.identity = { kind: 'guest', id: 'guest', name: 'Guest', photo: null };
  },

  setCloudUser(user) {
    this.identity = {
      kind: 'cloud',
      id: user.uid,
      name: user.displayName || user.email || 'Player',
      photo: user.photoURL || null,
    };
  },

  _store() {
    return this.identity.kind === 'cloud' ? cloud : local;
  },

  async saveRun(run) {
    const record = {
      ...run,
      at: Date.now(),
      machineId: this.machineIdValue,
      device: deviceService.label(),
    };
    const saved = await this._store().addRun(this.identity.id, record);
    // Signed-in, credible run → also publish to the global leaderboard. Awaited
    // so a leaderboard re-render right after finishing includes this score.
    if (this.identity.kind === 'cloud' && this._qualifies(record)) {
      try {
        await this._submitScore(record);
      } catch (e) {
        console.warn('leaderboard submit failed:', e);
      }
    }
    return saved;
  },

  _qualifies(run) {
    return run.wpm > 0 && run.wpm <= LB_MAX_WPM && run.seconds >= LB_MIN_SECONDS;
  },

  async _submitScore(run) {
    return cloud.addScore({
      uid: this.identity.id,
      name: this.identity.name,
      photo: this.identity.photo || null,
      device: run.device,
      wpm: run.wpm,
      accuracy: run.accuracy,
      mode: run.mode,
      difficulty: run.difficulty,
      at: run.at,
    });
  },

  // Global leaderboard, scoped to a single category so difficulty is fair —
  // you only ever rank against players who typed the same mode+difficulty.
  //   period: 'day'|'month'|'all'; metric: 'wpm'|'accuracy';
  //   mode: 'words'|'punctuation'|'numbers'|'quotes'; difficulty: easy|medium|hard
  // Keeps each player's single best entry in the window. Requires sign-in
  // (rules only allow authenticated reads).
  async leaderboard({ period = 'day', metric = 'wpm', mode = 'words', difficulty = 'medium' } = {}) {
    const scores = await cloud.getScores(sinceFor(period));
    return rankScores(scores, { metric, mode, difficulty });
  },

  async runs() {
    return this._store().getRuns(this.identity.id);
  },

  async clear() {
    return this._store().clearRuns(this.identity.id);
  },

  // Aggregate stats, optionally filtered by mode and/or this machine only.
  async summary(filter = {}) {
    const all = await this._store().getRuns(this.identity.id);
    const runs = all.filter((r) => {
      if (filter.mode && r.mode !== filter.mode) return false;
      if (filter.thisMachine && r.machineId !== this.machineIdValue) return false;
      return true;
    });
    if (runs.length === 0) {
      return { count: 0, bestWpm: 0, avgWpm: 0, avgAcc: 0, recent: [], all: [] };
    }
    const bestWpm = Math.max(...runs.map((r) => r.wpm));
    const avgWpm = runs.reduce((a, r) => a + r.wpm, 0) / runs.length;
    const avgAcc = runs.reduce((a, r) => a + r.accuracy, 0) / runs.length;
    return {
      count: runs.length,
      bestWpm: Math.round(bestWpm),
      avgWpm: Math.round(avgWpm),
      avgAcc: Math.round(avgAcc),
      recent: runs.slice(-10).reverse(),
      all: runs,
    };
  },
};
