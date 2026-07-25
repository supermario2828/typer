import './style.css';
import { TypingEngine, STATUS } from './core/engine.js';
import { generate, MODES, DIFFICULTIES, LENGTHS } from './core/generator.js';
import { gradeRun, scoreOf } from './core/verdict.js';
import { statsService } from './store/stats.js';
import { authService } from './store/auth.js';
import { deviceService } from './store/device.js';
import { initAnalytics } from './firebase/config.js';

// ---------------------------------------------------------------- constants
const REPO_URL = 'https://github.com/supermario2828/typer';
// Install the terminal version (needs Node.js 18+). Two npm quirks are baked
// into every command below:
//   1. We install from the GitHub *tarball* URL, not `github:user/repo` — the
//      git-URL form makes npm symlink the global package to a temp clone it
//      then deletes (dangling `typer`).
//   2. `--allow-remote=all` is required: as of npm 12 `allow-remote` defaults
//      to "none", so installing a tarball URL off the registry's host fails
//      with EALLOWREMOTE. Older npm just warns about the unknown config.
const CLI_TARBALL = 'https://github.com/supermario2828/typer/tarball/main';

// There is no one global-install string that is correct on every OS, so we show
// the right one per platform:
//   • Linux — distro-packaged npm (Arch, Debian) has a global prefix of `/usr`,
//     which the user can't write to → EACCES. `--prefix ~/.local` installs into
//     the home dir instead. It's a per-command flag, so it never clobbers an
//     existing nvm/fnm prefix the way `npm config set prefix` would.
//   • macOS/Windows — Homebrew, nvm and the Windows installer all use a
//     user-writable prefix already, and `~` doesn't expand in cmd/PowerShell.
//   • npx — the only genuinely universal line: it caches under the user's own
//     `~/.npm`, so it can't hit a permission wall on any OS.
const CLI_INSTALLS = {
  linux: {
    label: 'Linux',
    cmd: `npm install -g --prefix ~/.local --allow-remote=all ${CLI_TARBALL}`,
    note: 'installs to <code>~/.local/bin</code> — already on <code>PATH</code> on most distros',
  },
  mac: {
    label: 'macOS',
    cmd: `npm install -g --allow-remote=all ${CLI_TARBALL}`,
    note: 'if you get <code>EACCES</code>, add <code>--prefix ~/.local</code> and put that on your <code>PATH</code>',
  },
  windows: {
    label: 'Windows',
    cmd: `npm install -g --allow-remote=all ${CLI_TARBALL}`,
    note: 'PowerShell or cmd — npm installs to <code>%AppData%\\npm</code>, no admin needed',
  },
  npx: {
    label: 'Any OS (no install)',
    cmd: `npx --yes --allow-remote=all ${CLI_TARBALL}`,
    note: 'runs it straight away and leaves nothing behind — works everywhere',
  },
};

// Best-effort platform guess, defaulting to the universal npx line when the
// browser won't say (userAgentData is Chromium-only; platform is legacy but
// still the most reliable cross-browser hint).
function detectOS() {
  const hint = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  const s = `${hint} ${ua}`;
  if (s.includes('win')) return 'windows';
  if (s.includes('mac') || s.includes('iphone') || s.includes('ipad')) return 'mac';
  if (s.includes('linux') || s.includes('android') || s.includes('x11')) return 'linux';
  return 'npx';
}
let cliOS = detectOS();

// ---------------------------------------------------------------- app state
const cfg = loadConfig();
let engine = null;
let meta = {};
let machineId = '';
let rafId = null;
let armed = false;      // countdown finished → typing accepted
let counting = false;   // countdown in progress
let countTimer = null;
let statsOpen = false;
let boardOpen = false;
let histThisMachine = false;
let boardPeriod = 'day';
let boardMetric = 'score';
let boardMode = cfg.mode;
let boardDifficulty = cfg.difficulty;

const el = {}; // cached DOM refs

// ---------------------------------------------------------------- config persistence
function loadConfig() {
  const def = { mode: 'words', difficulty: 'medium', length: 25 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('typer.config') || '{}') };
  } catch {
    return def;
  }
}
function saveConfig() {
  localStorage.setItem('typer.config', JSON.stringify(cfg));
}

