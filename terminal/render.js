// Terminal rendering: ANSI colours + frame builders. Frame functions return a
// string; the orchestrator writes it. Word-safe wrapping mirrors the web
// version — lines only ever break between words, never mid-word.
import { MODES, DIFFICULTIES, LENGTHS } from '../src/core/generator.js';
import { rgbFor, scoreOf } from '../src/core/verdict.js';

export const A = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  white: '\x1b[97m',
  gray: '\x1b[37m',
  red: '\x1b[91m',
  redbg: '\x1b[41m\x1b[97m',
  accent: '\x1b[93m',
  green: '\x1b[92m',
  inverse: '\x1b[7m',
  bold: '\x1b[1m',
};

const cols = () => process.stdout.columns || 80;
export const wrapWidth = () => Math.min(cols() - 6, 78);

// Screen control.
export function draw(frame) {
  process.stdout.write('\x1b[?25l\x1b[H\x1b[0J' + frame);
}
export function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}
export function showCursor() {
  process.stdout.write('\x1b[?25h');
}

function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - visibleLen(s)));
}
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}
function center(s) {
  const w = cols();
  const pre = Math.max(0, Math.floor((w - visibleLen(s)) / 2));
  return ' '.repeat(pre) + s;
}

// Group cells into wrapped lines, keeping each word (plus its trailing space)
// on one line.
function wrapCells(cells, width) {
  const lines = [];
  let line = [];
  let len = 0;
  let i = 0;
  while (i < cells.length) {
    const token = [];
    while (i < cells.length && cells[i].char !== ' ') token.push(cells[i++]);
    if (i < cells.length && cells[i].char === ' ') token.push(cells[i++]); // trailing space
    if (len + token.length > width && len > 0) { lines.push(line); line = []; len = 0; }
    for (const c of token) line.push(c);
    len += token.length;
  }
  if (line.length) lines.push(line);
  return lines;
}

function colorCell(c) {
  const isSpace = c.char === ' ';
  const glyph = isSpace ? ' ' : c.char;
  switch (c.state) {
    case 'current': return A.inverse + A.accent + glyph + A.reset;
    case 'correct': return A.white + glyph + A.reset;
    case 'incorrect': return (isSpace ? A.redbg : A.red) + glyph + A.reset;
    default: return A.dim + glyph + A.reset;
  }
}

function bar(progress, width = 24) {
  const filled = Math.round(progress * width);
  return A.accent + '█'.repeat(filled) + A.dim + '░'.repeat(width - filled) + A.reset;
}

const INDENT = '  ';

function textBlock(cells) {
  const lines = wrapCells(cells, wrapWidth());
  return lines.map((ln) => INDENT + ln.map(colorCell).join('')).join('\n');
}

function title(cfg) {
  const cat = cfg.mode === 'quotes'
    ? MODES.quotes.label
    : `${MODES[cfg.mode].label} · ${cfg.difficulty} · ${cfg.length}`;
  return `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  ${cat}${A.reset}`;
}

// ---- frames -------------------------------------------------------------

