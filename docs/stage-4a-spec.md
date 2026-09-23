# LangTrainer — Stage 4a spec: multiple courses (programs), switcher, import from file

Read first: `docs/stage-1-spec.md`, `src/content/types.ts`, `src/content/programs/index.ts`, `src/content/validateProgram.ts`,
`src/content/contentRules.ts`, `src/db/db.ts`, `src/settings/*`, `src/routes/LearnScreen.tsx`, `src/routes/LibraryScreen.tsx`,
`src/session/useSessionRunner.ts`, `src/engine/plan.ts`, `src/backup/backup.ts`.

Another developer is concurrently working in `scripts/`, `content/**` and `docs/content-generation.md` — do not touch those.
Commit only your own paths with explicit `git add <paths>`; never `git add -A`.

## 1. Program registry

- A "program" (course) can be **bundled** (from `src/content/programs`, built into the app) or **imported** (stored on the
  device). New Dexie table `programs`: `{ id: string; program: Program; source: 'imported'; importedAt: number; fileName?: string }`,
  pk `id`. Dexie → version 4.
- `src/content/programRegistry.ts`: `useAllPrograms()` (bundled + imported, live), `useProgram(id)`, `getProgramSync`
  where needed. Bundled and imported ids must not collide: an imported program with a bundled id is rejected ("This course
  is built into the app and cannot be replaced").
- `settings.activeProgramId` selects the course. If it points to a removed program, fall back to the first bundled one.
- Everything that today uses `getProgram('pt-PT-A1')` / the first program must use the active program: Learn screen,
  session planning, Library, progress queries (filter `topicProgress`/`sessions` by `programId`).

## 2. Course switcher on the Learn screen

- The program card becomes tappable → bottom sheet "Courses": list of all programs with title, level, target language,
  modules/topics count and a one-line progress summary (topics completed / total). Active one marked. Tap → set
  `activeProgramId`, close. Last row: "Import a course from file…" (opens the import flow of §3).
- If an in-progress session exists for another program, the Resume card shows that program's title; starting a new
  session always uses the active program. Switching program does not discard a saved session.

## 3. Import a course from a JSON file

- Entry points: Learn switcher sheet and Settings → Library group ("Import course").
- Flow: file picker (`.json`) → parse → `validateProgram` → `checkContent` (from `contentRules`) → **cross-program topic id
  check**: topic and phrase-set ids must not exist in any other installed program (bundled or imported) → on problems show a
  sheet with the first 10 problems (path + message) and "Copy all" button; nothing is saved. On success: if a program with
  the same id is already imported → confirm "Replace course «{title}»? Your progress is kept." → `put`. Set it active,
  toast "Course imported".
- Robustness: size limit 10 MB; accept files that contain the built `$generated` key; accept `Program` JSON exactly as
  produced by `scripts/content-build.ts`.
- Remove: Library → program header → "Remove course" (imported only) → confirm sheet with a checkbox "Also delete my
  progress for this course" (default off). Export: "Export course file" for imported programs (share/download JSON).
- Backups (`backup.ts`) must include the `programs` table (imported courses travel with the backup); confirm round-trip test.

## 4. Library and Progress adapt to programs

- Library lists programs as top-level sections (bundled badge / imported badge), then modules → topics as today.
- Learn card/current topic uses the active program. `plan.ts` input already carries the program — verify nothing else is
  hard-wired to `pt-PT-A1` (grep).

## 5. Docs

`docs/courses.md` (English, one page): what a course is; the two ways to add one (bundled folder + rebuild/push; import
file on the phone); file format pointer to `content-authoring.md` and `types.ts`; id conventions
(`<programId>` lowercase like `en-b2`; topic ids `<moduleId>-<slug>` prefixed uniquely per program, e.g. `en-b2-m1-...`,
because ids must be unique across all installed courses); `supportLanguage` semantics (language of prompts/explanations);
how progress is kept per course; how to replace a course with a new version without losing progress (keep topic ids).

## 6. Tests and gates

Registry (bundled + imported merge, fallback of activeProgramId), import happy path, import rejects (invalid, content
problems, id collision with bundled, cross-program topic collision), replace keeps progress, remove with/without progress,
switcher changes active program, backup round-trips `programs`. `npm run lint/test/build` green. i18n en + ru.
Commits e.g. "Stage 4a: program registry and course switcher", "Stage 4a: import/remove/export courses".
