import { describe, expect, it } from 'vitest';
import { checkContent } from '../contentRules';
import type {
  AboutMeExercise,
  BuildPhraseExercise,
  Exercise,
  FillGapsExercise,
  FindErrorExercise,
  MatchPairsExercise,
  NumberSequenceExercise,
  OrderDialogueExercise,
  PhraseSet,
  Program,
  QuestionForAnswerExercise,
  Topic,
  TranslateWordExercise,
} from '../types';

const TOPIC_ID = 't1-topic';

function programWithTopic(exercises: Exercise[], topicId = TOPIC_ID): Program {
  const topic: Topic = {
    id: topicId,
    moduleId: 'm1',
    title: 'Topic',
    kind: 'grammar',
    context: 'c',
    keyItems: [],
    exercises,
  };
  return {
    id: 'p',
    title: 'P',
    targetLanguage: 'pt-PT',
    supportLanguage: 'en',
    level: 'A1',
    modules: [{ id: 'm1', title: 'M1', description: 'd', topics: [topic] }],
    phraseSets: [],
  };
}

function programWithPhraseSet(exercises: Exercise[], phraseSetId: string): Program {
  const phraseSet: PhraseSet = { id: phraseSetId, title: 'PS', phrases: [], exercises };
  return {
    id: 'p',
    title: 'P',
    targetLanguage: 'pt-PT',
    supportLanguage: 'en',
    level: 'A1',
    modules: [],
    phraseSets: [phraseSet],
  };
}

function messages(problems: { message: string }[]): string[] {
  return problems.map((p) => p.message);
}

function has(problems: { message: string }[], substr: string): boolean {
  return messages(problems).some((m) => m.includes(substr));
}

// One valid, minimal exercise of every type, all belonging to TOPIC_ID with well-formed ids.
const validBuildPhrase: BuildPhraseExercise = {
  id: `${TOPIC_ID}-01`,
  type: 'build_phrase',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles'],
  prompt: 'Build the phrase.',
  explanation: 'Ser + nationality.',
  answer: ['Eu', 'sou', 'português.'],
  distractors: ['portuguesa'],
};

const validFillGaps: FillGapsExercise = {
  id: `${TOPIC_ID}-02`,
  type: 'fill_gaps',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles'],
  prompt: 'Fill the gap.',
  explanation: 'ser, 1st person.',
  template: 'Eu ___ português.',
  gaps: [{ answer: 'sou' }],
  wordBank: ['sou', 'é', 'somos', 'são'],
};

const validQuestionForAnswer: QuestionForAnswerExercise = {
  id: `${TOPIC_ID}-03`,
  type: 'question_for_answer',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles'],
  prompt: 'Ask the question.',
  explanation: 'tu + ser question.',
  givenAnswer: 'Sim, sou.',
  answer: ['Tu', 'és', 'portuguesa?'],
  distractors: ['é'],
};

const validAboutMe: AboutMeExercise = {
  id: `${TOPIC_ID}-04`,
  type: 'about_me',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles', 'typing'],
  prompt: 'Answer about yourself.',
  explanation: 'Introduce yourself.',
  question: 'Como te chamas?',
  sampleAnswer: 'Chamo-me Ana e sou portuguesa.',
  // Deliberately disjoint from sampleAnswer's own words: hints duplicating a sampleAnswer word
  // now raise a warning (see "about_me — hint/sampleAnswer duplicate" below), which would break
  // the "no problems" happy-path test below if this fixture overlapped.
  hints: ['tenho', 'anos', 'moro', 'trabalho'],
};

const validFindError: FindErrorExercise = {
  id: `${TOPIC_ID}-05`,
  type: 'find_error',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles', 'letters'],
  prompt: 'Find the error.',
  explanation: 'de+o = do.',
  sentence: ['Eu', 'sou', 'di', 'Lisboa.'],
  wrongIndex: 2,
  correction: 'de',
  options: ['do', 'de', 'da'],
};

const validNumberSequence: NumberSequenceExercise = {
  id: `${TOPIC_ID}-06`,
  type: 'number_sequence',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles', 'typing'],
  prompt: 'Complete the sequence.',
  explanation: 'Counting.',
  sequence: [1, 2, null, 4],
  answerWords: ['três'],
  options: ['um', 'dois', 'três', 'quatro'],
};