// ---------------------------------------------------------------- boot
async function boot() {
  machineId = await statsService.init();
  deviceService.init(machineId);
  await authService.init();
  renderShell();
  newRun();
  window.addEventListener('keydown', onKeyDown);
  initAnalytics();

  // React to sign-in / sign-out. Fires once on load with the restored session.
  authService.onChange(async (user) => {
    if (user) {
      statsService.setCloudUser(user);
      await deviceService.syncOnSignIn(user.uid);
    } else {
      statsService.setGuest();
    }
    renderAuthArea();
    renderDeviceBar();
    if (statsOpen) renderHistory();
    if (boardOpen) renderBoard();
  });
}

// ---------------------------------------------------------------- shell markup
function renderShell() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="dot">⌨</span> Typer <small>speed &amp; accuracy</small></div>
      <div class="user-area" id="userArea"></div>
    </header>

    <div class="devicebar" id="deviceBar"></div>

    <div class="config" id="config"></div>

    <div class="live hidden" id="live"></div>

    <section class="stage">
      <div class="text" id="text" tabindex="0"></div>
      <div class="overlay" id="overlay"></div>
    </section>

    <!-- The start prompt lives below the text, not on top of it: overlaying it
         means either blurring the words or fighting them for contrast. -->
    <button class="start-hint" id="startHint" type="button">
      <span class="pulse"></span>
      <span>press <kbd>any key</kbd> or click the text to start</span>
    </button>

    <div class="controls">
      <button class="btn" id="btnRestart">↻ new (Tab)</button>
      <button class="btn" id="btnRetry">retry same</button>
      <button class="btn" id="btnStats">stats</button>
      <button class="btn" id="btnBoard">🏆 leaderboard</button>
      <span class="hint">press <kbd>Tab</kbd> for a fresh test · <kbd>Esc</kbd> to reset</span>
    </div>

    <section class="results hidden" id="results"></section>
    <section class="history hidden" id="history"></section>
    <section class="history hidden" id="board"></section>

    <footer class="cli-cta">
      <div class="cli-head">
        <span class="cli-label">▶ install the terminal version:</span>
        <div class="cli-tabs" id="cliTabs">
          ${Object.entries(CLI_INSTALLS).map(([k, v]) => `
            <button class="cli-tab" data-os="${k}">${v.label}</button>
          `).join('')}
        </div>
        <a class="cli-src" href="${REPO_URL}" target="_blank" rel="noopener">source ↗</a>
      </div>
      <div class="cli-row">
        <code id="cliCmd"></code>
        <button class="btn" id="copyCli">copy</button>
      </div>
      <div class="cli-foot">
        <span class="cli-note" id="cliNote"></span>
        <span class="cli-run">needs Node 18+ · then run <code>typer</code></span>
      </div>
    </footer>
  `;

  el.userArea = document.getElementById('userArea');
  el.deviceBar = document.getElementById('deviceBar');
  el.config = document.getElementById('config');
  el.live = document.getElementById('live');
  el.text = document.getElementById('text');
  el.overlay = document.getElementById('overlay');
  el.startHint = document.getElementById('startHint');
  el.results = document.getElementById('results');
  el.history = document.getElementById('history');
  el.board = document.getElementById('board');

  document.getElementById('btnRestart').onclick = () => { newRun(); startCountdown(); };
  document.getElementById('btnRetry').onclick = () => { retry(); startCountdown(); };
  document.getElementById('btnStats').onclick = toggleStats;
  document.getElementById('btnBoard').onclick = toggleBoard;
  el.overlay.onclick = startCountdown;
  el.text.onclick = startCountdown;
  el.startHint.onclick = startCountdown;

  el.cliCmd = document.getElementById('cliCmd');
  el.cliNote = document.getElementById('cliNote');
  document.querySelectorAll('.cli-tab').forEach((tab) => {
    tab.onclick = () => { cliOS = tab.dataset.os; renderCliCmd(); };
  });
  renderCliCmd();

  const copyBtn = document.getElementById('copyCli');
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(CLI_INSTALLS[cliOS].cmd);
      copyBtn.textContent = 'copied ✓';
      setTimeout(() => { copyBtn.textContent = 'copy'; }, 1500);
    } catch {
      // Clipboard blocked (e.g. non-secure context) — select the text instead.
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('cliCmd'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };

  renderAuthArea();
  renderDeviceBar();
  renderConfig();
}

// ---------------------------------------------------------------- cli install
function renderCliCmd() {
  const install = CLI_INSTALLS[cliOS];
  el.cliCmd.textContent = install.cmd;
  el.cliNote.innerHTML = install.note;
  document.querySelectorAll('.cli-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.os === cliOS);
  });
}

// ---------------------------------------------------------------- device bar
function renderDeviceBar() {
  const named = deviceService.hasName();
  el.deviceBar.innerHTML = `
    <span class="dev-lead">typing on</span>
    <button class="device-chip ${named ? '' : 'unset'}" id="deviceChip" title="Name this device">
      <span class="ico">💻</span> <b>${escapeHtml(deviceService.label())}</b> <span class="pencil">✎</span>
    </button>
    ${statsService.identity.kind === 'cloud'
      ? '<span class="dev-note">remembered on your account</span>'
      : '<span class="dev-note">sign in to remember this across visits</span>'}
  `;
  document.getElementById('deviceChip').onclick = renameDevice;
}

async function renameDevice() {
  const current = deviceService.hasName() ? deviceService.label() : '';
  const name = prompt('Name this device (e.g. "MacBook", "Work PC"):', current);
  if (name == null) return;
  const uid = statsService.identity.kind === 'cloud' ? statsService.identity.id : null;
  await deviceService.setName(name, uid);
  renderDeviceBar();
  if (statsOpen) renderHistory();
}

// ---------------------------------------------------------------- auth area
function renderAuthArea() {
  const id = statsService.identity;
  if (id.kind === 'cloud') {
    const avatar = id.photo
      ? `<img class="avatar" src="${id.photo}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="avatar ph">${escapeHtml((id.name[0] || '?').toUpperCase())}</span>`;
    el.userArea.innerHTML = `
      ${avatar}
      <span class="uname" title="${escapeHtml(id.name)}">${escapeHtml(id.name)}</span>
      <button class="btn" id="signOut">sign out</button>
    `;
    document.getElementById('signOut').onclick = async () => {
      await authService.signOut();
    };
  } else {
    el.userArea.innerHTML = `
      <span class="signin-note">stats saved on this device</span>
      <button class="btn primary" id="signIn">
        <span class="g">G</span> Sign in with Google
      </button>
    `;
    document.getElementById('signIn').onclick = signIn;
  }
}

