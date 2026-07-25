// OAuth client identifiers for the terminal app, shipped in the package.
//
// These are *not* secrets. Google's own guidance for installed apps: "The
// process results in a client ID and, in some cases, a client secret, which you
// embed in the source code of your application. (In this context, the client
// secret is obviously not treated as a secret.)" Every distributed CLI that
// does Google sign-in works this way — gcloud, gh, rclone. The account is
// protected by the consent screen and PKCE, not by hiding these strings.
//
// Shipping them is what makes `typer` work on a stranger's machine with zero
// setup, which is the whole point. A user can still override with their own
// client via env vars or ~/.typer/oauth.json (see loadCreds below).
//
// ── MAINTAINER SETUP (one time, then commit the values) ──────────────────────
// In the Google Cloud console for project `digi-typer`
// (https://console.cloud.google.com/apis/credentials):
//
//  1. Create Credentials → OAuth client ID → **Desktop app**.
//     Paste the id + secret into DESKTOP below. This drives the loopback flow
//     (the normal path: browser opens, you approve, done).
//  2. Create Credentials → OAuth client ID → **TVs and Limited Input devices**.
//     Paste the id + secret into DEVICE below. This drives the device-code flow
//     (the fallback for headless boxes, SSH, containers, WSL without interop).
//  3. OAuth consent screen → add scopes `openid`, `email`, `profile` and
//     **publish** the app. While it's in "Testing", only accounts you list by
//     hand can sign in — that alone will make it fail for the public.
//  4. Firebase console → Authentication → Sign-in method → Google → Web SDK
//     configuration → make sure both client IDs above are accepted. Clients in
//     the same Google Cloud project are normally accepted automatically; if
//     `accounts:signInWithIdp` rejects the token with an audience error, add
//     them under "Whitelist client IDs from external projects".
//
// Until steps 1–2 are done the CLI stays in read-only leaderboard mode (via
// Firebase anonymous auth) and tells the user sign-in isn't configured, rather
// than failing in some confusing way.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// Desktop-app client for project `digi-typer`. Drives the loopback flow on any
// machine that has a browser — macOS, Windows, Linux, WSL.
const DESKTOP = {
  clientId: '708032044767-b5n4ug45l0p4v85u6djoad01ldk6g93p.apps.googleusercontent.com',
  clientSecret: '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',
};

// Not configured yet. Google only honours the device-code grant for clients of
// type "TVs and Limited Input devices" — the desktop id above is rejected with
// invalid_client, so it can't be reused here. Until this is filled in, headless
// machines fall back to the printed loopback URL (see interactiveLogin).
const DEVICE = {
  clientId: '',
  clientSecret: '',  // TV/limited-input clients issue one; send it if present.
};

const clean = (c) => (c && c.clientId ? { ...c } : null);

/**
 * Credentials for a flow, in precedence order: env vars → ~/.typer/oauth.json →
 * the shipped defaults. The overrides let someone run the CLI against their own
 * Google project (or let us hand a tester new creds) without a reinstall.
 *
 * @param {'desktop'|'device'} kind
 */
export function loadCreds(kind = 'desktop') {
  const envPrefix = kind === 'device' ? 'GOOGLE_DEVICE_CLIENT' : 'GOOGLE_CLIENT';
  const id = process.env[`${envPrefix}_ID`];
  const secret = process.env[`${envPrefix}_SECRET`];
  if (id) return { clientId: id, clientSecret: secret || '' };

  try {
    const j = JSON.parse(readFileSync(join(os.homedir(), '.typer', 'oauth.json'), 'utf8'));
    // Either a flat { client_id, client_secret } (the historical shape, taken as
    // the desktop client) or { desktop: {...}, device: {...} }.
    const section = j[kind] || (kind === 'desktop' ? j : null);
    if (section?.client_id) {
      return { clientId: section.client_id, clientSecret: section.client_secret || '' };
    }
  } catch {
    /* not present or not valid JSON — fall through to the shipped defaults */
  }

  return clean(kind === 'device' ? DEVICE : DESKTOP);
}

/** True if at least one flow is usable on this machine. */
export const hasAnyCreds = () => !!(loadCreds('desktop') || loadCreds('device'));