const validMatchPairs: MatchPairsExercise = {
  id: `${TOPIC_ID}-07`,
  type: 'match_pairs',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles'],
  prompt: 'Match the pairs.',
  explanation: 'Common greetings.',
  pairs: [
    { target: 'olá', support: 'hello' },
    { target: 'adeus', support: 'bye' },
    { target: 'obrigado', support: 'thanks' },
    { target: 'desculpe', support: 'sorry' },
  ],
};

const validOrderDialogue: OrderDialogueExercise = {
  id: `${TOPIC_ID}-08`,
  type: 'order_dialogue',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles'],
  prompt: 'Order the dialogue.',
  explanation: 'A greets first.',
  lines: [
    { speaker: 'A', text: 'Olá!' },
    { speaker: 'B', text: 'Olá, tudo bem?' },
    { speaker: 'A', text: 'Tudo bem.' },
  ],
};

const validTranslateWord: TranslateWordExercise = {
  id: `${TOPIC_ID}-09`,
  type: 'translate_word',
  topicId: TOPIC_ID,
  difficulty: 1,
  allowedModes: ['tiles'],
  prompt: 'Translate the bold word.',
  explanation: 'house = casa.',
  direction: 'toTarget',
  sentence: 'I live in a **house**.',
  word: 'house',
  answer: 'casa',
  options: ['casa', 'carro', 'cama', 'copo'],
};

const allValidExercises: Exercise[] = [
  validBuildPhrase,
  validFillGaps,
  validQuestionForAnswer,
  validAboutMe,
  validFindError,
  validNumberSequence,
  validMatchPairs,
  validOrderDialogue,
  validTranslateWord,
];

describe('checkContent — happy path and stats', () => {
  it('reports no problems for a fully valid topic covering every exercise type', () => {
    const { problems } = checkContent(programWithTopic(allValidExercises));
    expect(problems).toEqual([]);
  });

  it('computes exercise count, per-type and per-difficulty stats for a topic', () => {
    const { stats } = checkContent(programWithTopic(allValidExercises));
    const topicStats = stats[TOPIC_ID];
    expect(topicStats.exerciseCount).toBe(9);
    expect(topicStats.byType).toEqual({
      build_phrase: 1,
      fill_gaps: 1,
      question_for_answer: 1,
      about_me: 1,
      find_error: 1,
      number_sequence: 1,
      match_pairs: 1,
      order_dialogue: 1,
      translate_word: 1,
    });
    expect(topicStats.byDifficulty).toEqual({ '1': 9, '2': 0, '3': 0 });
  });

  it('computes stats for a phrase set keyed by its id', () => {
    const { stats, problems } = checkContent(
      programWithPhraseSet([{ ...validBuildPhrase, id: 'ps1-01', topicId: 'ps1' }], 'ps1')
    );
    expect(problems).toEqual([]);
    expect(stats.ps1.exerciseCount).toBe(1);
  });
});

