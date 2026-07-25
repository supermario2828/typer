# ⌨️ Typer

A typing speed & accuracy game — TypeRacer / Monkeytype style. Tracks WPM,
accuracy, raw WPM and consistency, keeps per-profile stats **per machine**
(different keyboards get their own stats), and offers several difficulty modes.

Built with **Vite** (vanilla JS, zero runtime dependencies) so the production
build is a handful of static files you can drop onto xneelo shared hosting.

## Modes

| Mode          | What you type                                   |
|---------------|-------------------------------------------------|
| **Words**     | lowercase common words (easy / medium / hard)   |
| **Punctuation** | capitalised words with commas, periods, etc.  |
| **Numbers**   | words mixed with random digits                  |
| **Quotes**    | real sentences with full punctuation + author   |

Word modes come in lengths of 10 / 25 / 50 / 100 words.

## Run it

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build -> dist/
npm run preview  # preview the production build
```

### Controls
- Just start typing to begin. Errors highlight red; backspace to fix.
- `Tab` — fresh test · `Esc` — reset the current one.

## Terminal version

A full-featured terminal client that reuses the **same** engine, generator and
metrics as the web app (from `src/core/`), so scoring is identical. Stats are
stored locally per profile + machine in `~/.typer/stats.json` (Firebase auth
doesn't fit a CLI, so the terminal is local-only).

Needs **Node.js 18+**. Pick the line for your OS — each adds a global `typer`
command you can run from anywhere:

```bash
# macOS / Windows (PowerShell or cmd)
npm install -g --allow-remote=all https://github.com/supermario2828/typer/tarball/main

# Linux — distro npm can't write to its own global prefix, so install into ~/.local
npm install -g --prefix ~/.local --allow-remote=all https://github.com/supermario2828/typer/tarball/main
```

```bash
typer                       # launch from anywhere
typer --mode=punctuation --difficulty=hard --length=50 --profile=marius

# Prefer not to install? This one line works on every OS — no prefix, no perms:
npx --yes --allow-remote=all https://github.com/supermario2828/typer/tarball/main

