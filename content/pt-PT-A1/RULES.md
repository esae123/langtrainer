# pt-PT-A1 — Language rules (EUROPEAN Portuguese only)

Moved here from `docs/content-authoring.md` §2 (stage 4b) so `scripts/content-generate.ts` can load
one rules file per program and paste it into the Gemini prompt as-is. This file is the language
contract for `content/pt-PT-A1/**`; the pedagogy and schema rules that apply to every program still
live in `docs/content-authoring.md` and `scripts/prompt-parts/*.md`.

- Informal singular is **tu** with 2nd-person verb forms (`tu falas`, `tu és`, `chamas-te`). Formal singular is **você / o senhor / a senhora** with 3rd-person forms. Plural: **vocês**. Never use `você` as the default informal form (that is Brazilian usage).
- Possessives take the **definite article** in European Portuguese: `a minha mãe`, `o meu pai`, `os teus irmãos`, `A minha casa é pequena.` Never write, and never accept as correct, an article-less possessive before a noun (`minha mãe`, `meu pai` — Brazilian usage), including in `answer`, `acceptedAnswers` and tile banks. (Vocative/fixed uses such as `Meu Deus!` are the only exception; avoid them at A1.)
- Progressive: **estar a + infinitivo** (`estou a falar`). Never the gerund (`estou falando`).
- Clitic pronouns after the verb in affirmative main clauses: **Chamo-me Ana**, never `Me chamo Ana`. After question words and negation they go before: `Como te chamas?`, `Não me lembro`.
- Vocabulary: comboio (not trem), autocarro (not ônibus), pequeno-almoço (not café da manhã), telemóvel (not celular), casa de banho (not banheiro), sumo (not suco), rapariga (girl), miúdo/a, fixe (cool, informal), giro/a (cute/nice), talho, bica (espresso, Lisbon), passadeira.
- Spelling per Acordo Ortográfico 1990 as used in Portugal: `ação`, `ótimo`, `direto`, but keep `facto` (PT) not `fato`.
- Numbers: **catorze** and **dezasseis, dezassete, dezanove** (PT), not `quatorze`, `dezesseis`.
- Greetings: `Bom dia` (until lunch), `Boa tarde`, `Boa noite`. `Olá`, `Tudo bem?`, `Até logo`, `Até amanhã`, `Adeus`.
- `Obrigado` if the speaker is male, `Obrigada` if female. Exercises must not force one; accept both where relevant.
- Questions: `Como te chamas?` / `Como se chama?`; the emphatic `é que` is very common: `Onde é que moras?`, `De onde é que és?`. Use both plain and `é que` forms in content.
- Keep sentences short and natural, the way people actually speak in Portugal.
