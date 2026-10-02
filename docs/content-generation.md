# LangTrainer — Content generation with Gemini (free tier)

This page covers `scripts/content-generate.ts`, the automated content generator introduced in
stage 4b. It calls the Gemini REST API directly (no SDK, just `fetch`) to write topic and
phrase-set JSON files under `content/<programId>/`, using the same rules and schema as
`docs/content-prompt-pack.md` (manual generation) and `docs/content-authoring.md` (the full
authoring contract).

## 1. Set up `.env`

1. Get a free-tier API key at <https://aistudio.google.com/apikey>.
2. Copy `.env.example` to `.env` in the repo root and fill in `GEMINI_API_KEY`.
3. `.env` is gitignored (`.gitignore` already excludes `.env` and `.env.*`, keeping only
   `.env.example`) — **never commit it**. `scripts/content-generate.ts` loads it automatically
   with Node's built-in `process.loadEnvFile()` (no dependency added).
4. **Choose the model.** The default is `gemini-3.8-flash` (`DEFAULT_MODEL` at the top of
   `scripts/content-generate.ts`). Override it with `GEMINI_MODEL=<name>` in `.env` or with
   `--model <name>` on the command line (the flag wins). **Model names change and old ones are
   retired** — if a run fails with a 404 or "model not found", look up a current model name in
   AI Studio (<https://aistudio.google.com>) or at <https://ai.google.dev/gemini-api/docs/models>
   and pass that instead.

## 2. Commands

Generate every topic of a module that doesn't have a file yet:

```sh
npm run content:generate -- --program pt-PT-A1 --module m2
```

Generate one topic (English B2 course, module 1):

```sh
npm run content:generate -- --program en-b2 --module m1
```

Other flags:

- `--topic <topicId>` — generate a single topic (the module is found automatically from
  whichever `modules/*.json` file lists it under `topics[]`).
- `--phrases <phraseSetId>` — generate a phrase set listed in `content/<programId>/phrases.plan.json`.
- `--force` — regenerate even if the topic/phrase-set file already exists. Without it,
  `--module`, `--topic` and `--phrases` all skip anything that already has a file, so a
  reviewed topic is never overwritten by accident.
- `--dry-run` — print the system + user prompts for every chunk without calling the API (no
  `GEMINI_API_KEY` required — use this to sanity-check a new module's briefs).
- `--model <name>` / `--count <n>` — override the model or the exercise count for this run.
- `--sleep <ms>` (default 2000) — pause between sequential API calls (see free-tier limits below).

Preview without any API key or network access:

```sh
npm run content:generate -- --program pt-PT-A1 --module m2 --dry-run
```

## 3. What the generator does

For each topic/phrase-set that needs generating:

1. **Prompt assembly** — system prompt = an intro line naming the program/target language +
   `content/<programId>/RULES.md` (language rules) + `scripts/prompt-parts/pedagogy.md` +
   `scripts/prompt-parts/schema.md` + `scripts/prompt-parts/examples.md` +
   `scripts/prompt-parts/self-check.md` (the same program-independent parts
   `docs/content-prompt-pack.md` uses, so the pack and the script never drift apart). User
   prompt = the topic/phrase-set brief (id, title, kind, count, brief, known/avoid grammar) plus
   the exact id range required for that chunk. The API key is sent in the `x-goog-api-key`
   header (never in the URL); `maxOutputTokens` is 32768.
2. **Chunked generation** — exercises are requested in chunks of 20 (ids `<id>-01`..`<id>-20`,
   then `<id>-21`..`<id>-40`), then merged into one Topic/PhraseSet JSON. A continuation chunk
   is given the first chunk's context and key items (or phrase list) and the list of target
   sentences already used, so it stays on the same material and doesn't repeat sentences.
   A reply cut off at `MAX_TOKENS` or one that isn't valid JSON is retried once; if it fails
   again, that chunk's exercises are simply missing and the repair step writes them.
   After merging, the topic id, `moduleId`, every exercise's `topicId` and the exercise ids
   (`<id>-01`, `<id>-02`, …) are forced to the requested values — the model's own ids are never
   trusted.
3. **Validation** — the merged JSON is checked as part of a temporary program containing the
   module's other existing topics plus this new one (the same `validateProgram` +
   `checkContent` used by `npm run content:check`), so id collisions and rule violations are
   caught immediately.
4. **Repair loop** — on any blocking problem (or missing exercises), only the affected
   exercises (by id), the ids still missing and the problem list are sent back — not the whole
   40-exercise JSON — and the returned exercises are spliced back in by id (topic-level fields
   such as `context` are sent only when they have a problem themselves). Up to **2** repair
   rounds. If problems remain after that, or an API call fails for good, whatever was generated
   is written to `content/<programId>/topics/_draft-<id>.json` (or `phrases/_draft-<id>.json`)
   instead of the real path, and the command exits 1 with the problem list printed — nothing
   broken is ever written to the real topic file, and no finished chunk is lost.
5. On success, the file is written Prettier-formatted, and the script prints the next steps.

**This script must never be pointed at the real API from an automated/CI run** — there is no key
committed anywhere, and the unit tests (`scripts/__tests__/content-generate.test.ts`) mock
`fetch` instead of calling Gemini. The very first real run against a live key should be treated
as exploratory: read its printed report and the generated JSON carefully before trusting it.

## 4. Free-tier limits

Gemini's free tier enforces requests-per-minute and requests-per-day limits that vary by model
and change over time — check the current numbers at
<https://ai.google.dev/gemini-api/docs/rate-limits> before a big generation run. The script is
free-tier friendly by design: calls are sequential (never parallel), there's a `--sleep` pause
(default 2000 ms) between calls, and a 429, 500 or 503 response is retried with backoff rather
than failing the whole run: the wait comes from `Retry-After` (seconds or an HTTP date) or the
error body's `retryDelay` (e.g. `"12s"`), otherwise it is exponential; each wait is capped at 60 s
and there are at most 5 tries per call. Token usage from `usageMetadata` is printed after every call so you can watch your
budget.

## 5. Recommended workflow

1. `npm run content:generate -- --program <id> --module <moduleId>` (or `--topic`/`--phrases`).
2. `npm run content:check -- --program <id>` (default `pt-PT-A1`) — modules not yet in `program.json`'s `moduleOrder` are still fully
   validated (schema + content rules) and reported under "Not yet in moduleOrder (checked, not
   built)", without blocking the exit code, so you can review a module before it ships.
