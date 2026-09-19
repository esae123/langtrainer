# LangTrainer — Stage 3 spec: the session (engine, exercise UIs, feedback, summary)

Builds on Stage 1 (`docs/stage-1-spec.md`: types, Dexie schema, settings) and Stage 2 (`docs/content-authoring.md`,
program loaded via `src/content/programs`). Read `src/content/types.ts`, `src/db/db.ts`, `src/settings/settings.ts`,
`src/routes/LearnScreen.tsx`, `src/lib/renderExercise.ts` before starting.

Goal: a learner opens the app, taps **Start session**, and completes a real session of exercises with three input modes,
feedback after every exercise, the option to stop at any moment, and a summary. Progress is recorded so Stage 4 can
show statistics and SRS can schedule reviews.

## 1. Architecture

- `src/engine/` — **pure TypeScript, no React, no Dexie**: planning, selection, answer checking, SRS transitions.
  Every function deterministic given inputs (pass `now` and an `rng` where needed). Heavily unit-tested.
- `src/session/` — React: session state machine (`useReducer`), persistence of in-progress session, screens.
- `src/exercises/` — one renderer component per exercise type; each supports the input modes allowed for that type.
  Shared input widgets: `TileBank`, `LetterBoard`, `TypingInput` (with accent bar), `OptionList`.
- Routes: `/session` (full-screen flow, no bottom tab bar), summary inside the same route.

## 2. Session planning (`src/engine/plan.ts`)

Inputs: program, all `topicProgress` rows, settings (`sessionLength`, `inputShares`), attempts history summary
(seen exercise ids per topic are already in `topicProgress.seenExerciseIds`), `now`, `rng`.

Block composition for length L (numbers below are targets, computed with rounding so they sum to L):

| length | new | review | phrases |
|---|---|---|---|
| 5 | 3 | 1 | 1 |
| 10 | 5 | 3 | 2 |
| 15 | 8 | 5 | 2 |
| 20 | 10 | 7 | 3 |
| 30 | 15 | 10 | 5 |
| open | cycles of 6: 3 new, 2 review, 1 phrase, until the learner stops |

Order within a session: new block first (preceded by a **context screen**), then review block, then phrases.
For `open` the same order repeats per cycle; the context screen is shown only the first time a topic appears.

**Current topic** = first topic in program order (moduleOrder → topicOrder) whose status is `new` or `learning`.
If none (all completed), the new block is replaced by review exercises.

**Topic completion rule**: a topic becomes `review` (first completion) when the learner has answered **≥ 20 distinct
exercises** of that topic in total. At that moment set `firstCompletedAt = now`, `reviewStage = 1`,
`nextReviewAt = now + 7 days`. Status `learning` from the first attempt until then.

**Review block**: pick topics with `status in (review, maintenance)` and `nextReviewAt ≤ now`, earliest first; take
exercises from them (spread across up to 2 topics if several are due). If none due → a random completed topic (status
review/mastered/maintenance), if none completed → fill with more current-topic exercises.

**Phrases block**: exercises from phrase sets in `phraseSetOrder`, unseen first.

**Exercise selection within a topic**: unseen first (not in `seenExerciseIds`), then least recently seen (use attempts
if available, else random). Within the new block sort by difficulty ascending. Never repeat an exercise inside one session.

**Input mode per exercise**: weighted random by `inputShares` restricted to `exercise.allowedModes`; if the drawn mode is
not allowed, take the allowed mode with the highest share. Types that are tiles-only just get tiles.

Output: `SessionPlan { id, programId, plannedLength, items: PlannedItem[] }` where
`PlannedItem { exercise, mode, block: 'new'|'review'|'phrases', topicId, showContextBefore?: boolean }`. For `open`,
expose `planNextCycle(state)` to append items.

## 3. Answer checking (`src/engine/check.ts`)

`checkAnswer(exercise, mode, response): CheckResult { correct: boolean; diacriticsOk: boolean | null; expected: string; matchedAccepted?: string }`

Normalisation (`normalize(s)`): trim, collapse whitespace, lowercase, remove terminal `.`, `!`, `?` and surrounding
quotes/guillemets; keep internal punctuation and hyphens. `stripDiacritics(s)` removes accents/cedilla/tilde
(NFD + remove combining marks; `ç`→`c`).

Rules per mode:
- **tiles**: response = ordered tokens joined by space; correct if `normalize(joined) === normalize(expected)` or equals any
  `acceptedAnswers` (normalised). Diacritics are always ok in tiles (learner did not type) → `diacriticsOk: null`.
- **letters**: response = composed string(s). Correct if normalised equality; if not, compare with diacritics stripped on
  both sides → if equal, `correct: true, diacriticsOk: false`. No typo tolerance.
