import { describe, expect, it } from 'vitest';
import type {
  AboutMeExercise,
  FillGapsExercise,
  FindErrorExercise,
  MatchPairsExercise,
  NumberSequenceExercise,
  OrderDialogueExercise,
  QuestionForAnswerExercise,
} from '../../content/types';
import { makeBuildPhrase, makeTranslateWord } from '../../test/fixtures';
import { checkAnswer, expectedAnswerText, gradePairs, responseToText } from '../check';
import { levenshtein, normalize, stripDiacritics } from '../text';

describe('normalize', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalize('  Eu   FALO  inglês ')).toBe('eu falo inglês');
  });

  it('removes terminal sentence punctuation and surrounding quotes', () => {
    expect(normalize('Falo inglês.')).toBe('falo inglês');
    expect(normalize('Moras aqui?')).toBe('moras aqui');
    expect(normalize('«Bom dia!»')).toBe('bom dia');
    expect(normalize('"Olá."')).toBe('olá');
  });

  it('keeps internal punctuation and hyphens', () => {
    expect(normalize('Chamo-me Ana, e tu?')).toBe('chamo-me ana, e tu');
  });
});

describe('stripDiacritics', () => {
  it('removes accents, tildes and cedillas', () => {
    expect(stripDiacritics('português')).toBe('portugues');
    expect(stripDiacritics('não')).toBe('nao');
    expect(stripDiacritics('almoço')).toBe('almoco');
    expect(stripDiacritics('àéêíóõúÇ')).toBe('aeeioouC');
  });
});

describe('levenshtein', () => {
  it('measures edit distance', () => {
    expect(levenshtein('falo', 'falo')).toBe(0);
    expect(levenshtein('falo', 'falu')).toBe(1);
    expect(levenshtein('falo', 'fao')).toBe(1);
    expect(levenshtein('falo', 'fla')).toBe(2);
  });
});

describe('checkAnswer — build_phrase', () => {
  const exercise = makeBuildPhrase('e1', 't1');

  it('accepts tiles in the right order, ignoring case and final punctuation', () => {
    const result = checkAnswer(exercise, 'tiles', {
      kind: 'tokens',
      tokens: ['Eu', 'falo', 'inglês.'],
    });
    expect(result).toMatchObject({
      correct: true,
      diacriticsOk: null,
      expected: 'Eu falo inglês.',
    });
  });

  it('accepts an acceptedAnswers variant and reports which one matched', () => {
    const result = checkAnswer(exercise, 'tiles', { kind: 'tokens', tokens: ['Falo', 'inglês.'] });
    expect(result.correct).toBe(true);
    expect(result.matchedAccepted).toBe('Falo inglês.');
  });

  it('rejects the wrong order', () => {
    const result = checkAnswer(exercise, 'tiles', {
      kind: 'tokens',
      tokens: ['falo', 'Eu', 'inglês.'],
    });
    expect(result).toMatchObject({ correct: false, diacriticsOk: null });
  });

  it('never reports diacritics problems in tiles mode', () => {
    const result = checkAnswer(exercise, 'tiles', {
      kind: 'tokens',
      tokens: ['Eu', 'falo', 'ingles.'],
    });
    expect(result).toMatchObject({ correct: false, diacriticsOk: null });
  });

  it('letters mode: exact match is diacriticsOk true', () => {
    const result = checkAnswer(exercise, 'letters', { kind: 'text', text: 'eu falo inglês' });
    expect(result).toMatchObject({ correct: true, diacriticsOk: true });
  });

  it('letters mode: missing accents are correct but flagged', () => {
    const result = checkAnswer(exercise, 'letters', { kind: 'text', text: 'eu falo ingles' });
    expect(result).toMatchObject({ correct: true, diacriticsOk: false });
  });

  it('letters mode has no typo tolerance', () => {
    const result = checkAnswer(exercise, 'letters', { kind: 'text', text: 'eu falo inglesa' });
    expect(result.correct).toBe(false);
  });

  it('typing mode forgives one typo on a long expected string', () => {
    const result = checkAnswer(exercise, 'typing', { kind: 'text', text: 'eu falo ingles!' });
    expect(result).toMatchObject({ correct: true, diacriticsOk: false });

    const oneTypo = checkAnswer(exercise, 'typing', { kind: 'text', text: 'eu falo inglesa' });
    expect(oneTypo.correct).toBe(true);

    const twoTypos = checkAnswer(exercise, 'typing', { kind: 'text', text: 'eu falo ingl' });
    expect(twoTypos.correct).toBe(false);
  });

  it('typing mode does not forgive typos on short answers', () => {
    const short = makeBuildPhrase('e2', 't1', {
      answer: ['Sim'],
      acceptedAnswers: [],
      distractors: [],
    });
    expect(checkAnswer(short, 'typing', { kind: 'text', text: 'sin' }).correct).toBe(false);
    expect(checkAnswer(short, 'typing', { kind: 'text', text: 'Sim!' }).correct).toBe(true);
  });
});

