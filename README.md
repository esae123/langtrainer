# LangTrainer

An installable, offline-first PWA for daily language-learning sessions on Android
(Chrome). This is **Stage 1**: a professional-looking app skeleton with working
local storage, settings, and backup/restore. There are no exercises yet — the
domain model and database schema are already in place so later stages can build
on top of them without migrations.

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
  routes/            # Learn / Progress / Settings screens
  pwa/                # update-available toast
```

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
