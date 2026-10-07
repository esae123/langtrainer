import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { db } from '../../db/db';
import { DAY_MS } from '../../engine/progress';
import { makeProgress } from '../../test/fixtures';

vi.mock('../../content/programs', async () => {
  const { makeStandardProgram } = await import('../../test/fixtures');
  return { programs: [makeStandardProgram()] };
});

afterEach(async () => {
  window.location.hash = '';
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function seed() {
  const now = Date.now();
  await db.sessions.bulkPut([
    {
      id: 's1',
      programId: 'pt-PT-A1',
      startedAt: now - 60_000,
      plannedLength: 6,
      completed: 6,
      correct: 2,
      interrupted: false,
      kind: 'regular',
    },
    {
      id: 's2',
      programId: 'pt-PT-A1',
      startedAt: now - 30_000,
      plannedLength: 4,
      completed: 4,
      correct: 4,
      interrupted: false,
      kind: 'practice',
    },
  ]);
  await db.attempts.bulkPut(
    Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      sessionId: 's1',
      exerciseId: `t1-e${i + 1}`,
      topicId: 't1',
      mode: 'tiles' as const,
      correct: i < 2,
      answer: '',
      at: now - 60_000 + i,
    }))
  );
  await db.topicProgress.bulkPut([
    makeProgress('t1', {
      status: 'learning',
      seenExerciseIds: ['t1-e1', 't1-e2', 't1-e3', 't1-e4', 't1-e5', 't1-e6'],
    }),
    makeProgress('t2', { status: 'review', nextReviewAt: now - DAY_MS }),
  ]);
}

describe('Progress screen', () => {
  it('shows a friendly empty state with a start button for a fresh course', async () => {
    window.location.hash = '#/progress';
    render(<App />);
    expect(await screen.findByText(/nothing to show yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
  });

  it('shows tiles, needs work, topics and recent sessions', async () => {
    await seed();
    window.location.hash = '#/progress';
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.getByText('best: 1')).toBeInTheDocument();
    // 2 of 6 regular answers correct; the practice run is left out.
    expect(screen.getByText('Accuracy').parentElement).toHaveTextContent('33%');

    const needsWork = screen.getByText('Needs work').closest('section')!;
    expect(within(needsWork).getByText('Topic t1')).toBeInTheDocument();

    // The upcoming-reviews card is gone (docs/stage-6-spec.md §2).
    expect(screen.queryByText('Upcoming reviews')).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();

    expect(screen.getByText('Module 2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '6 of 40 exercises seen' })).toBeInTheDocument();

    const recent = screen.getByText('Recent sessions').closest('section')!;
    expect(within(recent).getByText('Practice')).toBeInTheDocument();
    expect(within(recent).getByText('4/4')).toBeInTheDocument();
    expect(within(recent).getByText('2/6')).toBeInTheDocument();
  });
});