describe('checkContent — common invariants', () => {
  it('accepts a well-formed id (positive)', () => {
    expect(
      has(checkContent(programWithTopic([validBuildPhrase])).problems, 'must match the pattern')
    ).toBe(false);
  });

  it('rejects an id that does not match "<topicId>-nn" (negative)', () => {
    const bad = { ...validBuildPhrase, id: 'not-the-right-shape' };
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'must match the pattern')).toBe(true);
  });

  it('rejects an exercise whose topicId does not match its container (negative)', () => {
    const bad = { ...validBuildPhrase, topicId: 'some-other-topic' };
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'must equal the containing topic')).toBe(true);
  });

  it('accepts allowedModes that are valid for the exercise type (positive)', () => {
    const ok: MatchPairsExercise = { ...validMatchPairs, allowedModes: ['tiles'] };
    expect(
      has(checkContent(programWithTopic([ok])).problems, 'is not allowed for exercise type')
    ).toBe(false);
  });

  it('rejects an allowedMode that is not type-compatible (negative)', () => {
    const bad: MatchPairsExercise = { ...validMatchPairs, allowedModes: ['typing'] };
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'is not allowed for exercise type')).toBe(true);
  });

  it('allows "letters" mode for build_phrase when answer is 4 words or fewer (positive)', () => {
    const ok: BuildPhraseExercise = {
      ...validBuildPhrase,
      allowedModes: ['tiles', 'letters'],
      answer: ['Eu', 'sou', 'português.'],
    };
    expect(
      has(checkContent(programWithTopic([ok])).problems, 'letters" mode is only allowed')
    ).toBe(false);
  });

  it('rejects "letters" mode for build_phrase when answer has more than 4 words (negative)', () => {
    const bad: BuildPhraseExercise = {
      ...validBuildPhrase,
      allowedModes: ['tiles', 'letters'],
      answer: ['Eu', 'sou', 'muito', 'feliz', 'hoje.'],
    };
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'letters" mode is only allowed')).toBe(true);
  });

  it('rejects a difficulty outside 1-3 (negative)', () => {
    const bad = { ...validBuildPhrase, difficulty: 4 } as unknown as Exercise;
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'difficulty must be 1, 2 or 3')).toBe(true);
  });

  it('rejects an empty prompt (negative)', () => {
    const bad = { ...validBuildPhrase, prompt: '  ' };
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'prompt must not be empty')).toBe(true);
  });

  it('rejects an empty explanation (negative)', () => {
    const bad = { ...validBuildPhrase, explanation: '' };
    const { problems } = checkContent(programWithTopic([bad]));
    expect(has(problems, 'explanation must not be empty')).toBe(true);
  });

  it('rejects duplicate exercise ids anywhere in the program (negative)', () => {
    const dup = { ...validQuestionForAnswer, id: validBuildPhrase.id, topicId: TOPIC_ID };
    const { problems } = checkContent(programWithTopic([validBuildPhrase, dup]));
    expect(has(problems, 'duplicate exercise id')).toBe(true);
  });

  it('accepts unique exercise ids across the whole program (positive)', () => {
    const { problems } = checkContent(programWithTopic(allValidExercises));
    expect(has(problems, 'duplicate exercise id')).toBe(false);
  });

  it('rejects two exercises in the same topic with the same joined target sentence (negative)', () => {
    const dup: BuildPhraseExercise = {
      ...validBuildPhrase,
      id: `${TOPIC_ID}-99`,
      answer: [...validBuildPhrase.answer],
    };
    const { problems } = checkContent(programWithTopic([validBuildPhrase, dup]));
    expect(has(problems, 'duplicate target sentence')).toBe(true);
  });

  it('accepts two exercises in the same topic with different target sentences (positive)', () => {
    const other: BuildPhraseExercise = {
      ...validBuildPhrase,
      id: `${TOPIC_ID}-99`,
      answer: ['Tu', 'és', 'russo.'],
    };
    const { problems } = checkContent(programWithTopic([validBuildPhrase, other]));
    expect(has(problems, 'duplicate target sentence')).toBe(false);
  });
});

describe('checkContent — problem metadata (stage 4b report)', () => {
  it('stamps a problem with the exercise id, 1-based number and total count', () => {
    const bad = { ...validBuildPhrase, difficulty: 4 } as unknown as Exercise;
    const { problems } = checkContent(programWithTopic([bad, validFillGaps]));
    const hit = problems.find((p) => p.message.includes('difficulty must be 1, 2 or 3'));
    expect(hit).toMatchObject({ exerciseId: bad.id, exerciseNumber: 1, exerciseCount: 2 });
  });

  it('includes the earlier exercise number/id in the duplicate target sentence message', () => {
    const dup: BuildPhraseExercise = {
      ...validBuildPhrase,
      id: `${TOPIC_ID}-99`,
      answer: [...validBuildPhrase.answer],
    };
    const { problems } = checkContent(programWithTopic([validBuildPhrase, dup]));
    const hit = problems.find((p) => p.message.includes('duplicate target sentence'));
    expect(hit?.message).toContain(`exercise 1, id "${validBuildPhrase.id}"`);
    expect(hit).toMatchObject({ exerciseId: dup.id, exerciseNumber: 2, exerciseCount: 2 });
  });

  it('stamps a duplicate exercise id problem with its own number/count', () => {
    const dup = { ...validQuestionForAnswer, id: validBuildPhrase.id, topicId: TOPIC_ID };
    const { problems } = checkContent(programWithTopic([validBuildPhrase, dup]));
    const hit = problems.find((p) => p.message.includes('duplicate exercise id'));
    expect(hit).toMatchObject({ exerciseId: dup.id, exerciseNumber: 2, exerciseCount: 2 });
  });
});

