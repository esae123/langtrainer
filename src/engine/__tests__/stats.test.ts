import { describe, expect, it } from 'vitest';
import { makeProgress, makeStandardProgram } from '../../test/fixtures';
import { DAY_MS } from '../progress';
import {
  needsWork,
  overview,
  recentSessions,
  streaks,
  topicStats,
  type StatsAttempt,
  type StatsSession,
} from '../stats';

// 2023-11-14T22:13:20Z. Offsets below are fixed so the tests do not depend on the host TZ.
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

let seq = 0;
function session(startedAt: number, overrides: Partial<StatsSession> = {}): StatsSession {
  seq += 1;
  return {
    id: `s${seq}`,
    startedAt,
    plannedLength: 10,
    completed: 10,
    correct: 8,
    interrupted: false,
    kind: 'regular',
    ...overrides,
  };
}

function attempt(topicId: string, correct: boolean, overrides: Partial<StatsAttempt> = {}) {
  seq += 1;
  return { topicId, exerciseId: `${topicId}-e1`, correct, at: NOW, ...overrides };
}

describe('streaks', () => {
  it('is zero with no sessions', () => {
    expect(streaks([], NOW, 0)).toEqual({ current: 0, best: 0 });
  });

  it('counts consecutive days back from today', () => {
    const rows = [session(NOW - 2 * DAY_MS), session(NOW - DAY_MS), session(NOW - HOUR)];
    expect(streaks(rows, NOW, 0)).toEqual({ current: 3, best: 3 });
  });

  it('counts back from yesterday when nothing has been done today yet', () => {
    const rows = [session(NOW - 2 * DAY_MS), session(NOW - DAY_MS)];
    expect(streaks(rows, NOW, 0).current).toBe(2);
  });

  it('breaks on a missed day but keeps the best run', () => {
    const rows = [
      session(NOW - 10 * DAY_MS),
      session(NOW - 9 * DAY_MS),
      session(NOW - 8 * DAY_MS),
      session(NOW - 2 * DAY_MS),
    ];
    expect(streaks(rows, NOW, 0)).toEqual({ current: 0, best: 3 });
  });

  it('ignores practice sessions and sessions with nothing answered', () => {
    const rows = [
      session(NOW - HOUR, { kind: 'practice' }),
      session(NOW - DAY_MS, { completed: 0 }),
    ];
    expect(streaks(rows, NOW, 0)).toEqual({ current: 0, best: 0 });
  });

  it('several sessions on one day count once', () => {
    const rows = [session(NOW - HOUR), session(NOW - 2 * HOUR)];
    expect(streaks(rows, NOW, 0)).toEqual({ current: 1, best: 1 });
  });

  it('uses local calendar days, not UTC ones', () => {
    // NOW is 22:13 UTC. At UTC+3 (offset -180) that is already 01:13 the next day, so a
    // session at 20:00 UTC was "yesterday" locally and the streak is 1 (from yesterday).
    const rows = [session(NOW - 2 * HOUR - 13 * 60_000)];
    expect(streaks(rows, NOW, 0).current).toBe(1);
    expect(streaks(rows, NOW, -180)).toEqual({ current: 1, best: 1 });
    // Two sessions on the same UTC day fall on different local days at UTC+3.
    const split = [session(NOW - 22 * HOUR), session(NOW - HOUR)];
    expect(streaks(split, NOW, 0)).toEqual({ current: 1, best: 1 });
    expect(streaks(split, NOW, -180)).toEqual({ current: 2, best: 2 });
  });
});

describe('overview', () => {
  it('is all zero for a fresh course', () => {
    expect(overview([], [])).toEqual({ sessions: 0, answered: 0, correct: 0, accuracy: 0 });
  });

  it('counts regular sessions and attempts only', () => {
    const sessions = [
      session(NOW),
      session(NOW, { kind: 'practice' }),
      session(NOW, { completed: 0 }),
    ];
    const attempts = [
      attempt('t1', true),
      attempt('t1', false),
      attempt('t1', true),
      attempt('t1', true),
      attempt('t1', false, { practice: true }),
    ];
    expect(overview(sessions, attempts)).toEqual({
      sessions: 1,
      answered: 4,
      correct: 3,
      accuracy: 0.75,
    });
  });
});

