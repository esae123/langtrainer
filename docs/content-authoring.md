# LangTrainer — Content authoring guide (pt-PT A1)

This guide is the contract for anyone (human or LLM) writing learning content. Content files are validated by
`npm run content:check`; a file that fails validation is not shipped.

## 1. Layout on disk

```
content/pt-PT-A1/
  program.json                 # id, title, targetLanguage, supportLanguage, level, moduleOrder[], phraseSetOrder[]
  modules/m1.json              # { id, title, description, topicOrder: [topicId, ...] }
  topics/m1-greetings.json     # one Topic per file (see src/content/types.ts)
  phrases/everyday-1.json      # one PhraseSet per file
```

`npm run content:build` assembles these into `src/content/programs/pt-PT-A1.json` (generated, committed).
Never edit the generated file by hand.

## 2. Language rules — EUROPEAN Portuguese only

- Informal singular is **tu** with 2nd-person verb forms (`tu falas`, `tu és`, `chamas-te`). Formal singular is **você / o senhor / a senhora** with 3rd-person forms. Plural: **vocês**. Never use `você` as the default informal form (that is Brazilian usage).
- Progressive: **estar a + infinitivo** (`estou a falar`). Never the gerund (`estou falando`).
- Clitic pronouns after the verb in affirmative main clauses: **Chamo-me Ana**, never `Me chamo Ana`.
- Vocabulary: comboio (not trem), autocarro (not ônibus), pequeno-almoço (not café da manhã), telemóvel (not celular), casa de banho (not banheiro), sumo (not suco), rapariga (girl), miúdo/a, fixe (cool, informal), giro/a (cute/nice), talho, bica (espresso, Lisbon), passadeira.
- Spelling per Acordo Ortográfico 1990 as used in Portugal: `ação`, `ótimo`, `direto`, but keep `facto` (PT) not `fato`.
- Numbers: **catorze** and **dezasseis, dezassete, dezanove** (PT), not `quatorze`, `dezesseis`.
- Greetings: `Bom dia` (until lunch), `Boa tarde`, `Boa noite`. `Olá`, `Tudo bem?`, `Até logo`, `Até amanhã`, `Adeus`.
- `Obrigado` if the speaker is male, `Obrigada` if female. Exercises must not force one; accept both where relevant.
- Questions: `Como te chamas?` / `Como se chama?`; the emphatic `é que` is very common: `Onde é que moras?`, `De onde é que és?`. Use both plain and `é que` forms in content.
- Keep sentences short and natural, the way people actually speak in Portugal.

## 3. Pedagogical rules

- Support language (prompts, explanations, contexts) is **English**. Simple, friendly, no jargon beyond "verb", "article", "plural".
- Each topic: `context` 120–250 words of markdown: the situation or rule, 4–8 example sentences with English glosses, one or two "watch out" notes. Written for a beginner.
- `keyItems`: 10–20 entries, the words and chunks the topic is built on. `support` is the English gloss; `note` optional (gender, register, irregularity).
- `explanation` on every exercise: 1–2 sentences, states the rule or the reason. Never just "Correct answer: X".
- Learner **produces** language: prefer `build_phrase`, `fill_gaps`, `question_for_answer`, `find_error`, `about_me`. Use `translate_word` and `match_pairs` mainly for vocabulary topics and phrase sets.
- `difficulty`: 1 = recognises / short forms, 2 = full sentence with one decision, 3 = two decisions (e.g. verb form + article) or longer sentence.
- Distractors must be **plausible**: same part of speech, similar form (`falo / falas / fala`, `de / do / da`, `sou / estou`), never random unrelated words. At least one distractor per exercise should be a "near miss" that tests the point of the topic.
- Avoid the answer being derivable from the tile set alone: for `build_phrase` add 1–3 distractors; for `fill_gaps` `wordBank` = all gap answers + 2–4 distractors.
- Vary subjects and names: use Portuguese names (Ana, João, Rita, Pedro, Sofia, Miguel, Inês, Tiago), cities (Lisboa, Porto, Coimbra, Braga, Faro), and international ones (Madrid, Londres, Moscovo, Berlim).
- No two exercises in a topic with identical target sentences.
- Register `formal | informal | neutral` on phrases where it matters.

## 4. Per-type invariants (enforced by validator)

Common: `id` unique across the whole program, pattern `<topicId>-<nn>` (e.g. `m1-greetings-07`); `topicId` equals the containing topic/phrase-set id; `allowedModes` non-empty and type-compatible (below); `prompt`, `explanation` non-empty; `difficulty` 1–3.