describe('checkContent — build_phrase invariants', () => {
  it('rejects an answer with fewer than 2 words (negative)', () => {
    const bad: BuildPhraseExercise = { ...validBuildPhrase, answer: ['Olá.'] };
    expect(has(checkContent(programWithTopic([bad])).problems, 'answer must have 2-10 words')).toBe(
      true
    );
  });

  it('rejects zero distractors (negative)', () => {
    const bad: BuildPhraseExercise = { ...validBuildPhrase, distractors: [] };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'distractors must have 1-4 items')
    ).toBe(true);
  });

  it('rejects a distractor equal to an answer word (negative)', () => {
    const bad: BuildPhraseExercise = { ...validBuildPhrase, distractors: ['sou'] };
    expect(has(checkContent(programWithTopic([bad])).problems, 'duplicates an answer word')).toBe(
      true
    );
  });

  it('rejects a distractor equal to an answer word after case/punctuation normalisation (negative)', () => {
    // answer ["Tens","um","gato?"], distractor "tens" — same word, different case, no "?".
    const bad: BuildPhraseExercise = {
      ...validBuildPhrase,
      answer: ['Tens', 'um', 'gato?'],
      distractors: ['tens'],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'duplicates an answer word')).toBe(
      true
    );
  });
});

describe('checkContent — fill_gaps invariants', () => {
  it('rejects a template whose "___" count does not match gaps.length (negative)', () => {
    const bad: FillGapsExercise = { ...validFillGaps, template: 'Eu ___ ___ português.' };
    expect(has(checkContent(programWithTopic([bad])).problems, 'markers but gaps has')).toBe(true);
  });

  it('rejects a wordBank missing a gap answer (negative)', () => {
    const bad: FillGapsExercise = { ...validFillGaps, wordBank: ['é', 'somos', 'são'] };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'must contain every gap answer')
    ).toBe(true);
  });

  it('rejects a wordBank with duplicates (negative)', () => {
    const bad: FillGapsExercise = { ...validFillGaps, wordBank: ['sou', 'sou', 'é', 'somos'] };
    expect(has(checkContent(programWithTopic([bad])).problems, 'must not contain duplicates')).toBe(
      true
    );
  });

  it('rejects a wordBank with too few distractors (negative)', () => {
    const bad: FillGapsExercise = { ...validFillGaps, wordBank: ['sou'] };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'wordBank must contain 2-4 distractor')
    ).toBe(true);
  });
});

describe('checkContent — question_for_answer invariants', () => {
  it('rejects an empty givenAnswer (negative)', () => {
    const bad: QuestionForAnswerExercise = { ...validQuestionForAnswer, givenAnswer: '' };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'givenAnswer must not be empty')
    ).toBe(true);
  });

  it('rejects an answer whose last word does not contain "?" (negative)', () => {
    const bad: QuestionForAnswerExercise = {
      ...validQuestionForAnswer,
      answer: ['Tu', 'és', 'portuguesa'],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'answer is a question')).toBe(true);
  });

  it('rejects zero distractors (negative)', () => {
    const bad: QuestionForAnswerExercise = { ...validQuestionForAnswer, distractors: [] };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'distractors must have 1-4 items')
    ).toBe(true);
  });

  it('rejects a distractor equal to an answer word after case/punctuation normalisation (negative)', () => {
    // answer [...,"tens?"], distractor "tens" — same word, missing the "?".
    const bad: QuestionForAnswerExercise = {
      ...validQuestionForAnswer,
      answer: ['Quantos', 'gatos', 'tens?'],
      distractors: ['tens'],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'duplicates an answer word')).toBe(
      true
    );
  });
});