async function signIn() {
  const btn = document.getElementById('signIn');
  if (btn) btn.disabled = true;
  try {
    await authService.signInWithGoogle();
    // onChange handles the re-render.
  } catch (err) {
    const code = err?.code || '';
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      alert('Sign-in failed: ' + (err?.message || code || 'unknown error'));
    }
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------- config bar
function renderConfig() {
  const modeSegs = Object.entries(MODES)
    .map(([k, v]) => `<button class="seg ${cfg.mode === k ? 'active' : ''}" data-mode="${k}" title="${v.hint}">${v.label}</button>`)
    .join('');
  const diffSegs = DIFFICULTIES
    .map((d) => `<button class="seg ${cfg.difficulty === d ? 'active' : ''}" data-diff="${d}">${d}</button>`)
    .join('');
  const lenSegs = LENGTHS
    .map((n) => `<button class="seg ${cfg.length === n ? 'active' : ''}" data-len="${n}">${n}</button>`)
    .join('');

  const gen = cfg.mode !== 'quotes';
  el.config.innerHTML = `
    <div class="group">${modeSegs}</div>
    <div class="sep"></div>
    <div class="group ${gen ? '' : 'disabled'}">${diffSegs}</div>
    <div class="sep"></div>
    <div class="group ${gen ? '' : 'disabled'}">${lenSegs}</div>
  `;

  el.config.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => { cfg.mode = b.dataset.mode; saveConfig(); renderConfig(); newRun(); };
  });
  el.config.querySelectorAll('[data-diff]').forEach((b) => {
    b.onclick = () => { cfg.difficulty = b.dataset.diff; saveConfig(); renderConfig(); newRun(); };
  });
  el.config.querySelectorAll('[data-len]').forEach((b) => {
    b.onclick = () => { cfg.length = Number(b.dataset.len); saveConfig(); renderConfig(); newRun(); };
  });
}

// ---------------------------------------------------------------- run lifecycle
function newRun() {
  const g = generate(cfg);
  meta = g.meta || {};
  engine = new TypingEngine(g.text);
  resetStart();
  el.results.classList.add('hidden');
  el.live.classList.add('hidden');
  el.overlay.classList.remove('hidden');
  el.startHint.classList.remove('hidden');
  renderText();
  stopLoop();
}

