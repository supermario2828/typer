// Pure metric helpers. No DOM, no state — easy to unit test and reuse.

// Standard: a "word" is 5 characters. Net WPM counts only correctly typed chars.
export function wpm(correctChars, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60000;
  return (correctChars / 5) / minutes;
}

export function accuracy(correctKeystrokes, totalKeystrokes) {
  if (totalKeystrokes <= 0) return 100;
  return (correctKeystrokes / totalKeystrokes) * 100;
}

// Consistency (Monkeytype-style): 100% means perfectly even speed.
// Derived from the coefficient of variation of per-second raw WPM.
export function consistency(perSecondWpm) {
  const xs = perSecondWpm.filter((v) => v > 0);
  if (xs.length < 2) return 100;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(100, (1 - cv) * 100));
}

// Turn a series of cumulative-keystroke samples into per-second raw WPM.
// samples: [{ t: elapsedMs, k: cumulativeKeystrokes }]
export function perSecondWpm(samples) {
  if (samples.length < 2) return [];
  const totalSec = Math.ceil(samples[samples.length - 1].t / 1000);
  const out = [];
  for (let s = 1; s <= totalSec; s++) {
    const lo = kAt(samples, (s - 1) * 1000);
    const hi = kAt(samples, s * 1000);
    const chars = hi - lo;
    out.push((chars / 5) * 60); // chars/sec -> chars/min -> /5
  }
  return out;
}

function kAt(samples, t) {
  let k = 0;
  for (const s of samples) {
    if (s.t <= t) k = s.k;
    else break;
  }
  return k;
}

export function round(n, d = 0) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