3. **Language review** (a human, or Claude) — the generator's own repair loop only fixes
   structural/schema problems; European-Portuguese-only phrasing, natural sentences and
   Brazilian-form slips still need a language pass (`docs/content-authoring.md` §7).
4. Add the module to `program.json`'s `moduleOrder` (and, if you generated one topic at a time,
   confirm the topic id is already in the module file's `topics[]`).
5. `npm run content:build -- --program <id>` — assembles `content/<programId>/**` into one
   course JSON: `src/content/programs/<programId>.json` (generated, committed) for a bundled
   course (one imported by `src/content/programs/index.ts`), otherwise
   `dist-courses/<programId>.json` (gitignored) — an importable course file (§7).
6. Commit the new/updated files and push.

## 6. Manual alternative

You don't need this script at all: `docs/content-prompt-pack.md` has the same system prompt
(Block A) and a fill-in-the-blanks topic brief (Block B) for pasting into any chat model by hand
(Gemini's web UI, Claude, DeepSeek, Qwen, Kimi...). Save the JSON reply straight to
`content/<programId>/topics/<topicId>.json`, run `npm run content:check`, and iterate on any
printed problems the same way the script's repair loop does.

## 7. Getting a built course onto a phone

- **Bundled course** (`pt-PT-A1`): `npm run content:build` writes
  `src/content/programs/pt-PT-A1.json`; commit and push, and it ships with the next app build.
- **Any other course, e.g. `en-b2`** — build it into a file and import it on the phone:

  ```sh
  npm run content:check -- --program en-b2
  npm run content:build -- --program en-b2     # writes dist-courses/en-b2.json
  ```

  Move `dist-courses/en-b2.json` to the phone (e-mail it to yourself, a cloud drive, a USB
  cable…), then in the app: **Learn → tap the course card → Import a course from file…** (or
  **Settings → Courses → Import course**) and pick the file. The app validates it, installs it
  and makes it the active course. Importing a newer build of the same course replaces it and
  keeps your progress as long as topic ids are unchanged. More in `docs/courses.md`.
