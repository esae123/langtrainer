import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  return { programs: [program] };
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
  // Unmount before clearing: a still-mounted session would re-save its snapshot, and the
  // next test's plain /session would then resume it.
  cleanup();
  window.location.hash = '';
  await Promise.all(db.tables.map((table) => table.clear()));
});

/**
 * Every flow runs under StrictMode, which double-invokes effects (mount → cleanup →
 * mount) exactly like `npm run dev`: the session bootstrap has to survive that instead
 * of leaving the screen on "Preparing your session…".
 */
function renderApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

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
    renderApp();

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
    await answerCurrent('tiles', ['Eu', 'falo', 'inglês']);

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
    expect(screen.getByText('Excellent — keep this pace.')).toBeInTheDocument();
    expect(screen.getByText('New material')).toBeInTheDocument();
    expect(screen.queryByText('Interrupted')).not.toBeInTheDocument();
    // Nothing was wrong, so only "Repeat session" is offered as practice.
    expect(screen.queryByRole('button', { name: 'Retry mistakes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repeat session' })).toBeInTheDocument();

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
    renderApp();
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
    renderApp();
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
    const first = renderApp();
    await startSession();
    await answerCurrent('option', ['trabalho']);
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.index).toBe(1));
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());
    first.unmount();

    window.location.hash = '#/';
    const second = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    // Straight back to the second exercise, with the first answer still counted.
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await answerCurrent('tiles', ['Eu', 'falo', 'inglês']);
    expect(await screen.findByText('3/3')).toBeInTheDocument();
    expect(screen.getByText('Onde é que moras?')).toBeInTheDocument();
    second.unmount();
  });

  it('retries the mistakes in a practice session without touching progress', async () => {
    renderApp();
    await startSession();

    // First exercise wrong, the other two right.
    fireEvent.click(await screen.findByRole('radio', { name: 'trabalhas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/not quite/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await answerCurrent('tiles', ['Eu', 'falo', 'inglês']);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Moro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));

    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    await waitFor(async () => expect((await db.topicProgress.get('t1'))?.history).toHaveLength(1));
    const before = await db.topicProgress.get('t1');
    expect(before?.wrongExerciseIds).toEqual(['t1-e1']);

    // Retry mistakes -> a practice session with only the wrong exercise, no context.
    expect(screen.getByRole('button', { name: 'Repeat session' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry mistakes' }));
    expect(await screen.findByText('Practice')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start exercises/i })).not.toBeInTheDocument();
    await answerCurrent('option', ['trabalho']);

    expect(await screen.findByText(/practice complete/i)).toBeInTheDocument();
    expect(screen.getByText('Fixed: 1 of 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Another session' })).not.toBeInTheDocument();

    await waitFor(async () => expect(await db.sessions.count()).toBe(2));
    const sessions = await db.sessions.toArray();
    expect(sessions.map((row) => row.kind).sort()).toEqual(['practice', 'regular']);
    const practiceSession = sessions.find((row) => row.kind === 'practice')!;
    const practiceAttempts = await db.attempts
      .where('sessionId')
      .equals(practiceSession.id)
      .toArray();
    expect(practiceAttempts).toHaveLength(1);
    expect(practiceAttempts[0]).toMatchObject({ exerciseId: 't1-e1', practice: true });

    // Progress is untouched, except that the fixed mistake is no longer prioritised.
    await waitFor(async () =>
      expect((await db.topicProgress.get('t1'))?.wrongExerciseIds).toEqual([])
    );
    const after = await db.topicProgress.get('t1');
    expect(after).toMatchObject({
      status: before!.status,
      reviewStage: before!.reviewStage,
      seenExerciseIds: before!.seenExerciseIds,
      history: before!.history,
    });
    expect(after?.nextReviewAt).toBe(before?.nextReviewAt);
  });

  it('offers to discard an unfinished session', async () => {
    renderApp();
    await startSession();
    await answerCurrent('option', ['trabalho']);
    await waitFor(async () => expect(await readActiveSession()).not.toBeNull());
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());

    window.location.hash = '#/';
    expect(await screen.findByText(/resume session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect(await readActiveSession()).toBeNull());
    expect(await screen.findByText(/unfinished session discarded/i)).toBeInTheDocument();
    // The answered item is not lost: the session is recorded as interrupted.
    const sessions = await db.sessions.toArray();
    expect(sessions).toEqual([expect.objectContaining({ completed: 1, interrupted: true })]);
    expect((await db.topicProgress.get('t1'))?.history).toHaveLength(1);
  });

  it('a plain /session resumes an unfinished session instead of overwriting it', async () => {
    const first = renderApp();
    await startSession();
    await answerCurrent('option', ['trabalho']);
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.index).toBe(1));
    const sessionId = (await readActiveSession())?.state.sessionId;
    first.unmount();

    // Android restores a killed PWA at its last URL: #/session, no resume=1.
    window.location.hash = '#/session';
    renderApp();
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start exercises/i })).not.toBeInTheDocument();
    expect((await readActiveSession())?.state.sessionId).toBe(sessionId);
    expect((await readActiveSession())?.state.responses).toHaveLength(1);
  });
});

