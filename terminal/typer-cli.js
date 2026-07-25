#!/usr/bin/env node
// Typer — terminal client. Reuses the exact same engine/generator/metrics as
// the web app (src/core/), so scoring is identical. Stats are stored locally
// per profile + machine in ~/.typer/stats.json.
import { TypingEngine, STATUS } from '../src/core/engine.js';
import { generate, MODES, DIFFICULTIES, LENGTHS } from '../src/core/generator.js';
import { gradeRun, scoreOf } from '../src/core/verdict.js';
import { store } from './store.js';
import { startKeys } from './keys.js';
import { fetchLeaderboard } from './cloud.js';
import { session } from './session.js';
import { checkForUpdate, runUpdate, updateCommand, installKind, PKG_ROOT } from './update.js';
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

// Sign-in transport. `auto` picks the browser loopback flow when this machine
// can actually show a browser and the device-code flow otherwise; the flags are
// escape hatches for when that guess is wrong.
//   --auth=browser|device|auto
//   --auth-port=N   pin the loopback port, so `ssh -L N:127.0.0.1:N host` lets
//                   a remote login redirect back to the browser on your laptop.
const authMode = ['auto', 'browser', 'device'].includes(args.auth) ? args.auth : 'auto';
const authPort = Number.isInteger(Number(args['auth-port'])) ? Number(args['auth-port']) : 0;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// `--device=NAME` names this machine without going through the UI, for setup
// scripts and headless boxes. It's saved before the TTY check so it works even
// where the game itself can't run.
if (args.device !== undefined) {
  const name = store.setDevice(args.device);
  if (store.deviceNamed()) {
    console.log(`Device named "${name}".`);
    console.log('Sign in (press g in the menu) to sync it to your account.');
  } else {
    console.log(`Device name cleared — using hostname "${name}".`);
  }
  process.exit(0);
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
let signin = { flow: null, url: null, userCode: null, err: null, done: false };
let signinAbort = null; // AbortController for an in-flight login (Esc cancels)

// device naming + self-update view state
let device = { draft: '', saved: null, syncErr: null };
let update = { phase: 'checking' };
let updateAvailable = false; // drives the menu hint after the startup check

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
      }, {
        name: store.device(),
        named: store.deviceNamed(),
        updateAvailable,
      }));
      break;
    case 'device':
      R.draw(R.renderDevice({
        draft: device.draft,
        current: store.device(),
        named: store.deviceNamed(),
        signedIn: !!session.user,
        saved: device.saved,
        syncErr: device.syncErr,
      }));
      break;
    case 'update':
      R.draw(R.renderUpdate({ ...update, cmd: updateCommand(), root: PKG_ROOT }));
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
      R.draw(R.renderResults(engine.snapshot(), { ...meta, mode: cfg.mode }, meta._isPB, meta._verdict));
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
  // Graded before the save, so a run is never part of its own baseline. The PB
  // follows the score, so it means the same thing the headline number does.
  const history = store.runs(profile);
  meta._verdict = gradeRun(run, history);
  const bestScore = Math.max(0, ...history
    .filter((r) => r.mode === run.mode && (run.mode === 'quotes' || r.difficulty === run.difficulty))
    .map(scoreOf));
  meta._isPB = meta._verdict.score > 0 && meta._verdict.score > bestScore;
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
// Human-readable endings for the AuthError codes google-auth.js raises. Anything
// not listed falls through to the raw message.
const SIGNIN_ERRORS = {
  'no-oauth-creds': 'Google sign-in is not configured in this build (see README: CLI Google sign-in).',
  'no-device-creds': 'The device-code flow is not configured in this build (see README: CLI Google sign-in).',
  denied: 'You declined the permission request.',
  timeout: 'Timed out waiting for approval.',
  cancelled: 'Cancelled.',
  network: 'Could not reach Google. Check your connection or proxy, then try again.',
  'port-in-use': 'That --auth-port is already in use. Pick another, or drop the flag to use any free port.',
  'no-browser': 'No browser could be opened, and no fallback flow is configured. Open the URL above by hand.',
};

async function startSignIn() {
  stopTimers();
  signinAbort = new AbortController();
  state = 'signin';
  signin = { flow: null, url: null, userCode: null, verifyUrl: null, opened: null, err: null, done: false };
  R.clearScreen();
  render();
  try {
    await session.signIn({
      mode: authMode,
      port: authPort,
      signal: signinAbort.signal,
      onProgress: (info) => {
        if (state !== 'signin') return;
        if (info.flow === 'switching') signin.switched = true;
        else Object.assign(signin, info);
        render();
      },
    });
    // Reconcile this machine's name with the account now that we have a uid.
    await session.syncDeviceName();
    if (state !== 'signin') return;
    signin.done = true;
    render();
    setTimeout(() => { if (state === 'signin') toMenu(); }, 900);
  } catch (e) {
    if (state !== 'signin') return;
    signin.err = SIGNIN_ERRORS[e?.code] || e?.message || String(e);
    render();
  } finally {
    signinAbort = null;
  }
}

