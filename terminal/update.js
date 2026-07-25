// Self-update for the terminal client.
//
// The CLI is installed from a GitHub tarball, so nothing about the installed
// copy changes until it's reinstalled — unlike the web app, which is current on
// every reload. This module answers "is there a newer commit on main?" and, if
// so, re-runs the exact install command that put this copy here.
//
// How "newer" is decided: npm stamps the extracted files with the *install*
// time, so comparing the installed package's mtime against the date of the
// latest commit on main is enough — no version bumps, no state file. (A version
// mismatch in package.json also counts, for when the version is bumped without
// this file being touched.)
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = resolvePath(HERE, '..');
const REPO = 'supermario2828/typer';
const TARBALL = `https://github.com/${REPO}/tarball/main`;
const API = `https://api.github.com/repos/${REPO}/commits/main`;
const CHECK_TIMEOUT_MS = 8000;

export function localVersion() {
  try {
    return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Where this copy is running from, which decides whether updating in place is
 * even meaningful:
 *   'global'   — npm install -g … : can be updated by reinstalling.
 *   'npx'      — npx … : already fetches main every run, nothing to update.
 *   'checkout' — a git clone / npm run cli : `git pull` is the user's job.
 */
export function installKind() {
  const p = PKG_ROOT;
  if (p.includes('_npx')) return 'npx';
  if (!p.includes('node_modules')) return 'checkout';
  return 'global';
}

/**
 * The npm prefix this copy was installed under, so the update reinstalls into
 * the same place rather than npm's default (which may not be writable — that's
 * the EACCES trap the install docs work around).
 *   Unix:    <prefix>/lib/node_modules/typer
 *   Windows: <prefix>\node_modules\typer
 */
export function installPrefix() {
  const nm = dirname(PKG_ROOT);              // …/node_modules
  const parent = dirname(nm);                // …/lib   or   <prefix>
  return basename(parent) === 'lib' ? dirname(parent) : parent;
}

export function updateCommand() {
  return `npm install -g --prefix ${installPrefix()} --allow-remote=all ${TARBALL}`;
}

/**
 * Ask GitHub for the head of main and compare it with this install.
 * Resolves to { status, sha, date, message, version } where status is
 * 'available' | 'current' | 'unknown'.
 */
export async function checkForUpdate() {
  const kind = installKind();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CHECK_TIMEOUT_MS);
  let commit;
  try {
    const r = await fetch(API, {
      signal: ctl.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'typer-cli' },
    });
    if (!r.ok) {
      // 403 here is almost always the unauthenticated rate limit (60/hr/IP).
      const why = r.status === 403
        ? "GitHub's rate limit for this network was hit — try again later."
        : `GitHub said HTTP ${r.status}.`;
      return { status: 'unknown', err: why, kind };
    }
    commit = await r.json();
  } catch (e) {
    const why = e?.name === 'AbortError'
      ? 'GitHub did not respond in time.'
      : 'Could not reach GitHub — check your connection.';
    return { status: 'unknown', err: why, kind };
  } finally {
    clearTimeout(timer);
  }

  const sha = String(commit.sha || '').slice(0, 7);
  const dateStr = commit.commit?.committer?.date || commit.commit?.author?.date;
  const commitAt = dateStr ? Date.parse(dateStr) : NaN;
  const message = (commit.commit?.message || '').split('\n')[0];

  let installedAt = 0;
  try {
    installedAt = statSync(join(PKG_ROOT, 'package.json')).mtimeMs;
  } catch { /* fall through to 'unknown' below */ }

  if (!installedAt || Number.isNaN(commitAt)) {
    return { status: 'unknown', err: 'Could not read this install\'s timestamp.', sha, message, kind };
  }

  const status = commitAt > installedAt ? 'available' : 'current';
  return { status, sha, message, kind, commitAt, installedAt, version: localVersion() };
}

/**
 * Run the reinstall with the terminal handed back to npm, so its progress and
 * any error (EACCES, network) is visible verbatim rather than swallowed by our
 * full-screen UI. Resolves with the exit code.
 */
export function runUpdate() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = [
      'install', '-g',
      '--prefix', installPrefix(),
      '--allow-remote=all',
      TARBALL,
    ];
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(-1)); // npm not on PATH
    child.on('close', (code) => resolve(code ?? -1));
  });
}