export function renderMenu(cfg, best, auth = {}, dev = {}) {
  const seg = (items, cur) => items
    .map((v) => (v === cur ? `${A.accent}[${v}]${A.reset}` : `${A.dim} ${v} ${A.reset}`))
    .join(' ');
  const modeKeys = Object.keys(MODES);
  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨  TYPER${A.reset}${A.dim} — typing speed & accuracy (terminal)${A.reset}`);
  if (auth.signedIn) {
    L.push(INDENT + `${A.green}● signed in as ${auth.name}${A.reset}${A.dim} — your runs post to the leaderboard${A.reset}`);
  } else if (auth.hasCreds) {
    L.push(INDENT + `${A.dim}○ not signed in — press ${A.reset}${A.white}g${A.reset}${A.dim} to sign in with Google${A.reset}`);
  } else {
    L.push(INDENT + `${A.dim}○ not signed in (Google sign-in not configured — see README)${A.reset}`);
  }
  L.push(INDENT + `${A.dim}on ${A.reset}${dev.named ? A.white : A.dim}${dev.name || '—'}${A.reset}${A.dim}${dev.named ? '' : ' (unnamed)'} — press ${A.reset}${A.white}n${A.reset}${A.dim} to rename${A.reset}`
    + (dev.updateAvailable ? `   ${A.accent}★ update available (${A.reset}${A.white}u${A.reset}${A.accent})${A.reset}` : ''));
  L.push('');
  L.push(INDENT + `${A.gray}mode        ${A.reset}${seg(modeKeys, cfg.mode)}`);
  const dimDiff = cfg.mode === 'quotes';
  L.push(INDENT + `${A.gray}difficulty  ${A.reset}${dimDiff ? A.dim + '(n/a for quotes)' + A.reset : seg(DIFFICULTIES, cfg.difficulty)}`);
  L.push(INDENT + `${A.gray}length      ${A.reset}${dimDiff ? A.dim + '(full quote)' + A.reset : seg(LENGTHS.map(String), String(cfg.length))}`);
  L.push('');
  if (best && best.count) {
    L.push(INDENT + `${A.green}best ${best.bestScore}${A.reset}${A.dim}  ·  avg ${best.avgScore} score  ·  ${best.bestWpm} wpm best  ·  ${best.avgAcc}% acc  ·  ${best.count} tests in this category${A.reset}`);
    L.push('');
  }
  L.push(INDENT + `${A.dim}keys:${A.reset} ${A.white}m${A.reset} mode   ${A.white}d${A.reset} difficulty   ${A.white}l${A.reset} length   ${A.white}s${A.reset} stats   ${A.white}b${A.reset} leaderboard`);
  L.push(INDENT + `      ${A.white}n${A.reset} name device   ${A.white}u${A.reset} update   ${A.accent}⏎ Enter${A.reset} start    ${A.white}q${A.reset} quit`);
  L.push('');
  return L.join('\n') + '\n';
}

export function renderDevice(opts) {
  const { draft, current, named, signedIn, saved, syncErr } = opts;
  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  name this device${A.reset}`);
  L.push('');
  L.push(INDENT + `${A.dim}Shown next to your scores on the global leaderboard, so you can tell${A.reset}`);
  L.push(INDENT + `${A.dim}your machines apart. ${A.reset}${A.gray}currently:${A.reset} ${A.white}${current}${A.reset}${named ? '' : `${A.dim} (hostname — not named yet)${A.reset}`}`);
  L.push('');
  L.push(INDENT + `${A.gray}name  ${A.reset}${A.accent}${draft}${A.reset}${A.inverse} ${A.reset}`);
  L.push('');
  if (saved) {
    L.push(INDENT + (saved.synced
      ? `${A.green}✓ saved and synced to your account${A.reset}`
      : `${A.green}✓ saved on this machine${A.reset}${A.dim}${signedIn ? " — couldn't reach your account" : ' (sign in to sync it to your account)'}${A.reset}`));
    if (syncErr) L.push(INDENT + `${A.dim}${syncErr}${A.reset}`);
  } else if (!signedIn) {
    L.push(INDENT + `${A.dim}not signed in — the name stays on this machine until you sign in.${A.reset}`);
  }
  L.push('');
  L.push(INDENT + `${A.accent}⏎ Enter${A.reset} save   ${A.white}Esc${A.reset} cancel   ${A.dim}(empty name = back to the hostname)${A.reset}`);
  L.push('');
  return L.join('\n') + '\n';
}

export function renderUpdate(u) {
  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  update${A.reset}`);
  L.push('');

  if (u.phase === 'checking') {
    L.push(INDENT + `${A.dim}checking GitHub for a newer version…${A.reset}`);
  } else if (u.phase === 'error') {
    L.push(INDENT + `${A.red}couldn't check for updates${A.reset}`);
    L.push(INDENT + `${A.dim}${u.err}${A.reset}`);
  } else if (u.kind === 'npx') {
    L.push(INDENT + `${A.white}You're running via npx.${A.reset}`);
    L.push(INDENT + `${A.dim}npx fetches the latest main every time, so there's nothing to update.${A.reset}`);
  } else if (u.kind === 'checkout') {
    L.push(INDENT + `${A.white}You're running from a git checkout.${A.reset}`);
    L.push(INDENT + `${A.dim}Update it with ${A.reset}${A.accent}git pull${A.reset}${A.dim} in ${u.root}${A.reset}`);
  } else if (u.phase === 'current') {
    L.push(INDENT + `${A.green}✓ up to date${A.reset}${A.dim}  — you have the latest commit on main (${u.sha})${A.reset}`);
    if (u.message) L.push(INDENT + `${A.dim}${trunc(u.message, 62)}${A.reset}`);
  } else if (u.phase === 'available') {
    L.push(INDENT + `${A.accent}${A.bold}★ an update is available${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.gray}${pad('latest', 12)}${A.reset}${A.white}${u.sha}${A.reset}${A.dim}  ${trunc(u.message || '', 48)}${A.reset}`);
    L.push(INDENT + `${A.gray}${pad('pushed', 12)}${A.reset}${A.dim}${timeAgo(u.commitAt)}${A.reset}`);
    L.push(INDENT + `${A.gray}${pad('installed', 12)}${A.reset}${A.dim}${timeAgo(u.installedAt)}${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.dim}will run:${A.reset}`);
    L.push(INDENT + `${A.accent}${u.cmd}${A.reset}`);
  }

  L.push('');
  if (u.phase === 'available') {
    L.push(INDENT + `${A.accent}u${A.reset} update now   ${A.white}r${A.reset} re-check   ${A.accent}⏎${A.reset}/${A.white}Esc${A.reset} menu`);
  } else if (u.phase === 'checking') {
    L.push(INDENT + `${A.white}Esc${A.reset}${A.dim} menu${A.reset}`);
  } else {
    L.push(INDENT + `${A.white}r${A.reset} re-check   ${A.accent}⏎${A.reset}/${A.white}Esc${A.reset} menu   ${A.white}q${A.reset} quit`);
  }
  L.push('');
  return L.join('\n') + '\n';
}

