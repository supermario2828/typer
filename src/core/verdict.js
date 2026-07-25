// Turns a finished run into a single score, and a verdict on that score against
// the player's *own* history — a colour and a short phrase. Pure math + colour,
// no DOM, so the terminal client uses it too.
//
// SCORE. Speed and accuracy fold into one number, because either alone is
// gameable: you can be fast and sloppy, or accurate and slow. Net wpm already
// counts only correct characters, but it penalises the two kinds of error
// unevenly — leaving a wrong character in costs you just that character, while
// *fixing* one costs the keystroke, the backspace, the retype and all the time
// in between. Left alone, the metric quietly rewards barrelling through and
// leaving mistakes behind. Squaring accuracy closes that gap: it's nearly free
// above 97% (where the last few points are mostly luck) and bites hard below
// ~93%, without punishing the careful corrector a third time the way a cube
// would.
//
// VERDICT. The comparison is a z-score, not a raw delta, because "10 points
// above average" means very different things for a metronomic typist and a
// streaky one. The z-score maps onto a red → orange → yellow → green ramp:
//
//     z ≤ -1.5   red        a bad run for you
//     z ≈ -0.6   orange     below your usual
//     z ≈  0     yellow     right on par
//     z ≈ +1     green-ish  above average
//     z ≥ +2     green      exceptional
//
// Only runs in the same category (mode + difficulty) count as the baseline —
// hard punctuation and easy words aren't the same test, and mixing them makes
// every category look average.

// How hard accuracy bites. 2 is the sweet spot; see the note above.
const ACC_EXPONENT = 2;

/**
 * The combined speed+accuracy score for a run. Works on any stored run, since
 * every one records wpm and accuracy — so history grades retroactively with no
 * migration. Runs from before accuracy was recorded are treated as clean.
 * @param {{wpm: number, accuracy?: number}} run
 */
export function scoreOf(run) {
  const acc = (run.accuracy ?? 100) / 100;
  return Math.round(run.wpm * acc ** ACC_EXPONENT);
}

// Runs needed before a verdict is trustworthy. Below this we say so rather
// than pretending two runs describe a typist.
export const MIN_BASELINE = 5;
// Only the most recent runs shape the baseline: someone improving shouldn't be
// judged against the speed they had a thousand runs ago.
const WINDOW = 50;

// Ramp stops as [z, hue, saturation%, lightness%]. Hue alone isn't enough —
// pure yellow at the same lightness as red reads much brighter, so the middle
// of the ramp is dimmed slightly to keep the stops visually even.
const RAMP = [
  [-2.0, 0, 78, 60],   // red
  [-1.0, 22, 85, 58],  // orange
  [-0.35, 45, 88, 56], // amber
  [0.35, 55, 85, 55],  // yellow (on par)
  [1.0, 88, 62, 55],   // yellow-green
  [2.0, 145, 58, 55],  // green
];

// Bands, coarsest first. `min` is the inclusive lower z bound.
const TIERS = [
  { key: 'exceptional', min: 2.0, label: 'exceptional run', blurb: 'way above your usual — bank it' },
  { key: 'great', min: 1.0, label: 'well above average', blurb: 'clearly better than you normally do' },
  { key: 'good', min: 0.35, label: 'above average', blurb: 'a solid run for you' },
  { key: 'par', min: -0.35, label: 'on par', blurb: 'right where you usually land' },
  { key: 'below', min: -1.0, label: 'below average', blurb: 'off your usual pace' },
  { key: 'poor', min: -2.0, label: 'a weak one', blurb: 'well off your normal form' },
  { key: 'bad', min: -Infinity, label: 'rough run', blurb: 'shake it off and go again' },
];

function mean(xs) {
  return xs.reduce((a, x) => a + x, 0) / xs.length;
}

