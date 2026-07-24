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

```bash
# Install once (needs Node.js) — adds a global `typer` command:
npm install -g github:supermario2828/typer
typer                       # launch from anywhere
typer --mode=punctuation --difficulty=hard --length=50 --profile=marius

# Prefer not to install? Run it transiently:
npx --yes github:supermario2828/typer

# From a checkout:
npm run cli
```

> Both `install -g` and `npx github:...` work because the repo is **public** and
> `package.json` exposes a `bin` (`typer`). The web app shows the install
> command with a copy button at the bottom of the page.

- **Menu:** `m` mode · `d` difficulty · `l` length · `s` stats · `Enter` start · `q` quit
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

The engine, generator, metrics and leaderboard ranking all come from `src/`, so
the terminal is zero-deps of its own — just Firebase (already a dependency) for
the leaderboard read. Needs an interactive TTY.

### CLI Google sign-in (optional — to post CLI runs to the leaderboard)

By default the terminal reads the leaderboard anonymously. Sign in with Google
(`g` from the menu) to make your terminal runs **count on the leaderboard** as
your account. It uses the OAuth loopback flow: the CLI opens your browser, you
approve, and a refresh token is saved to `~/.typer/auth.json` (mode 600) so you
stay signed in. Your password is never seen by the CLI.

This needs a **Google OAuth "Desktop app" client** (the web client can't do the
loopback redirect). One-time setup:

1. [Google Cloud console](https://console.cloud.google.com/apis/credentials) →
   project **digi-typer** → **Create Credentials → OAuth client ID → Desktop app**.
2. Provide the client id + secret to the CLI, either via env vars:
   ```bash
   export GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
   export GOOGLE_CLIENT_SECRET="..."
   ```
   or `~/.typer/oauth.json`:
   ```json
   { "client_id": "....apps.googleusercontent.com", "client_secret": "..." }
   ```

For installed apps Google does not treat the client secret as confidential, but
this keeps it out of the public repo. If it isn't configured, the CLI simply
stays in read-only (anonymous) leaderboard mode.

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
  typer-cli.js   state machine / orchestrator
  render.js      ANSI frames + word-safe wrapping
  keys.js        raw stdin -> logical key events
  store.js       ~/.typer/stats.json persistence
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