describe('topicStats', () => {
  const program = makeStandardProgram();

  it('lists every topic in program order, grouped by module', () => {
    const stats = topicStats(program, [], []);
    expect(stats.map((m) => m.moduleId)).toEqual(['m1', 'm2']);
    expect(stats.map((m) => m.topics.map((t) => t.topicId))).toEqual([['t1', 't2'], ['t3']]);
    expect(stats[0].topics[0]).toEqual({
      topicId: 't1',
      title: 'Topic t1',
      status: 'new',
      seen: 0,
      total: 40,
      accuracy: null,
      attempts: 0,
    });
  });

  it('combines progress rows and regular attempts', () => {
    const rows = [
      makeProgress('t1', {
        status: 'review',
        seenExerciseIds: ['t1-e1', 't1-e2', 't1-e2', 'gone'],
        nextReviewAt: NOW + DAY_MS,
      }),
    ];
    const attempts = [
      attempt('t1', true, { at: NOW - 3 * DAY_MS }),
      attempt('t1', false, { at: NOW - DAY_MS }),
      attempt('t1', true, { at: NOW, practice: true }),
      attempt('t2', true),
    ];
    const t1 = topicStats(program, rows, attempts)[0].topics[0];
    expect(t1).toMatchObject({
      status: 'review',
      seen: 2,
      total: 40,
      accuracy: 0.5,
      attempts: 2,
      lastPractisedAt: NOW - DAY_MS,
      nextReviewAt: NOW + DAY_MS,
    });
  });
});

describe('needsWork', () => {
  const program = makeStandardProgram();
  const many = (topicId: string, right: number, wrong: number) => [
    ...Array.from({ length: right }, () => attempt(topicId, true)),
    ...Array.from({ length: wrong }, () => attempt(topicId, false)),
  ];

  it('picks topics with at least 5 attempts below 80%, weakest first', () => {
    const attempts = [
      ...many('t1', 3, 2), // 60%
      ...many('t2', 1, 3), // 25% but only 4 attempts
      ...many('t3', 1, 4), // 20%
    ];
    const result = needsWork(topicStats(program, [], attempts));
    expect(result.map((t) => t.topicId)).toEqual(['t3', 't1']);
  });

  it('leaves out topics at or above 80%', () => {
    expect(needsWork(topicStats(program, [], many('t1', 4, 1)))).toEqual([]);
  });

  it('returns at most three', () => {
    const big = makeStandardProgram();
    big.modules[1].topics.push(
      { ...big.modules[1].topics[0], id: 't4', title: 'Topic t4' },
      { ...big.modules[1].topics[0], id: 't5', title: 'Topic t5' }
    );
    const attempts = ['t1', 't2', 't3', 't4', 't5'].flatMap((id) => many(id, 0, 5));
    expect(needsWork(topicStats(big, [], attempts))).toHaveLength(3);
  });
});

describe('recentSessions', () => {
  it('returns the newest n, practice included and tagged', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      session(NOW - i * HOUR, { kind: i === 1 ? 'practice' : undefined, interrupted: i === 2 })
    );
    const result = recentSessions([...rows].reverse());
    expect(result).toHaveLength(10);
    expect(result[0].startedAt).toBe(NOW);
    expect(result[1]).toMatchObject({ kind: 'practice', interrupted: false });
    expect(result[2]).toMatchObject({ kind: 'regular', interrupted: true, planned: 10 });
    expect(recentSessions(rows, 3)).toHaveLength(3);
  });
});

describe('focus sessions (docs/stage-6-spec.md §4)', () => {
  it('count like regular sessions for streak, sessions, answered and accuracy', () => {
    const sessions = [
      session(NOW - DAY_MS, { kind: 'focus' }),
      session(NOW - HOUR, { kind: 'regular' }),
      session(NOW - 2 * HOUR, { kind: 'practice' }),
    ];
    expect(streaks(sessions, NOW, 0)).toEqual({ current: 2, best: 2 });
    expect(streaks([session(NOW - HOUR, { kind: 'focus' })], NOW, 0).current).toBe(1);

    const attempts = [
      attempt('t1', true),
      attempt('t1', false),
      attempt('t1', true, { practice: true }),
    ];
    expect(overview(sessions, attempts)).toEqual({
      sessions: 2,
      answered: 2,
      correct: 1,
      accuracy: 0.5,
    });
    expect(recentSessions(sessions).map((row) => row.kind)).toEqual([
      'regular',
      'practice',
      'focus',
    ]);
  });
});
