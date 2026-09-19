# The session engine

`src/engine/` is pure TypeScript: no React, no Dexie, no clock. Every function is
deterministic given its inputs — `now` and an `rng` (`Rng = () => number`, seeded with
`mulberry32`) are always passed in. React state lives in `src/session/`, Dexie access in
`src/db/`.

| file          | responsibility                                                        |
| ------------- | --------------------------------------------------------------------- |
| `plan.ts`     | what to practise: blocks, topic and exercise selection, input modes   |
| `check.ts`    | is the answer right, per exercise type and input mode                 |
| `progress.ts` | topic progress, topic completion, spaced repetition                   |
| `text.ts`     | normalisation, diacritics stripping, Levenshtein distance             |
| `hint.ts`     | "first letter + length" hint for typed answers                        |
| `rng.ts`      | seeded PRNG, shuffling, weighted picks, string hashing                |
| `types.ts`    | `TopicProgress` (re-exported by `src/db/db.ts` as `TopicProgressRow`) |

## Planning (`planSession`, `planNextCycle`)

Block composition per session length (each row sums to the length):

| length | new                                    | review | phrases |
| ------ | -------------------------------------- | ------ | ------- |
| 5      | 3                                      | 1      | 1       |
| 10     | 5                                      | 3      | 2       |
| 15     | 8                                      | 5      | 2       |
| 20     | 10                                     | 7      | 3       |
| 30     | 15                                     | 10     | 5       |
| open   | cycles of 6: 3 new, 2 review, 1 phrase |

- Items are ordered **new → review → phrases**. `planNextCycle` appends one more cycle to
  an open-ended plan and never repeats an exercise already in it.
- **Current topic** = the first topic in program order (module order → topic order) whose
  status is `new` or `learning`. If every topic has been completed once, the new block
  becomes extra review.
- **Review block**: topics with status `review`/`maintenance` and `nextReviewAt <= now`,
  earliest first, spread round-robin over at most two topics. If nothing is due, one
  random completed topic; if nothing is completed, more current-topic exercises.
- **Phrases block**: exercises from the phrase sets in program order, unseen first.
- **Exercise selection**: unseen exercises (not in `seenExerciseIds`) before seen ones; the
  new block is sorted by difficulty ascending, elsewhere the order is shuffled (no
  per-exercise timestamps are stored, so "least recently seen" is random). An exercise is
  never repeated inside one session. If a block runs short, the plan tops up from the
  topics it already uses, so `plannedLength` always matches the real item count (`0` marks
  an open session).
- **Input mode**: drawn at random weighted by `settings.inputShares`; if the drawn mode is
  not in `exercise.allowedModes`, the allowed mode with the highest share wins. Tiles-only
  types therefore always get tiles.
- **Context screen**: `showContextBefore` is set on the first new-block item of each topic
  the plan introduces.

## Checking (`checkAnswer`)

`checkAnswer(exercise, mode, response)` returns
`{ correct, diacriticsOk, expected, matchedAccepted? }`. `diacriticsOk` is `null` whenever
the learner did not type characters (tiles, matching, ordering, self-graded answers).

`normalize(s)`: trim, collapse whitespace, lowercase, drop terminal `.`/`!`/`?` and
surrounding quotes/guillemets; internal punctuation and hyphens are kept.
`stripDiacritics(s)`: NFD + drop combining marks (`ç`→`c`, `não`→`nao`).

Per mode (applied to the expected answer and every accepted variant, exact matches first):

- **tiles** — response is the placed tokens joined by spaces; correct on normalised
  equality; `diacriticsOk: null`.
- **letters** — correct on normalised equality (`diacriticsOk: true`) or, failing that, on
  equality after stripping diacritics (`correct: true, diacriticsOk: false`). No typo
  tolerance.
- **typing** — as letters, plus one typo: if the stripped strings are within Levenshtein
  distance 1 and the expected answer is at least 5 characters, the answer counts. In that
  case `diacriticsOk` is `true` only when keeping the accents does not make the answer
  further from the expected string.

Per type:

| type                                  | expected / rule                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `build_phrase`, `question_for_answer` | `answer.join(' ')`, plus `acceptedAnswers`                                                                                       |
| `fill_gaps`                           | each gap checked against `gaps[i].answer` + `accepted`; all gaps must be right; `diacriticsOk` false if any gap needed stripping |
| `translate_word`                      | `answer`                                                                                                                         |
| `number_sequence`                     | `answerWords[0]`, the rest are accepted variants                                                                                 |
| `find_error`                          | `index === wrongIndex` **and** the replacement matches `correction` under the mode's rules                                       |
| `match_pairs`                         | free pairing: the response is the links the learner made, correct iff every item is paired **and** every pair is right          |
| `order_dialogue`                      | the placed order equals the natural order                                                                                        |
| `about_me`                            | not graded automatically: the learner's self-grade (Yes/Mostly = correct) and `selfGraded: true` on the attempt                  |

## Typing hints (`hint.ts`)

With `settings.typingHint` on (the default), typing mode shows a skeleton of the expected
answer under the prompt: the first letter of each word, one `_` per remaining letter, and
the total letter count — `s _ _ _ _  (5 letters)`. Hyphens and apostrophes are printed as
themselves and not counted; trailing punctuation is dropped. Answers longer than two words
get no hint. `hintExpectedFor(exercise, mode)` picks the field to hint per type
(`translate_word.answer`, `number_sequence.answerWords[0]`, `find_error.correction`,
`build_phrase`/`question_for_answer` joined answer); `fill_gaps` hints the active gap from
its own view.

## Progress and spaced repetition

`applyAttempt(row, exerciseId, correct, now)` runs after every answer: it adds the
exercise to `seenExerciseIds` (set semantics) and moves `new → learning`. A topic is
**completed** the moment it has **20 distinct answered exercises** — status `review`,
`reviewStage: 1`, `firstCompletedAt = now`, `nextReviewAt = now + 7 days`.

`finishSession(rows, attempts, now)` runs once at the summary. For every topic touched it
appends a `history` entry `{ at, correct, total }`, and for topics that appeared in the
**review block** it sets `lastReviewedAt = now`. If such a topic had **at least 3 attempts
in the review block** this session, its SRS state moves (100% = every one of those attempts
correct):

| current           | result | next                                                                                                                                |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| review, stage 1   | 100%   | stage 2, `nextReviewAt = now + 30d`                                                                                                 |
| review, stage 2   | 100%   | stage 3, `nextReviewAt = now + 60d`                                                                                                 |
| review, stage 3   | 100%   | `mastered`, no `nextReviewAt`                                                                                                       |
| review, any stage | < 100% | same stage, `nextReviewAt = now + 7d`, `failedReviewsInARow += 1`; at stage 3 the 3rd failure in a row → `maintenance`, `now + 60d` |
| maintenance       | 100%   | `mastered`, no `nextReviewAt`                                                                                                       |
| maintenance       | < 100% | `nextReviewAt = now + 60d`                                                                                                          |

A perfect review resets `failedReviewsInARow` to 0. `finishSession` also returns per-topic
outcomes (before/after snapshots and counts), which the summary screen turns into lines
like "→ ready for review in 30 days".
