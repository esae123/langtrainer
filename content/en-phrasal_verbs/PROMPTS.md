# Phrasal verbs course prompts

Use these prompts with the course files. Replace `<topic-id>` with the topic ID from `modules/m1.json`.

## Generate a topic

```text
Read content/en-phrasal_verbs/RULES.md, content/en-phrasal_verbs/modules/m1.json, and src/content/types.ts.
For topic <topic-id>, write content/en-phrasal_verbs/topics/<topic-id>.json following that topic's brief and the course rules.

Treat the brief's coverage list and dictionary descriptions as authoritative. Create exactly the required exercises for each assigned phrasal verb. Include a short meaning/use description and a natural example for every practised phrasal verb. Vary contexts and tenses.

Do not use about_me. Do not reveal the target phrase, any listed interchangeable synonym, or the expected sentence in learner-visible text shown before the answer is submitted. Check prompt, question, givenAnswer, sentence, context, and template, including inflected and separable forms. A find_error sentence may contain the deliberately wrong particle form being corrected; do not reveal the correct form elsewhere.

In build_phrase and question_for_answer the prompt must contain every content word, the subject/person, the tense and every detail of the answer except the phrasal verb itself (paraphrase it), and must say to use a phrasal verb. For question_for_answer the prompt says exactly what to ask and to whom. A learner typing from the prompt alone must be able to produce the answer.

For open typed answers, include natural acceptable alternatives in acceptedAnswers (or in a fill_gaps gap's accepted list). Accept every synonym the brief identifies as interchangeable for that sense. Do not require please unless the prompt explicitly asks for a polite answer. Keep tile answers based on the primary answer.

Then run npm run content:check. Fix errors for this topic only. Do not modify any other files.
Return only the topic JSON.
```

## Review and repair a generated topic

```text
Read content/en-phrasal_verbs/RULES.md, content/en-phrasal_verbs/modules/m1.json, src/content/types.ts, and content/en-phrasal_verbs/topics/<topic-id>.json.
Audit and repair only content/en-phrasal_verbs/topics/<topic-id>.json. Do not modify any other files.

Check every exercise against its assigned coverage tag and dictionary description. Confirm that every practised phrasal verb is described with its meaning/use and a natural example, and that the required number of distinct exercises tests each target.

Inspect all learner-visible text presented before submission: prompt, question, givenAnswer, sentence, context, and template. Remove the target phrasal verb in every tense/separable form, any listed interchangeable synonym, and any wording that gives away the expected sentence. In find_error only, allow the deliberately incorrect particle phrase in sentence, but never reveal its correction elsewhere. In question_for_answer, ensure givenAnswer does not reveal the target phrase.

Check every build_phrase and question_for_answer prompt against its answer: In build_phrase and question_for_answer the prompt must contain every content word, the subject/person, the tense and every detail of the answer except the phrasal verb itself (paraphrase it), and must say to use a phrasal verb. For question_for_answer the prompt says exactly what to ask and to whom. A learner typing from the prompt alone must be able to produce the answer. Rewrite the prompt (or fix the answer, tiles and distractors) where subject, person, tense, object or details do not match.

For typed build_phrase, question_for_answer, and translate_word items, add acceptedAnswers for reasonable natural answers the prompt permits. For fill_gaps, use each gap's accepted list for valid word-level variants. Include all synonymous/interchangeable phrasal verbs specified by the brief. If please is not requested, accept both versions with and without please. Preserve the primary answer and current tile choices.

Remove any about_me exercise and replace it with an objectively gradable exercise for the same target, preserving coverage. Check grammar, naturalness, tense, answer keys, distractors, and duplicate sentences. Then run npm run content:check and repair diagnostics for this topic only.

Save the corrected JSON to the specified topic file, then report briefly what you fixed and whether the course content check passed.
```