export function renderTest(engine, cfg, opts = {}) {
  const L = [];
  L.push('');
  L.push(INDENT + title(cfg));
  L.push('');
  L.push(textBlock(engine.cells()));
  L.push('');
  if (opts.countdown != null) {
    L.push(INDENT + `${A.accent}${A.bold}get ready… ${opts.countdown}${A.reset}`);
  } else {
    const s = opts.snapshot;
    L.push(INDENT
      + `${A.accent}${A.bold}${s.wpm}${A.reset}${A.dim} wpm${A.reset}   `
      + `${A.white}${s.accuracy}%${A.reset}${A.dim} acc${A.reset}   `
      + `${A.dim}${s.elapsedSec}s${A.reset}   `
      + bar(s.progress));
  }
  L.push('');
  L.push(INDENT + `${A.dim}Tab restart · Esc menu · Ctrl-C quit${A.reset}`);
  L.push('');
  return L.join('\n') + '\n';
}

// The verdict colour. Most modern terminals do 24-bit, which is what the ramp
// was designed for; anywhere else we fall back to the four basic colours the
// rest of this file already uses, so the grade still reads even on a plain tty.
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM || '');
function verdictColor(v) {
  if (!v || !v.ready) return A.accent;
  if (TRUECOLOR) {
    const [r, g, b] = rgbFor(v.z);
    return `\x1b[38;2;${r};${g};${b}m`;
  }
  if (v.z >= 1.0) return A.green;
  if (v.z >= -0.35) return A.accent;
  return A.red;
}

// [====|===o==] — the marker sits where this run landed between -2σ and +2σ of
// the player's own spread; the pipe in the middle is their average.
function verdictMeter(v, color, width = 21) {
  const mid = Math.floor(width / 2);
  const at = Math.min(width - 1, Math.max(0, Math.round(v.position * (width - 1))));
  let bar = '';
  for (let i = 0; i < width; i += 1) {
    if (i === at) bar += `${color}o${A.reset}${A.dim}`;
    else if (i === mid) bar += '|';
    else bar += '=';
  }
  return `${A.dim}[${bar}]${A.reset}`;
}

