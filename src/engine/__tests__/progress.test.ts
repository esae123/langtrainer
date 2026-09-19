import { describe, expect, it } from 'vitest';
import { makeProgress } from '../../test/fixtures';
import {
  applyAttempt,
  COMPLETION_THRESHOLD,
  DAY_MS,
  emptyTopicProgress,
  finishSession,
  type SessionAttemptSummary,
} from '../progress';
import type { TopicProgress } from '../types';

const NOW = 1_700_000_000_000;

function reviewAttempts(topicId: string, results: boolean[]): SessionAttemptSummary[] {
  return results.map((correct) => ({ topicId, block: 'review' as const, correct }));
}

describe('applyAttempt', () => {
  it('moves new -> learning and records the exercise as seen', () => {
    const row = applyAttempt(emptyTopicProgress('t1', 'p'), 'e1', true, NOW);
    expect(row).toMatchObject({ status: 'learning', seenExerciseIds: ['e1'], reviewStage: 0 });
  });

  it('keeps seenExerciseIds a set', () => {
    let row = applyAttempt(emptyTopicProgress('t1', 'p'), 'e1', true, NOW);
    row = applyAttempt(row, 'e1', false, NOW + 1);
    expect(row.seenExerciseIds).toEqual(['e1']);
  });

  it('completes the topic at 20 distinct exercises', () => {
    let row = emptyTopicProgress('t1', 'p');
    for (let i = 1; i < COMPLETION_THRESHOLD; i += 1) {
      row = applyAttempt(row, `e${i}`, true, NOW);
      expect(row.status).toBe('learning');
    }
    row = applyAttempt(row, `e${COMPLETION_THRESHOLD}`, true, NOW);
    expect(row).toMatchObject({
      status: 'review',
      reviewStage: 1,
      firstCompletedAt: NOW,
      nextReviewAt: NOW + 7 * DAY_MS,
    });
  });

  it('does not re-complete a topic already in review', () => {
    const row = makeProgress('t1', {
      status: 'review',
      reviewStage: 2,
      seenExerciseIds: Array.from({ length: 25 }, (_, i) => `e${i}`),
      firstCompletedAt: 1,
      nextReviewAt: 5,
    });
    const next = applyAttempt(row, 'new-one', true, NOW);
    expect(next).toMatchObject({
      status: 'review',
      reviewStage: 2,
      firstCompletedAt: 1,
      nextReviewAt: 5,
    });
  });
});

