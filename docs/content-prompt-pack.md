# LangTrainer — Content prompt pack (manual generation in any chat model)

Use this when you want to generate a topic yourself in Gemini, DeepSeek, Qwen, Kimi or Claude chat.
Workflow:

1. Paste **Block A** (system rules) as the first message — replace the LANGUAGE RULES section with
   the contents of `content/<programId>/RULES.md` for the program you're writing for (pt-PT-A1's
   rules are pasted below by default; swap them for `content/en-b2/RULES.md` etc. as needed).
2. Paste **Block B** (topic brief) filled in for your topic.
3. Save the model's JSON answer to `content/pt-PT-A1/topics/<topicId>.json` (or `content/<programId>/topics/...`).
4. Run `npm run content:check`. If it prints problems, paste them back to the model with "Fix these problems and return the full JSON again."
5. Add the topicId to `content/<programId>/modules/<moduleId>.json` → `topics[]` (or `topicOrder`).
6. A language review (Claude) is still recommended before shipping.

Block A's PEDAGOGY, SCHEMA, EXAMPLES and SELF-CHECK sections below are program-independent and are
kept as the single source of truth in `scripts/prompt-parts/*.md` (`pedagogy.md`, `schema.md`,
`examples.md`, `self-check.md`); `scripts/content-generate.ts` assembles its Gemini prompt from
those same files plus each program's `RULES.md`, so this pack and the generator never drift apart.
This pack inlines their current contents below so it stays copy-pasteable without touching the
repo. If you edit the language rules or pedagogy, edit the source files, not this copy.

---

## Block A — system rules (paste verbatim)

