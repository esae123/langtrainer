import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Exercise, InputMode } from '../../content/types';
import { checkAnswer, type ExerciseResponse } from '../../engine/check';
import { hashString } from '../../engine/rng';
import { ExerciseArea } from '../ExerciseArea';
import { makeBuildPhrase, makeTranslateWord } from '../../test/fixtures';

const base = {
  topicId: 't1',
  difficulty: 1 as const,
  prompt: 'Do the thing.',
  explanation: 'Because.',
};

const fillGaps: Exercise = {
  ...base,
  id: 'fg',
  type: 'fill_gaps',
  allowedModes: ['tiles', 'letters', 'typing'],
  template: 'Eu ___ português.',
  gaps: [{ answer: 'falo' }],
  wordBank: ['falo', 'falas'],
};

const findError: Exercise = {
  ...base,
  id: 'fe',
  type: 'find_error',
  allowedModes: ['tiles', 'letters'],
  sentence: ['Eu', 'falas', 'português.'],
  wrongIndex: 1,
  correction: 'falo',
  options: ['falo', 'fala'],
};

const numberSequence: Exercise = {
  ...base,
  id: 'ns',
  type: 'number_sequence',
  allowedModes: ['tiles', 'letters', 'typing'],
  sequence: [1, 3, null, 7],
  answerWords: ['cinco'],
  options: ['cinco', 'seis'],
};

const matchPairs: Exercise = {
  ...base,
  id: 'mp',
  type: 'match_pairs',
  allowedModes: ['tiles'],
  pairs: [
    { target: 'falo', support: 'I speak' },
    { target: 'falas', support: 'you speak' },
  ],
};

const orderDialogue: Exercise = {
  ...base,
  id: 'od',
  type: 'order_dialogue',
  allowedModes: ['tiles'],
  lines: [
    { speaker: 'A', text: 'Olá!' },
    { speaker: 'B', text: 'Bom dia!' },
  ],
};

const aboutMe: Exercise = {
  ...base,
  id: 'am',
  type: 'about_me',
  allowedModes: ['tiles', 'typing'],
  question: 'Onde é que moras?',
  sampleAnswer: 'Moro em Lisboa.',
  hints: ['numa', 'aldeia'],
};

const questionForAnswer: Exercise = {
  ...base,
  id: 'qfa',
  type: 'question_for_answer',
  allowedModes: ['tiles', 'letters', 'typing'],
  givenAnswer: 'Moro em Lisboa.',
  answer: ['Onde', 'moras?'],
  distractors: ['mora'],
};

const ALL: Exercise[] = [
  makeTranslateWord('tw', 't1'),
  makeBuildPhrase('bp', 't1'),
  questionForAnswer,
  fillGaps,
  findError,
  numberSequence,
  matchPairs,
  orderDialogue,
  aboutMe,
];

function renderView(exercise: Exercise, mode: InputMode) {
  const onChange = vi.fn();
  render(
    <ExerciseArea
      exercise={exercise}
      mode={mode}
      seed={hashString(exercise.id)}
      onChange={onChange}
    />
  );
  return onChange;
}

/** The response the view reported last, if any. */
function lastResponse(onChange: ReturnType<typeof vi.fn>): ExerciseResponse | null {
  const calls = onChange.mock.calls;
  return calls.length === 0 ? null : (calls[calls.length - 1][0] as ExerciseResponse | null);
}

describe('every exercise type renders in every allowed mode', () => {
  for (const exercise of ALL) {
    for (const mode of exercise.allowedModes) {
      it(`${exercise.type} / ${mode}`, () => {
        const onChange = renderView(exercise, mode);
        // Nothing answered yet, so the screen keeps Check disabled.
        expect(lastResponse(onChange)).toBeNull();
      });
    }
  }
});

