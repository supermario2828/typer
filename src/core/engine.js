// The typing engine: a UI-agnostic state machine. Feed it printable characters
// and backspaces; ask it for a snapshot of render + metric state. Both the web
// UI and the terminal client drive this same class.
import { wpm, accuracy, consistency, perSecondWpm, round } from './metrics.js';

export const STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done' };

export class TypingEngine {
  constructor(target) {
    this.target = target;
    this.reset(target);
  }

  reset(target = this.target) {
    this.target = target;
    this.input = '';
    this.status = STATUS.IDLE;
    this.startTime = null;
    this.endTime = null;
    this.totalKeystrokes = 0; // every printable char typed (incl. later deleted)
    this.correctKeystrokes = 0; // of those, how many matched at type-time
    this.samples = []; // [{ t, k }] cumulative keystrokes over time (raw wpm)
  }

  now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  elapsed() {
    if (!this.startTime) return 0;
    return (this.endTime ?? this.now()) - this.startTime;
  }

  /** Handle a single printable character. Returns true if state changed. */
  type(ch) {
    if (this.status === STATUS.DONE) return false;
    if (this.input.length >= this.target.length) return false;

    if (this.status === STATUS.IDLE) {
      this.status = STATUS.RUNNING;
      this.startTime = this.now();
    }

    const expected = this.target[this.input.length];
    this.totalKeystrokes += 1;
    if (ch === expected) this.correctKeystrokes += 1;
    this.input += ch;
    this.samples.push({ t: this.elapsed(), k: this.totalKeystrokes });

    if (this.input.length >= this.target.length) this.finish();
    return true;
  }

  backspace() {
    if (this.status === STATUS.DONE || this.input.length === 0) return false;
    this.input = this.input.slice(0, -1);
    return true;
  }

  finish() {
    if (this.status === STATUS.DONE) return;
    this.status = STATUS.DONE;
    this.endTime = this.now();
  }

  isComplete() {
    return this.status === STATUS.DONE;
  }

  /** Count positions in the current input that match the target. */
  correctChars() {
    let n = 0;
    const len = Math.min(this.input.length, this.target.length);
    for (let i = 0; i < len; i++) if (this.input[i] === this.target[i]) n++;
    return n;
  }

  /** Per-character render model for the current input. */
  cells() {
    const cells = new Array(this.target.length);
    for (let i = 0; i < this.target.length; i++) {
      const t = this.target[i];
      let state;
      if (i < this.input.length) state = this.input[i] === t ? 'correct' : 'incorrect';
      else if (i === this.input.length) state = 'current';
      else state = 'pending';
      cells[i] = { char: t, typed: this.input[i], state };
    }
    return cells;
  }

  /** A full metrics + render snapshot. */
  snapshot() {
    const ms = this.elapsed();
    const correct = this.correctChars();
    const rawSeries = perSecondWpm(this.samples);
    return {
      status: this.status,
      caret: this.input.length,
      total: this.target.length,
      progress: this.target.length ? this.input.length / this.target.length : 0,
      elapsedMs: ms,
      elapsedSec: round(ms / 1000, 1),
      wpm: round(wpm(correct, ms)),
      rawWpm: round(wpm(this.totalKeystrokes, ms)),
      accuracy: round(accuracy(this.correctKeystrokes, this.totalKeystrokes)),
      consistency: round(consistency(rawSeries)),
      correctChars: correct,
      incorrectChars: this.input.length - correct,
      keystrokes: this.totalKeystrokes,
      errors: this.totalKeystrokes - this.correctKeystrokes,
    };
  }
}
