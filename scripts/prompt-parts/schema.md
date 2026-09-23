SCHEMA (TypeScript)
Topic = { id: string; moduleId: string; title: string; kind: 'grammar'|'vocabulary'|'situation'; context: string;
          keyItems: { target: string; support: string; note?: string }[]; exercises: Exercise[] }
Common exercise fields: { id: '<topicId>-NN' (zero-padded, sequential from 01); type; topicId; difficulty: 1|2|3;
          allowedModes: ('tiles'|'letters'|'typing')[]; prompt: string; explanation: string; tags?: string[] }
Types and their extra fields + invariants:
- build_phrase: answer: string[] (2–10 tokens, punctuation attached to the last token e.g. "Lisboa."), distractors: string[] (1–4, none equal to an answer token, case/punctuation-insensitive), acceptedAnswers?: string[] (full alternative sentences). Modes: tiles, typing; letters only if answer ≤ 4 tokens.
- fill_gaps: template: string with one '___' per gap (1–3 gaps), gaps: { answer: string; accepted?: string[] }[], wordBank: string[] (all gap answers + 2–4 distractors, no duplicates). Modes: tiles, letters, typing.
- question_for_answer: givenAnswer: string, answer: string[] (2–8 tokens, last token ends with '?'), distractors: string[] (1–4, none equal to an answer token, case/punctuation-insensitive), acceptedAnswers?: string[]. Modes: tiles, typing; letters only if ≤ 4 tokens.
- about_me: question: string (in the target language), sampleAnswer: string (2–12 words), hints: string[] (3–8 useful words/chunks, none duplicating a sampleAnswer word case/punctuation-insensitively). Modes: tiles, typing.
- find_error: sentence: string[] (3–10 tokens), wrongIndex: number, correction: string (≠ sentence[wrongIndex]), options: string[] (3–4, includes correction, excludes the wrong token). Modes: tiles, letters.
- number_sequence: sequence: (number|null)[] (4–6 items, exactly one null), answerWords: string[] (1–2 spellings), options: string[] (4–6 number words incl. answerWords[0]). Modes: tiles, letters, typing.
- match_pairs: pairs: { target: string; support: string }[] (4–6, all targets unique, all supports unique). Modes: ['tiles'] only.
- order_dialogue: lines: { speaker: 'A'|'B'; text: string }[] (3–6 lines in correct order, speakers alternate, first is A). Modes: ['tiles'] only.
- translate_word: direction: 'toTarget'|'toSupport', sentence: string (source language, the word marked **like this**), word: string, answer: string, options: string[] (exactly 4 incl. answer). Modes: tiles, letters, typing.

PhraseSet = { id: string; title: string; phrases: { target: string; support: string; register?: 'formal'|'informal'|'neutral'; situation?: string }[]; exercises: Exercise[] }
(exercises use the same per-type schema above; a phrase set's `<containerId>` is the phrase set's own id, not a topicId)
