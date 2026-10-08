# LangTrainer — Content generation with Gemini or OpenAI (free tier / pay-as-you-go)

This page covers `scripts/content-generate.ts`, the automated content generator introduced in
stage 4b. It calls the Gemini or OpenAI REST API directly (no SDK, just `fetch`) to write topic
and phrase-set JSON files under `content/<programId>/`, using the same rules and schema as
`docs/content-prompt-pack.md` (manual generation) and `docs/content-authoring.md` (the full
authoring contract). Everything except the two provider calls themselves (chunking, id
normalisation, validation, the repair loop, draft files, `--force` guards) is provider-independent.

## 1. Set up `.env`

1. Get a free-tier API key at <https://aistudio.google.com/apikey> (Gemini) or, for OpenAI, an API
   key at <https://platform.openai.com/api-keys> (pay-as-you-go, no free tier).
2. Copy `.env.example` to `.env` in the repo root and fill in `GEMINI_API_KEY` (default provider)
   or `OPENAI_API_KEY` + `OPENAI_MODEL` (see §1b).
3. `.env` is gitignored (`.gitignore` already excludes `.env` and `.env.*`, keeping only
   `.env.example`) — **never commit it**. `scripts/content-generate.ts` loads it automatically
   with Node's built-in `process.loadEnvFile()` (no dependency added).