function retry() {
  if (!engine) return newRun();
  const target = engine.target;
  engine = new TypingEngine(target);
  resetStart();
  el.results.classList.add('hidden');
  el.live.classList.add('hidden');
  el.overlay.classList.remove('hidden');
  el.startHint.classList.remove('hidden');
  renderText();
  stopLoop();
}

// Clear any pending countdown and disarm typing (called when a run resets).
function resetStart() {
  clearInterval(countTimer);
  countTimer = null;
  counting = false;
  armed = false;
  el.overlay.classList.remove('countdown');
}

// Ready-set-go: a 3-2-1 countdown before typing is accepted. The typing timer
// itself still starts on the first real keystroke.
function startCountdown() {
  if (armed) { el.text.focus(); return; }
  if (counting) return;
  counting = true;
  el.text.focus();
  el.overlay.classList.remove('hidden');
  el.overlay.classList.add('countdown');
  el.startHint.classList.add('hidden');
  let n = 3;
  const paint = () => { el.overlay.innerHTML = `<span class="count">${n}</span>`; };
  paint();
  countTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      clearInterval(countTimer);
      countTimer = null;
      counting = false;
      armed = true;
      el.overlay.classList.add('hidden');
      el.overlay.classList.remove('countdown');
    } else {
      paint();
    }
  }, 1000);
}

