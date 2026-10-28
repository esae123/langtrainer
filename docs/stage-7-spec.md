# LangTrainer — Stage 7 spec: AI check of typed answers (OpenAI)

Owner decisions (2026-10-26/28): provider OpenAI, mini-class model; the AI is called **only when the local check did not
accept a typed answer**, **only if the AI check is switched on in Settings and an API key is set**; verdict
correct / almost / incorrect; **"almost" counts as correct**. Works for every course (pt-PT-A1, en-phrasal_verbs,
imported courses). Without the switch or key the app behaves exactly as today.

Read first: docs/engine.md, src/engine/check.ts, src/session/* (FeedbackSheet, ExercisePanel, sessionState,
useSessionRunner), src/exercises/AboutMeView.tsx, src/settings/*, src/routes/SettingsScreen.tsx, src/backup/backup.ts,
src/db/db.ts, src/content/types.ts, scripts/content-generate.ts (callOpenAI there is a reference for request shape and
error handling — do not import scripts into the app). UI strings English only (same English into ru.json).

## 1. Settings

- Rename the AI group: remove every mention of Gemini in the UI. New settings fields (keep old `geminiApiKey` in the
  stored blob untouched and unused; do not show it):
  - `aiCheckEnabled: boolean` — default **false**. Toggle "Check typed answers with AI". When off, no request is ever made,
    even if a key is present.
  - `openaiApiKey: string` — masked input with show/hide, "Stored only on this device. Typed answers you submit are sent
    to OpenAI for checking."
  - `openaiModel: string` — default `gpt-5.4-mini`, free text with a hint "a mini-class model is enough".
  - Button **Test connection**: one tiny request; shows "Connected" or the error message (invalid key, no credit, network).
  - Usage line: "AI checks this month: N · ~T tokens" (store counters per calendar month in settings/kv; reset when the
    month changes).
- Backup: never export `openaiApiKey` (strip it like the old Gemini key); import keeps the current device's key and
  switch. Existing settings migrate with defaults.

## 2. When the AI is called

All of these must hold:
1. `aiCheckEnabled` is true and `openaiApiKey` is non-empty;
2. the answer was given in **typing** mode (not tiles or letters);
3. the exercise type is open: `build_phrase`, `question_for_answer`, `about_me`;
4. the local `checkAnswer` returned **not correct** (for `about_me`, which has no local check, always);
5. the device is online (`navigator.onLine`), and the AI is not suspended (see §4).
Otherwise: today's behaviour (local verdict; about_me self-grade).

## 3. Request and verdict

- `POST https://api.openai.com/v1/chat/completions` with `Authorization: Bearer <key>`, `response_format: {type:
  "json_object"}`, `max_completion_tokens: 2000` (reasoning tokens count toward it), `reasoning_effort: "low"`, no temperature. Timeout 15 s (AbortController).
- System prompt (constant in code, unit-tested for content): a fair language teacher grading ONE learner answer for a
  course in `<targetLanguage>` (for pt-PT: European Portuguese only — Brazilian forms are wrong). Return JSON
  `{"verdict":"correct"|"almost"|"incorrect","correction":"<best corrected version of the learner's sentence>","explanation":"<one short sentence in English>"}`.
  Grading rules:
  - **correct**: grammatical, natural, expresses what the prompt asks; uses the target word/phrase/structure of the
    exercise when there is one (e.g. the phrasal verb, the verb form being drilled); details not fixed by the prompt
    (names, who, when) may differ from the model answer; ignore capitalisation, punctuation and missing accents.
  - **almost**: the target is used correctly and the meaning fits, but there is one small slip (a minor spelling mistake,
    a missing article, a small agreement error).
  - **incorrect**: the target word/phrase/structure is missing or used wrongly, a clear grammar error, wrong meaning,
    wrong register when the prompt fixes it, or a different language/variety.
- User message: JSON with `exercise.prompt`, `exercise.type`, the model answer and acceptedAnswers (or for about_me the
  question, sampleAnswer, hints), the topic title and tags, and `learnerAnswer`.
- Parse defensively: unknown/invalid JSON or verdict → treat as unavailable (§4 fallback), never as a verdict.

## 4. Errors, quota, fallback

- 401 / invalid key → suspend AI until the key or model changes; show once "AI check: the API key is not valid".
- 429 with `insufficient_quota` (or billing errors) → suspend until the next app start or until settings change; show
  "AI check: no OpenAI credit left — checking without AI".
- 429 rate limit / 500 / 502 / 503 / 504 / timeout / network error → no retry loop: one retry after 2 s at most, then
  fallback for this answer only.
- **Fallback when the AI was supposed to run but could not** (offline, suspended, error, bad response): show the model
  answer and the self-grade buttons "Did you get it right? Yes / Mostly / No" (the about_me pattern); Yes/Mostly count as
  correct. When the AI is off or no key: unchanged local behaviour.
- Never block the session: while waiting, the feedback sheet shows "Checking your answer…" with a spinner and a
  "Skip — grade myself" link that switches to the self-grade fallback.

## 5. Recording and engine

- The final verdict feeds the normal flow (applyAttempt, history, strict completion, SRS): AI correct/almost → correct.
- Attempt rows get optional fields `gradedBy: 'local' | 'ai' | 'self'` and `aiVerdict?: 'correct'|'almost'|'incorrect'`
  (no index, no Dexie bump needed; backup round-trips them).
- Practice sessions use the AI the same way (still practice: no SRS).

## 6. Feedback UI

- After the AI verdict: ✅ **Correct** (label "Checked by AI"), ✅ **Almost right** with the correction highlighted, or
  ❌ **Not quite** with the correction; one-line explanation; the model answer below as today. The learner's own answer
  stays visible.
- Accessible (`aria-live`), 44px targets, warm theme tokens, works at 360px.

## 7. Code structure and tests

- `src/ai/openaiCheck.ts` (pure request builder + response parser + error classifier; the fetch wrapper injected),
  `src/ai/aiState.ts` (suspension state, monthly usage counters), hook `useAiCheck` used by the session runner/feedback.
- Tests with mocked fetch: gating (each of the conditions in §2), request shape (URL, bearer, json_object, model,
  max_completion_tokens, reasoning_effort, no temperature), parsing (valid, invalid JSON, unknown verdict), almost →
  correct in applyAttempt flow, 401 suspends, insufficient_quota suspends, 503 single retry then fallback, timeout →
  fallback, skip link, backup never contains the key, usage counter increments and resets by month, about_me uses AI
  when enabled, toggle off → zero fetch calls even with a key.
- docs/engine.md: "AI check" section. README: how to enable it (key from platform.openai.com, cost note: a check is a
  few hundred tokens).

Gates: `npm run lint`, `npm run test`, `npm run build`, `node scripts/content-check.ts` green. Commits e.g.
"AI check: settings and OpenAI client", "AI check: session integration and feedback". End each commit message with:
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