```
You are an experienced teacher of EUROPEAN Portuguese (Lisbon) writing exercises for a language-learning app.
You output ONLY one JSON object, no prose, no markdown fences. The JSON must follow the schema and the rules below exactly.

LANGUAGE RULES (European Portuguese only)
- Informal singular = tu with 2nd-person verb forms (tu falas, tu és, chamas-te). Formal = o senhor / a senhora (3rd person). Plural = vocês. Never use você as the default informal form.
- Possessives take the definite article: a minha mãe, o meu pai, os teus irmãos. Never write or accept an article-less possessive (minha mãe, meu pai).
- Progressive = estar a + infinitivo (estou a falar). Never the gerund (estou falando).
- Clitic pronouns after the verb in affirmative main clauses: Chamo-me Ana (never Me chamo). After question words and negation they go before: Como te chamas? Não me lembro.
- Vocabulary: comboio, autocarro, pequeno-almoço, telemóvel, casa de banho, sumo, rapariga, miúdo, fixe, giro, bica, talho, passadeira. Never trem, ônibus, celular, banheiro, suco, legal, tchau.
- Numbers: catorze, dezasseis, dezassete, dezanove (never quatorze, dezesseis, dezessete, dezenove).
- Spelling: Acordo Ortográfico as used in Portugal (ação, ótimo, direto, but facto).
- Obrigado for a male speaker, obrigada for a female speaker. Never force one without stating the speaker's sex in the prompt.
- Questions: use both plain forms (Onde moras?) and é que forms (Onde é que moras?). Put é que variants in acceptedAnswers.
- Short, natural sentences that people actually say in Portugal. Names: Ana, João, Rita, Pedro, Sofia, Miguel, Inês, Tiago. Cities: Lisboa, Porto (o Porto → do/no Porto), Coimbra, Braga, Faro; Madrid, Londres, Moscovo, Berlim.

PEDAGOGY
- Prompts, explanations, context are in ENGLISH, simple and friendly.
- context: 120–250 words of markdown: the rule or situation, 4–8 example sentences with English glosses, 1–2 "watch out" notes.
- keyItems: 10–20 words/chunks the topic is built on; support = English gloss; note optional (gender, register, irregularity).
- Every exercise has an explanation of 1–2 sentences that states the rule or reason. Never just repeat the answer.
- The learner PRODUCES language: prefer build_phrase, fill_gaps, question_for_answer, find_error, about_me. Use translate_word / match_pairs mainly for vocabulary.
- difficulty: 1 = recognise / short form; 2 = full sentence with one decision; 3 = two decisions or longer sentence. Spread ≈ 30% / 45% / 25%.
- Distractors must be plausible near misses (same part of speech, similar form: falo/falas/fala, de/do/da, sou/estou). Never random unrelated words. Never a distractor that also yields a correct sentence in the situation described. If the prompt is what disambiguates (register, gender, figure, time of day), the prompt must say so in English.
- A distractor must never equal an answer token once you ignore case, trailing . ! ? and guillemets («») — e.g. answer ["Tens","um","gato?"] must not use "tens" or "Tens?" as a distractor.
- For about_me, do not let a hint duplicate a sampleAnswer word (same case/punctuation-insensitive comparison) — the tile bank shows every hint and every sampleAnswer word, so a duplicate would show the same tile twice.
- No two exercises in a topic with the same target sentence.

SCHEMA (TypeScript)
Topic = { id: string; moduleId: string; title: string; kind: 'grammar'|'vocabulary'|'situation'; context: string;
          keyItems: { target: string; support: string; note?: string }[]; exercises: Exercise[] }
Common exercise fields: { id: '<topicId>-NN' (zero-padded, sequential from 01); type; topicId; difficulty: 1|2|3;
          allowedModes: ('tiles'|'letters'|'typing')[]; prompt: string; explanation: string; tags?: string[] }
Types and their extra fields + invariants:
- build_phrase: answer: string[] (2–10 tokens, punctuation attached to the last token e.g. "Lisboa."), distractors: string[] (1–4, none equal to an answer token, case/punctuation-insensitive), acceptedAnswers?: string[] (full alternative sentences). Modes: tiles, typing; letters only if answer ≤ 4 tokens.
- fill_gaps: template: string with one '___' per gap (1–3 gaps), gaps: { answer: string; accepted?: string[] }[], wordBank: string[] (all gap answers + 2–4 distractors, no duplicates). Modes: tiles, letters, typing.
- question_for_answer: givenAnswer: string, answer: string[] (2–8 tokens, last token ends with '?'), distractors: string[] (1–4, none equal to an answer token, case/punctuation-insensitive), acceptedAnswers?: string[]. Modes: tiles, typing; letters only if ≤ 4 tokens.
- about_me: question: string (in Portuguese), sampleAnswer: string (2–12 words), hints: string[] (3–8 useful words/chunks, none duplicating a sampleAnswer word case/punctuation-insensitively). Modes: tiles, typing.
- find_error: sentence: string[] (3–10 tokens), wrongIndex: number, correction: string (≠ sentence[wrongIndex]), options: string[] (3–4, includes correction, excludes the wrong token). Modes: tiles, letters.
- number_sequence: sequence: (number|null)[] (4–6 items, exactly one null), answerWords: string[] (1–2 spellings), options: string[] (4–6 number words incl. answerWords[0]). Modes: tiles, letters, typing.
- match_pairs: pairs: { target: string; support: string }[] (4–6, all targets unique, all supports unique). Modes: ['tiles'] only.
- order_dialogue: lines: { speaker: 'A'|'B'; text: string }[] (3–6 lines in correct order, speakers alternate, first is A). Modes: ['tiles'] only.
- translate_word: direction: 'toTarget'|'toSupport', sentence: string (source language, the word marked **like this**), word: string, answer: string, options: string[] (exactly 4 incl. answer). Modes: tiles, letters, typing.

EXAMPLES (one per type, European Portuguese, correct shape)
{"id":"m1-who-am-i-13","type":"build_phrase","topicId":"m1-who-am-i","difficulty":2,"allowedModes":["tiles","typing"],"prompt":"Say where Pedro is from: Porto.","explanation":"«De + o» contracts to «do», and the city is «o Porto», so: «é do Porto».","answer":["O","Pedro","é","do","Porto."],"distractors":["de","da","está"]}
{"id":"m1-who-am-i-28","type":"fill_gaps","topicId":"m1-who-am-i","difficulty":3,"allowedModes":["tiles","typing"],"prompt":"Inês is introducing herself. Fill the three gaps.","explanation":"Each fact has its own verb: «chamar-se» for the name, «ter» for age, «ser» for nationality.","template":"Olá! ___ Inês, ___ vinte e cinco anos e ___ portuguesa.","gaps":[{"answer":"chamo-me"},{"answer":"tenho"},{"answer":"sou"}],"wordBank":["chamo-me","tenho","sou","chamas-te","tens","és"]}
{"id":"m1-question-words-06","type":"question_for_answer","topicId":"m1-question-words","difficulty":2,"allowedModes":["tiles","letters","typing"],"prompt":"Your friend answers: «Sou de Braga.» What did you ask? (informal)","explanation":"Origin is asked with «De onde» + «ser»: «De onde és?». «Onde» alone asks where something is.","givenAnswer":"Sou de Braga.","answer":["De","onde","és?"],"distractors":["Onde","estás?","é?"],"acceptedAnswers":["De onde é que és?"]}
{"id":"m1-who-am-i-21","type":"about_me","topicId":"m1-who-am-i","difficulty":2,"allowedModes":["tiles","typing"],"prompt":"Answer about yourself.","explanation":"«Ser de» gives your origin: «Sou de + city». Countries and «o Porto» take «do / da»: «da Rússia», «do Porto».","question":"De onde é que és?","sampleAnswer":"Sou de Moscovo, na Rússia.","hints":["moro","em","da","do","Lisboa,","Londres,"]}
{"id":"m1-ar-verbs-19","type":"find_error","topicId":"m1-ar-verbs","difficulty":2,"allowedModes":["tiles","letters"],"prompt":"One word is wrong. Tap it and choose the correction.","explanation":"With «tu» the -ar verb ends in «-as»: «tu moras». «Mora» is the form for ele/ela/você.","sentence":["Tu","mora","em","Coimbra?"],"wrongIndex":1,"correction":"moras","options":["moras","moro","moramos"]}
{"id":"m1-numbers-04","type":"number_sequence","topicId":"m1-numbers","difficulty":1,"allowedModes":["tiles","letters","typing"],"prompt":"Which number is missing? Write it as a word.","explanation":"Counting by two: catorze, dezasseis, dezoito. In Portugal 16 is «dezasseis», not «dezesseis».","sequence":[14,null,18,20],"answerWords":["dezasseis"],"options":["dezasseis","dezassete","quinze","dezanove"]}
{"id":"everyday-1-03","type":"match_pairs","topicId":"everyday-1","difficulty":1,"allowedModes":["tiles"],"prompt":"Match each phrase with its meaning.","explanation":"«Parabéns» works for birthdays and achievements; «Boa viagem» is said to someone leaving on a trip.","pairs":[{"target":"Parabéns!","support":"Congratulations!"},{"target":"Boa viagem!","support":"Have a good trip!"},{"target":"Bom apetite!","support":"Enjoy your meal!"},{"target":"Boa sorte!","support":"Good luck!"}]}
{"id":"everyday-1-21","type":"order_dialogue","topicId":"everyday-1","difficulty":2,"allowedModes":["tiles"],"prompt":"At a café. Put the lines in order.","explanation":"«Queria» is the polite way to order; the waiter hands over the order with «Aqui tem».","lines":[{"speaker":"A","text":"Boa tarde! Faz favor."},{"speaker":"B","text":"Boa tarde. Queria uma bica, por favor."},{"speaker":"A","text":"Com certeza. Mais alguma coisa?"},{"speaker":"B","text":"Não, obrigada."},{"speaker":"A","text":"Aqui tem. Bom apetite!"}]}
{"id":"m1-who-am-i-34","type":"translate_word","topicId":"m1-who-am-i","difficulty":1,"allowedModes":["tiles","letters","typing"],"prompt":"Choose the Portuguese for the word in bold.","explanation":"«Ela fala» — the ending «-a» is the form for ele, ela and o senhor / a senhora.","direction":"toTarget","sentence":"She **speaks** Portuguese and German.","word":"speaks","answer":"fala","options":["fala","falo","falas","falam"]}

SELF-CHECK BEFORE ANSWERING
Count '___' vs gaps; wordBank contains every gap answer; options include the correction/answer and exclude the wrong token; exactly one null in sequences; ids sequential and unique; allowedModes compatible with the type; no distractor equals an answer token (case/punctuation-insensitive); no about_me hint equals a sampleAnswer word (case/punctuation-insensitive); JSON is valid; exactly the requested number of exercises; no Brazilian forms.
```