# From a checkout:
npm run cli
```

> **`--allow-remote=all` is not optional on npm 12+.** npm 12 changed the
> `allow-remote` default to `none`, so a tarball URL that isn't on the
> registry's own host is refused with `npm error code EALLOWREMOTE`. The flag
> opts in for that one command. (`allow-git` went `none` the same way, which is
> why plain `npx github:user/repo` now fails with `EALLOWGIT`.) On npm < 12 the
> flag is simply an unknown config — harmless.

> **Install from the tarball URL, not `github:user/repo`.** Installing a *git*
> URL globally triggers an npm bug where the global `typer` is symlinked to a
> temporary git clone that npm then deletes — leaving a dangling link and
> "command not found". The `/tarball/main` URL is a plain remote tarball, so npm
> copies it properly. If reinstalling in the same shell still shows "command not
> found", run `hash -r` or open a new terminal (zsh caches the old lookup).

> **Why Linux gets a different line.** Distro-packaged npm (Arch, some Debian
> setups) uses a global prefix of `/usr`, which isn't writable by your user, so
> a plain `npm i -g` dies with `EACCES: permission denied, mkdir
> '/usr/lib/node_modules/typer'` — and `sudo npm i -g` there fights the system
> package manager. `--prefix ~/.local` installs to `~/.local/bin` instead, which
> is already on `PATH` on most distros. It's a per-command flag, so unlike
> `npm config set prefix ~/.local` it won't override an existing nvm/fnm prefix.
> If `typer` still isn't found afterwards, add `~/.local/bin` to your `PATH`.
>
> The same fix applies on macOS in the rarer case that Node was installed
> system-wide — but `~/.local/bin` isn't on `PATH` there by default, so pick a
> directory that is. Windows never needs it: npm installs to `%AppData%\npm`.

- **Menu:** `m` mode · `d` difficulty · `l` length · `s` stats · `b` leaderboard ·
  `n` name device · `u` update · `Enter` start · `q` quit
- **During a test:** a 3-2-1 countdown, live WPM/accuracy/progress, colour-coded
  characters (correct = white, wrong = red, pending = dim, cursor = highlighted),
  word-safe wrapping to your terminal width. `Tab` restart · `Esc` menu.
- **After:** WPM, accuracy, raw WPM, consistency, time, characters, errors, and a
  personal-best flag. `Enter` next · `r` retry · `m` menu · `q` quit.
- **Leaderboard** (`b` from the menu): a read-only view of the same global
  leaderboard as the web app, for the category matching your menu selection.
  `p` cycles period, `t` toggles fastest/most-accurate. The CLI reads it via
  Firebase **anonymous** auth (enable it in the console — see Firebase setup);
  getting *onto* the board is done by signing in with Google on the web.

### Naming a device (`n`)

Scores carry the machine they were typed on, so the leaderboard can tell your
laptop from your desktop. Unnamed machines fall back to the hostname; press `n`
to give this one a friendly name (max 32 chars, empty to go back to the
hostname). Non-interactively:

```bash
typer --device="Work laptop"   # set and exit — works without a TTY
typer --device=                # clear it, back to the hostname
```

The name is saved to `~/.typer/stats.json`. When you're signed in it also syncs
to your account (`users/{uid}/devices/{machineId}`, the same documents the web
app writes) and is pulled back on the next sign-in, so a reinstall keeps it.

> **The CLI and your browser are separate devices**, even on one machine: each
> has its own `machineId`, so naming one doesn't rename the other. That's
> deliberate — "Laptop (terminal)" and "Laptop (web)" are genuinely different
> entries on the board.

### Updating (`u`)

The CLI is installed from a tarball, so unlike the web app it never changes
until you reinstall it. Press `u` to check GitHub for a newer commit on `main`;
if there is one, `u` again re-runs the install for you and exits so you can
restart. The check also runs quietly at startup, which is what lights up the
`★ update available` hint on the menu.

The update reinstalls into **the same prefix this copy lives in** (derived from
its own path), so an install that went to `~/.local` updates in `~/.local` and
never trips over the `/usr` permission problem. Running via `npx` or from a
checkout instead? The screen says so and points at `git pull` rather than
pretending it can update you.

> "Newer" = the latest commit on `main` is more recent than this copy's install
> timestamp. No version bumps needed — but it does mean the check reports
> *any* pushed commit, including ones that don't touch the CLI.

The terminal client has **zero runtime dependencies**: the engine, generator,
metrics and leaderboard ranking come from `src/core/`, and it talks to Firebase
(auth + Firestore) over the plain **REST API** with Node's built-in `fetch` —
no Firebase SDK. That's why `npm install -g` is tiny and instant. (The Firebase
*SDK* is only a dev dependency, used to build the web app.) Needs a TTY.

### Platform support

Works on **macOS, Linux, and Windows** (Node 18+) — plain ANSI + raw stdin with
cross-platform browser launching (`open` / `xdg-open` / `cmd start`).

- **Windows:** run it in **Windows Terminal, PowerShell, or cmd**. Git Bash /
  MinTTY don't provide a real TTY for raw input — if you must use them, prefix
  with `winpty typer`.
- **Linux:** any standard terminal. Google sign-in tries a long list of browser
  openers, and on a headless box (no `$DISPLAY`/`$WAYLAND_DISPLAY`) it switches
  to the device-code flow automatically — see *CLI Google sign-in* below.
- **WSL:** sign-in hands the URL to the Windows browser (`wslview`, else
  PowerShell `Start-Process`); WSL2's default localhost forwarding lets the
  redirect reach the loopback server. If it doesn't, use `--auth=device`.

### CLI Google sign-in

By default the terminal reads the leaderboard anonymously. Sign in with Google
(`g` from the menu) to make your terminal runs **count on the leaderboard** as
your account. Your password is never seen by the CLI, and a refresh token is
saved to `~/.typer/auth.json` (mode 600) so you stay signed in.

Because a CLI runs everywhere, there are **two flows** and it picks for you:

| Flow | When | How it works |
|------|------|--------------|
| **Loopback** | there's a browser (normal desktop, WSL) | opens your browser to Google's consent screen and catches the redirect on a throwaway `127.0.0.1` server (PKCE, random port) |
| **Device code** | headless box, SSH, container, no `$DISPLAY` | shows a short code + URL; you approve on your phone, the CLI polls Google |

`auto` uses the browser when the machine can plausibly show one, and falls back
to the device flow if no opener works. Override with flags:

```bash
typer --auth=device        # force the code flow even on a desktop
typer --auth=browser       # force the loopback flow
typer --auth-port=45123    # pin the loopback port (see SSH, below)
```

`Esc` cancels a sign-in in progress.

**Browser launching** tries, in order: `$BROWSER`, then the platform opener
(`open` on macOS; `start` then `rundll32` on Windows; `wslview` /
`powershell.exe` under WSL; `termux-open-url` on Termux), then `xdg-open`,
`gio`, `gnome-open`, `kde-open`, `x-www-browser`, `sensible-browser`, and
finally Firefox/Chrome/Chromium directly — and it *detects* failure (a missing
binary, or `xdg-open` exiting 3 with no handler) instead of silently assuming a
window appeared. See [`terminal/open-url.js`](terminal/open-url.js).

**Over SSH** you have two options. Easiest: `typer --auth=device` and approve on
your phone — nothing needs to reach the remote machine. Or forward a pinned
port, so the redirect lands back on your laptop's browser:

```bash
ssh -L 45123:127.0.0.1:45123 you@host
typer --auth=browser --auth-port=45123
```

#### Maintainer setup (once, before publishing)

The OAuth client id/secret ship **in the package** —
[`terminal/oauth-client.js`](terminal/oauth-client.js) — which is how every
distributed CLI that does Google sign-in works (gcloud, `gh`, rclone). Google's
own guidance for installed apps is explicit that in this context "the client
secret is obviously not treated as a secret"; the account is protected by the
consent screen and PKCE, not by hiding those strings. Users can still override
with their own client via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and
`GOOGLE_DEVICE_CLIENT_ID` / `_SECRET`), or `~/.typer/oauth.json`:

```json
{
  "desktop": { "client_id": "…", "client_secret": "…" },
  "device":  { "client_id": "…", "client_secret": "…" }
}
```

To make sign-in work for the public, fill in `terminal/oauth-client.js` and
commit it:

1. [Google Cloud console](https://console.cloud.google.com/apis/credentials) →
   project **digi-typer** → **Create Credentials → OAuth client ID → Desktop
   app** → paste into `DESKTOP`. (The *web* client can't do loopback redirects.)
2. Same again with **TVs and Limited Input devices** → paste into `DEVICE`.
   This one is what makes SSH/headless sign-in possible.
3. **OAuth consent screen** → add scopes `openid`, `email`, `profile`, then
   **publish** the app. Left in "Testing", only accounts you list by hand can
   sign in — which will look like a broken CLI to everyone else.
4. **Firebase console → Authentication → Sign-in method → Google** → confirm
   both client IDs are accepted. Clients in the same Google Cloud project are
   normally fine automatically; if `accounts:signInWithIdp` returns an audience
   error, add them under *"Whitelist client IDs from external projects"*.

Until steps 1–2 are done the menu shows *"Google sign-in not configured"* and
the CLI stays in read-only (anonymous) leaderboard mode — nothing else breaks.

> Setting the env vars in **fish** uses `set`, not `export`:
> `set -Ux GOOGLE_CLIENT_ID "…"`. In PowerShell: `$env:GOOGLE_CLIENT_ID = "…"`.

## Firebase (Google sign-in + cloud stats)

The game works signed-out (stats saved locally on the device). Signing in with
Google syncs stats to Firestore under your account, across devices. Project:
**digi-typer** (config in `src/firebase/config.js` — those keys are public by
design; access is guarded by security rules).

**One-time setup in the [Firebase console](https://console.firebase.google.com/project/digi-typer):**

1. **Authentication → Sign-in method → Google → Enable.** Set a support email, save.
2. **Authentication → Sign-in method → Anonymous → Enable.** This lets the
   terminal client read the leaderboard (read-only) without a Google login.
3. **Firestore Database → Create database** (production mode is fine — rules below lock it down).
4. **Firestore → Rules** → paste the contents of [`firestore.rules`](firestore.rules) → **Publish**.
5. **Authentication → Settings → Authorized domains** → add the domain you host on
   (e.g. `yourdomain.co.za`). `localhost` is already allowed for local dev.

That's it — no keys to rotate, nothing server-side.

### Data model
```
users/{uid}/runs/{runId}       ->  a private run: { mode, difficulty, wpm, rawWpm,
                                    accuracy, consistency, seconds, chars, errors,
                                    at, machineId, device }