4. **Choose the Gemini model.** The default is `gemini-3.6-flash` (`DEFAULT_MODEL` at the top of
   `scripts/content-generate.ts`). Override it with `GEMINI_MODEL=<name>` in `.env` or with
   `--model <name>` on the command line (the flag wins); an empty `GEMINI_MODEL=` counts as unset
   and falls back to the default. **Model names change and old ones are retired** — if a run
   fails with a 404 or "model not found", look up a current model name in AI Studio
   (<https://aistudio.google.com>) or at <https://ai.google.dev/gemini-api/docs/models> and pass
   that instead.

## 1b. Switching to OpenAI

Set the provider with `AI_PROVIDER=openai` in `.env`, or pass `--provider openai` on the command
line (the flag wins; default is `gemini`). The provider value is lowercased and validated —
anything other than `gemini`/`openai` (any case) fails with a clear error instead of silently
falling back to Gemini. Then:

- `OPENAI_API_KEY` — required for any real (non-`--dry-run`) OpenAI call.
- `OPENAI_MODEL` — **required**, no hardcoded default: OpenAI model ids change, so the script
  refuses to guess one. Check a current "mini"-class model (cheap, fast) on
  <https://platform.openai.com/docs/pricing> and set it here, or pass `--model <name>`. Missing
  it (or an empty `OPENAI_MODEL=`, which counts as unset) fails with a clear message before any
  API call (dry runs are exempt, since they never call the API).
- `OPENAI_REASONING_EFFORT` (optional, `low | medium | high`) — sent as `reasoning_effort` for
  reasoning-capable models; same role as `GEMINI_THINKING_LEVEL`, overridden per run with
  `--thinking`.
- `OPENAI_MAX_COMPLETION_TOKENS` (optional) — overrides `MAX_OUTPUT_TOKENS` (65536) for
  `max_completion_tokens`; some OpenAI models cap lower.

Example:

```sh
# .env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini   # check platform.openai.com/docs/pricing for the current name
```

`OPENAI_MAX_COMPLETION_TOKENS` (optional) overrides `MAX_OUTPUT_TOKENS` (65536) for
`max_completion_tokens`; some OpenAI models cap lower. A reply whose `finish_reason` is `"length"`
and whose `message.content` is `null` (some reasoning models hit the cap before emitting any
content) is treated as a cut-off reply, not a fatal error — same retry-once/repair-loop handling
as any other `"length"`/`MAX_TOKENS` finish.

```sh
npm run content:generate -- --program pt-PT-A1 --topic m3-daily-routine --provider openai
```

**Cost hint:** a 40-exercise topic is roughly 25k input + 25k output tokens across its chunks and
any repair rounds (less for a 20-exercise topic/phrase set) — check
<https://platform.openai.com/docs/pricing> for current per-token prices before a big run; prompt
and completion token counts are printed after every call either way.

Request/response shape (no SDK, `fetch` only): `POST
https://api.openai.com/v1/chat/completions` with `Authorization: Bearer <key>`, a `system` +
`user` message pair, `response_format: {type: "json_object"}` and `max_completion_tokens` (no
`temperature` is sent — some reasoning models reject it). The reply's
`choices[0].message.content` is parsed as JSON; `finish_reason: "length"` is treated exactly like
Gemini's `MAX_TOKENS` (retried once, then handled by the repair loop); a `refusal` message fails
the call. 429s are retried with backoff like Gemini's, **except** a `429` whose body is
`error.code`/`error.type` `insufficient_quota` — out of billing credits — which stops the whole
run immediately (see §4).

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
- `--dry-run` — print the system + user prompts for every chunk without calling the API (no API
  key required — use this to sanity-check a new module's briefs).
- `--provider <gemini|openai>` — which API to call (default `gemini`, or `AI_PROVIDER` in `.env`;
  see §1b for OpenAI setup).
- `--model <name>` / `--count <n>` — override the model (for whichever provider is active) or the
  exercise count for this run.
- `--thinking <low|high|medium>` — Gemini 3 thinking level, or OpenAI `reasoning_effort`,
  depending on `--provider` (or `GEMINI_THINKING_LEVEL` / `OPENAI_REASONING_EFFORT` in `.env`).
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
   header (never in the URL); `maxOutputTokens` is 65536 (`MAX_OUTPUT_TOKENS`), overridable with
   `GEMINI_MAX_OUTPUT_TOKENS` for older models that cap lower (e.g. 8192).
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
   such as `context` are sent only when they have a problem themselves; a missing/lost chunk never
   triggers a header rewrite on its own — only a real header-level problem does). Up to **2**
   repair rounds. If problems remain after that, or an API call fails for good, whatever was
   generated is written Prettier-formatted to `content/<programId>/topics/_draft-<id>.json` (or
   `phrases/_draft-<id>.json`) instead of the real path, and the command exits 1 with the problem
   list printed — nothing broken is ever written to the real topic file, and no finished chunk is
   lost. If generation failed before any content at all came back (e.g. the very first call
   errored), **no draft file is written** — only the failure is printed, so
   `content/<programId>/` isn't cluttered with empty `_draft-*.json` files for topics that were
   never really attempted.
5. On success, the file is written Prettier-formatted, any stale `_draft-<id>.json` from an
   earlier failed attempt at the same topic/phrase set is deleted, and the script prints the next
   steps. For a topic, it also prints the exercise type mix and difficulty-band counts and WARNs
   (non-blocking) when `build_phrase` has fewer than 10 exercises, `question_for_answer` fewer
   than 8, or a difficulty band is off its ≈8/18/14 pedagogy target by more than 4 — a quick
   sanity check before the language review.

**This script must never be pointed at a real API from an automated/CI run** — there is no key
committed anywhere, and the unit tests (`scripts/__tests__/content-generate.test.ts`) mock
`fetch` instead of calling Gemini or OpenAI. The very first real run against a live key should be
treated as exploratory: read its printed report and the generated JSON carefully before trusting
it.

## 4. Rate limits, quotas, and stopping the whole run

Gemini's free tier enforces requests-per-minute **and requests-per-day** limits that vary by model
and change over time — check the current numbers at
<https://ai.google.dev/gemini-api/docs/rate-limits> before a big generation run. The script is
rate-limit friendly by design: calls are sequential (never parallel), there's a `--sleep` pause
(default 2000 ms) between calls, and a 429, 500, 502, 503 or 504 response is retried with backoff
rather than failing the whole run (504 included for Gemini, since a long "thinking" generation can
exceed the gateway's own timeout): the wait comes from OpenAI's `Retry-After-Ms` (milliseconds,
checked first) or `Retry-After` (seconds or an HTTP date), or the error body's `retryDelay` (e.g.
`"12s"`), otherwise it is exponential; each wait is capped at 60 s and there are at most 5 tries
per call. Token usage is printed after every call so you can watch your budget.

Two failures are different: retrying (or moving on to the next topic) would just burn the same
exhausted quota/credits, so the script **stops the whole run immediately** instead — any topic a
previous job in the same run already finished and wrote stays on disk, and no draft file is
written for a topic that was never attempted:

- **Gemini — daily quota exhausted.** A 429 whose body is a `QuotaFailure` violation with a
  `quotaId` containing `"PerDay"` (or a `retryDelay` over 10 minutes). The message names the
  model, when the quota resets, and reminds you that quotas are per model — pass a different
  `--model`, or wait and retry tomorrow. A short per-minute 429 is unaffected and keeps retrying
  as before.
- **OpenAI — out of credits.** A 429 whose body is `error.code`/`error.type`
  `insufficient_quota`. The message points at
  <https://platform.openai.com/account/billing>.

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

## Thinking level / reasoning effort

**Gemini 3 models:** set `GEMINI_THINKING_LEVEL=high` in `.env`, or pass `--thinking high` for one run. The script sends it as `generationConfig.thinkingConfig.thinkingLevel`; when unset, nothing is sent and the model uses its default. If a model rejects the field (HTTP 400 mentioning thinking), remove the setting for that model. Thinking tokens count toward the output limit, which is why `MAX_OUTPUT_TOKENS` is 65536.

**OpenAI reasoning models:** set `OPENAI_REASONING_EFFORT=medium` in `.env` (`low | medium | high`), or pass `--thinking medium` for one run (`--provider openai` makes `--thinking` apply to OpenAI's `reasoning_effort` instead of Gemini's thinking level). Unset = the model's default; reasoning tokens also count toward `max_completion_tokens`.