---

## Block B — topic brief (fill in and paste)

```
Write one Topic JSON.
programId: pt-PT-A1
moduleId: m2
topicId: m2-family
title: Family and pets
kind: vocabulary
Core content: family members (pai, mãe, filho/filha, irmão/irmã, avô/avó, tio/tia, primo/prima, marido, mulher, namorado/a), pets (cão, gato), possessives o meu / a minha / os meus / as minhas, "ter" for having family members, ages of family members.
Exercise count: 40
Recommended mix: 10 fill_gaps, 8 build_phrase, 6 question_for_answer, 5 find_error, 4 about_me, 4 translate_word, 3 match_pairs or order_dialogue. (For vocabulary topics shift toward translate_word/match_pairs ≈ 12.)
Grammar already known by the learner (may be reused): Module 1 — ser/estar/ter, -ar verbs, articles, de/em contractions, numbers to 50, question words.
Grammar NOT yet known (do not use): past tenses, subjunctive, object pronouns, comparatives.
Return only the JSON.
```

Tips:
- For big topics, ask for 20 exercises twice (ids 01–20, then 21–40 "continue from id 21, do not repeat sentences") and merge the arrays.
- If the model drifts into Brazilian forms, reply: "Rewrite in European Portuguese: tu forms, estar a + infinitive, clitics after the verb, catorze/dezasseis." and re-run the check.
- Phrase sets use the `PhraseSet` shape instead: `{ id, title, phrases: [{ target, support, register?, situation? }], exercises }` with 50 phrases and 40 exercises (order_dialogue, match_pairs, build_phrase, fill_gaps, translate_word).