export function renderResults(s, run, isPB, verdict) {
  const L = [];
  const vc = verdictColor(verdict);
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  result${A.reset}`);
  L.push('');
  if (verdict) {
    L.push(INDENT + `${vc}${A.bold}${String(verdict.score).padStart(3)}${A.reset}${A.dim} score${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.white}${s.wpm} wpm${A.reset}${A.dim}  ·  ${A.reset}${A.white}${s.accuracy}% accuracy${A.reset}`);
  } else {
    L.push(INDENT + `${A.accent}${A.bold}${String(s.wpm).padStart(3)} wpm${A.reset}    ${A.green}${s.accuracy}% accuracy${A.reset}`);
  }
  if (isPB) L.push(INDENT + `${A.accent}★ new personal best${A.reset}`);
  if (verdict) {
    L.push('');
    if (!verdict.ready) {
      L.push(INDENT + `${A.dim}${verdict.label} — ${verdict.blurb}${A.reset}`);
    } else {
      const sign = verdict.delta > 0 ? '+' : verdict.delta < 0 ? '−' : '±';
      L.push(INDENT + `${vc}${A.bold}${verdict.label.toUpperCase()}${A.reset}`);
      L.push(INDENT + `${verdictMeter(verdict, vc)}  ${vc}${sign}${Math.abs(verdict.delta)}${A.reset}${A.dim} vs your ${verdict.avg} avg score${A.reset}`);
      L.push(INDENT + `${A.dim}beats ${verdict.percentile}% of your last ${verdict.sample}${A.reset}`);
    }
  }
  L.push('');
  const row = (k, v) => INDENT + `${A.gray}${pad(k, 14)}${A.reset}${A.white}${v}${A.reset}`;
  L.push(row('raw wpm', s.rawWpm));
  L.push(row('consistency', s.consistency + '%'));
  L.push(row('time', s.elapsedSec + 's'));
  L.push(row('characters', s.correctChars));
  L.push(row('errors', s.incorrectChars));
  L.push(row('keystrokes', s.keystrokes));
  if (run.author) L.push(INDENT + `${A.dim}— ${run.author}${A.reset}`);
  L.push('');
  L.push(INDENT + `${A.accent}⏎ Enter${A.reset} next   ${A.white}r${A.reset} retry same   ${A.white}m${A.reset} menu   ${A.white}q${A.reset} quit`);
  L.push('');
  return L.join('\n') + '\n';
}

export function renderSignin(opts) {
  const { flow, url, userCode, verifyUrl, opened, switched, err, done } = opts;
  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  sign in with Google${A.reset}`);
  L.push('');

  if (err) {
    L.push(INDENT + `${A.red}sign-in failed:${A.reset} ${A.dim}${err}${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.accent}⏎${A.reset}/${A.white}Esc${A.reset} back to menu`);
  } else if (done) {
    L.push(INDENT + `${A.green}✓ signed in!${A.reset}`);
  } else if (flow === 'device') {
    // No browser here (headless box, SSH, container): the user approves on any
    // other device by typing a short code.
    L.push(INDENT + `${A.dim}No browser on this machine — approve from your phone or another computer.${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.white}1.${A.reset} go to ${A.accent}${verifyUrl || 'https://www.google.com/device'}${A.reset}`);
    L.push(INDENT + `${A.white}2.${A.reset} enter this code:`);
    L.push('');
    L.push(INDENT + `   ${A.accent}${A.bold}${spaced(userCode)}${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.dim}waiting for approval…  (${A.reset}${A.white}Esc${A.reset}${A.dim} to cancel)${A.reset}`);
  } else {
    if (switched) L.push(INDENT + `${A.dim}couldn't open a browser — switching to code sign-in…${A.reset}`);
    L.push(INDENT + (opened === false
      ? `${A.white}Couldn't open a browser automatically.${A.reset} ${A.dim}Open this URL yourself:${A.reset}`
      : `${A.white}A browser window should have opened.${A.reset} ${A.dim}Approve access to continue.${A.reset}`));
    L.push('');
    if (opened !== false) L.push(INDENT + `${A.dim}If it didn't open, paste this URL into your browser:${A.reset}`);
    L.push(INDENT + `${A.accent}${url || '…'}${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.dim}waiting for you to finish in the browser…  (${A.reset}${A.white}Esc${A.reset}${A.dim} to cancel)${A.reset}`);
  }
  L.push('');
  return L.join('\n') + '\n';
}

// "ABCD-EFGH" -> "A B C D - E F G H": device codes get read off one screen and
// typed into another, and the extra tracking makes that much less error-prone.
function spaced(code) {
  return (code || '…').split('').join(' ');
}