users/{uid}/devices/{machineId} -> { name, updatedAt }   named devices
scores/{autoId}                 -> public leaderboard entry: { uid, name, photo,
                                    device, wpm, accuracy, mode, difficulty, at }
```
All queries use single-field indexes only (Firestore auto-creates these) — **no
manual composite indexes to set up.**

### Named devices
Each browser has a stable `machineId`. Give it a friendly name ("MacBook",
"Work PC") from the device chip under the header. When signed in, the name is
saved to your account keyed by `machineId`, so signing in on that same device
recognises it every time. The stats panel's **"this machine only"** toggle lets
you compare keyboards even on one account across several computers.

### Leaderboard
Finished runs by signed-in players are published to the global `scores`
collection (guests play locally and don't appear). The leaderboard is scoped to
a **category** — a specific **mode + difficulty** — so difficulty is fair: an
easy-words 120 wpm never competes against a hard-mode run. Within a category it
shows the best result **per player** for **Today / This month / All time**,
ranked by **Fastest (WPM)** or **Most accurate**. Finishing a test auto-selects
that test's category on the board. To keep it credible, only runs with
`wpm ≤ 300` and `≥ 2s` are submitted; your personal stats always save regardless.

> Category filtering is done client-side over the most recent ~1000 scores in
> the window. That's ample early on; if the game gets busy, add Firestore
> `where('mode', ...)` clauses + a composite index for exact server-side scoping.

## Deploy to xneelo

1. `npm run build`
2. Upload **everything inside `dist/`** to your `public_html` (or a subfolder
   like `public_html/typer/`) via FTP / the xneelo file manager.
3. Done — it's fully static. `vite.config.js` sets `base: './'` so it works
   from any subdirectory. No server-side runtime needed.

## Architecture (why it's laid out this way)

```
src/
  core/        <- pure, DOM-free. SHARED with the terminal version.
    words.js       word banks by difficulty
    texts.js       quotes for Quotes mode
    generator.js   builds the target text from a config
    metrics.js     WPM / accuracy / consistency math
    engine.js      TypingEngine — the state machine both frontends drive
  store/       <- persistence, swappable backend
    storage.js     LocalStatsStore today; Firebase drops in here
    stats.js       service: profiles, saving runs, summaries
  main.js      web UI (wires the engine to the DOM)
  style.css
