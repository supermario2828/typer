// Opening a URL in the user's browser, reliably, from a terminal app.
//
// There is no single command that works everywhere, and the usual one-liner
// (`spawn('xdg-open', …)` detached + unref'd) can't tell you whether it worked:
// a missing binary surfaces as an async 'error' event on a child nobody is
// listening to. So we walk a per-platform candidate list, wait long enough to
// learn whether the opener actually took the URL, and report back honestly —
// the caller needs to know, because a headless box has to fall back to a
// different OAuth flow entirely.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// How long we give an opener to either exit cleanly or prove it's running.
const GRACE_MS = 3000;

let wslCache;
export function isWSL() {
  if (wslCache !== undefined) return wslCache;
  if (process.platform !== 'linux') return (wslCache = false);
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return (wslCache = true);
  try {
    wslCache = /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    wslCache = false;
  }
  return wslCache;
}

export const isTermux = () =>
  process.platform === 'android' || !!process.env.TERMUX_VERSION ||
  (process.env.PREFIX || '').includes('com.termux');

/**
 * Can this machine plausibly show a browser to the person at the keyboard?
 * Used to choose between the loopback flow and the device-code flow, so a
 * false negative only costs a nicer UX — never a failed login.
 */
export function canOpenBrowser() {
  if (process.env.TYPER_NO_BROWSER) return false;
  if (process.platform === 'darwin' || process.platform === 'win32') return true;
  if (isWSL() || isTermux()) return true;
  // Linux/BSD: a graphical session means DISPLAY or WAYLAND_DISPLAY. Neither +
  // an SSH session is the classic headless server; neither and no SSH (a bare
  // TTY, a container) is also not going to render a browser.
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

// Each candidate is [command, argsFor(url)]. Ordered most- to least-specific.
function candidates(url) {
  const list = [];

  // An explicit user preference wins on every platform. $BROWSER may be a
  // colon-separated list, and entries may contain %s as the URL placeholder.
  for (const entry of (process.env.BROWSER || '').split(':').filter(Boolean)) {
    list.push(entry.includes('%s')
      ? ['sh', ['-c', entry.replace(/%s/g, `'${url.replace(/'/g, "'\\''")}'`)]]
      : [entry, [url]]);
  }

  if (process.platform === 'darwin') {
    list.push(['open', [url]]);
  } else if (process.platform === 'win32') {
    // The empty "" is start's window-title argument; quoting the URL stops cmd
    // treating `&` in the query string as a command separator, and
    // windowsVerbatimArguments keeps Node from re-quoting what we wrote.
    list.push(['cmd', ['/c', 'start', '""', `"${url}"`]]);
    list.push(['rundll32', ['url.dll,FileProtocolHandler', url]]);
  } else {
    if (isWSL()) {
      // Hand off to Windows: wslview if wslu is installed, else PowerShell.
      list.push(['wslview', [url]]);
      list.push(['powershell.exe', ['-NoProfile', '-Command', 'Start-Process', `"${url}"`]]);
      list.push(['cmd.exe', ['/c', 'start', '""', `"${url}"`]]);
    }
    if (isTermux()) list.push(['termux-open-url', [url]]);
    list.push(['xdg-open', [url]]);
    list.push(['gio', ['open', url]]);
    list.push(['gnome-open', [url]]);
    list.push(['kde-open', [url]]);
    list.push(['kde-open5', [url]]);
    list.push(['wslview', [url]]);          // harmless if absent
    list.push(['x-www-browser', [url]]);
    list.push(['sensible-browser', [url]]);
    list.push(['firefox', [url]]);
    list.push(['google-chrome', [url]]);
    list.push(['chromium', [url]]);
  }
  return list;
}

/**
 * Try one opener. Resolves true if it plausibly opened the URL.
 *
 * Openers split into two shapes: launchers that hand off and exit 0 (`open`,
 * `xdg-open`, `start`), and browsers we exec directly that stay alive for the
 * session. So "exited 0" and "still running after the grace period" both count
 * as success, while ENOENT and a non-zero exit (xdg-open returns 3 when no
 * handler is registered) count as failure and move us to the next candidate.
 */
function tryOpen(cmd, args) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => {
      // Still alive and hasn't errored: a real browser holding the session.
      // Detach so it outlives us, and call it a win.
      try { child?.unref(); } catch { /* already gone */ }
      done(true);
    }, GRACE_MS);

    try {
      child = spawn(cmd, args, {
        stdio: 'ignore',
        detached: process.platform !== 'win32',
        ...(process.platform === 'win32' ? { windowsVerbatimArguments: true } : {}),
      });
    } catch {
      done(false);
      return;
    }

    child.on('error', () => done(false));   // ENOENT, EACCES, …
    child.on('exit', (code) => done(code === 0));
  });
}

/**
 * Open `url` in a browser. Never throws.
 * @returns {Promise<boolean>} true if some opener accepted it.
 */
export async function openUrl(url) {
  if (!canOpenBrowser()) return false;
  for (const [cmd, args] of candidates(url)) {
    if (await tryOpen(cmd, args)) return true;
  }
  return false;
}
