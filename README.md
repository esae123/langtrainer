# LangTrainer

An installable, offline-first PWA for daily language-learning sessions on Android
(Chrome). It ships an app skeleton with local storage, settings and
backup/restore (Stage 1), an authored European Portuguese A1 program with a
content library (Stage 2), and complete training sessions with three input
modes, feedback and spaced repetition (Stage 3).

## Stack

- Vite 6 + React 19 + TypeScript (strict)
- Tailwind CSS v4 (`@tailwindcss/vite`)
- `react-router` v7, `HashRouter` (works on static hosts with no SPA fallback,
  such as GitHub Pages)
- Dexie v4 (IndexedDB) + `dexie-react-hooks`
- `vite-plugin-pwa` (installable, offline, prompts to update)
- Vitest + `fake-indexeddb` + `@testing-library/react` for tests

## Requirements

- Node 24, npm 11 (no global installs needed)

## Scripts

```bash
npm install       # install dependencies
npm run dev        # start the Vite dev server
npm run build       # type-check and build to dist/
npm run preview      # serve the production build locally
npm run lint        # ESLint (typescript-eslint, react-hooks, react-refresh)
npm run test        # run the Vitest suite once
npm run icons       # regenerate public/icons/*.png from icons/icon.svg (needs sharp)
npm run format       # Prettier --write
```

## Project layout

```
src/
  content/          # domain types (Program/Module/Topic/Exercise), JSON program data, validator
  db/                # Dexie schema (db.ts), reset helper
  settings/          # typed Settings, context/hook, Dexie-backed store
  backup/            # export/import to a single JSON file
  i18n/              # minimal en/ru dictionaries + useT()
  theme/             # system/light/dark handling
  components/        # shared UI (Card, Sheet, ConfirmDialog, Toggle, tab bar, toast)
  engine/            # pure session logic: planning, answer checking, SRS (no React, no Dexie)
  session/           # session state machine, persistence and the /session screens
  exercises/         # one renderer per exercise type + shared input widgets
  routes/            # Learn / Progress / Settings / Library screens
  pwa/                # update-available toast
```

`content/` holds the authored program sources (see `docs/content-authoring.md`);
`npm run content:build` compiles them into `src/content/programs/`. The rules the
engine follows are documented in `docs/engine.md`.

## Environment variables

- `VITE_BASE` — the app's base path, used by `vite.config.ts` as `base`. Defaults
  to `/` for local dev and previews. Set it to `/<repo-name>/` when building for
  GitHub Pages (the CI workflow does this automatically).

## Deploying to GitHub Pages

1. Create a new, empty GitHub repository (any name — the workflow reads it via
   `github.event.repository.name`, so no manual edits are needed).
2. Push this project to the `main` branch of that repository:
   ```bash
   git remote add origin https://github.com/<you>/<repo-name>.git
   git push -u origin main
   ```
3. In the repository settings, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
4. Push to `main` (or re-run the workflow from the **Actions** tab). The
   `.github/workflows/deploy.yml` workflow will:
   - install dependencies, run `npm run lint` and `npm run test`,
   - build with `VITE_BASE=/<repo-name>/`,
   - upload `dist/` and deploy it via `actions/deploy-pages`.
5. Your app will be live at `https://<you>.github.io/<repo-name>/`.

Because routing uses `HashRouter`, all in-app links resolve under the `#/...`
fragment, so GitHub Pages' lack of SPA rewrite rules is not a problem — every
route ultimately loads the same `index.html`.

## Installing on Android (Chrome)

1. Open the deployed URL in Chrome on Android.
2. Chrome will offer **"Add to Home screen"** / **"Install app"** (via the
   manifest served at `/manifest.webmanifest`); alternatively use the ⋮ menu →
   **Install app**.
3. The app opens `display: standalone` (no browser chrome), using the icons in
   `public/icons/`.
4. When a new version is deployed, the app shows an in-app **"Update"** toast
   the next time it's opened while online — tapping it activates the new
   service worker and reloads.

### Verifying offline support

1. `npm run build && npm run preview`.
2. Open the preview URL in Chrome, let it fully load (so the service worker
   installs and precaches assets — check **Application → Service Workers** in
   DevTools).
3. In DevTools → **Network**, tick **Offline** (or **Application → Service
   Workers → Offline**).
4. Reload the page — it should still load fully from the cache.

## How a session works

1. **Learn** shows the current topic (first topic that is still `new` or
   `learning`), how many of its 20 exercises you have answered, the next review
   date, and a **Resume session** card if you left one unfinished in the last 24
   hours. Pick a session length (5/10/15/20/30 or ∞) and tap **Start session**.
2. The session is planned up front: a **new** block from the current topic
   (easiest first, preceded by a context screen with the topic's rule text and
   key words), a **review** block from topics whose review is due, and a block of
   **everyday phrases**. Open-ended sessions are planned in cycles of six. Each
   exercise gets an input mode — tiles, letters or typing — drawn from the shares
   in Settings → Input and restricted to what the exercise supports.
3. Answer, then tap **Check**. A feedback sheet slides up with a tick/cross, the
   correct answer, a note if only the accents were off, and a one-line
   explanation. `about_me` exercises show a sample answer and ask you to grade
   yourself. In typing mode an optional hint under the prompt gives the first
   letter and the length of the answer (Settings → Input), and an accent strip
   under the field inserts `á ã ç …` at the caret. **Match the pairs** lets you
   link any two items freely — connect everything, then tap **Check** to see
   which pairs were right.
4. **×** stops the session at any point: everything already answered is saved,
   the rest is simply skipped.
5. The **summary** shows your percentage, a breakdown per block and what changed
   per topic ("→ ready for review in 30 days", "→ mastered!"). Each answer is
   stored in `attempts`; topic progress and the spaced-repetition schedule are
   updated at the end of the session.

## How backups work

- **Export** (Settings → Backup → Export backup, or the reminder banner on the
  Learn screen): gathers every Dexie table into one JSON file named
  `langtrainer-backup-YYYY-MM-DD.json`. On Android, this uses the Web Share API
  so you can save it to Drive, send it to yourself, etc.; elsewhere it falls
  back to a normal file download. **The Gemini API key is never included** —
  it's stripped from the exported settings and only ever lives in this
  device's IndexedDB.
- **Import** (Settings → Backup → Import backup): pick a previously exported
  `.json` file. After confirming ("this replaces all current data"), the app
  validates the file's shape and schema version, then replaces every table's
  contents in a single Dexie transaction. Your current device's Gemini API key
  is always preserved, even if the backup was made without one or on another
  device.
- `lastBackupAt` is recorded in settings and shown in **Settings → Backup**; a
  banner nudges you to back up if you never have, or it's been more than 7
  days.

## Notes on quality bar

- Mobile-first, single column, max width 480px, centered on larger screens.
- Bottom tab bar (Learn / Progress / Settings), rounded cards, one accent
  color, ≥44px touch targets, safe-area insets for notches/home indicators.
- Theme follows the system by default; can be overridden to light/dark in
  Settings → Appearance.