| type | allowedModes allowed | invariants |
|---|---|---|
| build_phrase | tiles, letters (only if answer ≤ 4 words), typing | `answer` 2–10 words; `distractors` 1–4, none equal to an answer word (case-sensitive); `acceptedAnswers` optional alternatives as full strings |
| fill_gaps | tiles, letters, typing | count of `___` in `template` == `gaps.length` (1–3); `wordBank` ⊇ all gap answers, has 2–4 extra distractors, no duplicates |
| question_for_answer | tiles, letters (≤ 4 words), typing | `givenAnswer` non-empty; `answer` 2–8 words ending with `?` as last token or last token containing `?`; `distractors` 1–4 |
| about_me | tiles, typing | `question` in target language; `sampleAnswer` 2–12 words; `hints` 3–8 words/chunks the learner may need (tile bank = sampleAnswer words + hints) |
| find_error | tiles, letters | `sentence` 3–10 tokens; `0 ≤ wrongIndex < sentence.length`; `correction` ≠ `sentence[wrongIndex]`; `options` 3–4 items including `correction`, excluding `sentence[wrongIndex]` |
| number_sequence | tiles, letters, typing | `sequence` 4–6 items with exactly one `null`; `answerWords` 1–2 accepted spellings of the missing number word; `options` 4–6 number words including `answerWords[0]` |
| match_pairs | tiles | `pairs` 4–6, all `target` unique, all `support` unique |
| order_dialogue | tiles | `lines` 3–6, speakers alternate A/B, first is A |
| translate_word | tiles, letters, typing | `direction`; `sentence` contains `word` (the sentence in the *source* language shows `word` in bold via `**word**`); `options` 4 items including `answer` |

Tokens in `answer`, `sentence`, `lines[].text` keep punctuation attached to the word (`Lisboa.`, `chamas?`). Tiles are shown exactly as tokens.

## 5. Topic size and mix

Each topic: **40 exercises**. Recommended mix for a grammar topic: 10 fill_gaps, 8 build_phrase, 6 question_for_answer, 5 find_error, 4 about_me, 4 translate_word, 3 match_pairs or order_dialogue. Vocabulary topics shift toward translate_word/match_pairs (≈ 12) and number_sequence where relevant. Difficulty spread ≈ 30% / 45% / 25%.
Phrase set: 50 phrases, 40 exercises (order_dialogue, match_pairs, build_phrase, fill_gaps, translate_word).

## 6. Module 1 topic plan (from the roadmap)

| topicId | title | kind | core content |
|---|---|---|---|
| m1-greetings | Greetings and politeness | situation | Olá, Bom dia/tarde/noite, Tudo bem?, Por favor, Obrigado/a, De nada, Desculpe, Com licença, Até logo/amanhã, Adeus; tu vs você register |
| m1-who-am-i | Introducing yourself | grammar | chamar-se, ser + nationality (português/portuguesa, russo/russa, inglês/inglesa, espanhol/espanhola…), ser de + city, ter … anos, falar + language; agreement of nationality adjectives |
| m1-pronouns-ser-estar-ter | Pronouns, ser, estar, ter | grammar | eu/tu/você/ele/ela/nós/vocês/eles/elas; full present of ser, estar, ter; ser vs estar (permanent vs temporary; location with estar) |
| m1-ar-verbs | Regular -ar verbs | grammar | falar, morar, trabalhar, estudar, gostar de; endings -o/-as/-a/-amos/-am; negation with não |
| m1-articles-de-em | Articles and de/em contractions | grammar | o/a/os/as, um/uma/uns/umas; gender & number cues; de+o=do, de+a=da, em+o=no, em+a=na, plurals dos/das/nos/nas; "sou do Porto", "moro na Rua…" |
| m1-professions-languages | Professions and languages | vocabulary | professor/a, jornalista, médico/a, engenheiro/a, estudante, advogado/a, cozinheiro/a, enfermeiro/a, empresário/a, reformado/a; "sou professor" (no article); languages: português, inglês, russo, espanhol, francês, alemão |
| m1-numbers | Numbers 0–50 and ordinals | vocabulary | zero…cinquenta, um/uma & dois/duas agreement, vinte e um, ordinals primeiro…sexto; age, phone numbers, floor numbers (andar), prices in euros |
| m1-question-words | Question words and word order | grammar | como, quem, onde, de onde, o que, qual, quanto/a, quantos/as, porquê/porque; plain vs "é que"; answering yes/no questions (Sim, sou. / Não, não sou.) |

Phrase set `everyday-1` "Everyday phrases 1": reactions and social formulas — Parabéns!, Saúde!, Bom apetite!, Boa viagem!, Boa sorte!, Bem-vindo/a!, Com licença, Desculpe / Desculpa, Não faz mal, Não percebo, Pode repetir?, Fala inglês?, Como se diz … em português?, Está tudo bem, Até já, Fixe!, Está bem, Claro, Pois, Então…, Que pena!, Boas férias!, Feliz aniversário!, Bom fim de semana!, Igualmente!, etc.

## 7. Quality bar

Before handing in a topic, re-read it as a Portuguese teacher from Lisbon would: any Brazilian form, any unnatural sentence, any distractor that is actually also correct, any explanation that does not explain — fix it. An error in a textbook is worse than a bug in code.
