# LangTrainer — Stage 6 spec: review scheduling fix, Progress cleanup, focus sessions

Read first: `docs/engine.md`, `src/engine/plan.ts`, `src/engine/progress.ts`, `src/engine/stats.ts`,
`src/session/*` (state machine, runner, SummaryPanel), `src/routes/ProgressScreen.tsx`,
`src/routes/LibraryDetailScreen.tsx`, `src/routes/LearnScreen.tsx`, `src/settings/settings.ts`, `src/db/db.ts`.
UI strings English only (put the same English text into ru.json for new keys). Warm theme tokens, Lucide icons,
44px targets, no horizontal overflow at 360px.

## 1. Bug: reviews never advance ("Overdue" forever) — highest priority

Cause: the review block is spread over up to 2 due topics (`MAX_REVIEW_TOPICS = 2`), but `finishSession` applies an
SRS transition only when a topic received ≥ `MIN_REVIEW_ATTEMPTS` (3) review-block attempts. With session length 10
(review block 3) and two due topics the split is 2 + 1, so neither topic ever advances; with length 5 (review block 1)
no review can ever count. The owner studies daily and sees topics stuck as overdue.

Fix in `plan.ts` (pure, tested):
- When at least one topic is due (status review/maintenance, `nextReviewAt ≤ now`) and the review target for the
  session/cycle is > 0, the review block takes items from **one** due topic (earliest due) and has **at least
  `MIN_REVIEW_ATTEMPTS` items** from it. If the computed review target is smaller, take the missing slots from the new
  block first, then from phrases (total length unchanged). A second due topic is added only when the review target is
  ≥ 2 × MIN_REVIEW_ATTEMPTS, and then each review topic gets ≥ MIN_REVIEW_ATTEMPTS items.
- Open-ended sessions: keep reviewing the same due topic across cycles until it has ≥ MIN_REVIEW_ATTEMPTS items in this
  session, then move to the next due topic.
- If the user's session mix sets the review share to 0, respect it (no forced review).
- Fallbacks when nothing is due stay unchanged.
Tests: lengths 5 / 10 / 15 / 20 / 30 / open with 0, 1, 2, 3 due topics: every review topic in the plan has ≥ 3 items,
total length unchanged; after `finishSession` with all review answers correct the topic advances a stage; a topic that
was stuck overdue advances after one regular session. Update `docs/engine.md`.

## 2. Progress: remove "Upcoming reviews"

Remove the Upcoming reviews card from `/progress` (owner decision). Remove now-unused i18n keys and the
`upcomingReviews` function only if nothing else uses it (the Learn screen "Next review" line may; keep what is used).

## 3. Progress: topics collapsible by module

The Topics section groups topics under module headers. Each module header is a button (`aria-expanded`) showing the
module title, "{completed} / {total} topics" and a chevron; tapping toggles its topic rows. Default: only the module that
contains the current topic is expanded (or the first module for a fresh course). Remember expanded modules per course in
`localStorage` (`langtrainer:progress:expanded:<programId>`). Phrase sets are not listed (unchanged).

## 4. Focus session: practise a chosen topic

Entry points:
- Library topic / phrase-set detail screen: primary button **Practise this topic** (Lucide `Target` or `Dumbbell`).
- Progress → **Needs work** card: each row gets a **Practise** button (tapping the row still opens the Library detail).

Behaviour:
- New engine function `planFocus(input, topicId)`: all items come from that topic or phrase set; order: unseen first,
  then exercises in `wrongExerciseIds`, then the rest (least recently seen if available, else random); never repeat an
  exercise inside a session; length = the user's `sessionLength` (open → cycles of 6 from the same topic until the pool
  is exhausted, then the session ends). Input modes as usual. A context screen is shown first (for phrase sets: skip).
- `SessionPlan.kind = 'focus'` with `focusTopicId`; `SessionRow.kind` gains `'focus'` (optional field, no Dexie bump if
  not indexed). Resume works for focus sessions like regular ones.
- Recording: attempts are normal (not practice): `applyAttempt` updates seen / wrong ids / learning status and the
  20-distinct first completion. **No SRS transition**: `finishSession` must not change `reviewStage`, `nextReviewAt`,
  `failedReviewsInARow` or mastered/maintenance status for focus sessions (first completion via applyAttempt still
  happens). Attempts get block `'focus'` (extend the block union) so stats can tell them apart.
- Stats: focus sessions count like regular sessions for streak, sessions, answered and accuracy.
- Summary: same score and Retry mistakes / Repeat session buttons; replace "Another session" with **Practise again**
  (a new focus plan for the same topic); "Done" unchanged.
- If an unfinished session exists when a focus session is requested, show a confirm sheet: "You have an unfinished
  session. Discard it and practise «{topic}»?" (Discard and start / Cancel).
- Route: `/session?focus=<topicId>` (HashRouter query string) or router state — pick one, document it.
Tests: planFocus ordering and length, open-mode exhaustion, phrase sets, no SRS change after a focus session on a topic
in review stage 2 (stage and nextReviewAt unchanged), first completion still triggered, buttons start a focus session,
confirm sheet when a saved session exists, stats include focus sessions.

## Gates and commits

`npm run lint`, `npm run test`, `npm run build`, `npm run content:check` green. Commits, e.g.
"Fix review scheduling: one due topic gets at least 3 review items", "Progress: drop upcoming reviews, collapsible
modules", "Focus sessions: practise a chosen topic". End each commit message with:
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