// ---------------------------------------------------------------- input handling
function onKeyDown(e) {
  if (e.key === 'Tab') { e.preventDefault(); newRun(); startCountdown(); return; }
  if (e.key === 'Escape') { retry(); startCountdown(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (counting) { e.preventDefault(); return; } // swallow keys mid-countdown
  if (!engine || engine.status === STATUS.DONE) return;

  // Not started yet: the first keypress kicks off the countdown (it is not
  // consumed as a typed character).
  if (!armed) {
    if (e.key.length === 1 || e.key === 'Backspace') { e.preventDefault(); startCountdown(); }
    return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (engine.backspace()) { renderText(); updateLive(); }
    return;
  }
  if (e.key.length === 1) {
    e.preventDefault();
    const wasIdle = engine.status === STATUS.IDLE;
    if (engine.type(e.key)) {
      if (wasIdle) startLoop();
      renderText();
      updateLive();
      if (engine.status === STATUS.DONE) finishRun();
    }
  }
}

// ---------------------------------------------------------------- text rendering
// Words are grouped into <span class="word"> (inline-block, nowrap) so a word
// never splits across lines; the space cells between them are the only wrap
// points. A real space in the space cell is what gives the browser a place to
// break the line.
function renderText() {
  const cells = engine.cells();
  let html = '';
  let word = '';
  const flush = () => {
    if (word) { html += `<span class="word">${word}</span>`; word = ''; }
  };
  for (const c of cells) {
    if (c.char === ' ') {
      flush();
      html += `<span class="ch space ${c.state}"> </span>`;
    } else {
      word += `<span class="ch ${c.state}">${escapeHtml(c.char)}</span>`;
    }
  }
  flush();
  el.text.innerHTML = html;
}

// ---------------------------------------------------------------- live stats loop
function startLoop() {
  el.live.classList.remove('hidden');
  const tick = () => {
    updateLive();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}
function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}
function updateLive() {
  const s = engine.snapshot();
  el.live.innerHTML = `
    <div class="stat">${s.wpm}<span>wpm</span></div>
    <div class="stat">${s.accuracy}<span>% acc</span></div>
    <div class="stat">${s.elapsedSec}<span>s</span></div>
    <div class="stat bar-wrap"><div class="progress"><i style="width:${Math.round(s.progress * 100)}%"></i></div></div>
  `;
}

// ---------------------------------------------------------------- finishing + results
async function finishRun() {
  stopLoop();
  armed = false; // require a fresh countdown for the next run
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
  };

  let isPB = false;
  // Graded against the runs stored *before* this one, so a run never counts
  // itself as part of its own baseline.
  let verdict = gradeRun(run, []);
  try {
    const prev = await statsService.runs();
    // The personal best follows the score, so it means the same thing the
    // headline number does — your best run, not just your fastest.
    const sameMode = prev.filter((r) => r.mode === cfg.mode);
    const bestScore = sameMode.length ? Math.max(...sameMode.map(scoreOf)) : 0;
    verdict = gradeRun(run, prev);
    isPB = verdict.score > bestScore && verdict.score > 0;
    await statsService.saveRun(run);
  } catch (err) {
    console.error('Could not save run:', err);
  }
  renderResults(s, isPB, verdict);
  if (statsOpen) renderHistory();
  if (boardOpen) {
    // Point the board at the category just played so the new score is visible.
    boardMode = cfg.mode;
    if (cfg.mode !== 'quotes') boardDifficulty = cfg.difficulty;
    renderBoard();
  }
}

function renderResults(s, isPB, verdict) {
  el.live.classList.add('hidden');
  el.results.classList.remove('hidden');
  const author = meta.author ? `<div class="author">— <b>${escapeHtml(meta.author)}</b></div>` : '';
  el.results.innerHTML = `
    <div class="result-grid">
      <div class="result-hero verdict-${verdict.tier}" style="--verdict:${verdict.color}">
        <div class="big">${verdict.score}<span> score</span></div>
        <div class="acc">${s.wpm} wpm · ${s.accuracy}% accuracy</div>
        ${verdictBlock(verdict)}
        ${isPB ? '<div class="pb">★ new personal best</div>' : ''}
      </div>
      <div>
        <div class="result-detail">
          ${metric('raw wpm', s.rawWpm)}
          ${metric('consistency', s.consistency + '%')}
          ${metric('time', s.elapsedSec + 's')}
          ${metric('characters', s.correctChars)}
          ${metric('errors', s.incorrectChars)}
          ${metric('keystrokes', s.keystrokes)}
        </div>
        ${author}
        <div class="result-actions">
          <button class="btn primary" id="rNext">next test →</button>
          <button class="btn" id="rRetry">retry same</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('rNext').onclick = () => { newRun(); startCountdown(); };
  document.getElementById('rRetry').onclick = () => { retry(); startCountdown(); };
}
// The verdict: how this run compares to the player's own history in the same
// category. The wpm number itself is tinted (see .verdict-* in the CSS); this
// block spells out what the colour means so it isn't a guessing game.
function verdictBlock(v) {
  if (!v.ready) {
    return `
      <div class="verdict pending">
        <div class="v-label">${v.label}</div>
        <div class="v-sub">${escapeHtml(v.blurb)}</div>
      </div>`;
  }
  const sign = v.delta > 0 ? '+' : v.delta < 0 ? '−' : '±';
  return `
    <div class="verdict">
      <div class="v-label">${v.label}</div>
      <div class="v-meter" title="${v.percentile}% of your last ${v.sample} runs in this category">
        <i class="v-mark" style="left:${(v.position * 100).toFixed(1)}%"></i>
      </div>
      <div class="v-sub">
        <b>${sign}${Math.abs(v.delta)}</b> vs your ${v.avg} avg score
        · beats ${v.percentile}% of your last ${v.sample}
      </div>
    </div>`;
}

function metric(label, value) {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

// ---------------------------------------------------------------- history panel
async function toggleStats() {
  statsOpen = !statsOpen;
  if (statsOpen) { await renderHistory(); el.history.classList.remove('hidden'); }
  else el.history.classList.add('hidden');
}

async function renderHistory() {
  const id = statsService.identity;
  const scopeLabel = id.kind === 'cloud'
    ? 'synced to your Google account'
    : 'saved on this device — sign in to sync';

  let sum;
  try {
    sum = await statsService.summary({ thisMachine: histThisMachine });
  } catch (err) {
    el.history.innerHTML = `<h3>stats</h3><div class="empty">Couldn't load stats: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const toggle = `
    <label class="machine-toggle">
      <input type="checkbox" id="thisMachine" ${histThisMachine ? 'checked' : ''} />
      this machine only
    </label>`;

  if (sum.count === 0) {
    el.history.innerHTML = `
      <div class="hist-head">
        <div><h3>${escapeHtml(id.name)} · stats</h3><div class="sub">${scopeLabel}</div></div>
        ${toggle}
      </div>
      <div class="empty">No runs yet — finish a test and your stats will appear here.</div>
      <div class="foot"><span class="machine">${escapeHtml(deviceService.label())} · ${machineId}</span></div>`;
    wireHistControls();
    return;
  }

  const scores = sum.all.map(scoreOf);
  const bestScore = Math.max(...scores);
  const avgScore = Math.round(scores.reduce((a, x) => a + x, 0) / scores.length);
  // Plots score, not wpm, so the chart matches what the verdict grades.
  const chart = scoreChart(sum.all.slice(-30), avgScore);
  const rows = sum.recent
    .map(
      (r) => `<tr>
        <td class="wpm">${scoreOf(r)}</td>
        <td>${r.wpm}</td>
        <td>${r.accuracy}%</td>
        <td><span class="tag">${r.mode}${r.difficulty && r.difficulty !== '—' ? ' · ' + r.difficulty : ''}</span></td>
        <td>${r.seconds}s</td>
        <td style="color:var(--muted)">${timeAgo(r.at)}</td>
      </tr>`
    )
    .join('');

  el.history.innerHTML = `
    <div class="hist-head">
      <div><h3>${escapeHtml(id.name)} · stats</h3><div class="sub">${sum.count} tests · ${scopeLabel}</div></div>
      ${toggle}
    </div>
    <div class="cards">
      <div class="card"><div class="k">best score</div><div class="v">${bestScore}</div></div>
      <div class="card"><div class="k">avg score</div><div class="v small">${avgScore}</div></div>
      <div class="card"><div class="k">best wpm</div><div class="v small">${sum.bestWpm}</div></div>
      <div class="card"><div class="k">avg accuracy</div><div class="v small">${sum.avgAcc}%</div></div>
    </div>
    ${chart}
    <table class="runs">
      <thead><tr><th>score</th><th>wpm</th><th>acc</th><th>mode</th><th>time</th><th>when</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">
      <span class="machine">${escapeHtml(deviceService.label())} · ${machineId}</span>
      <button class="link" id="clearRuns">clear ${id.kind === 'cloud' ? 'account' : 'device'} history</button>
    </div>
  `;
  wireHistControls();
}

// Score over the last N runs.
//
// This is a line rather than the bars it used to be, because the y-axis has to
// be truncated to be useful: scores live in a narrow band well above zero, so
// anchoring at zero flattens a real 30 → 53 climb into a barely-visible wobble.
// Bars can't be truncated honestly — a bar's *length* is its value, so a 30
// beside a 53 on a floating baseline reads as a third of it rather than a bit
// over half. A line encodes value as position, where a non-zero baseline is
// legitimate as long as it's labelled — hence the axis ends and the caption.
function scoreChart(runs, avgScore) {
  const pts = runs.map(scoreOf);
  if (pts.length < 2) return ''; // two points is the minimum that can show a trend
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  // Headroom so the extremes don't sit welded to the edges.
  const pad = Math.max(2, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const W = 300;
  const H = 70;
  const fx = (i) => (i / (pts.length - 1)) * W;
  const fy = (v) => H - ((v - lo) / (hi - lo)) * H;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${fx(i).toFixed(1)} ${fy(v).toFixed(1)}`).join(' ');
  const avgY = fy(Math.min(hi, Math.max(lo, avgScore)));
  const dots = runs.map((r, i) => {
    const v = scoreOf(r);
    return `<i style="left:${((i / (pts.length - 1)) * 100).toFixed(2)}%;bottom:${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%"
      title="score ${v} · ${r.wpm} wpm · ${r.accuracy}% · ${timeAgo(r.at)}"></i>`;
  }).join('');

  return `
    <div class="chart">
      <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="spark-avg" x1="0" y1="${avgY.toFixed(1)}" x2="${W}" y2="${avgY.toFixed(1)}" vector-effect="non-scaling-stroke" />
        <path class="spark-line" d="${line}" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="spark-dots">${dots}</div>
      <span class="ax hi">${Math.round(hi)}</span>
      <span class="ax lo">${Math.round(lo)}</span>
    </div>
    <div class="chart-cap">
      score, last ${pts.length} runs · ${min === max ? min : `${min}–${max}`} · <b>avg ${avgScore}</b>
      <span class="warn">scale starts at ${Math.round(lo)}, not zero</span>
    </div>`;
}