// ---- device name --------------------------------------------------------
function openDevice() {
  stopTimers();
  state = 'device';
  // Pre-fill with the current name so a tweak doesn't mean retyping it; the
  // hostname fallback starts empty, since that's a guess and not a choice.
  device = { draft: store.deviceNamed() ? store.device() : '', saved: null, syncErr: null };
  R.clearScreen();
  render();
}

async function saveDevice() {
  const res = await session.setDeviceName(device.draft);
  if (state !== 'device') return;
  device.saved = res;
  device.syncErr = res.err || null;
  render();
  setTimeout(() => { if (state === 'device') toMenu(); }, res.synced ? 900 : 1600);
}

function deviceKey(key) {
  if (key.name === 'escape') return toMenu();
  if (device.saved) return; // already saved, returning to the menu — ignore keys
  if (key.name === 'enter') return saveDevice();
  if (key.name === 'backspace') {
    device.draft = device.draft.slice(0, -1);
    return render();
  }
  if (key.name === 'char' && device.draft.length < 32) {
    device.draft += key.char;
    render();
  }
}

// ---- self-update --------------------------------------------------------
function openUpdate() {
  stopTimers();
  state = 'update';
  R.clearScreen();
  return checkUpdate();
}

// `background` runs the same check on startup purely to light up the menu hint,
// without stealing the screen.
async function checkUpdate({ background = false } = {}) {
  if (!background) { update = { phase: 'checking' }; render(); }
  const res = await checkForUpdate();
  updateAvailable = res.status === 'available';
  if (background) {
    if (state === 'menu') render();
    return;
  }
  if (state !== 'update') return;
  update = {
    phase: res.status === 'unknown' ? 'error' : res.status,
    kind: res.kind,
    err: res.err,
    sha: res.sha,
    message: res.message,
    commitAt: res.commitAt,
    installedAt: res.installedAt,
  };
  render();
}

// Hand the terminal to npm: leave raw mode and the full-screen UI so its output
// (and any EACCES) is plainly visible, then exit — the code running in memory is
// the old copy, so continuing after a successful update would be a lie.
async function applyUpdate() {
  stopTimers();
  stop();
  R.showCursor();
  R.clearScreen();
  process.stdout.write(`${R.A.dim}${updateCommand()}${R.A.reset}\n\n`);
  const code = await runUpdate();
  if (code === 0) {
    process.stdout.write(`\n${R.A.green}✓ updated — run ${R.A.reset}${R.A.accent}typer${R.A.reset}${R.A.green} again to use the new version.${R.A.reset}\n`);
  } else if (code === -1) {
    process.stdout.write(`\n${R.A.red}Could not run npm.${R.A.reset} ${R.A.dim}Is it on your PATH?${R.A.reset}\n`);
  } else {
    process.stdout.write(`\n${R.A.red}Update failed (npm exited ${code}).${R.A.reset} ${R.A.dim}The output above says why; your install is untouched.${R.A.reset}\n`);
  }
  process.exit(code === 0 ? 0 : 1);
}

function updateKey(key) {
  if (key.name === 'enter' || key.name === 'escape') return toMenu();
  if (key.name !== 'char') return;
  if (key.char === 'r') return checkUpdate();
  if (key.char === 'u' && update.phase === 'available') return applyUpdate();
  if (key.char === 'q' && update.phase !== 'checking') return quit();
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
    case 'device': return deviceKey(key);
    case 'update': return updateKey(key);
    case 'signin':
      if (signin.err || signin.done) {
        if (key.name === 'enter' || key.name === 'escape') return toMenu();
        return;
      }
      // Still waiting on the browser / phone: Esc aborts the attempt so the
      // user isn't stuck staring at a flow they can't complete (the device flow
      // polls for minutes) with only Ctrl-C as a way out.
      if (key.name === 'escape') {
        signinAbort?.abort();
        return toMenu();
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
    case 'n': return openDevice();
    case 'u': return openUpdate();
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
session.restore()
  .then(async () => {
    if (session.user) await session.syncDeviceName();
    if (state === 'menu') render();
  })
  .catch(() => {});

// Quietly ask GitHub whether main has moved on, so the menu can show a hint.
// Failures are deliberately silent — no network is not an error worth a screen.
if (installKind() === 'global') checkUpdate({ background: true }).catch(() => {});
