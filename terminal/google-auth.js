// Google OAuth 2.0 for a distributed CLI, built to work on any machine.
//
// Two flows, because no single one covers every environment:
//
//   loopback (preferred) — we open the user's browser to Google's consent screen
//     and catch the redirect on a throwaway HTTP server bound to 127.0.0.1.
//     Fast and familiar, but needs both a browser and a reachable loopback port,
//     which rules out headless servers, most containers, and plain SSH.
//
//   device code (fallback) — we show a short code and a URL; the user approves
//     on *any* device (their phone), and we poll Google until they do. Needs
//     nothing from the local machine but an outbound HTTPS connection, so it
//     works over SSH, in Docker, on a Raspberry Pi with no X, in CI shells.
//
// `interactiveLogin` picks automatically and falls back if the browser doesn't
// open, so the user gets the nice path when it's available and a working path
// otherwise. Both use PKCE where the flow supports it, and neither ever sees
// the user's password.
import http from 'node:http';
import crypto from 'node:crypto';
import { loadCreds } from './oauth-client.js';
import { openUrl, canOpenBrowser } from './open-url.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEVICE_ENDPOINT = 'https://oauth2.googleapis.com/device/code';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SCOPE = 'openid email profile';

// Overall budget for a login attempt. Generous: the device flow expects the
// user to walk to another device, and Google's own device codes live ~30 min.
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export { loadCreds };

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function postForm(url, params) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  } catch (e) {
    // DNS failure, no route, proxy refusing — the single most common real-world
    // failure, and worth naming instead of surfacing "fetch failed".
    throw new AuthError('network', `cannot reach ${new URL(url).host} (${e.message})`);
  }
  let body = {};
  try { body = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) {
    const err = new AuthError(body.error || `http-${r.status}`, body.error_description || body.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

// ---------------------------------------------------------------- loopback flow
/**
 * @param {object} opts
 * @param {number} [opts.port] fixed port, for `ssh -L` tunnelling. 0 = any.
 * @param {boolean} [opts.abandonIfNoBrowser] bail out (rather than wait on the
 *   printed URL) when no opener works, so a device-code fallback can take over.
 * @param {(info:object)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
async function loopbackLogin({ port = 0, abandonIfNoBrowser = false, onProgress, signal }) {
  const creds = loadCreds('desktop');
  if (!creds) throw new AuthError('no-oauth-creds');

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const server = http.createServer();
  let redirectUri = '';

  const code = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { server.close(); } catch { /* not listening */ }
      fn(arg);
    };

    const timer = setTimeout(() => finish(reject, new AuthError('timeout')), LOGIN_TIMEOUT_MS);
    const onAbort = () => finish(reject, new AuthError('cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });

    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      // Browsers also ask for /favicon.ico and friends; ignore anything that
      // isn't the redirect so a stray request can't end the flow.
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(404).end();
        return;
      }
      const returned = url.searchParams.get('code');
      const ok = url.searchParams.get('state') === state && !!returned;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(landingPage(ok));
      if (!ok) {
        const why = url.searchParams.get('error') || 'state-mismatch';
        finish(reject, new AuthError(why === 'access_denied' ? 'denied' : why));
        return;
      }
      finish(resolve, returned);
    });

    server.on('error', (e) => {
      finish(reject, e.code === 'EADDRINUSE'
        ? new AuthError('port-in-use', `port ${port} is already in use`)
        : new AuthError('listen-failed', e.message));
    });

    // Loopback IP literal rather than "localhost": Google requires it, and it
    // sidesteps hosts files that resolve localhost to ::1 only.
    server.listen(port, '127.0.0.1', async () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const authUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })}`;

      onProgress?.({ flow: 'browser', url: authUrl, opening: true });
      const opened = await openUrl(authUrl);
      if (settled) return;
      onProgress?.({ flow: 'browser', url: authUrl, opening: false, opened });
      // No opener worked. If a device-code fallback exists, give up here so the
      // caller can switch to it; otherwise keep listening — the URL is on
      // screen, and anyone who can reach this loopback port (a local TTY, or
      // SSH with `-L` onto a fixed --auth-port) can still finish the flow.
      if (!opened && abandonIfNoBrowser) finish(reject, new AuthError('no-browser'));
    });
  });

  return postForm(TOKEN_ENDPOINT, {
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
}

function landingPage(ok) {
  return `<!doctype html><meta charset=utf-8><title>Typer</title>
    <body style="font-family:system-ui,sans-serif;background:#0e1015;color:#d7dbe3;display:grid;place-items:center;height:100vh;margin:0">
    <div style="text-align:center">
      <div style="font-size:42px">${ok ? '✅' : '⚠️'}</div>
      <h2>${ok ? 'Signed in to Typer' : 'Sign-in failed'}</h2>
      <p style="color:#6b7280">You can close this tab and return to the terminal.</p>
    </div></body>`;
}

// ------------------------------------------------------------- device-code flow
async function deviceLogin({ onProgress, signal }) {
  const creds = loadCreds('device');
  if (!creds) throw new AuthError('no-device-creds');

  // Google's device endpoint only supports the openid/email/profile scopes —
  // exactly what we ask for.
  const init = await postForm(DEVICE_ENDPOINT, {
    client_id: creds.clientId,
    scope: SCOPE,
  });

  const verifyUrl = init.verification_url || init.verification_uri;
  onProgress?.({
    flow: 'device',
    userCode: init.user_code,
    verifyUrl,
    // Chrome/Safari can deep-link the code so the user doesn't retype it.
    verifyUrlComplete: init.verification_url_complete || null,
    expiresIn: init.expires_in,
  });

  // Politely try to open the page too — on a desktop that fell back to this
  // flow (no opener found earlier) it's a no-op, and on WSL it may just work.
  openUrl(init.verification_url_complete || verifyUrl).catch(() => {});

  const started = Date.now();
  let intervalMs = Math.max(5, Number(init.interval) || 5) * 1000;
  const deadline = started + Math.min(LOGIN_TIMEOUT_MS, (Number(init.expires_in) || 600) * 1000);

  for (;;) {
    if (signal?.aborted) throw new AuthError('cancelled');
    if (Date.now() > deadline) throw new AuthError('timeout');
    await sleep(intervalMs, signal);

    try {
      return await postForm(TOKEN_ENDPOINT, {
        client_id: creds.clientId,
        ...(creds.clientSecret ? { client_secret: creds.clientSecret } : {}),
        device_code: init.device_code,
        grant_type: DEVICE_GRANT,
      });
    } catch (e) {
      // Per RFC 8628: authorization_pending = keep waiting, slow_down = back
      // off. Anything else is terminal.
      if (e.code === 'authorization_pending') continue;
      if (e.code === 'slow_down') { intervalMs += 5000; continue; }
      if (e.code === 'expired_token') throw new AuthError('timeout');
      if (e.code === 'access_denied') throw new AuthError('denied');
      throw e;
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(new AuthError('cancelled')); }
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------- entry point
/**
 * Run an interactive login using whichever flow suits this machine.
 *
 * @param {object} [opts]
 * @param {'auto'|'browser'|'device'} [opts.mode='auto']
 * @param {number} [opts.port=0] fixed loopback port (for `ssh -L`).
 * @param {(info:object)=>void} [opts.onProgress] flow/url/user-code updates.
 * @param {AbortSignal} [opts.signal] cancel (user pressed Esc).
 * @returns {Promise<{id_token:string, refresh_token?:string}>}
 */
export async function interactiveLogin(opts = {}) {
  const { mode = 'auto', port = 0, onProgress, signal } = opts;
  const desktop = loadCreds('desktop');
  const device = loadCreds('device');
  if (!desktop && !device) throw new AuthError('no-oauth-creds');

  const wantBrowser = mode === 'browser' || (mode === 'auto' && desktop && canOpenBrowser());

  if (wantBrowser && desktop) {
    try {
      return await loopbackLogin({ port, abandonIfNoBrowser: mode === 'auto' && !!device, onProgress, signal });
    } catch (e) {
      // Only a machine that can't show a browser is worth retrying elsewhere.
      // A denial, a timeout or a bad token exchange means stop.
      const retry = e.code === 'no-browser' && mode === 'auto' && device;
      if (!retry) throw e;
      onProgress?.({ flow: 'switching', from: 'browser', to: 'device' });
    }
  }

  if (device) return deviceLogin({ onProgress, signal });

  // Asked for the device flow (or have no browser) but that client isn't
  // configured: fall back to loopback and let the printed URL carry the day.
  if (desktop) return loopbackLogin({ port, onProgress, signal });
  throw new AuthError('no-oauth-creds');
}

// Silently mint fresh tokens from a stored refresh token (no browser). The
// refresh token belongs to whichever client issued it, so try both.
export async function refresh(refreshToken) {
  const errors = [];
  for (const kind of ['desktop', 'device']) {
    const creds = loadCreds(kind);
    if (!creds) continue;
    try {
      return await postForm(TOKEN_ENDPOINT, {
        client_id: creds.clientId,
        ...(creds.clientSecret ? { client_secret: creds.clientSecret } : {}),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
    } catch (e) {
      errors.push(e);
    }
  }
  throw errors[0] || new AuthError('no-oauth-creds');
}