terminal/      <- the CLI client (Node, zero deps)
  typer-cli.js     state machine / orchestrator
  render.js        ANSI frames + word-safe wrapping
  keys.js          raw stdin -> logical key events
  store.js         ~/.typer/stats.json persistence
  google-auth.js   OAuth: loopback + device-code flows
  oauth-client.js  shipped OAuth client ids (+ user overrides)
  open-url.js      cross-platform browser launching
  session.js       Google token -> Firebase session, persisted
  firebase-rest.js Identity Toolkit + Firestore over plain REST
  cloud.js         leaderboard fetch
```

Two seams were designed in from the start:

- **`src/core/` is pure JS with no DOM.** The terminal client (`terminal/`)
  imports the exact same `TypingEngine`, generator and metrics — no logic
  duplicated between web and CLI.
- **`src/store/storage.js` is an interface.** The whole app talks to a
  `StatsStore` with async methods. Today it's `LocalStatsStore` (localStorage,
  keyed by a stable per-machine id). To move stats to the cloud, implement the
  same methods with Firestore and change the single `export const store = …`
  line — the game never knows the difference.

## Roadmap

- [x] Web version
- [x] Firebase Google auth (guest fallback kept)
- [x] Firestore stats backend (`FirebaseStatsStore`)
- [x] Named devices synced to your account
- [x] Global leaderboards (day / month / all-time · fastest / most accurate)
- [x] Terminal version (`npm run cli`) reusing `src/core/`
