// Applying results to topic progress + SRS transitions (docs/stage-3-spec.md §4).
import type { BlockKind } from './plan';
import type { TopicProgress, TopicStatus } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Distinct exercises answered before a topic counts as completed for the first time. */
export const COMPLETION_THRESHOLD = 20;
/** Minimum attempts on a topic in one session before its review moves the SRS stage. */
export const MIN_REVIEW_ATTEMPTS = 3;
/** Failed reviews in a row at stage 3 before a topic drops to maintenance. */
export const MAINTENANCE_AFTER_FAILURES = 3;
/** Statuses a topic can only have after it has been completed once. */
const COMPLETED_STATUSES = new Set<TopicStatus>(['review', 'mastered', 'maintenance']);

export function emptyTopicProgress(topicId: string, programId: string): TopicProgress {
  return {
    topicId,
    programId,
    status: 'new',
    reviewStage: 0,
    failedReviewsInARow: 0,
    history: [],
    seenExerciseIds: [],
    wrongExerciseIds: [],
  };
}

function withoutWrong(row: TopicProgress, exerciseId: string): string[] {
  return (row.wrongExerciseIds ?? []).filter((id) => id !== exerciseId);
}

/**
 * Records one answered exercise: marks it seen, moves `new → learning`, applies the
 * completion rule (≥ 20 distinct exercises → `review`, stage 1, next review in 7 days)
 * and keeps `wrongExerciseIds` up to date (added on a wrong answer, removed on a right
 * one) so planning can offer past mistakes first.
 *
 * `practice: true` (docs/stage-3b-spec.md §4) makes the attempt inert: nothing is marked
 * seen, no status or SRS field moves. The only effect is that answering a past mistake
 * correctly drops it from `wrongExerciseIds`.
 */
export function applyAttempt(
  row: TopicProgress,
  exerciseId: string,
  correct: boolean,
  now: number,
  practice = false
): TopicProgress {
  if (practice) {
    if (!correct) return row;
    const wrong = withoutWrong(row, exerciseId);
    return wrong.length === (row.wrongExerciseIds?.length ?? 0)
      ? row
      : { ...row, wrongExerciseIds: wrong };
  }

  const seen = row.seenExerciseIds.includes(exerciseId)
    ? row.seenExerciseIds
    : [...row.seenExerciseIds, exerciseId];
  const wrongIds = withoutWrong(row, exerciseId);
  const next: TopicProgress = {
    ...row,
    seenExerciseIds: seen,
    wrongExerciseIds: correct ? wrongIds : [...wrongIds, exerciseId],
  };

  if (next.status === 'new') next.status = 'learning';
  if (next.status === 'learning' && seen.length >= COMPLETION_THRESHOLD) {
    next.status = 'review';
    next.reviewStage = 1;
    next.firstCompletedAt = now;
    next.nextReviewAt = now + 7 * DAY_MS;
  }
  return next;
}

export interface SessionAttemptSummary {
  topicId: string;
  block: BlockKind;
  correct: boolean;
}

export interface TopicSnapshot {
  status: TopicStatus;
  reviewStage: 0 | 1 | 2 | 3;
  nextReviewAt?: number;
  /** Lets the summary tell a first completion (applied per attempt) from a review. */
  firstCompletedAt?: number;
}

export interface TopicOutcome {
  topicId: string;
  before: TopicSnapshot;
  after: TopicSnapshot;
  correct: number;
  total: number;
  /** The topic appeared in this session's review block. */
  reviewed: boolean;
  /** Its SRS stage/status was re-evaluated (reviewed with enough attempts). */
  srsApplied: boolean;
}

export interface FinishSessionResult {
  rows: TopicProgress[];
  outcomes: TopicOutcome[];
}

function snapshot(row: TopicProgress): TopicSnapshot {
  return {
    status: row.status,
    reviewStage: row.reviewStage,
    nextReviewAt: row.nextReviewAt,
    firstCompletedAt: row.firstCompletedAt,
  };
}