export function renderLeaderboard(cfg, opts) {
  const { period, metric, rows, loading, err, myUid } = opts;
  const cat = cfg.mode === 'quotes'
    ? MODES.quotes.label
    : `${MODES[cfg.mode].label} · ${cfg.difficulty}`;
  const periodLabel = { day: 'today', month: 'this month', all: 'all time' }[period];
  const metricLabel = { score: 'best score', accuracy: 'most accurate', wpm: 'fastest' }[metric] || 'best score';

  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}🏆 TYPER${A.reset}${A.dim}  global leaderboard${A.reset}`);
  L.push('');
  L.push(INDENT + `${A.gray}category ${A.reset}${A.accent}${cat}${A.reset}   ${A.gray}·${A.reset}   ${A.white}${metricLabel}${A.reset}   ${A.gray}·${A.reset}   ${A.white}${periodLabel}${A.reset}`);
  L.push('');

  if (loading) {
    L.push(INDENT + `${A.dim}loading leaderboard…${A.reset}`);
  } else if (err) {
    L.push(INDENT + `${A.red}couldn't load leaderboard${A.reset}`);
    L.push(INDENT + `${A.dim}${err}${A.reset}`);
  } else if (!rows.length) {
    L.push(INDENT + `${A.dim}no scores for this category & period yet.${A.reset}`);
  } else {
    // All three numbers, with the ranked one highlighted, so the sort order is
    // readable without checking the header.
    const head = (key, label) => (metric === key ? A.accent : A.gray) + pad(label, 8) + A.reset;
    L.push(INDENT + `${A.gray}${pad('#', 4)}${pad('player', 22)}${A.reset}`
      + head('score', 'score') + head('wpm', 'wpm') + head('accuracy', 'acc') + `${A.gray}device${A.reset}`);
    rows.forEach((r, i) => {
      const col = (key, text) => (metric === key ? A.accent : A.dim) + pad(text, 8) + A.reset;
      const rank = i < 3 ? A.accent + pad(String(i + 1), 4) + A.reset : A.dim + pad(String(i + 1), 4) + A.reset;
      const me = myUid && r.uid === myUid;
      const name = trunc(r.name || 'Player', 20) + (me ? ' (you)' : '');
      L.push(INDENT
        + rank
        + (me ? A.accent : A.white) + pad(name, 22) + A.reset
        + col('score', String(scoreOf(r)))
        + col('wpm', String(r.wpm))
        + col('accuracy', r.accuracy + '%')
        + A.dim + (r.device || '—') + A.reset);
    });
  }
  L.push('');
  L.push(INDENT + `${A.dim}keys:${A.reset} ${A.white}p${A.reset} period   ${A.white}t${A.reset} score/fastest/accurate   ${A.white}r${A.reset} refresh   ${A.accent}⏎${A.reset}/${A.white}Esc${A.reset} menu   ${A.white}q${A.reset} quit`);
  L.push(INDENT + `${A.dim}category follows your menu selection (mode + difficulty).${A.reset}`);
  L.push('');
  return L.join('\n') + '\n';
}

function trunc(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function renderStats(profile, device, sum) {
  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  stats — ${profile} @ ${device}${A.reset}`);
  L.push('');
  if (!sum.count) {
    L.push(INDENT + `${A.dim}No runs yet. Play a test and your stats will show here.${A.reset}`);
  } else {
    L.push(INDENT + `${A.green}best ${sum.bestScore}${A.reset}   ${A.white}avg ${sum.avgScore}${A.reset}${A.dim} score${A.reset}   ${A.dim}·${A.reset}   ${A.white}best ${sum.bestWpm} wpm${A.reset}   ${A.white}avg ${sum.avgAcc}% acc${A.reset}   ${A.dim}${sum.count} tests${A.reset}`);
    L.push('');
    const spark = sparkline(sum.all.slice(-40).map(scoreOf));
    if (spark) L.push(INDENT + spark);
    L.push('');
    L.push(INDENT + `${A.gray}${pad('score', 7)}${pad('wpm', 7)}${pad('acc', 7)}${pad('mode', 22)}${pad('time', 7)}when${A.reset}`);
    for (const r of sum.recent) {
      const mode = `${r.mode}${r.difficulty && r.difficulty !== '—' ? ' · ' + r.difficulty : ''}`;
      L.push(INDENT
        + A.accent + pad(String(scoreOf(r)), 7) + A.reset
        + A.white + pad(String(r.wpm), 7) + A.reset
        + A.white + pad(r.accuracy + '%', 7) + A.reset
        + A.dim + pad(mode, 22) + pad(r.seconds + 's', 7) + timeAgo(r.at) + A.reset);
    }
  }
  L.push('');
  L.push(INDENT + `${A.accent}⏎ Enter${A.reset} back to menu   ${A.white}q${A.reset} quit`);
  L.push('');
  return L.join('\n') + '\n';
}

// The score trend as block characters — the terminal's answer to the web
// sparkline. Same truncated axis, for the same reason: scores sit in a narrow
// band well above zero, so anchoring there flattens real progress into a
// straight line. A terminal row can't carry a drawn axis, so both ends of the
// scale are printed beside it rather than left to be guessed.
const BLOCKS = '▁▂▃▄▅▆▇█';
function sparkline(scores) {
  if (scores.length < 2) return '';
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min;
  const cells = scores.map((v) => {
    const t = span === 0 ? 0.5 : (v - min) / span; // flat history sits mid-height
    return BLOCKS[Math.round(t * (BLOCKS.length - 1))];
  }).join('');
  return `${A.dim}${min}${A.reset} ${A.accent}${cells}${A.reset} ${A.dim}${max}`
    + `   last ${scores.length} runs · scale starts at ${min}, not zero${A.reset}`;
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
