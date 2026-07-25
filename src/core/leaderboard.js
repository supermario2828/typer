// Pure leaderboard math, shared by the web app and the terminal client so both
// rank identically. Given a flat list of score docs, produce the ranked
// best-per-player table for one category.

import { scoreOf } from './verdict.js';

export const PERIOD_MS = { day: 86400000, month: 2592000000, all: Infinity };

// What each metric ranks on, and what breaks a tie. Score leads: it's the
// number both clients show after a run, so the board ranks the same thing the
// player was just graded on. Every score doc records wpm and accuracy, so this
// applies to entries submitted before the score existed.
const METRICS = {
  score: { value: scoreOf, tie: (s) => s.wpm },
  wpm: { value: (s) => s.wpm, tie: (s) => s.accuracy },
  accuracy: { value: (s) => s.accuracy, tie: (s) => s.wpm },
};

export const BOARD_METRICS = Object.keys(METRICS);

// Positive when `a` outranks `b`.
function compare(a, b, m) {
  return (m.value(a) - m.value(b)) || (m.tie(a) - m.tie(b));
}

// Epoch-ms lower bound for a period ('day' | 'month' | 'all').
export function sinceFor(period) {
  const span = PERIOD_MS[period] ?? PERIOD_MS.day;
  return span === Infinity ? 0 : Date.now() - span;
}

/**
 * @param {Array} scores  raw score docs: { uid, name, photo, device, wpm,
 *                        accuracy, mode, difficulty, at }
 * @param {object} opts
 * @param {'score'|'wpm'|'accuracy'} opts.metric
 * @param {string} [opts.mode]        filter to this mode
 * @param {string} [opts.difficulty]  filter to this difficulty (ignored for quotes)
 * @param {number} [opts.limit=25]
 * @returns ranked rows, best entry per player, highest first
 */
export function rankScores(scores, { metric = 'score', mode, difficulty, limit = 25 } = {}) {
  const m = METRICS[metric] || METRICS.score;
  const inCategory = scores.filter(
    (s) =>
      (!mode || s.mode === mode) &&
      (mode === 'quotes' || !difficulty || s.difficulty === difficulty),
  );

  // Each player's single best entry *by the metric being ranked* — switching
  // tabs can promote a different run for the same player, which is correct:
  // your fastest run and your best-scoring one need not be the same run.
  const best = new Map(); // uid -> their best entry in this category
  for (const s of inCategory) {
    const cur = best.get(s.uid);
    if (!cur || compare(s, cur, m) > 0) best.set(s.uid, s);
  }

  return [...best.values()].sort((a, b) => compare(b, a, m)).slice(0, limit);
}
