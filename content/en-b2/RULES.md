# en-b2 — Language rules (English B2 vocabulary and natural speech)

Per-program language rules for `content/en-b2/**` (see `docs/content-authoring.md` §2 and
`content/pt-PT-A1/RULES.md` for the pt-PT-A1 equivalent). `targetLanguage` and `supportLanguage`
are both `en` — the learner already speaks English; this course teaches richer, more natural B2+
vocabulary and phrasing (collocations, phrasal verbs, idioms, register) rather than a foreign
grammar system.

- Prompts, explanations and context are in English throughout — there is no second language to
  translate into. Keep them precise and adult in tone (this is a B2 learner, not a beginner):
  it is fine to use grammar terminology (collocation, phrasal verb, register, hedging).
- `translate_word` with `direction: 'toTarget'` and target == support language does **not**
  translate between languages. Instead:
  - `sentence` = an English sentence with a gap-like paraphrase in **bold**, e.g.
    `"She **avoided giving a direct answer** to the question."`
  - `word` = that bolded chunk exactly as it appears in `sentence` (the paraphrase, not the
    target word).
  - `answer` = the target word or phrase the paraphrase describes, e.g. `"dodged"`.
  - `options` = 4 near-synonyms of `answer` (plausible near misses: same register/part of
    speech, e.g. `dodged / avoided / evaded / sidestepped` — pick the one that actually fits the
    sentence's collocation).
  - `direction: 'toSupport'` is unused in this course (no support-language translation needed);
    do not generate it.
- `match_pairs.support` = a short definition or synonym of `match_pairs.target` (not a
  translation, since there is no second language).
- A short Russian gloss in parentheses is allowed inside `explanation` for genuinely hard or
  culturally-loaded words, e.g. `explanation: "«To dodge a question» means to avoid answering it
  directly (увиливать)."` — never in `prompt`, `sentence`, or any target-facing field.
- Topic ids are prefixed `en-b2-m<N>-<slug>` (e.g. `en-b2-m1-collocations-work`) — ids must stay
  unique across every installed course, not just en-b2.
- Register: mark natural formal/casual splits explicitly in `prompt` or `explanation` when a
  collocation or phrasal verb is register-sensitive (e.g. "informal, spoken" vs "written,
  formal").
- No two exercises in a topic with the same target sentence (same rule as pt-PT-A1, §4 of
  `docs/content-authoring.md`).
