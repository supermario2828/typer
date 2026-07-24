// Google OAuth 2.0 for a native/CLI app: the loopback + PKCE "installed app"
// flow (the same shape Claude Code and gcloud use). We open the user's browser
// to Google's consent screen and run a throwaway HTTP server on 127.0.0.1 to
// catch the redirect. We never see the user's password — they authenticate
// with Google directly.
//
// Requires a Google OAuth client of type "Desktop app". Supply it via env vars
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, or ~/.typer/oauth.json:
//   { "client_id": "...apps.googleusercontent.com", "client_secret": "..." }
// (For installed apps Google does not treat the secret as confidential, but we
// keep it out of the repo regardless.)
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'openid email profile';

export function loadCreds() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  }
  try {
    const j = JSON.parse(readFileSync(join(os.homedir(), '.typer', 'oauth.json'), 'utf8'));
    if (j.client_id && j.client_secret) return { clientId: j.client_id, clientSecret: j.client_secret };
  } catch {
    /* not configured */
  }
  return null;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can copy the URL from the screen */
  }
}

/**
 * Run the interactive browser login.
 * @param {(url:string)=>void} [onUrl] called with the consent URL once ready.
 * @returns {Promise<{id_token, access_token, refresh_token, expires_in}>}
 */
export function interactiveLogin(onUrl) {
  const creds = loadCreds();
  if (!creds) return Promise.reject(new Error('no-oauth-creds'));

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let redirectUri = '';

    async function exchange(code) {
      const r = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      });
      if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
      return r.json();
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><meta charset=utf-8><title>Typer</title>
        <body style="font-family:system-ui;background:#0e1015;color:#d7dbe3;display:grid;place-items:center;height:100vh;margin:0">
        <div style="text-align:center">
          <div style="font-size:42px">${ok ? '✅' : '⚠️'}</div>
          <h2>${ok ? 'Signed in to Typer' : 'Sign-in failed'}</h2>
          <p style="color:#6b7280">You can close this tab and return to the terminal.</p>
        </div></body>`);
      server.close();
      clearTimeout(timer);
      if (!ok) {
        reject(new Error(url.searchParams.get('error') || 'state-mismatch'));
        return;
      }
      exchange(url.searchParams.get('code')).then(resolve, reject);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('timeout'));
    }, 180000);

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
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
      if (onUrl) onUrl(authUrl);
      openBrowser(authUrl);
    });

    server.on('error', reject);
  });
}

// Silently mint a fresh id_token from a stored refresh token (no browser).
export async function refresh(refreshToken) {
  const creds = loadCreds();
  if (!creds) throw new Error('no-oauth-creds');
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token refresh failed (${r.status})`);
  return r.json();
}
