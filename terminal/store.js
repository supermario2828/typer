// Local stats for the terminal client. Mirrors the web LocalStatsStore, but
// persists to ~/.typer/stats.json instead of localStorage. Stats are kept per
// profile (default: your OS username) on this machine (its hostname).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const DIR = join(os.homedir(), '.typer');
const FILE = join(DIR, 'stats.json');

function read() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function write(data) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export const store = {
  file: FILE,

  device() {
    const d = read();
    if (!d.device) { d.device = os.hostname(); write(d); }
    return d.device;
  },

  machineId() {
    const d = read();
    if (!d.machineId) { d.machineId = 'm_' + Math.random().toString(36).slice(2, 10); write(d); }
    return d.machineId;
  },

  runs(profile) {
    const d = read();
    return (d.runs && d.runs[profile]) || [];
  },

  addRun(profile, run) {
    const d = read();
    d.runs = d.runs || {};
    d.runs[profile] = d.runs[profile] || [];
    const record = { ...run, at: Date.now() };
    d.runs[profile].push(record);
    if (d.runs[profile].length > 1000) d.runs[profile] = d.runs[profile].slice(-1000);
    write(d);
    return record;
  },

  clear(profile) {
    const d = read();
    if (d.runs) d.runs[profile] = [];
    write(d);
  },

  summary(profile, filter = {}) {
    const all = this.runs(profile);
    const runs = all.filter((r) => {
      if (filter.mode && r.mode !== filter.mode) return false;
      if (filter.difficulty && r.difficulty !== filter.difficulty) return false;
      return true;
    });
    if (runs.length === 0) return { count: 0, bestWpm: 0, avgWpm: 0, avgAcc: 0, recent: [] };
    const bestWpm = Math.max(...runs.map((r) => r.wpm));
    const avgWpm = runs.reduce((a, r) => a + r.wpm, 0) / runs.length;
    const avgAcc = runs.reduce((a, r) => a + r.accuracy, 0) / runs.length;
    return {
      count: runs.length,
      bestWpm: Math.round(bestWpm),
      avgWpm: Math.round(avgWpm),
      avgAcc: Math.round(avgAcc),
      recent: runs.slice(-12).reverse(),
    };
  },
};