function applySrs(row: TopicProgress, perfect: boolean, now: number): void {
  if (row.status === 'review') {
    if (perfect) {
      row.failedReviewsInARow = 0;
      if (row.reviewStage <= 1) {
        row.reviewStage = 2;
        row.nextReviewAt = now + 30 * DAY_MS;
      } else if (row.reviewStage === 2) {
        row.reviewStage = 3;
        row.nextReviewAt = now + 60 * DAY_MS;
      } else {
        row.status = 'mastered';
        row.nextReviewAt = undefined;
      }
      return;
    }
    row.failedReviewsInARow += 1;
    row.nextReviewAt = now + 7 * DAY_MS;
    if (row.reviewStage === 3 && row.failedReviewsInARow >= MAINTENANCE_AFTER_FAILURES) {
      row.status = 'maintenance';
      row.nextReviewAt = now + 60 * DAY_MS;
    }
    return;
  }

  if (row.status === 'maintenance') {
    if (perfect) {
      row.status = 'mastered';
      row.nextReviewAt = undefined;
      row.failedReviewsInARow = 0;
    } else {
      // `failedReviewsInARow` only drives the stage-3 → maintenance rule, and a topic
      // already in maintenance has nowhere further to drop, so it is left alone.
      row.nextReviewAt = now + 60 * DAY_MS;
    }
  }
}

/**
 * End-of-session bookkeeping: one history entry per touched topic, `lastReviewedAt` for
 * topics that were already completed and appeared in the review block, and SRS
 * transitions for those topics when they got at least three review-block attempts.
 *
 * Topics completed *during* this session, and topics still `learning`, are skipped:
 * when nothing is due, `plan.ts` fills the review block from the current topic, so a
 * brand-new stage 1 / +7d schedule (just set by `applyAttempt`) must not immediately
 * jump to stage 2 / +30d. `sessionStartedAt` is what tells the two apart.
 */
export function finishSession(
  rows: TopicProgress[],
  sessionAttempts: SessionAttemptSummary[],
  now: number,
  sessionStartedAt = now
): FinishSessionResult {
  const byId = new Map(rows.map((row) => [row.topicId, row]));
  const touchedOrder: string[] = [];
  for (const attempt of sessionAttempts) {
    if (!touchedOrder.includes(attempt.topicId)) touchedOrder.push(attempt.topicId);
  }

  const outcomes: TopicOutcome[] = [];
  const updated: TopicProgress[] = [];

  for (const topicId of touchedOrder) {
    const existing = byId.get(topicId);
    if (!existing) continue;
    const before = snapshot(existing);
    const row: TopicProgress = { ...existing, history: [...existing.history] };

    const all = sessionAttempts.filter((a) => a.topicId === topicId);
    const correct = all.filter((a) => a.correct).length;
    row.history.push({ at: now, correct, total: all.length });

    const reviewAttempts = all.filter((a) => a.block === 'review');
    const reviewed = reviewAttempts.length > 0;
    // Only a topic that was already completed when the session started can be reviewed.
    // `applyAttempt` may have completed this one a moment ago (its brand-new stage 1 /
    // +7d must stand), and a `learning` topic only ever gets review-block items because
    // planning falls back to the current topic when nothing is due.
    const completedThisSession =
      existing.firstCompletedAt !== undefined && existing.firstCompletedAt >= sessionStartedAt;
    const wasCompleted = !completedThisSession && COMPLETED_STATUSES.has(existing.status);
    if (reviewed && wasCompleted) row.lastReviewedAt = now;

    const srsApplied = wasCompleted && reviewAttempts.length >= MIN_REVIEW_ATTEMPTS;
    if (srsApplied) {
      applySrs(
        row,
        reviewAttempts.every((a) => a.correct),
        now
      );
    }

    updated.push(row);
    outcomes.push({
      topicId,
      before,
      after: snapshot(row),
      correct,
      total: all.length,
      reviewed,
      srsApplied,
    });
  }

  const updatedById = new Map(updated.map((row) => [row.topicId, row]));
  return {
    rows: rows.map((row) => updatedById.get(row.topicId) ?? row),
    outcomes,
  };
}