- **typing**: as letters, plus **one typo tolerance**: if the stripped strings have Levenshtein distance ≤ 1 and the expected
  string is ≥ 5 chars → correct (with `diacriticsOk` computed on the un-stripped comparison). Apply to each of
  `expected` and `acceptedAnswers`.

Per type expectations:
- `build_phrase`, `question_for_answer`: expected = `answer.join(' ')`; accepted = `acceptedAnswers`.
- `fill_gaps`: response is an array per gap; each gap checked independently against `gaps[i].answer` and `gaps[i].accepted`;
  exercise correct iff all gaps correct; `diacriticsOk` false if any gap was only correct after stripping.
- `translate_word`: expected = `answer`.
- `number_sequence`: expected = `answerWords[0]`, accepted = rest of `answerWords`.
- `find_error`: response `{ index, replacement }`; correct iff `index === wrongIndex` and replacement matches `correction`
  (letters/typing rules for replacement text; tiles = exact option).
- `match_pairs`: response = list of chosen pairs and count of wrong pairings; correct iff every pair right **and**
  `wrongPairings === 0`.
- `order_dialogue`: response = ordered indices; correct iff identical to natural order.
- `about_me`: no automatic grading in Stage 3. After submission show `sampleAnswer` and hints and ask the learner to
  self-grade: "Did you get it right?" → Yes / Mostly / No. Record `correct = (Yes || Mostly)`, `diacriticsOk: null`,
  and a `selfGraded: true` flag on the attempt (add optional field to `AttemptRow`). Stage 5 replaces this with Gemini judging when online.

## 4. Applying results (`src/engine/progress.ts`)

`applyAttempt(topicProgress, exerciseId, correct, now)` → updated row: add to `seenExerciseIds` (set semantics), status
`new → learning`, apply the completion rule (§2). `history` is per session, so append at session end:
`finishSession(rows, sessionAttempts, now)` computes, per topic touched in the session, `{ at, correct, total }` and
applies **SRS transitions** for topics reviewed in the review block with ≥ 3 attempts in this session:

| current | result | next |
|---|---|---|
| review, stage 1 | 100% | stage 2, `nextReviewAt = now + 30d` |
| review, stage 2 | 100% | stage 3, `nextReviewAt = now + 60d` |
| review, stage 3 | 100% | status `mastered`, `nextReviewAt = undefined` |
| review, any stage | < 100% | same stage, `nextReviewAt = now + 7d`; if this is the 3rd failed review in a row at stage 3 → status `maintenance`, `nextReviewAt = now + 60d` |
| maintenance | 100% | `mastered` |
| maintenance | < 100% | `nextReviewAt = now + 60d` |

Add `failedReviewsInARow: number` to `TopicProgressRow` (Dexie version 2 migration, default 0). `lastReviewedAt = now`
whenever a topic was in the review block.

## 5. Session state machine (`src/session/`)

State: `{ plan, index, phase: 'context'|'exercise'|'feedback'|'summary', responses: AttemptDraft[], startedAt, interrupted }`.
Actions: start, showExercise, submit(response) → compute check → feedback, next, stop (confirm → summary), finish.

**Persistence**: on every transition save the whole state to Dexie `settings` table under key `activeSession` (or a new
kv table). On app launch, if `activeSession` exists and is < 24h old, the Learn screen shows a **Resume session** card
(with "Discard"). Clear it at summary.

**Recording**: on each feedback, write an `attempts` row and update `topicProgress` (`applyAttempt`). On summary, write
the `sessions` row and run `finishSession`. Interrupting keeps everything recorded so far; unanswered items are simply
not recorded.

## 6. Screens (mobile-first, same visual language as Stage 1)

- **Learn (update)**: card "Current topic: {title} — {seen}/20" with module name; "Next review: {date or none}";
  "Resume session" card when applicable; Start button opens `/session`.
- **Context screen** (before a new-topic block): topic title, module, rendered `context` markdown (reuse `markdownLite`),
  collapsible "Key words & phrases" list (target / support / note), button "Start exercises". Block header for review
  ("Review · {topic}") and phrases ("Everyday phrases") is a slim banner on the first exercise of the block, not a full screen.
- **Exercise screen**: top bar with progress `{index+1}/{L}` (or count for open), small block label, **Stop** (×) button
  → confirm sheet "Stop and save progress so far?" Body: prompt, exercise-specific area, input area, primary button
  "Check" (disabled until a response exists). No timer.