describe('checkContent — about_me invariants', () => {
  it('rejects an empty question (negative)', () => {
    const bad: AboutMeExercise = { ...validAboutMe, question: '' };
    expect(has(checkContent(programWithTopic([bad])).problems, 'question must not be empty')).toBe(
      true
    );
  });

  it('rejects a sampleAnswer with fewer than 2 words (negative)', () => {
    const bad: AboutMeExercise = { ...validAboutMe, sampleAnswer: 'Ana.' };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'sampleAnswer must have 2-12 words')
    ).toBe(true);
  });

  it('rejects hints outside the 3-8 range (negative)', () => {
    const bad: AboutMeExercise = { ...validAboutMe, hints: ['a', 'b'] };
    expect(has(checkContent(programWithTopic([bad])).problems, 'hints must have 3-8 items')).toBe(
      true
    );
  });

  it('warns (does not error) when a hint duplicates a sampleAnswer word (negative, warning)', () => {
    const bad: AboutMeExercise = {
      ...validAboutMe,
      sampleAnswer: 'Chamo-me Ana e sou portuguesa.',
      hints: ['sou', 'anos', 'moro'],
    };
    const { problems } = checkContent(programWithTopic([bad]));
    const hit = problems.find((p) => p.message.includes('duplicates a sampleAnswer word'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('warning');
  });

  it('does not warn when hints are disjoint from sampleAnswer words (positive)', () => {
    const { problems } = checkContent(programWithTopic([validAboutMe]));
    expect(has(problems, 'duplicates a sampleAnswer word')).toBe(false);
  });
});

describe('checkContent — find_error invariants', () => {
  it('rejects a sentence with fewer than 3 tokens (negative)', () => {
    const bad: FindErrorExercise = { ...validFindError, sentence: ['Eu', 'di'], wrongIndex: 1 };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'sentence must have 3-10 tokens')
    ).toBe(true);
  });

  it('rejects an out-of-range wrongIndex (negative)', () => {
    const bad: FindErrorExercise = { ...validFindError, wrongIndex: 99 };
    expect(has(checkContent(programWithTopic([bad])).problems, 'valid index into sentence')).toBe(
      true
    );
  });

  it('rejects a correction equal to the wrong token (negative)', () => {
    const bad: FindErrorExercise = { ...validFindError, correction: 'di' };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'must differ from sentence[wrongIndex]')
    ).toBe(true);
  });

  it('rejects options that do not include the correction (negative)', () => {
    const bad: FindErrorExercise = { ...validFindError, options: ['do', 'da'] };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'options must include correction')
    ).toBe(true);
  });

  it('rejects options that include the wrong token (negative)', () => {
    const bad: FindErrorExercise = { ...validFindError, options: ['do', 'de', 'di'] };
    expect(
      has(
        checkContent(programWithTopic([bad])).problems,
        'options must not include sentence[wrongIndex]'
      )
    ).toBe(true);
  });

  it('rejects a correction that differs from the wrong token only by accents (review item 11)', () => {
    const bad: FindErrorExercise = {
      ...validFindError,
      sentence: ['Tu', 'nao', 'falas', 'português.'],
      wrongIndex: 1,
      correction: 'não',
      options: ['não', 'nunca', 'sempre'],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'only by accents')).toBe(true);
  });

  it('rejects fill_gaps whose gaps share an answer in tiles mode', () => {
    const fx = {
      id: 't1-01',
      type: 'fill_gaps',
      topicId: 't1',
      difficulty: 2,
      allowedModes: ['tiles', 'typing'],
      prompt: 'p',
      explanation: 'e',
      template: 'Hoje ___ frio e ___ a chover.',
      gaps: [{ answer: 'está' }, { answer: 'está' }],
      wordBank: ['está', 'estão', 'é'],
    } as unknown as Exercise;
    expect(
      has(checkContent(programWithTopic([fx])).problems, 'two gaps have the same answer')
    ).toBe(true);
    const typingOnly = { ...fx, allowedModes: ['typing'] } as unknown as Exercise;
    expect(
      has(checkContent(programWithTopic([typingOnly])).problems, 'two gaps have the same answer')
    ).toBe(false);
  });

  it('accepts an accent-only contrast when the exercise is tiles-only (exact option must be picked)', () => {
    const tilesOnly: FindErrorExercise = {
      ...validFindError,
      allowedModes: ['tiles'],
      sentence: ['Eles', 'tem', 'dois', 'gatos.'],
      wrongIndex: 1,
      correction: 'têm',
      options: ['têm', 'temos', 'tens'],
    };
    expect(has(checkContent(programWithTopic([tilesOnly])).problems, 'only by accents')).toBe(
      false
    );
  });

  it('accepts a correction that differs from the wrong token by more than accents (positive)', () => {
    expect(has(checkContent(programWithTopic([validFindError])).problems, 'only by accents')).toBe(
      false
    );
  });

  it('rejects two options that differ only by accents (review item 11)', () => {
    const bad: FindErrorExercise = {
      ...validFindError,
      options: ['de', 'é', 'e'],
      correction: 'de',
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'only by accents')).toBe(true);
  });
});

