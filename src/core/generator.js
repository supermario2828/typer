// Builds the target text for a run from a config. Pure & deterministic given an
// RNG, so the terminal version and tests can reproduce runs if needed.
import { WORD_BANKS, PUNCTUATION } from './words.js';
import { QUOTES } from './texts.js';

const rand = (rng) => (rng ? rng() : Math.random());
const pick = (arr, rng) => arr[Math.floor(rand(rng) * arr.length)];

export const MODES = {
  words: { label: 'Words', hint: 'lowercase words only' },
  punctuation: { label: 'Punctuation', hint: 'capitals, commas, periods' },
  numbers: { label: 'Numbers', hint: 'words mixed with digits' },
  quotes: { label: 'Quotes', hint: 'real sentences & authors' },
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Available word-count lengths for the generated modes.
export const LENGTHS = [10, 25, 50, 100];

function randomWords(n, difficulty, rng) {
  const bank = WORD_BANKS[difficulty] || WORD_BANKS.medium;
  const out = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(rand(rng) * bank.length);
    if (idx === last && bank.length > 1) idx = (idx + 1) % bank.length; // avoid dupes back-to-back
    last = idx;
    out.push(bank[idx]);
  }
  return out;
}

function capitalize(w) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * @param {object} cfg
 * @param {'words'|'punctuation'|'numbers'|'quotes'} cfg.mode
 * @param {'easy'|'medium'|'hard'} cfg.difficulty
 * @param {number} cfg.length  word count (ignored for quotes)
 * @param {() => number} [rng]  optional RNG for reproducibility
 * @returns {{ text: string, meta: object }}
 */
export function generate(cfg, rng) {
  const { mode = 'words', difficulty = 'medium', length = 25 } = cfg || {};

  if (mode === 'quotes') {
    const q = pick(QUOTES, rng);
    return { text: q.text, meta: { author: q.author } };
  }

  const words = randomWords(length, difficulty, rng);

  if (mode === 'numbers') {
    // Replace ~20% of words with a 1-4 digit number.
    for (let i = 0; i < words.length; i++) {
      if (rand(rng) < 0.2) {
        const digits = 1 + Math.floor(rand(rng) * 4);
        let num = '';
        for (let d = 0; d < digits; d++) num += Math.floor(rand(rng) * 10);
        words[i] = num;
      }
    }
    return { text: words.join(' '), meta: {} };
  }

  if (mode === 'punctuation') {
    let capitalizeNext = true;
    for (let i = 0; i < words.length; i++) {
      if (capitalizeNext) {
        words[i] = capitalize(words[i]);
        capitalizeNext = false;
      }
      // Sprinkle punctuation after ~18% of words (not the last).
      if (i < words.length - 1 && rand(rng) < 0.18) {
        const mark = pick(PUNCTUATION, rng);
        words[i] += mark;
        if (/[.!?]/.test(mark)) capitalizeNext = true;
      }
    }
    // Ensure it ends with a period.
    const lastWord = words[words.length - 1];
    if (!/[.!?]$/.test(lastWord)) words[words.length - 1] = lastWord + '.';
    return { text: words.join(' '), meta: {} };
  }

  // default: plain words
  return { text: words.join(' '), meta: {} };
}