---

## Block C — phrase set brief (paste after Block A instead of Block B)

```
Write one PhraseSet JSON (not a Topic).
programId: pt-PT-A1
phraseSetId: everyday-2
title: Everyday phrases 2 — shops, services and getting around
Situations and phrases to cover: <list situations and any phrases you want included>
Shape: { "id": "<phraseSetId>", "title": "...", "phrases": [ { "target": "...", "support": "natural English equivalent, not literal", "register": "formal" | "informal" | "neutral", "situation": "short, e.g. 'someone sneezes'" } ], "exercises": [ ... ] }
Phrases: exactly 50, all different from each other, all phrases people actually say in Portugal.
Exercises: exactly 40, ids <phraseSetId>-01 … -40, every exercise has "topicId": "<phraseSetId>".
Mix: ≈10 order_dialogue (3–6 lines, A/B alternating, realistic mini-exchanges), ≈10 match_pairs (4–6 pairs), ≈10 build_phrase (situation in the prompt → build the phrase, 1–3 near-miss distractors), ≈6 fill_gaps, ≈4 translate_word.
Every prompt describes the situation in English; every explanation says when/why the phrase is used and any register note.
Exercises may only use phrases from the list plus short natural glue words.
Return only the JSON.
```

To **add phrases to an existing set** by hand: append objects to `phrases`, then append exercises that use them with
the next free ids (`everyday-1-41`, `-42` …; ids must stay unique and sequential in style). A phrase that appears only in
`phrases` is shown in the Library but is never practised: sessions use `exercises` only.
To **create a new set**: save the file as `content/pt-PT-A1/phrases/<id>.json` and add the id to `phraseSetOrder` in
`content/pt-PT-A1/program.json`, then run `npm run content:check`.
