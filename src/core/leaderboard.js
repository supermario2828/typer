// Pure leaderboard math, shared by the web app and the terminal client so both
// rank identically. Given a flat list of score docs, produce the ranked
// best-per-player table for one category.

export const PERIOD_MS = { day: 86400000, month: 2592000000, all: Infinity };

// Epoch-ms lower bound for a period ('day' | 'month' | 'all').
export function sinceFor(period) {
  const span = PERIOD_MS[period] ?? PERIOD_MS.day;
  return span === Infinity ? 0 : Date.now() - span;
}

/**
 * @param {Array} scores  raw score docs: { uid, name, photo, device, wpm,
 *                        accuracy, mode, difficulty, at }
 * @param {object} opts
 * @param {'wpm'|'accuracy'} opts.metric
 * @param {string} [opts.mode]        filter to this mode
 * @param {string} [opts.difficulty]  filter to this difficulty (ignored for quotes)
 * @param {number} [opts.limit=25]
 * @returns ranked rows, best entry per player, highest first
 */
export function rankScores(scores, { metric = 'wpm', mode, difficulty, limit = 25 } = {}) {
  const inCategory = scores.filter(
    (s) =>
      (!mode || s.mode === mode) &&
      (mode === 'quotes' || !difficulty || s.difficulty === difficulty),
  );

  const best = new Map(); // uid -> best score in category
  for (const s of inCategory) {
    const cur = best.get(s.uid);
    const better =
      metric === 'accuracy'
        ? s.accuracy > (cur?.accuracy ?? -1) ||
          (s.accuracy === cur?.accuracy && s.wpm > cur.wpm)
        : s.wpm > (cur?.wpm ?? -1);
    if (!cur || better) best.set(s.uid, s);
  }

  const rows = [...best.values()];
  rows.sort((a, b) =>
    metric === 'accuracy'
      ? b.accuracy - a.accuracy || b.wpm - a.wpm
      : b.wpm - a.wpm || b.accuracy - a.accuracy,
  );
  return rows.slice(0, limit);
}