describe('checkAnswer — question_for_answer', () => {
  const exercise: QuestionForAnswerExercise = {
    id: 'q1',
    type: 'question_for_answer',
    topicId: 't1',
    difficulty: 1,
    allowedModes: ['tiles', 'typing'],
    prompt: 'Ask the question.',
    explanation: 'Onde asks for a place.',
    givenAnswer: 'Moro em Lisboa.',
    answer: ['Onde', 'moras?'],
    distractors: ['mora'],
    acceptedAnswers: ['Onde é que moras?'],
  };

  it('uses answer.join(" ") as expected and honours accepted answers', () => {
    expect(expectedAnswerText(exercise)).toBe('Onde moras?');
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'tokens', tokens: ['Onde', 'moras?'] }).correct
    ).toBe(true);
    expect(
      checkAnswer(exercise, 'typing', { kind: 'text', text: 'Onde é que moras?' }).correct
    ).toBe(true);
  });
});

describe('checkAnswer — fill_gaps', () => {
  const exercise: FillGapsExercise = {
    id: 'f1',
    type: 'fill_gaps',
    topicId: 't1',
    difficulty: 1,
    allowedModes: ['tiles', 'letters', 'typing'],
    prompt: 'Complete.',
    explanation: 'Endings.',
    template: 'Eu ___ português e ___ em Lisboa.',
    gaps: [{ answer: 'falo', accepted: ['não falo'] }, { answer: 'moro' }],
    wordBank: ['falo', 'moro', 'falas'],
  };

  it('is correct only when every gap is correct', () => {
    expect(checkAnswer(exercise, 'tiles', { kind: 'gaps', values: ['falo', 'moro'] }).correct).toBe(
      true
    );
    expect(checkAnswer(exercise, 'tiles', { kind: 'gaps', values: ['falo', 'mora'] }).correct).toBe(
      false
    );
    expect(checkAnswer(exercise, 'tiles', { kind: 'gaps', values: ['falo'] }).correct).toBe(false);
  });

  it('accepts per-gap accepted variants', () => {
    expect(
      checkAnswer(exercise, 'typing', { kind: 'gaps', values: ['não falo', 'moro'] }).correct
    ).toBe(true);
  });

  it('flags diacritics when any gap only matched after stripping', () => {
    const accented: FillGapsExercise = {
      ...exercise,
      template: 'Ele ___ obrigado.',
      gaps: [{ answer: 'está' }],
    };
    const result = checkAnswer(accented, 'letters', { kind: 'gaps', values: ['esta'] });
    expect(result).toMatchObject({ correct: true, diacriticsOk: false });
    const clean = checkAnswer(accented, 'letters', { kind: 'gaps', values: ['está'] });
    expect(clean).toMatchObject({ correct: true, diacriticsOk: true });
  });

  it('renders the filled template as the expected answer', () => {
    expect(expectedAnswerText(exercise)).toBe('Eu falo português e moro em Lisboa.');
  });

  it('never flags diacritics in tiles mode', () => {
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'gaps', values: ['falo', 'moro'] }).diacriticsOk
    ).toBeNull();
  });
});

describe('checkAnswer — translate_word', () => {
  const exercise = makeTranslateWord('t1e', 't1');

  it('compares against answer', () => {
    expect(checkAnswer(exercise, 'tiles', { kind: 'text', text: 'trabalho' }).correct).toBe(true);
    expect(checkAnswer(exercise, 'tiles', { kind: 'text', text: 'trabalhas' }).correct).toBe(false);
  });
});

describe('checkAnswer — number_sequence', () => {
  const exercise: NumberSequenceExercise = {
    id: 'n1',
    type: 'number_sequence',
    topicId: 't1',
    difficulty: 1,
    allowedModes: ['tiles', 'letters', 'typing'],
    prompt: 'Which number is missing?',
    explanation: 'Counting by two.',
    sequence: [1, 3, null, 7],
    answerWords: ['cinco', '5'],
    options: ['cinco', 'seis', 'sete'],
  };

  it('accepts the first answer word and any alternative', () => {
    expect(checkAnswer(exercise, 'tiles', { kind: 'text', text: 'cinco' }).correct).toBe(true);
    expect(checkAnswer(exercise, 'typing', { kind: 'text', text: '5' }).correct).toBe(true);
    expect(checkAnswer(exercise, 'tiles', { kind: 'text', text: 'seis' }).correct).toBe(false);
    expect(expectedAnswerText(exercise)).toBe('cinco');
  });
});

describe('checkAnswer — find_error', () => {
  const exercise: FindErrorExercise = {
    id: 'fe1',
    type: 'find_error',
    topicId: 't1',
    difficulty: 1,
    allowedModes: ['tiles', 'letters'],
    prompt: 'One word is wrong.',
    explanation: 'Eu takes -o.',
    sentence: ['Eu', 'falas', 'português.'],
    wrongIndex: 1,
    correction: 'falo',
    options: ['falo', 'fala'],
  };

  it('needs the right token and the right replacement', () => {
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'findError', index: 1, replacement: 'falo' }).correct
    ).toBe(true);
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'findError', index: 0, replacement: 'falo' }).correct
    ).toBe(false);
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'findError', index: 1, replacement: 'fala' }).correct
    ).toBe(false);
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'findError', index: null, replacement: '' }).correct
    ).toBe(false);
  });

  it('applies letters rules to the replacement text', () => {
    const accented: FindErrorExercise = { ...exercise, correction: 'está' };
    const result = checkAnswer(accented, 'letters', {
      kind: 'findError',
      index: 1,
      replacement: 'esta',
    });
    expect(result).toMatchObject({ correct: true, diacriticsOk: false });
  });
});

