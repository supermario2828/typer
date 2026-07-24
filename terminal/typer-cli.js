#!/usr/bin/env node
// Typer — terminal client. Reuses the exact same engine/generator/metrics as
// the web app (src/core/), so scoring is identical. Stats are stored locally
// per profile + machine in ~/.typer/stats.json.
import { TypingEngine, STATUS } from '../src/core/engine.js';
import { generate, MODES, DIFFICULTIES, LENGTHS } from '../src/core/generator.js';
import { store } from './store.js';
import { startKeys } from './keys.js';
import { fetchLeaderboard } from './cloud.js';
import { session } from './session.js';
import * as R from './render.js';
import os from 'node:os';

// Global-leaderboard submission gate (mirrors the web app).
const LB_MAX_WPM = 300;
const LB_MIN_SECONDS = 2;

// ---- config / args ------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const profile = args.profile || os.userInfo().username || 'player';
const cfg = {
  mode: MODES[args.mode] ? args.mode : 'words',
  difficulty: DIFFICULTIES.includes(args.difficulty) ? args.difficulty : 'medium',
  length: LENGTHS.includes(Number(args.length)) ? Number(args.length) : 25,
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

if (!process.stdin.isTTY) {
  console.error('Typer needs an interactive terminal (TTY). Run it directly, not piped.');
  if (process.platform === 'win32') {
    console.error('On Windows, use Windows Terminal, PowerShell, or cmd — Git Bash/MinTTY');
    console.error('does not provide a real TTY (or prefix with: winpty typer).');
  }
  process.exit(1);
}

// ---- state --------------------------------------------------------------
let state = 'menu';
let engine = null;
let meta = {};
let countN = 3;
let countTimer = null;
let liveTimer = null;

// leaderboard view state
let boardPeriod = 'all';
let boardMetric = 'wpm';
let board = { loading: false, err: null, rows: [] };
let boardReq = 0; // guards against out-of-order async responses
let signin = { url: null, err: null, done: false };

const categoryFilter = () => ({
  mode: cfg.mode,
  ...(cfg.mode === 'quotes' ? {} : { difficulty: cfg.difficulty }),
});

// ---- render dispatch ----------------------------------------------------
function render() {
  switch (state) {
    case 'menu':
      R.draw(R.renderMenu(cfg, store.summary(profile, categoryFilter()), {
        signedIn: !!session.user,
        name: session.displayName(),
        hasCreds: session.hasCreds(),
      }));
      break;
    case 'signin':
      R.draw(R.renderSignin(signin));
      break;
    case 'countdown':
      R.draw(R.renderTest(engine, cfg, { countdown: countN }));
      break;
    case 'test':
      R.draw(R.renderTest(engine, cfg, { snapshot: engine.snapshot() }));
      break;
    case 'results':
      R.draw(R.renderResults(engine.snapshot(), { ...meta, mode: cfg.mode }, meta._isPB));
      break;
    case 'stats':
      R.draw(R.renderStats(profile, store.device(), store.summary(profile)));
      break;
    case 'board':
      R.draw(R.renderLeaderboard(cfg, {
        period: boardPeriod,
        metric: boardMetric,
        rows: board.rows,
        loading: board.loading,
        err: board.err,
        myUid: session.user?.uid,
      }));
      break;
  }
}

// ---- transitions --------------------------------------------------------
function toMenu() {
  stopTimers();
  state = 'menu';
  R.clearScreen();
  render();
}

function newRun() {
  const g = generate(cfg);
  meta = g.meta || {};
  engine = new TypingEngine(g.text);
}

function startCountdown() {
  stopTimers();
  state = 'countdown';
  countN = 3;
  R.clearScreen();
  render();
  countTimer = setInterval(() => {
    countN -= 1;
    if (countN <= 0) {
      clearInterval(countTimer);
      countTimer = null;
      beginTest();
    } else {
      render();
    }
  }, 1000);
}

function beginTest() {
  state = 'test';
  render();
  // Refresh the clock/WPM a few times a second while typing.
  liveTimer = setInterval(() => {
    if (state === 'test' && engine.status === STATUS.RUNNING) render();
  }, 200);
}

function finishTest() {
  stopTimers();
  const s = engine.snapshot();
  const run = {
    mode: cfg.mode,
    difficulty: cfg.mode === 'quotes' ? '—' : cfg.difficulty,
    length: engine.target.length,
    wpm: s.wpm,
    rawWpm: s.rawWpm,
    accuracy: s.accuracy,
    consistency: s.consistency,
    seconds: s.elapsedSec,
    chars: s.correctChars,
    errors: s.incorrectChars,
    author: meta.author || null,
  };
  const prev = store.summary(profile, categoryFilter());
  meta._isPB = s.wpm > 0 && (prev.count === 0 || s.wpm > prev.bestWpm);
  store.addRun(profile, run);

  // Signed in + credible run → post to the global leaderboard, same gate as web.
  if (session.user && run.wpm > 0 && run.wpm <= LB_MAX_WPM && run.seconds >= LB_MIN_SECONDS) {
    session.submitScore(run).catch(() => { /* stay silent; local save already done */ });
  }

  state = 'results';
  R.clearScreen();
  render();
}

function stopTimers() {
  if (countTimer) { clearInterval(countTimer); countTimer = null; }
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

// ---- google sign-in -----------------------------------------------------
async function startSignIn() {
  stopTimers();
  state = 'signin';
  signin = { url: null, err: null, done: false };
  R.clearScreen();
  render();
  try {
    await session.signIn((url) => { signin.url = url; if (state === 'signin') render(); });
    if (state !== 'signin') return;
    signin.done = true;
    render();
    setTimeout(() => { if (state === 'signin') toMenu(); }, 900);
  } catch (e) {
    if (state !== 'signin') return;
    signin.err = e?.message === 'no-oauth-creds'
      ? 'Google sign-in is not configured on this machine (see README: CLI Google sign-in).'
      : (e?.message || String(e));
    render();
  }
}

// ---- leaderboard --------------------------------------------------------
function openBoard() {
  stopTimers();
  state = 'board';
  R.clearScreen();
  loadBoard();
}

async function loadBoard() {
  const req = ++boardReq;
  board = { loading: true, err: null, rows: [] };
  render();
  try {
    const rows = await fetchLeaderboard({
      period: boardPeriod,
      metric: boardMetric,
      mode: cfg.mode,
      difficulty: cfg.mode === 'quotes' ? undefined : cfg.difficulty,
    });
    if (req !== boardReq || state !== 'board') return; // superseded / left
    board = { loading: false, err: null, rows };
  } catch (e) {
    if (req !== boardReq || state !== 'board') return;
    const hint = e?.code === 'auth/operation-not-allowed' || e?.code === 'auth/admin-restricted-operation'
      ? 'Enable Anonymous sign-in in the Firebase console (Authentication → Sign-in method).'
      : e?.code === 'auth/network-request-failed' || /network|fetch|ENOTFOUND/i.test(e?.message || '')
        ? 'No network connection.'
        : (e?.message || String(e));
    board = { loading: false, err: hint, rows: [] };
  }
  render();
}

// ---- input --------------------------------------------------------------
function onKey(key) {
  if (key.name === 'ctrl-c') return quit();

  switch (state) {
    case 'menu': return menuKey(key);
    case 'countdown': return; // ignore input during countdown
    case 'test': return testKey(key);
    case 'results': return resultsKey(key);
    case 'stats':
      if (key.name === 'char' && key.char === 'q') return quit();
      return toMenu();
    case 'board': return boardKey(key);
    case 'signin':
      // Only allow leaving once the flow settled (success/error); ignore keys
      // while still waiting on the browser.
      if (signin.err || signin.done) {
        if (key.name === 'enter' || key.name === 'escape') return toMenu();
      }
      return;
  }
}

function boardKey(key) {
  if (key.name === 'enter' || key.name === 'escape') return toMenu();
  if (key.name !== 'char') return;
  switch (key.char) {
    case 'p': boardPeriod = cycle(['day', 'month', 'all'], boardPeriod); return loadBoard();
    case 't': boardMetric = boardMetric === 'wpm' ? 'accuracy' : 'wpm'; return loadBoard();
    case 'r': return loadBoard();
    case 'q': return quit();
  }
}

function cycle(list, cur, dir = 1) {
  const i = list.indexOf(cur);
  return list[(i + dir + list.length) % list.length];
}

function menuKey(key) {
  if (key.name === 'enter') { newRun(); return startCountdown(); }
  if (key.name !== 'char') return;
  switch (key.char) {
    case 'm': cfg.mode = cycle(Object.keys(MODES), cfg.mode); break;
    case 'd': if (cfg.mode !== 'quotes') cfg.difficulty = cycle(DIFFICULTIES, cfg.difficulty); break;
    case 'l': if (cfg.mode !== 'quotes') cfg.length = cycle(LENGTHS, cfg.length); break;
    case 's': state = 'stats'; R.clearScreen(); render(); return;
    case 'b': return openBoard();
    case 'g':
      if (session.user) { session.signOut().then(render); render(); }
      else startSignIn();
      return;
    case 'q': return quit();
    default: return;
  }
  render();
}

function testKey(key) {
  if (key.name === 'tab') { newRun(); return startCountdown(); }
  if (key.name === 'escape') return toMenu();
  if (key.name === 'backspace') {
    if (engine.backspace()) render();
    return;
  }
  if (key.name === 'char') {
    if (engine.type(key.char)) {
      if (engine.status === STATUS.DONE) return finishTest();
      render();
    }
  }
}

function resultsKey(key) {
  if (key.name === 'enter') { newRun(); return startCountdown(); }
  if (key.name !== 'char') return;
  switch (key.char) {
    case 'r': engine = new TypingEngine(engine.target); return startCountdown();
    case 'm': return toMenu();
    case 'q': return quit();
  }
}

// ---- lifecycle ----------------------------------------------------------
const stop = startKeys(onKey);

function quit() {
  stopTimers();
  stop();
  R.showCursor();
  R.clearScreen();
  process.stdout.write(`${R.A.dim}thanks for playing — stats saved to ${store.file}${R.A.reset}\n`);
  process.exit(0);
}

process.on('exit', () => { R.showCursor(); });
process.on('SIGTERM', quit);

// Silently restore a saved Google session, then show the menu.
R.clearScreen();
render();
session.restore().then(() => { if (state === 'menu') render(); }).catch(() => {});
