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

## Firebase (Google sign-in + cloud stats)

The game works signed-out (stats saved locally on the device). Signing in with
Google syncs stats to Firestore under your account, across devices. Project:
**digi-typer** (config in `src/firebase/config.js` — those keys are public by
design; access is guarded by security rules).

**One-time setup in the [Firebase console](https://console.firebase.google.com/project/digi-typer):**

1. **Authentication → Sign-in method → Google → Enable.** Set a support email, save.
2. **Firestore Database → Create database** (production mode is fine — rules below lock it down).
3. **Firestore → Rules** → paste the contents of [`firestore.rules`](firestore.rules) → **Publish**.
4. **Authentication → Settings → Authorized domains** → add the domain you host on
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
```

Two seams were designed in from the start:

- **`src/core/` is pure JS with no DOM.** The upcoming terminal client imports
  the exact same `TypingEngine`, generator and metrics — no logic duplicated.
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
- [ ] Terminal version (`npm run cli`) reusing `src/core/`
