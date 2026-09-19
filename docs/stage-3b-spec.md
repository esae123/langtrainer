# LangTrainer — Stage 3b spec: product-owner feedback after first sessions

Changes requested after testing Stage 3 on a phone. Read `docs/stage-3-spec.md`, `docs/engine.md`, `src/engine/*`,
`src/session/*`, `src/exercises/*`, `src/index.css`, `src/components/*` first.

## 1. Match pairs: free pairing, check at the end

Current behaviour (reject): wrong pairs refuse to connect, every mis-tap counts as an error.
New behaviour:
- Tap left item then right item (or right then left) → they connect, whatever the pair is. Connected pairs are shown
  linked (same colour badge/number on both sides) and removed from the "unpaired" pool.
- Tapping a connected item disconnects that pair (both items return to the pool).
- **Check** button is enabled when every item is paired. Only then are pairs graded: correct pairs green, wrong pairs
  red with the correct partner shown in the feedback sheet.
- `checkAnswer` for `match_pairs`: response = list of chosen pairs; `correct` iff all pairs are right. Remove the
  `wrongPairings` concept (or keep it at 0) — mis-taps are no longer errors. Update `docs/engine.md`.

## 2. Accent bar: fits the screen, labelled

- Keep the accent bar in typing mode. It must fit the viewport width **without horizontal scrolling** on a 360px screen:
  12 keys → two rows of 6, or one row with keys ≥ 40px wide and small font. Choose the two-row layout on narrow screens
  (CSS grid `repeat(6, 1fr)`), one row on ≥ 480px.
- Add a small muted caption above it: "Accents — tap to insert" (i18n en/ru: «Диакритика — нажмите, чтобы вставить»).
- Visually subdued (muted background, smaller text than answer field) so it reads as a helper, not as part of the task.

## 3. Hint "first letter + length" for typed answers

- New setting `typingHint: boolean` (default **true**) in `Settings` with a row under Input: "Show first letter and
  length when typing" / «Подсказка при вводе: первая буква и длина».
- When on, in **typing mode** for single-word or short expected answers (≤ 2 words), show a hint line under the prompt:
  `s _ _ _ _  (5 letters)` per word (first letter of each word + underscores + total letters in parentheses). Hyphens and
  apostrophes shown as themselves. Applies to fill_gaps (per active gap), translate_word, number_sequence, find_error
  correction in typing, and build_phrase / question_for_answer only when the answer is ≤ 2 words (rare).
- When the hint is shown, do not also reveal the answer anywhere else.

## 4. Summary screen: retry buttons; practice sessions

- Add two buttons to `SummaryPanel`: **Retry mistakes** (visible only if ≥ 1 wrong answer) and **Repeat session**.
  Keep "Done" and "Another session".
- Both start a **practice session**: a `SessionPlan` built from the same exercises (wrong ones only, or all), same modes,
  `kind: 'practice'`, no context screens, block label "Practice". Practice sessions:
  - write `attempts` rows with a new optional `practice: true` flag;
  - write a `sessions` row with `kind: 'practice'` (add optional `kind?: 'regular'|'practice'` to `SessionRow`);
  - **do not** call `applyAttempt` completion logic or `finishSession` SRS transitions — they must not change topic
    status, `reviewStage`, `nextReviewAt`, `failedReviewsInARow`, or `history`. They may update nothing in
    `topicProgress` at all.
  - the practice summary shows the score and, for retried mistakes, "Fixed: n of m", and offers "Done" / "Retry again"
    (only wrong ones again) — no further nesting beyond that (Retry again is allowed repeatedly, but it always starts from
    the current wrong set).
- Dexie: bump to version 3 if a schema index is needed; otherwise optional fields need no migration (state it in the report).

## 5. Engine: prioritise exercises answered wrong

- `plan.ts` exercise selection within a topic currently: unseen first, then random. New order:
  1. unseen;
  2. seen with **last regular attempt wrong** (needs data: add `wrongExerciseIds: string[]` to `TopicProgress`, updated by
     `applyAttempt`: add on wrong, remove on correct — regular sessions only; practice sessions **also remove** on correct,
     so fixing a mistake in practice lowers its priority, as the product owner asked);
  3. the rest, random.
  Dexie upgrade: add `wrongExerciseIds: []` to existing rows (version 3).
- Unit tests for the new ordering and for practice-session non-effects.

## 6. Warm theme (whole app) + modern outline icons

Replace the current cool palette with a warm "paper" palette via CSS variables in `src/index.css` (Tailwind v4 `@theme`):

| token | light | dark |
|---|---|---|
| `--color-paper` (app background) | `#F4F1EA` | `#1B1917` |
| `--color-sheet` (cards) | `#FCFBF7` | `#25221F` |
| `--color-text` | `#2A2622` | `#EDE8DF` |
| `--color-muted` | `#6F6760` | `#A69E94` |
| `--color-line` | `#DED8CC` | `#3A352F` |
| `--color-accent` (primary buttons, active tab, progress) | `#D9552B` (terracotta) | `#E8724B` |
| `--color-accent-ink` (text on accent) | `#FFFFFF` | `#1B1917` |
| `--color-ok` / `--color-ok-bg` | `#2F6B3F` / `#DFEEE2` | `#7CC98F` / `#1F3326` |
| `--color-bad` / `--color-bad-bg` | `#B3261E` / `#F6E1DF` | `#EF7A70` / `#3A2322` |
| `--color-highlight` (soft yellow marker for the bold word, active gap) | `#F2C230` | `#F2C230` |

- Replace all hardcoded `slate-*`, `indigo-*`, `blue-*` etc. utilities with the tokens (search the whole `src/`). No cool
  greys or blues may remain. Buttons, tabs, sheets, toasts, progress bars, tiles, letter keys, option buttons all use the
  tokens. Selected tile/option: accent border + faint accent background. Correct/incorrect states: ok/bad tokens.
- Update `theme_color` / `background_color` in the PWA manifest and the inline anti-flash script colours; regenerate icons
  (`scripts/generate-icons.mjs`) with the terracotta accent on paper background (keep the current glyph).
- Icons: add `lucide-react`; replace emoji/inline SVG icons in tab bar, settings rows, buttons, feedback (check / x),
  summary with Lucide outline icons, stroke 2, sized 20–24px, coloured with `currentColor`. Keep bundle impact small
  (import icons individually).
- Do not change fonts.

## 7. Tests, docs, gates

- Update/extend tests: match_pairs check + view (free pairing, disconnect, check enabled only when complete);
  accent bar layout snapshot not needed, but caption present; typing hint text generation (pure function) with cases;
  practice session flow (retry mistakes → only wrong exercises, no topicProgress mutation, sessions row kind);
  plan ordering with `wrongExerciseIds`; Dexie v2→v3 upgrade backfills.
- `docs/engine.md`: update match_pairs rule, selection order, practice sessions.
- `npm run lint`, `npm run test`, `npm run build` green. Commit in logical steps (theme separately from logic), e.g.
  "Stage 3b: free pairing, accent bar, typing hint", "Stage 3b: practice sessions and wrong-first selection",
  "Stage 3b: warm theme and Lucide icons".