describe('finishSession', () => {
  it('appends one history entry per touched topic', () => {
    const rows = [
      makeProgress('t1', { status: 'learning' }),
      makeProgress('t2', { status: 'learning' }),
    ];
    const attempts: SessionAttemptSummary[] = [
      { topicId: 't1', block: 'new', correct: true },
      { topicId: 't1', block: 'new', correct: false },
      { topicId: 't2', block: 'phrases', correct: true },
    ];
    const { rows: updated, outcomes } = finishSession(rows, attempts, NOW);
    expect(updated[0].history).toEqual([{ at: NOW, correct: 1, total: 2 }]);
    expect(updated[1].history).toEqual([{ at: NOW, correct: 1, total: 1 }]);
    expect(outcomes.map((o) => o.topicId)).toEqual(['t1', 't2']);
    expect(outcomes[0]).toMatchObject({ correct: 1, total: 2, reviewed: false, srsApplied: false });
  });

  it('sets lastReviewedAt whenever a topic was in the review block', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 1, nextReviewAt: 1 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', [true]), NOW);
    expect(updated[0].lastReviewedAt).toBe(NOW);
  });

  it('does not change the SRS stage with fewer than 3 review attempts', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 1, nextReviewAt: 1 })];
    const { rows: updated, outcomes } = finishSession(
      rows,
      reviewAttempts('t1', [true, true]),
      NOW
    );
    expect(updated[0]).toMatchObject({ status: 'review', reviewStage: 1, nextReviewAt: 1 });
    expect(outcomes[0].srsApplied).toBe(false);
  });

  it('ignores attempts made outside the review block for the SRS decision', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 1, nextReviewAt: 1 })];
    const attempts: SessionAttemptSummary[] = [
      ...reviewAttempts('t1', [true, true, true]),
      { topicId: 't1', block: 'new', correct: false },
    ];
    const { rows: updated } = finishSession(rows, attempts, NOW);
    expect(updated[0]).toMatchObject({ reviewStage: 2, nextReviewAt: NOW + 30 * DAY_MS });
  });

  const perfect = [true, true, true];
  const failed = [true, false, true];

  it('review stage 1 at 100% -> stage 2 in 30 days', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 1 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', perfect), NOW);
    expect(updated[0]).toMatchObject({
      status: 'review',
      reviewStage: 2,
      nextReviewAt: NOW + 30 * DAY_MS,
      failedReviewsInARow: 0,
    });
  });

  it('review stage 2 at 100% -> stage 3 in 60 days', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 2 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', perfect), NOW);
    expect(updated[0]).toMatchObject({ reviewStage: 3, nextReviewAt: NOW + 60 * DAY_MS });
  });

  it('review stage 3 at 100% -> mastered with no next review', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 3, nextReviewAt: 5 })];
    const { rows: updated, outcomes } = finishSession(rows, reviewAttempts('t1', perfect), NOW);
    expect(updated[0]).toMatchObject({ status: 'mastered', nextReviewAt: undefined });
    expect(outcomes[0].before.status).toBe('review');
    expect(outcomes[0].after.status).toBe('mastered');
  });

  it('a failed review keeps the stage and retries in 7 days, counting the failure', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 2, failedReviewsInARow: 0 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', failed), NOW);
    expect(updated[0]).toMatchObject({
      status: 'review',
      reviewStage: 2,
      nextReviewAt: NOW + 7 * DAY_MS,
      failedReviewsInARow: 1,
    });
  });

  it('a perfect review resets failedReviewsInARow', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 1, failedReviewsInARow: 2 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', perfect), NOW);
    expect(updated[0].failedReviewsInARow).toBe(0);
  });

  it('the third failed review in a row at stage 3 drops to maintenance in 60 days', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 3, failedReviewsInARow: 2 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', failed), NOW);
    expect(updated[0]).toMatchObject({
      status: 'maintenance',
      reviewStage: 3,
      failedReviewsInARow: 3,
      nextReviewAt: NOW + 60 * DAY_MS,
    });
  });

  it('two failures at stage 3 are not yet maintenance', () => {
    const rows = [makeProgress('t1', { status: 'review', reviewStage: 3, failedReviewsInARow: 1 })];
    const { rows: updated } = finishSession(rows, reviewAttempts('t1', failed), NOW);
    expect(updated[0]).toMatchObject({ status: 'review', nextReviewAt: NOW + 7 * DAY_MS });
  });

  it('maintenance at 100% -> mastered, below 100% -> another 60 days', () => {
    const good = finishSession(
      [makeProgress('t1', { status: 'maintenance', reviewStage: 3 })],
      reviewAttempts('t1', perfect),
      NOW
    );
    expect(good.rows[0]).toMatchObject({ status: 'mastered', nextReviewAt: undefined });

    const bad = finishSession(
      [makeProgress('t1', { status: 'maintenance', reviewStage: 3 })],
      reviewAttempts('t1', failed),
      NOW
    );
    expect(bad.rows[0]).toMatchObject({ status: 'maintenance', nextReviewAt: NOW + 60 * DAY_MS });
  });

  it('leaves untouched rows alone and never mutates its input', () => {
    const original: TopicProgress = makeProgress('t1', { status: 'review', reviewStage: 1 });
    const untouched = makeProgress('t2', { status: 'learning' });
    const { rows: updated } = finishSession(
      [original, untouched],
      reviewAttempts('t1', perfect),
      NOW
    );
    expect(original.reviewStage).toBe(1);
    expect(original.history).toHaveLength(0);
    expect(updated[1]).toBe(untouched);
  });
});
