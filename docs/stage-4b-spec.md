# LangTrainer — Stage 4b spec: content generation pipeline via Gemini (free tier)

Read first: `docs/content-authoring.md`, `docs/content-prompt-pack.md`, `scripts/content-lib.ts`, `scripts/content-check.ts`,
`scripts/content-build.ts`, `src/content/contentRules.ts`, `src/content/validateProgram.ts`, `content/pt-PT-A1/**`.

Another developer is concurrently working in `src/` (except `src/content/contentRules.ts`/`validateProgram.ts`, which you
may extend if strictly needed) and `docs/courses.md` — do not touch their files. Commit only your own paths with explicit
`git add <paths>`; never `git add -A`. You may edit `package.json` scripts and `.gitignore`.

## 1. Per-program authoring inputs

- `content/<programId>/RULES.md` — language rules for that course (replaces §2 of the guide). Create
  `content/pt-PT-A1/RULES.md` by moving §2 of `docs/content-authoring.md` there (leave a pointer in the guide).
- Module file gains briefs. New shape (keep `topicOrder` support for backwards compatibility in `content-lib.ts`):
  ```json
  { "id": "m2", "title": "…", "description": "…",
    "topics": [ { "id": "m2-family", "title": "Family and pets", "kind": "vocabulary", "count": 40,
                  "brief": "family members …; possessives …; ter for having …", 
                  "known": "Module 1 grammar", "avoid": "past tenses, object pronouns" } ] }
  ```
  `topicOrder` is derived from `topics[].id` when `topics` is present. Convert `content/pt-PT-A1/modules/m1.json` to the
  new shape (briefs can be short; topics already exist). Add `content/pt-PT-A1/modules/m2.json` … `m7.json` with briefs
  derived from the roadmap (`../Portuguese Basic Learning Roadmap.md`, one level up from `langtrainer/`): 4–8 topics per module,
  ids `m<N>-<slug>`, kinds, briefs 2–4 lines each, `known`/`avoid`. Do **not** generate their topic files. Update
  `program.json` `moduleOrder` to include m1…m7 only when the module has at least one topic file present? No — keep
  `moduleOrder: ["m1"]` for now and document that modules are added to `moduleOrder` once their topics exist; `content-check`
  must not fail on modules that are defined but not listed in `moduleOrder` (they are simply not built).
- Phrase-set briefs: `content/<programId>/phrases.plan.json`: `[{ "id": "everyday-2", "title": "…", "brief": "…", "phrases": 50, "exercises": 40 }]`.

## 2. New course skeleton: English B2

`content/en-b2/program.json` (id `en-b2`, title "English B2 — vocabulary and natural speech", targetLanguage `en`,
supportLanguage `en`, level `B2`, moduleOrder `[]`), `content/en-b2/RULES.md`, `content/en-b2/modules/m1.json` with 6 topic
briefs (e.g. collocations for work and study; phrasal verbs of communication; describing people and behaviour; idioms of
time and money; linking words and hedging; register: formal vs casual). RULES.md for en-b2 must say: prompts and
explanations in English; when target == support language, `translate_word` uses a **definition or paraphrase** as the
`sentence` with the target word bolded in the *definition*… — no: define it precisely: `direction: 'toTarget'`, `sentence`
= an English sentence with a **gap-like paraphrase in bold** ("She **avoided giving a direct answer** to the question."),
`word` = that bolded chunk, `answer` = the target word/phrase ("dodged"), options = 4 near-synonyms. `match_pairs.support` =
short definition or synonym. A short Russian gloss in parentheses is allowed in `explanation` for hard words. Topic ids
prefixed `en-b2-m1-…` (ids must be unique across all installed courses). No topic files are generated in this stage.

## 3. Generator script `scripts/content-generate.ts`

- Runs with Node 24 (`node scripts/content-generate.ts …`), no SDK: call the Gemini REST API
  (`generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`) with `fetch`, `responseMimeType: application/json`.
  Key from `.env` (`GEMINI_API_KEY`), model from `GEMINI_MODEL` (default a current Flash-class model; make it a constant
  with a comment that it may need updating). Add `.env.example`; ensure `.env` is gitignored.
- Prompt assembly: system = RULES.md + pedagogy + schema + examples from `docs/content-prompt-pack.md` (extract Block A's
  program-independent parts into `scripts/prompt-parts/*.md` so the pack and the script share one source; update the pack
  to reference them or regenerate it — keep the pack usable by a human). User = topic brief (id, title, kind, count, brief,
  known, avoid, required id range).
- Generate in chunks of 20 exercises (ids 01–20, then 21–40 with "continue, do not repeat sentences"), merge, then run
  `validateProgram`-style validation of the topic + `checkContent` on a temporary program containing existing topics of the
  module plus the new one. On problems → **repair call**: send the JSON and the problem list, ask for the full corrected
  JSON; up to 2 repair rounds; then write the file (Prettier-formatted) and print the check report. If still failing,
  write to `content/<program>/topics/_draft-<id>.json` and exit 1 with the problems.
- CLI: `--program pt-PT-A1 --module m2` (all topics of the module without a file), `--topic m2-family`, `--phrases everyday-2`,
  `--force` (regenerate existing), `--dry-run` (print prompts only), `--model`, `--count`.
- Free-tier friendliness: on HTTP 429 wait per `Retry-After` or exponential backoff (max 5 tries); print token usage from
  `usageMetadata`; sequential, not parallel; a `--sleep <ms>` between calls (default 2000).
- After generation print next steps: "review language, then add module to moduleOrder and run npm run content:build".

## 4. Docs

`docs/content-generation.md` (English): set up `.env` (never commit it), commands with examples for pt-PT-A1 m2 and en-b2 m1,
what the check/repair loop does, free-tier limits (requests per minute/day are model-dependent; link to Google's
rate-limit page), recommended workflow: generate → `npm run content:check` → language review → add to `moduleOrder` →
`npm run content:build` → commit/push; and the manual alternative via the prompt pack; and how to import a built course
JSON on the phone (pointer to `docs/courses.md`).

## 5. Tests and gates

Unit tests with mocked `fetch`: prompt assembly contains rules + brief + id range; chunk merge; repair loop triggers on
problems and stops after 2 rounds; 429 backoff; module file both shapes parse; `content-check` passes with the new module
files present but unlisted. Do not call the real API (no key available) — state clearly what is unverified.
`npm run lint`, `npm run test`, `npm run build`, `npm run content:check` green. Commit e.g. "Stage 4b: module briefs,
RULES.md, en-b2 skeleton", "Stage 4b: Gemini content generator".