function wireHistControls() {
  const t = document.getElementById('thisMachine');
  if (t) t.onchange = () => { histThisMachine = t.checked; renderHistory(); };
  const c = document.getElementById('clearRuns');
  if (c) c.onclick = async () => {
    if (!confirm('Delete all saved runs for this profile?')) return;
    await statsService.clear();
    renderHistory();
  };
}

// ---------------------------------------------------------------- leaderboard
async function toggleBoard() {
  boardOpen = !boardOpen;
  if (boardOpen) { await renderBoard(); el.board.classList.remove('hidden'); }
  else el.board.classList.add('hidden');
}

async function renderBoard() {
  if (statsService.identity.kind !== 'cloud') {
    el.board.innerHTML = `
      <div class="hist-head"><h3>🏆 Leaderboard</h3></div>
      <div class="empty">Sign in with Google to see how you rank against other players.</div>`;
    return;
  }

  const periods = [['day', 'Today'], ['month', 'This month'], ['all', 'All time']];
  const metrics = [['score', 'Best score'], ['wpm', 'Fastest'], ['accuracy', 'Most accurate']];
  const modeItems = Object.entries(MODES).map(([k, v]) => [k, v.label]);
  const diffItems = DIFFICULTIES.map((d) => [d, d]);
  const tabs = (items, cur, attr) => items
    .map(([k, label]) => `<button class="seg ${cur === k ? 'active' : ''}" data-${attr}="${k}">${label}</button>`)
    .join('');

  const isQuotes = boardMode === 'quotes';
  const catLabel = `${MODES[boardMode].label}${isQuotes ? '' : ' · ' + boardDifficulty}`;

  el.board.innerHTML = `
    <div class="hist-head">
      <div><h3>🏆 Leaderboard</h3><div class="sub">${escapeHtml(catLabel)} · best result per player</div></div>
      <div class="board-tabs">
        <div class="group">${tabs(metrics, boardMetric, 'metric')}</div>
        <div class="group">${tabs(periods, boardPeriod, 'period')}</div>
      </div>
    </div>
    <div class="board-cat">
      <span class="cat-lead">category</span>
      <div class="group">${tabs(modeItems, boardMode, 'bmode')}</div>
      <div class="group ${isQuotes ? 'disabled' : ''}">${tabs(diffItems, boardDifficulty, 'bdiff')}</div>
    </div>
    <div id="boardBody"><div class="empty">Loading…</div></div>
  `;
  el.board.querySelectorAll('[data-metric]').forEach((b) => {
    b.onclick = () => { boardMetric = b.dataset.metric; renderBoard(); };
  });
  el.board.querySelectorAll('[data-period]').forEach((b) => {
    b.onclick = () => { boardPeriod = b.dataset.period; renderBoard(); };
  });
  el.board.querySelectorAll('[data-bmode]').forEach((b) => {
    b.onclick = () => { boardMode = b.dataset.bmode; renderBoard(); };
  });
  el.board.querySelectorAll('[data-bdiff]').forEach((b) => {
    b.onclick = () => { boardDifficulty = b.dataset.bdiff; renderBoard(); };
  });

  let rows;
  try {
    rows = await statsService.leaderboard({
      period: boardPeriod,
      metric: boardMetric,
      mode: boardMode,
      difficulty: boardDifficulty,
    });
  } catch (err) {
    document.getElementById('boardBody').innerHTML =
      `<div class="empty">Couldn't load leaderboard: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!rows.length) {
    document.getElementById('boardBody').innerHTML =
      '<div class="empty">No scores for this category and period yet — be the first!</div>';
    return;
  }

  const myUid = statsService.identity.id;
  // All three numbers are always shown; the ranked one is the emphasised
  // column, so it's never a guess what the order is based on.
  const cell = (key, text) => `<td class="${boardMetric === key ? 'primary' : 'muted'}">${text}</td>`;
  const body = rows.map((r, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || `<span class="rank">${i + 1}</span>`;
    const avatar = r.photo
      ? `<img class="avatar sm" src="${r.photo}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="avatar sm ph">${escapeHtml((r.name?.[0] || '?').toUpperCase())}</span>`;
    return `<tr class="${r.uid === myUid ? 'me' : ''}">
        <td class="pos">${medal}</td>
        <td class="who">${avatar}<span>${escapeHtml(r.name || 'Player')}</span></td>
        ${cell('score', scoreOf(r))}
        ${cell('wpm', r.wpm)}
        ${cell('accuracy', r.accuracy + '%')}
        <td class="muted">${escapeHtml(r.device || '—')}</td>
        <td class="muted">${timeAgo(r.at)}</td>
      </tr>`;
  }).join('');

  const th = (key, label) => `<th class="${boardMetric === key ? 'ranked' : ''}">${label}</th>`;
  document.getElementById('boardBody').innerHTML = `
    <table class="runs board">
      <thead><tr>
        <th></th><th>player</th>
        ${th('score', 'score')}${th('wpm', 'wpm')}${th('accuracy', 'acc')}
        <th>device</th><th>when</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ---------------------------------------------------------------- utils
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

boot();
