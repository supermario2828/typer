// Terminal rendering: ANSI colours + frame builders. Frame functions return a
// string; the orchestrator writes it. Word-safe wrapping mirrors the web
// version — lines only ever break between words, never mid-word.
import { MODES, DIFFICULTIES, LENGTHS } from '../src/core/generator.js';

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

export function renderMenu(cfg, best, auth = {}) {
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
  L.push('');
  L.push(INDENT + `${A.gray}mode        ${A.reset}${seg(modeKeys, cfg.mode)}`);
  const dimDiff = cfg.mode === 'quotes';
  L.push(INDENT + `${A.gray}difficulty  ${A.reset}${dimDiff ? A.dim + '(n/a for quotes)' + A.reset : seg(DIFFICULTIES, cfg.difficulty)}`);
  L.push(INDENT + `${A.gray}length      ${A.reset}${dimDiff ? A.dim + '(full quote)' + A.reset : seg(LENGTHS.map(String), String(cfg.length))}`);
  L.push('');
  if (best && best.count) {
    L.push(INDENT + `${A.green}best ${best.bestWpm} wpm${A.reset}${A.dim}  ·  avg ${best.avgWpm} wpm  ·  ${best.avgAcc}% acc  ·  ${best.count} tests in this category${A.reset}`);
    L.push('');
  }
  L.push(INDENT + `${A.dim}keys:${A.reset} ${A.white}m${A.reset} mode   ${A.white}d${A.reset} difficulty   ${A.white}l${A.reset} length   ${A.white}s${A.reset} stats   ${A.white}b${A.reset} leaderboard`);
  L.push(INDENT + `      ${A.accent}⏎ Enter${A.reset} start    ${A.white}q${A.reset} quit`);
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

export function renderResults(s, run, isPB) {
  const L = [];
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}⌨ TYPER${A.reset}${A.dim}  result${A.reset}`);
  L.push('');
  L.push(INDENT + `${A.accent}${A.bold}${String(s.wpm).padStart(3)} wpm${A.reset}    ${A.green}${s.accuracy}% accuracy${A.reset}`);
  if (isPB) L.push(INDENT + `${A.accent}★ new personal best${A.reset}`);
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
  const { url, err, done } = opts;
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
  } else {
    L.push(INDENT + `${A.white}A browser window should have opened.${A.reset} ${A.dim}Approve access to continue.${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.dim}If it didn't open, paste this URL into your browser:${A.reset}`);
    L.push(INDENT + `${A.accent}${url || '…'}${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.dim}waiting for you to finish in the browser…  (${A.reset}${A.white}Ctrl-C${A.reset}${A.dim} to cancel)${A.reset}`);
  }
  L.push('');
  return L.join('\n') + '\n';
}

export function renderLeaderboard(cfg, opts) {
  const { period, metric, rows, loading, err, myUid } = opts;
  const cat = cfg.mode === 'quotes'
    ? MODES.quotes.label
    : `${MODES[cfg.mode].label} · ${cfg.difficulty}`;
  const periodLabel = { day: 'today', month: 'this month', all: 'all time' }[period];
  const metricLabel = metric === 'accuracy' ? 'most accurate' : 'fastest';

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
    L.push(INDENT + `${A.gray}${pad('#', 4)}${pad('player', 22)}${pad(metric === 'accuracy' ? 'acc' : 'wpm', 8)}${pad(metric === 'accuracy' ? 'wpm' : 'acc', 8)}device${A.reset}`);
    rows.forEach((r, i) => {
      const primary = metric === 'accuracy' ? `${r.accuracy}%` : `${r.wpm}`;
      const secondary = metric === 'accuracy' ? `${r.wpm}` : `${r.accuracy}%`;
      const rank = i < 3 ? A.accent + pad(String(i + 1), 4) + A.reset : A.dim + pad(String(i + 1), 4) + A.reset;
      const me = myUid && r.uid === myUid;
      const name = trunc(r.name || 'Player', 20) + (me ? ' (you)' : '');
      L.push(INDENT
        + rank
        + (me ? A.accent : A.white) + pad(name, 22) + A.reset
        + A.accent + pad(primary, 8) + A.reset
        + A.dim + pad(secondary, 8) + (r.device || '—') + A.reset);
    });
  }
  L.push('');
  L.push(INDENT + `${A.dim}keys:${A.reset} ${A.white}p${A.reset} period   ${A.white}t${A.reset} fastest/accurate   ${A.white}r${A.reset} refresh   ${A.accent}⏎${A.reset}/${A.white}Esc${A.reset} menu   ${A.white}q${A.reset} quit`);
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
    L.push(INDENT + `${A.green}best ${sum.bestWpm} wpm${A.reset}   ${A.white}avg ${sum.avgWpm} wpm${A.reset}   ${A.white}avg ${sum.avgAcc}% acc${A.reset}   ${A.dim}${sum.count} tests${A.reset}`);
    L.push('');
    L.push(INDENT + `${A.gray}${pad('wpm', 7)}${pad('acc', 7)}${pad('mode', 22)}${pad('time', 7)}when${A.reset}`);
    for (const r of sum.recent) {
      const mode = `${r.mode}${r.difficulty && r.difficulty !== '—' ? ' · ' + r.difficulty : ''}`;
      L.push(INDENT
        + A.accent + pad(String(r.wpm), 7) + A.reset
        + A.white + pad(r.accuracy + '%', 7) + A.reset
        + A.dim + pad(mode, 22) + pad(r.seconds + 's', 7) + timeAgo(r.at) + A.reset);
    }
  }
  L.push('');
  L.push(INDENT + `${A.accent}⏎ Enter${A.reset} back to menu   ${A.white}q${A.reset} quit`);
  L.push('');
  return L.join('\n') + '\n';
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