describe('answering through the views', () => {
  it('fill_gaps tiles fills the next gap and clears it again', () => {
    const onChange = renderView(fillGaps, 'tiles');
    fireEvent.click(screen.getByRole('button', { name: 'Add falo' }));
    expect(lastResponse(onChange)).toEqual({ kind: 'gaps', values: ['falo'] });
    expect(checkAnswer(fillGaps, 'tiles', lastResponse(onChange)!).correct).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Gap 1' }));
    expect(lastResponse(onChange)).toBeNull();
  });

  it('fill_gaps letters builds the word from letter keys', () => {
    const onChange = renderView(fillGaps, 'letters');
    for (const letter of ['f', 'a', 'l', 'o']) {
      fireEvent.click(screen.getByRole('button', { name: letter }));
    }
    expect(checkAnswer(fillGaps, 'letters', lastResponse(onChange)!)).toMatchObject({
      correct: true,
      diacriticsOk: true,
    });
  });

  it('find_error needs both the token and the replacement', () => {
    const onChange = renderView(findError, 'tiles');
    fireEvent.click(screen.getByRole('radio', { name: 'falas' }));
    expect(lastResponse(onChange)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'falo' }));
    expect(lastResponse(onChange)).toEqual({ kind: 'findError', index: 1, replacement: 'falo' });
    expect(checkAnswer(findError, 'tiles', lastResponse(onChange)!).correct).toBe(true);
  });

  it('match_pairs links any two items and reports only when everything is paired', () => {
    const onChange = renderView(matchPairs, 'tiles');
    // A wrong pairing connects just like a right one — mis-taps are not errors.
    fireEvent.click(screen.getByRole('button', { name: 'falo' }));
    fireEvent.click(screen.getByRole('button', { name: 'you speak' }));
    expect(lastResponse(onChange)).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlink falo, pair 1' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'falas' }));
    fireEvent.click(screen.getByRole('button', { name: 'I speak' }));

    // Every item paired -> the response is reported, and it is graded as wrong.
    const wrong = lastResponse(onChange);
    expect(wrong).toEqual({
      kind: 'pairs',
      pairs: [
        { target: 'falo', support: 'you speak' },
        { target: 'falas', support: 'I speak' },
      ],
    });
    expect(checkAnswer(matchPairs, 'tiles', wrong!).correct).toBe(false);
  });

  it('match_pairs disconnects a linked pair and grades a complete correct set', () => {
    const onChange = renderView(matchPairs, 'tiles');
    fireEvent.click(screen.getByRole('button', { name: 'falo' }));
    fireEvent.click(screen.getByRole('button', { name: 'you speak' }));
    // Tapping either half of a linked pair returns both items to the pool.
    fireEvent.click(screen.getByRole('button', { name: 'Unlink you speak, pair 1' }));
    expect(screen.getByRole('button', { name: 'falo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'you speak' })).toBeEnabled();

    // Right-then-left works as well as left-then-right.
    fireEvent.click(screen.getByRole('button', { name: 'I speak' }));
    fireEvent.click(screen.getByRole('button', { name: 'falo' }));
    expect(lastResponse(onChange)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'falas' }));
    fireEvent.click(screen.getByRole('button', { name: 'you speak' }));

    expect(checkAnswer(matchPairs, 'tiles', lastResponse(onChange)!).correct).toBe(true);
  });

  it('order_dialogue places and takes back lines', () => {
    const onChange = renderView(orderDialogue, 'tiles');
    fireEvent.click(screen.getByRole('button', { name: 'Place: Olá!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place: Bom dia!' }));
    expect(lastResponse(onChange)).toEqual({ kind: 'order', order: [0, 1] });
    expect(checkAnswer(orderDialogue, 'tiles', lastResponse(onChange)!).correct).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Take back: Olá!' }));
    expect(lastResponse(onChange)).toBeNull();
  });

  it('about_me accepts a free typed answer', () => {
    const onChange = renderView(aboutMe, 'typing');
    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'Moro no Porto.' },
    });
    expect(lastResponse(onChange)).toEqual({ kind: 'text', text: 'Moro no Porto.' });
  });

  it('question_for_answer shows the given answer and accepts tiles', () => {
    const onChange = renderView(questionForAnswer, 'tiles');
    expect(screen.getByText('Moro em Lisboa.')).toBeInTheDocument();
    // The tile label never carries the question mark — it would give away the last word.
    expect(screen.queryByRole('button', { name: /Add moras\?/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add moras' })).toBeInTheDocument();
    // The final mark is shown as fixed text next to the answer line instead.
    expect(screen.getByLabelText('Your answer')).toHaveTextContent('?');
    fireEvent.click(screen.getByRole('button', { name: 'Add Onde' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add moras' }));
    expect(checkAnswer(questionForAnswer, 'tiles', lastResponse(onChange)!).correct).toBe(true);
  });

  it('number_sequence typing accepts the written number', () => {
    const onChange = renderView(numberSequence, 'typing');
    expect(screen.getByText('?')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'cinco' } });
    expect(checkAnswer(numberSequence, 'typing', lastResponse(onChange)!).correct).toBe(true);
  });
});