- **Feedback panel** (bottom sheet sliding over the exercise, not a new route): ✅ "Correct" / ❌ "Not quite" / ✅ with a
  soft note "Correct — mind the accents: **{expected}**" when `diacriticsOk === false`; shows the correct answer
  (formatted per type), `explanation`, and for wrong answers the learner's answer struck through. Button "Continue".
  For `about_me`: sample answer + self-grade buttons.
- **Summary screen**: big percentage, correct/total, breakdown per block (new / review / phrases), list of topics touched
  with status change ("Regular -ar verbs → ready for review in 7 days", "Greetings → mastered!"), "Interrupted" tag if
  applicable, buttons "Done" (→ Learn) and "Another session".

## 7. Input widgets and per-type UIs (`src/exercises/`)

- **TileBank**: shuffled tiles (answer tokens + distractors; shuffle with `rng`), tap to append to the answer line, tap a
  placed tile to remove it (returns to bank), tiles ≥ 44px tall, wrap in rows; answer line shows slots. For `fill_gaps`
  tiles fill the next empty gap; tap a filled gap to clear it.
- **LetterBoard**: the target word(s) shown as empty boxes per character (spaces/hyphens pre-filled, apostrophes too).
  Letter keys = unique letters of the answer + 3–4 distractor letters chosen from: accented/unaccented twins of letters in
  the answer (`a↔á↔ã↔à↔â`, `e↔é↔ê`, `o↔ó↔õ↔ô`, `i↔í`, `u↔ú`, `c↔ç`) first, then common letters. Keys **never disappear**
  when used. Backspace key. Case-insensitive; boxes display lowercase; comparing ignores case. For multi-word answers, one
  row of boxes per word.
- **TypingInput**: single-line input (multi-line for build_phrase/about_me), `autocapitalize=off`, `autocorrect=off`,
  `lang="pt-PT"`, above it an **accent bar** of buttons: `á à â ã é ê í ó ô õ ú ç` inserting at the caret. Enter submits.
- **OptionList** (translate_word tiles, number_sequence tiles, find_error replacement): 2×2 or vertical list of 44px buttons,
  single select, selected state visible.
- `build_phrase` / `question_for_answer`: prompt (+ `givenAnswer` in a quote bubble for question_for_answer); tiles / letters
  (only when allowed) / typing.
- `fill_gaps`: template rendered with gap chips inline; tiles from `wordBank` / letters per gap (tap a gap to make it active)
  / typing per gap (inline small inputs with accent bar for the active one).
- `about_me`: question bubble; tiles = shuffled `sampleAnswer` tokens + `hints` (learner composes any answer, may leave
  tiles unused) / typing; then self-grade.
- `find_error`: sentence as tappable tokens; tapping marks a token; then `OptionList` of `options` (tiles) or LetterBoard
  for `correction` (letters). Check enabled when both chosen.
- `number_sequence`: sequence shown as chips (`1 · 3 · ? · 7`); tiles = `options` / letters / typing.
- `match_pairs`: two shuffled columns; tap left then right to connect; correct pairs lock (subtle highlight), wrong
  pairs shake and count as `wrongPairings`; exercise auto-completes when all matched (Check button becomes Continue).
- `order_dialogue`: shuffled lines as cards with speaker badge A/B; tap to place in order into numbered slots; tap a placed
  line to send it back.
- `translate_word`: sentence with the bold word highlighted; options / letters / typing.

Accessibility: every interactive element has a text label; focus visible; `aria-live` region announces feedback.
Haptics: `navigator.vibrate?.(10)` on tap where available (guarded).

## 8. Tests

- `engine/plan`: block sizes for each length; open-cycle; current-topic selection; review-due selection and fallbacks;
  unseen-first ordering; mode weighting respects `allowedModes`; no duplicate exercises per session.
- `engine/check`: every rule in §3 including diacritics, typo tolerance thresholds, accepted answers, per-type responses.
- `engine/progress`: completion at 20 distinct, every SRS transition row, failedReviewsInARow, no change on < 3 attempts.
- Session reducer: start → exercise → feedback → next → summary; stop mid-way records only answered items; resume from
  persisted state.
- Component tests (Testing Library): TileBank add/remove; LetterBoard keys persist after use and backspace works;
  TypingInput accent bar inserts at caret; one full happy-path render of `/session` with a fixture program (2–3 exercises)
  through to the summary.

## 9. Deliverables

- `npm run lint`, `npm run test`, `npm run build` pass. Dexie migration to version 2 is safe for existing data.
- i18n: all new strings in en + ru.
- Update README "How a session works" (short) and add `docs/engine.md` (one page: planning rules, checking rules, SRS table).
- Commits: at least two, e.g. "Stage 3: session engine (plan, check, progress)" and "Stage 3: session UI (exercises, feedback, summary)".
