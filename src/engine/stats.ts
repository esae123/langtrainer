// Minimal statistics for the Progress screen (docs/stage-5-spec.md, Part A). Pure: no
// React, no Dexie; rows and `now` are passed in. The row shapes below are the subset of
// `SessionRow` / `AttemptRow` (src/db/db.ts) the statistics need, declared structurally
// so the engine does not import the database module.
import type { Program } from '../content/types';
import { DAY_MS } from './progress';
import type { TopicProgress, TopicStatus } from './types';

export interface StatsSession {
  id: string;
  startedAt: number;
  plannedLength: number;
  completed: number;
  correct: number;
  interrupted: boolean;
  kind?: 'regular' | 'practice';
}

export interface StatsAttempt {
  topicId: string;
  exerciseId: string;
  correct: boolean;
  at: number;
  practice?: boolean;
}

const isRegularSession = (session: StatsSession) => session.kind !== 'practice';
const isRegularAttempt = (attempt: StatsAttempt) => attempt.practice !== true;

/**
 * Local calendar day number of a timestamp. With an explicit offset (minutes, same sign
 * as `Date#getTimezoneOffset`: positive west of UTC) that offset is used for every
 * timestamp; without one, the runtime's local offset at that moment (so DST is honoured).
 */
function dayIndex(ms: number, timeZoneOffsetMinutes?: number): number {
  const offset = timeZoneOffsetMinutes ?? new Date(ms).getTimezoneOffset();
  return Math.floor((ms - offset * 60_000) / DAY_MS);
}

export interface Streaks {
  current: number;
  best: number;
}

/**
 * Consecutive local calendar days with at least one regular session that has at least
 * one answered item. `current` counts back from today, or from yesterday when nothing
 * has been done today yet (so the streak is not "lost" until a full day is missed).
 */
export function streaks(
  sessions: readonly StatsSession[],
  now: number,
  timeZoneOffsetMinutes?: number
): Streaks {
  const days = new Set(
    sessions
      .filter((session) => isRegularSession(session) && session.completed > 0)
      .map((session) => dayIndex(session.startedAt, timeZoneOffsetMinutes))
  );
  if (days.size === 0) return { current: 0, best: 0 };

  const sorted = [...days].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const today = dayIndex(now, timeZoneOffsetMinutes);
  let cursor = days.has(today) ? today : today - 1;
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor -= 1;
  }
  return { current, best };
}

export interface Overview {
  /** Regular sessions with at least one answered item. */
  sessions: number;
  answered: number;
  correct: number;
  /** correct / answered, 0 when nothing has been answered. */
  accuracy: number;
}

export function overview(
  sessions: readonly StatsSession[],
  attempts: readonly StatsAttempt[]
): Overview {
  const regular = attempts.filter(isRegularAttempt);
  const answered = regular.length;
  const correct = regular.filter((attempt) => attempt.correct).length;
  return {
    sessions: sessions.filter((session) => isRegularSession(session) && session.completed > 0)
      .length,
    answered,
    correct,
    accuracy: answered === 0 ? 0 : correct / answered,
  };
}

export interface TopicStat {
  topicId: string;
  title: string;
  status: TopicStatus;
  /** Distinct exercises answered in regular sessions (capped at `total`). */
  seen: number;
  /** Exercises in the topic. */
  total: number;
  /** correct / attempts over regular attempts; `null` with no attempt yet. */
  accuracy: number | null;
  attempts: number;
  lastPractisedAt?: number;
  nextReviewAt?: number;
}

export interface ModuleStats {
  moduleId: string;
  title: string;
  topics: TopicStat[];
}

/** Per-topic statistics in program order, grouped by module. */
export function topicStats(
  program: Program,
  progressRows: readonly TopicProgress[],
  attempts: readonly StatsAttempt[]
): ModuleStats[] {
  const rows = new Map(progressRows.map((row) => [row.topicId, row]));
  const byTopic = new Map<string, StatsAttempt[]>();
  for (const attempt of attempts) {
    if (!isRegularAttempt(attempt)) continue;
    const list = byTopic.get(attempt.topicId);
    if (list) list.push(attempt);
    else byTopic.set(attempt.topicId, [attempt]);
  }

  return program.modules.map((module) => ({
    moduleId: module.id,
    title: module.title,
    topics: module.topics.map((topic) => {
      const row = rows.get(topic.id);
      const list = byTopic.get(topic.id) ?? [];
      const correct = list.filter((attempt) => attempt.correct).length;
      const exerciseIds = new Set(topic.exercises.map((exercise) => exercise.id));
      const seen = new Set((row?.seenExerciseIds ?? []).filter((id) => exerciseIds.has(id))).size;
      const stat: TopicStat = {
        topicId: topic.id,
        title: topic.title,
        status: row?.status ?? 'new',
        seen,
        total: topic.exercises.length,
        accuracy: list.length === 0 ? null : correct / list.length,
        attempts: list.length,
      };
      if (list.length > 0) stat.lastPractisedAt = Math.max(...list.map((attempt) => attempt.at));
      if (row?.nextReviewAt !== undefined) stat.nextReviewAt = row.nextReviewAt;
      return stat;
    }),
  }));
}

/** Topics need at least this many attempts before their accuracy is judged. */
export const NEEDS_WORK_MIN_ATTEMPTS = 5;
/** Accuracy below this marks a topic as needing work. */
export const NEEDS_WORK_BELOW = 0.8;
const NEEDS_WORK_LIMIT = 3;

/** Up to three topics with ≥ 5 attempts and accuracy below 80%, weakest first. */
export function needsWork(modules: readonly ModuleStats[]): TopicStat[] {
  return modules
    .flatMap((module) => module.topics)
    .filter(
      (topic) =>
        topic.attempts >= NEEDS_WORK_MIN_ATTEMPTS &&
        topic.accuracy !== null &&
        topic.accuracy < NEEDS_WORK_BELOW
    )
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
    .slice(0, NEEDS_WORK_LIMIT);
}

export interface UpcomingReview {
  topicId: string;
  nextReviewAt: number;
  overdue: boolean;
}

const UPCOMING_LIMIT = 5;

/** The next five scheduled reviews by `nextReviewAt`; overdue ones come first and are flagged. */
export function upcomingReviews(
  progressRows: readonly TopicProgress[],
  now: number
): UpcomingReview[] {
  return progressRows
    .filter(
      (row): row is TopicProgress & { nextReviewAt: number } =>
        (row.status === 'review' || row.status === 'maintenance') && row.nextReviewAt !== undefined
    )
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
    .slice(0, UPCOMING_LIMIT)
    .map((row) => ({
      topicId: row.topicId,
      nextReviewAt: row.nextReviewAt,
      overdue: row.nextReviewAt <= now,
    }));
}

export interface RecentSession {
  id: string;
  startedAt: number;
  completed: number;
  correct: number;
  planned: number;
  kind: 'regular' | 'practice';
  interrupted: boolean;
}

/** The newest `n` sessions, practice runs included (tagged by `kind`). */
export function recentSessions(sessions: readonly StatsSession[], n = 10): RecentSession[] {
  return [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, n)
    .map((session) => ({
      id: session.id,
      startedAt: session.startedAt,
      completed: session.completed,
      correct: session.correct,
      planned: session.plannedLength,
      kind: session.kind ?? 'regular',
      interrupted: session.interrupted,
    }));
}