describe('checkContent — number_sequence invariants', () => {
  it('rejects a sequence outside 4-6 items (negative)', () => {
    const bad: NumberSequenceExercise = { ...validNumberSequence, sequence: [1, null, 3] };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'sequence must have 4-6 items')
    ).toBe(true);
  });

  it('rejects a sequence without exactly one null (negative)', () => {
    const bad: NumberSequenceExercise = { ...validNumberSequence, sequence: [1, 2, 3, 4] };
    expect(has(checkContent(programWithTopic([bad])).problems, 'exactly one null')).toBe(true);
  });

  it('rejects answerWords outside 1-2 items (negative)', () => {
    const bad: NumberSequenceExercise = {
      ...validNumberSequence,
      answerWords: ['um', 'dois', 'três'],
    };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'answerWords must have 1-2 items')
    ).toBe(true);
  });

  it('rejects options that do not include answerWords[0] (negative)', () => {
    const bad: NumberSequenceExercise = {
      ...validNumberSequence,
      options: ['um', 'dois', 'quatro', 'cinco'],
    };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'options must include answerWords[0]')
    ).toBe(true);
  });
});

describe('checkContent — match_pairs invariants', () => {
  it('rejects pairs outside 4-6 items (negative)', () => {
    const bad: MatchPairsExercise = {
      ...validMatchPairs,
      pairs: validMatchPairs.pairs.slice(0, 2),
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'pairs must have 4-6 items')).toBe(
      true
    );
  });

  it('rejects duplicate targets (negative)', () => {
    const bad: MatchPairsExercise = {
      ...validMatchPairs,
      pairs: [...validMatchPairs.pairs.slice(0, 3), { target: 'olá', support: 'hi again' }],
    };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'pairs targets must be unique')
    ).toBe(true);
  });

  it('rejects duplicate supports (negative)', () => {
    const bad: MatchPairsExercise = {
      ...validMatchPairs,
      pairs: [...validMatchPairs.pairs.slice(0, 3), { target: 'boa tarde', support: 'hello' }],
    };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'pairs supports must be unique')
    ).toBe(true);
  });
});

describe('checkContent — order_dialogue invariants', () => {
  it('rejects lines outside 3-6 items (negative)', () => {
    const bad: OrderDialogueExercise = {
      ...validOrderDialogue,
      lines: validOrderDialogue.lines.slice(0, 2),
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'lines must have 3-6 items')).toBe(
      true
    );
  });

  it('rejects a dialogue that does not start with A (negative)', () => {
    const bad: OrderDialogueExercise = {
      ...validOrderDialogue,
      lines: [{ speaker: 'B', text: 'Olá!' }, ...validOrderDialogue.lines.slice(1)],
    };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'first line must be spoken by A')
    ).toBe(true);
  });

  it('rejects speakers that do not alternate (negative)', () => {
    const bad: OrderDialogueExercise = {
      ...validOrderDialogue,
      lines: [
        { speaker: 'A', text: 'Olá!' },
        { speaker: 'A', text: 'Tudo bem?' },
        { speaker: 'B', text: 'Tudo bem.' },
      ],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'speakers must alternate')).toBe(
      true
    );
  });
});

describe('checkContent — translate_word invariants', () => {
  it('rejects a sentence that does not contain the word (negative)', () => {
    const bad: TranslateWordExercise = { ...validTranslateWord, word: 'car' };
    expect(
      has(checkContent(programWithTopic([bad])).problems, 'sentence must contain the word')
    ).toBe(true);
  });

  it('rejects options that do not have exactly 4 items (negative)', () => {
    const bad: TranslateWordExercise = {
      ...validTranslateWord,
      options: ['casa', 'carro', 'cama'],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'exactly 4 items')).toBe(true);
  });

  it('rejects options that do not include the answer (negative)', () => {
    const bad: TranslateWordExercise = {
      ...validTranslateWord,
      options: ['carro', 'cama', 'copo', 'cão'],
    };
    expect(has(checkContent(programWithTopic([bad])).problems, 'options must include answer')).toBe(
      true
    );
  });
});
