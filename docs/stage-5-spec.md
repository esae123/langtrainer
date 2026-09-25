# LangTrainer — Stage 5 spec: minimal statistics + session mix setting

Read first: `docs/engine.md`, `src/engine/plan.ts`, `src/engine/progress.ts`, `src/db/db.ts`, `src/settings/*`,
`src/routes/ProgressScreen.tsx`, `src/routes/SettingsScreen.tsx`, `src/session/SummaryPanel.tsx`,
`src/content/programRegistry.ts`, `src/components/*`, `src/index.css` (warm theme tokens).

Language: UI strings in **English only**. Add every new key to `en.json`; put the same English text into `ru.json`
(key sets must stay identical). No translation work.

## Part A — Progress screen (minimal statistics, no charts)

All numbers are for the **active course** only and count **regular** sessions/attempts only (exclude
`sessions.kind === 'practice'` and `attempts.practice === true`), unless stated otherwise.

Pure functions in `src/engine/stats.ts` (no React/Dexie; pass rows and `now`), unit-tested:

- `streaks(sessionRows, now, timeZoneOffsetMinutes?)` → `{ current, best }`: consecutive **local calendar days** with ≥ 1
  regular session that has ≥ 1 answered item. `current` counts back from today, or from yesterday if nothing today yet.
- `overview(sessions, attempts)` → `{ sessions, answered, correct, accuracy }` (accuracy = correct/answered, 0 when none).
- `topicStats(program, topicProgressRows, attempts)` → per topic: `{ topicId, status, seen (distinct), total (exercise
  count), accuracy (null if < 1 attempt), attempts, lastPractisedAt?, nextReviewAt? }`, in program order, grouped by module.
- `needsWork(topicStats)` → up to 3 topics with ≥ 5 attempts and the lowest accuracy below 80%.
- `upcomingReviews(topicProgressRows, now)` → next 5 by `nextReviewAt` (include overdue first, flagged).
- `recentSessions(sessions, n=10)` → newest first, including practice sessions (tagged), with `{ startedAt, completed,
  correct, planned, kind, interrupted }`.

Screen layout (`/progress`, mobile-first, warm theme, Lucide icons):
1. **Summary tiles** (2×2 grid): Current streak (days, with "best: N"), Sessions, Answered, Accuracy %.
2. **Needs work** card (hidden if empty): topic title, accuracy %, button "Practise" → starts a regular session? No —
   keep it simple: tapping opens the topic in the Library.
3. **Upcoming reviews**: date (or "Overdue") + topic title; empty state "No reviews scheduled yet".
4. **Topics**: grouped by module; each row: title, status badge (New / Learning / Review / Mastered / Maintenance, colour
   by token), progress bar `seen/total`, accuracy %, "last: {date}". Tap → Library detail.
5. **Recent sessions**: date + time, score `correct/completed`, `Practice` / `Interrupted` tags.
Empty state for a fresh course: friendly text + "Start a session" button.

Session summary (`SummaryPanel`, regular sessions only): add a one-line message in three grades by percentage:
≥ 90% "Excellent — keep this pace.", 70–89% "Good work. A little review will lock it in.", < 70% "Worth another go —
try Retry mistakes." (i18n keys).

## Part B — Session mix setting (new / review / phrases)

- New setting `sessionMix: { preset: 'balanced' | 'more-new' | 'more-review' | 'custom'; shares: { new: number;
  review: number; phrases: number } }`, default `{ preset: 'balanced', shares: { new: 50, review: 33, phrases: 17 } }`.
  Shares are integers summing to 100 (reuse/extend the `normalizeInputShares` approach for three sliders).
  Presets: `more-new` 70/20/10, `more-review` 30/55/15.
- Engine (`plan.ts`): `blockCountsFor(length, mix)`:
  - `balanced` → **exactly the current `BLOCK_COMPOSITION` table and `OPEN_CYCLE`** (no behaviour change by default).
  - other presets / custom → largest-remainder rounding of `length × share / 100` so counts sum to `length`; a block with
    share 0 gets 0 items; for `open` compute a cycle of 6 the same way. Existing fallbacks (review → current topic when
    nothing is due; new → review when the course is finished) stay as they are.
  - Unit tests: balanced equals the old table for 5/10/15/20/30/open; presets for each length sum correctly; zero shares.
- Settings UI: new group "Session mix" under the Session group: preset chips with one-line descriptions and, for
  `custom`, three sliders (New topic / Review / Everyday phrases) that keep the sum at 100.
- Settings migration: missing `sessionMix` in stored settings → default (no Dexie version bump needed if settings are a
  JSON blob; otherwise bump and backfill). Backup round-trip keeps it.

## Gates

`npm run lint`, `npm run test`, `npm run build`, `npm run content:check` green. Update `docs/engine.md` (session mix,
stats definitions). Commits: "Stage 5: statistics", "Stage 5: session mix setting". End each commit message with:
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
