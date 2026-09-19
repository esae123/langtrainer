import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { db } from '../../db/db';
import { updateSettings } from '../../settings/settingsStore';
import { readActiveSession } from '../activeSession';

// A tiny program: one topic with three tile-friendly exercises. Built inside the mock
// factory because vi.mock is hoisted above module-level variables.
vi.mock('../../content/programs', async () => {
  const { makeProgram, makeTopic, makeTranslateWord, makeBuildPhrase } =
    await import('../../test/fixtures');
  const program = makeProgram([
    {
      id: 'm1',
      title: 'Module 1 — Basics',
      description: 'Fixture module',
      topics: [
        makeTopic('t1', 'm1', 0, {
          title: 'Regular -ar verbs',
          exercises: [
            makeTranslateWord('t1-e1', 't1'),
            makeBuildPhrase('t1-e2', 't1'),
            {
              id: 't1-e3',
              type: 'about_me' as const,
              topicId: 't1',
              difficulty: 2 as const,
              allowedModes: ['tiles' as const, 'typing' as const],
              prompt: 'Answer about yourself.',
              explanation: 'Morar goes with em.',
              question: 'Onde é que moras?',
              sampleAnswer: 'Moro em Lisboa.',
              hints: ['numa', 'aldeia', 'perto'],
            },
          ],
        }),
      ],
    },
  ]);
  return { programs: [program], getProgram: () => program };
});

beforeEach(async () => {
  window.location.hash = '#/session';
  // All-tiles input shares make the rendered mode deterministic.
  await updateSettings({
    inputPreset: 'custom',
    inputShares: { tiles: 100, letters: 0, typing: 0 },
    sessionLength: 10,
  });
});

afterEach(async () => {
  window.location.hash = '';
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function startSession() {
  fireEvent.click(await screen.findByRole('button', { name: /start exercises/i }));
}

/** Answers the currently shown exercise correctly and confirms the feedback. */
async function answerCurrent(kind: 'option' | 'tiles', labels: string[], keepFeedback = false) {
  if (kind === 'option') {
    fireEvent.click(await screen.findByRole('radio', { name: labels[0] }));
  } else {
    for (const label of labels) {
      fireEvent.click(await screen.findByRole('button', { name: `Add ${label}` }));
    }
  }
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  expect(await screen.findByText('Correct')).toBeInTheDocument();
  if (!keepFeedback) fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('/session happy path', () => {
  it('runs context → three exercises → summary and records everything', async () => {
    render(<App />);

    // Context screen first, because the topic is new.
    expect(await screen.findByText('Regular -ar verbs')).toBeInTheDocument();
    expect(screen.getByText('Module 1 — Basics')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /key words & phrases/i }));
    expect(screen.getByText('to speak')).toBeInTheDocument();
    await startSession();

    expect(await screen.findByText('1/3')).toBeInTheDocument();
    // Check stays disabled until there is an answer.
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    await answerCurrent('option', ['trabalho']);

    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await answerCurrent('tiles', ['Eu', 'falo', 'inglês.']);

    // Third exercise is about_me: free answer, then a self-grade.
    expect(await screen.findByText('3/3')).toBeInTheDocument();
    expect(screen.getByText('Onde é que moras?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Moro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add em' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/did you get it right\?/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Moro em Lisboa.');
    expect(screen.getByRole('dialog')).toHaveTextContent('numa · aldeia · perto');
    fireEvent.click(screen.getByRole('button', { name: 'Mostly' }));

    // Summary.
    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 correct')).toBeInTheDocument();
    expect(screen.getByText('New material')).toBeInTheDocument();
    expect(screen.queryByText('Interrupted')).not.toBeInTheDocument();

    await waitFor(async () => expect(await db.attempts.count()).toBe(3));
    const attempts = await db.attempts.toArray();
    expect(attempts.every((row) => row.correct && row.mode === 'tiles')).toBe(true);
    // "Mostly" counts as correct and is flagged as self-graded.
    const selfGraded = attempts.find((row) => row.exerciseId === 't1-e3');
    expect(selfGraded).toMatchObject({ correct: true, selfGraded: true });
    // Self-graded answers carry no diacritics verdict at all.
    expect(selfGraded && 'diacriticsOk' in selfGraded).toBe(false);

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      programId: 'pt-PT-A1',
      completed: 3,
      correct: 3,
      plannedLength: 3,
      interrupted: false,
    });

    const progress = await db.topicProgress.get('t1');
    expect(progress).toMatchObject({ status: 'learning', failedReviewsInARow: 0 });
    expect(progress?.seenExerciseIds).toHaveLength(3);
    expect(progress?.history).toEqual([expect.objectContaining({ correct: 3, total: 3 })]);

    // The in-progress snapshot is gone once the summary is reached.
    expect(await readActiveSession()).toBeNull();
  });

  it('records only answered items when the learner stops mid-session', async () => {
    render(<App />);
    await startSession();
    await answerCurrent('option', ['trabalho']);
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());

    fireEvent.click(await screen.findByRole('button', { name: /stop session/i }));
    fireEvent.click(await screen.findByRole('button', { name: /stop and save/i }));

    expect(await screen.findByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 correct')).toBeInTheDocument();

    await waitFor(async () => expect(await db.attempts.count()).toBe(1));
    const sessions = await db.sessions.toArray();
    expect(sessions[0]).toMatchObject({ completed: 1, interrupted: true });
  });

  it('shows a wrong answer with the correct one', async () => {
    render(<App />);
    await startSession();
    fireEvent.click(await screen.findByRole('radio', { name: 'trabalhas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/not quite/i)).toBeInTheDocument();
    const sheet = screen.getByRole('dialog');
    // The learner's answer (struck through) next to the correct one.
    expect(sheet).toHaveTextContent('trabalhas');
    expect(sheet).toHaveTextContent('work → trabalho');
    expect(sheet).toHaveTextContent('Because of the ending.');

    await waitFor(async () => expect((await db.attempts.toArray())[0]?.correct).toBe(false));
    await waitFor(async () =>
      expect((await db.topicProgress.get('t1'))?.seenExerciseIds).toEqual(['t1-e1'])
    );
  });

  it('resumes a persisted session from the Learn screen', async () => {
    const first = render(<App />);
    await startSession();
    await answerCurrent('option', ['trabalho']);
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.index).toBe(1));
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());
    first.unmount();

    window.location.hash = '#/';
    const second = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    // Straight back to the second exercise, with the first answer still counted.
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await answerCurrent('tiles', ['Eu', 'falo', 'inglês.']);
    expect(await screen.findByText('3/3')).toBeInTheDocument();
    expect(screen.getByText('Onde é que moras?')).toBeInTheDocument();
    second.unmount();
  });

  it('offers to discard an unfinished session', async () => {
    render(<App />);
    await startSession();
    await answerCurrent('option', ['trabalho']);
    await waitFor(async () => expect(await readActiveSession()).not.toBeNull());
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());

    window.location.hash = '#/';
    expect(await screen.findByText(/resume session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect(await readActiveSession()).toBeNull());
    expect(await screen.findByText(/unfinished session discarded/i)).toBeInTheDocument();
  });
});