describe('focus sessions (docs/stage-6-spec.md §4)', () => {
  /** Focus plans shuffle the unseen exercises, so answer whichever one is shown. */
  async function answerAllThree() {
    for (let i = 1; i <= 3; i += 1) {
      expect(await screen.findByText(`${i}/3`)).toBeInTheDocument();
      if (screen.queryByRole('radio', { name: 'trabalho' })) {
        await answerCurrent('option', ['trabalho']);
      } else if (screen.queryByRole('button', { name: 'Add Eu' })) {
        await answerCurrent('tiles', ['Eu', 'falo', 'inglês']);
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Add Moro' }));
        fireEvent.click(screen.getByRole('button', { name: 'Check' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
      }
    }
  }

  it('runs a focus session, keeps the SRS and offers Practise again', async () => {
    const nextReviewAt = Date.now() - 1000;
    await db.topicProgress.put({
      topicId: 't1',
      programId: 'pt-PT-A1',
      status: 'review',
      reviewStage: 2,
      firstCompletedAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
      nextReviewAt,
      failedReviewsInARow: 0,
      history: [],
      seenExerciseIds: [],
      wrongExerciseIds: [],
    });
    window.location.hash = '#/session?focus=t1';
    renderApp();

    // Context screen first, then the topic's exercises only.
    expect(await screen.findByText('Regular -ar verbs')).toBeInTheDocument();
    await startSession();
    expect(await screen.findByText('Focus · Regular -ar verbs')).toBeInTheDocument();
    await answerAllThree();

    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    expect(screen.getByText('Focus practice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Another session' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repeat session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    await waitFor(async () => expect((await db.topicProgress.get('t1'))?.history).toHaveLength(1));
    const row = await db.topicProgress.get('t1');
    expect(row).toMatchObject({ status: 'review', reviewStage: 2, nextReviewAt });
    expect(row?.lastReviewedAt).toBeUndefined();
    expect(row?.seenExerciseIds).toHaveLength(3);
    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: 'focus', completed: 3 });
    const attempts = await db.attempts.toArray();
    expect(attempts.every((a) => a.block === 'focus' && a.practice === undefined)).toBe(true);

    // Practise again: a new focus plan for the same topic.
    fireEvent.click(screen.getByRole('button', { name: 'Practise again' }));
    expect(await screen.findByRole('button', { name: /start exercises/i })).toBeInTheDocument();
    await startSession();
    expect(await screen.findByText('Focus · Regular -ar verbs')).toBeInTheDocument();
  });

  it('asks before discarding an unfinished session', async () => {
    renderApp();
    await startSession();
    await answerCurrent('option', ['trabalho']);
    await waitFor(async () => expect(await readActiveSession()).not.toBeNull());
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());

    window.location.hash = '#/library/t1';
    fireEvent.click(await screen.findByRole('button', { name: 'Practise this topic' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'You have an unfinished session. Discard it and practise «Regular -ar verbs»?'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.hash).toBe('#/library/t1');
    expect(await readActiveSession()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Practise this topic' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and start' }));
    await waitFor(() => expect(window.location.hash).toBe('#/session?focus=t1'));
    expect(await screen.findByRole('button', { name: /start exercises/i })).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.plan.kind).toBe('focus'));
    expect((await readActiveSession())?.state.responses).toHaveLength(0);
    // The discarded session had an answer, so it was recorded like a stopped one.
    const sessions = await db.sessions.toArray();
    expect(sessions).toEqual([
      expect.objectContaining({ kind: 'regular', completed: 1, interrupted: true }),
    ]);
    expect((await db.topicProgress.get('t1'))?.history).toHaveLength(1);
  });

  it('reopening /session?focus=X resumes the unfinished focus session on X', async () => {
    window.location.hash = '#/session?focus=t1';
    const first = renderApp();
    await startSession();
    expect(await screen.findByText('1/3')).toBeInTheDocument();
    if (screen.queryByRole('radio', { name: 'trabalho' })) {
      await answerCurrent('option', ['trabalho']);
    } else if (screen.queryByRole('button', { name: 'Add Eu' })) {
      await answerCurrent('tiles', ['Eu', 'falo', 'inglês']);
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Add Moro' }));
      fireEvent.click(screen.getByRole('button', { name: 'Check' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    }
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.index).toBe(1));
    const sessionId = (await readActiveSession())?.state.sessionId;
    first.unmount();

    renderApp();
    expect(await screen.findByText('2/3')).toBeInTheDocument();
    expect((await readActiveSession())?.state.sessionId).toBe(sessionId);
    expect((await readActiveSession())?.state.responses).toHaveLength(1);
  });

  it('a focus URL for another session records the old one as interrupted', async () => {
    const first = renderApp();
    await startSession();
    await answerCurrent('option', ['trabalho']);
    await waitFor(async () => expect((await readActiveSession())?.state.index).toBe(1));
    await waitFor(async () => expect(await db.topicProgress.get('t1')).toBeTruthy());
    first.unmount();

    // A regular snapshot does not match a focus URL: it is finalised, not overwritten.
    window.location.hash = '#/session?focus=t1';
    renderApp();
    expect(await screen.findByRole('button', { name: /start exercises/i })).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.plan.kind).toBe('focus'));
    const sessions = await db.sessions.toArray();
    expect(sessions).toEqual([
      expect.objectContaining({ kind: 'regular', completed: 1, interrupted: true }),
    ]);
  });

  it('Practise again after a resumed focus session starts another focus session', async () => {
    window.location.hash = '#/session?focus=t1';
    const first = renderApp();
    await startSession();
    expect(await screen.findByText('Focus · Regular -ar verbs')).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.phase).toBe('exercise'));
    first.unmount();

    window.location.hash = '#/session?resume=1';
    renderApp();
    await answerAllThree();
    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Practise again' }));
    await startSession();
    expect(await screen.findByText('Focus · Regular -ar verbs')).toBeInTheDocument();
    await waitFor(async () => expect((await readActiveSession())?.state.plan.kind).toBe('focus'));
  });

  it('starts straight away from the Library when nothing is unfinished', async () => {
    window.location.hash = '#/library/t1';
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Practise this topic' }));
    await waitFor(() => expect(window.location.hash).toBe('#/session?focus=t1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /start exercises/i })).toBeInTheDocument();
  });
});