function stdev(xs, mu) {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// Linear interpolation across the ramp stops, clamped at both ends.
// Returns { h, s, l } so callers can render it however they like — CSS in the
// browser, a truecolor escape in the terminal.
export function rampHsl(z) {
  const first = RAMP[0];
  const last = RAMP[RAMP.length - 1];
  if (z <= first[0]) return { h: first[1], s: first[2], l: first[3] };
  if (z >= last[0]) return { h: last[1], s: last[2], l: last[3] };
  for (let i = 0; i < RAMP.length - 1; i += 1) {
    const [z0, h0, s0, l0] = RAMP[i];
    const [z1, h1, s1, l1] = RAMP[i + 1];
    if (z <= z1) {
      const t = (z - z0) / (z1 - z0);
      return { h: lerp(h0, h1, t), s: lerp(s0, s1, t), l: lerp(l0, l1, t) };
    }
  }
  return { h: last[1], s: last[2], l: last[3] };
}

export function colorFor(z) {
  const { h, s, l } = rampHsl(z);
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

// HSL → 0–255 RGB, for callers that need real channel values.
export function rgbFor(z) {
  const { h, s, l } = rampHsl(z);
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Share of baseline runs this one beat, 0–100.
function percentileOf(value, xs) {
  const beaten = xs.filter((x) => x < value).length;
  const tied = xs.filter((x) => x === value).length;
  return Math.round(((beaten + tied / 2) / xs.length) * 100);
}

/**
 * Pick the runs a new run should be judged against.
 * @param {Array} runs   every stored run: { wpm, mode, difficulty, at, ... }
 * @param {object} cat   { mode, difficulty } of the run being graded
 * @returns the most recent same-category runs, oldest first
 */
export function baselineFor(runs, { mode, difficulty } = {}) {
  const sameCategory = runs.filter(
    (r) => r.mode === mode && (mode === 'quotes' || r.difficulty === difficulty),
  );
  return sameCategory.slice(-WINDOW);
}

/**
 * Score a finished run and grade it against the player's history.
 * @param {object} run   the run just finished: { wpm, accuracy, mode, difficulty }
 * @param {Array} runs   all previous runs (the new one must NOT be included)
 * @returns {{
 *   score: number, ready: boolean, tier: string, label: string, blurb: string,
 *   color: string, z: number, avg: number, best: number, delta: number,
 *   percentile: number, sample: number, needed: number, position: number
 * }}  `score` is always meaningful. `ready: false` means there isn't enough
 *     history to grade it — `color` is neutral and only `sample`/`needed`
 *     carry information.
 */
export function gradeRun(run, runs) {
  const score = scoreOf(run);
  const base = baselineFor(runs, run);
  const short = MIN_BASELINE - base.length;
  if (base.length < MIN_BASELINE) {
    return {
      score,
      ready: false,
      tier: 'unknown',
      label: 'building your baseline',
      blurb: `${short} more run${short === 1 ? '' : 's'} in this category and we can grade it`,
      color: 'var(--accent)',
      z: 0, avg: 0, best: 0, delta: 0, percentile: 50,
      sample: base.length, needed: MIN_BASELINE, position: 0.5,
    };
  }

  const scores = base.map(scoreOf);
  const avg = mean(scores);
  // Floor the spread. Without it a metronomic typist gets a "rough run" verdict
  // off five points of ordinary noise — on a 25-word test that swing is a
  // single stumble, not a bad run. 8% of average (min 3) is roughly the wobble
  // no one can type their way out of, so it never counts against them.
  const sigma = Math.max(stdev(scores, avg), avg * 0.08, 3);
  const z = (score - avg) / sigma;
  const tier = TIERS.find((t) => z >= t.min);

  return {
    score,
    ready: true,
    tier: tier.key,
    label: tier.label,
    blurb: tier.blurb,
    color: colorFor(z),
    z: Math.round(z * 100) / 100,
    avg: Math.round(avg),
    best: Math.round(Math.max(...scores)),
    delta: Math.round(score - avg) || 0, // `|| 0` so a hair under average isn't "-0"
    percentile: percentileOf(score, scores),
    sample: base.length,
    needed: MIN_BASELINE,
    // Where to draw the marker on a -2σ…+2σ meter, 0–1.
    position: Math.min(1, Math.max(0, (z + 2) / 4)),
  };
}