describe('checkAnswer — match_pairs', () => {
  const exercise: MatchPairsExercise = {
    id: 'mp1',
    type: 'match_pairs',
    topicId: 't1',
    difficulty: 1,
    allowedModes: ['tiles'],
    prompt: 'Match the pairs.',
    explanation: 'Endings.',
    pairs: [
      { target: 'falo', support: 'I speak' },
      { target: 'falas', support: 'you speak' },
    ],
  };

  it('is correct when every pair is right, however many taps it took', () => {
    expect(checkAnswer(exercise, 'tiles', { kind: 'pairs', pairs: exercise.pairs }).correct).toBe(
      true
    );
  });

  it('is wrong when a pair is crossed over or missing', () => {
    expect(
      checkAnswer(exercise, 'tiles', {
        kind: 'pairs',
        pairs: [
          { target: 'falo', support: 'you speak' },
          { target: 'falas', support: 'I speak' },
        ],
      }).correct
    ).toBe(false);
    expect(
      checkAnswer(exercise, 'tiles', { kind: 'pairs', pairs: [exercise.pairs[0]] }).correct
    ).toBe(false);
  });

  it('grades each pair for the feedback sheet', () => {
    expect(
      gradePairs(exercise, [
        { target: 'falo', support: 'you speak' },
        { target: 'falas', support: 'you speak' },
      ])
    ).toEqual([
      { target: 'falo', chosen: 'you speak', expected: 'I speak', correct: false },
      { target: 'falas', chosen: 'you speak', expected: 'you speak', correct: true },
    ]);
    // An item left unpaired has no chosen partner and is wrong.
    expect(gradePairs(exercise, [])[0]).toEqual({
      target: 'falo',
      expected: 'I speak',
      correct: false,
    });
  });
});

describe('checkAnswer — order_dialogue', () => {
  const exercise: OrderDialogueExercise = {
    id: 'od1',
    type: 'order_dialogue',
    topicId: 't1',
    difficulty: 1,
    allowedModes: ['tiles'],
    prompt: 'Order the dialogue.',
    explanation: 'Question then answer.',
    lines: [
      { speaker: 'A', text: 'Olá!' },
      { speaker: 'B', text: 'Bom dia!' },
      { speaker: 'A', text: 'Tudo bem?' },
    ],
  };

  it('is correct only for the natural order', () => {
    expect(checkAnswer(exercise, 'tiles', { kind: 'order', order: [0, 1, 2] }).correct).toBe(true);
    expect(checkAnswer(exercise, 'tiles', { kind: 'order', order: [1, 0, 2] }).correct).toBe(false);
    expect(checkAnswer(exercise, 'tiles', { kind: 'order', order: [0, 1] }).correct).toBe(false);
  });
});

describe('checkAnswer — about_me', () => {
  const exercise: AboutMeExercise = {
    id: 'am1',
    type: 'about_me',
    topicId: 't1',
    difficulty: 2,
    allowedModes: ['tiles', 'typing'],
    prompt: 'Answer about yourself.',
    explanation: 'Morar goes with em.',
    question: 'Onde é que moras?',
    sampleAnswer: 'Moro em Lisboa, no centro.',
    hints: ['numa', 'aldeia'],
  };

  it('uses the learner self-grade: yes and mostly count as correct', () => {
    for (const grade of ['yes', 'mostly'] as const) {
      const result = checkAnswer(exercise, 'typing', {
        kind: 'selfGrade',
        text: 'Moro no Porto.',
        grade,
      });
      expect(result).toMatchObject({
        correct: true,
        diacriticsOk: null,
        expected: exercise.sampleAnswer,
      });
    }
    expect(
      checkAnswer(exercise, 'typing', { kind: 'selfGrade', text: 'x', grade: 'no' }).correct
    ).toBe(false);
  });
});

describe('responseToText', () => {
  it('renders each response kind as a storable string', () => {
    expect(responseToText({ kind: 'tokens', tokens: ['Eu', 'falo'] })).toBe('Eu falo');
    expect(responseToText({ kind: 'text', text: 'falo' })).toBe('falo');
    expect(responseToText({ kind: 'gaps', values: ['falo', 'moro'] })).toBe('falo | moro');
    expect(responseToText({ kind: 'findError', index: 1, replacement: 'falo' })).toBe('#2 → falo');
    expect(responseToText({ kind: 'order', order: [1, 0] })).toBe('2 1');
    expect(responseToText({ kind: 'pairs', pairs: [{ target: 'a', support: 'b' }] })).toBe('a = b');
    expect(responseToText({ kind: 'selfGrade', text: 'Moro aqui.', grade: 'yes' })).toBe(
      'Moro aqui.'
    );
  });
});
