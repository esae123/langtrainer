import { describe, expect, it } from 'vitest';
import ptPtA1Json from '../../content/programs/pt-PT-A1.json';
import type { Program } from '../../content/types';
import { validateProgram } from '../../content/validateProgram';
import { INPUT_PRESETS, type SessionLength } from '../../settings/settings';
import { makeProgress, makeStandardProgram } from '../../test/fixtures';
import {
  buildExerciseHistory,
  withAttempt,
  type ExerciseHistory,
  type HistoryAttempt,
} from '../history';
import {
  exercisesByTopic,
  planFocus,
  planNextCycle,
  planSession,
  type PlanInput,
  type SessionPlan,
} from '../plan';
import { DAY_MS, applyAttempt, emptyTopicProgress, finishSession } from '../progress';
import { mulberry32 } from '../rng';
import type { TopicProgress } from '../types';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('buildExerciseHistory', () => {
  it('replays attempts in time order, whatever the input order', () => {
    const history = buildExerciseHistory([
      { exerciseId: 'a', correct: true, at: 300 },
      { exerciseId: 'a', correct: false, at: 100 },
      { exerciseId: 'a', correct: true, at: 200 },
    ]);
    expect(history.get('a')).toEqual({ lastSeenAt: 300, correctStreak: 2, attempts: 3 });
  });

  it('resets the streak on a wrong answer', () => {
    const history = buildExerciseHistory([
      { exerciseId: 'a', correct: true, at: 1 },
      { exerciseId: 'a', correct: true, at: 2 },
      { exerciseId: 'a', correct: false, at: 3 },
      { exerciseId: 'b', correct: true, at: 4 },
    ]);
    expect(history.get('a')).toEqual({ lastSeenAt: 3, correctStreak: 0, attempts: 3 });
    expect(history.get('b')).toEqual({ lastSeenAt: 4, correctStreak: 1, attempts: 1 });
    expect(history.has('c')).toBe(false);
  });

  it('counts practice attempts like any other', () => {
    const rows: (HistoryAttempt & { practice?: boolean })[] = [
      { exerciseId: 'a', correct: false, at: 1 },
      { exerciseId: 'a', correct: true, at: 2, practice: true },
      { exerciseId: 'a', correct: true, at: 3 },
    ];
    expect(buildExerciseHistory(rows).get('a')).toEqual({
      lastSeenAt: 3,
      correctStreak: 2,
      attempts: 3,
    });
  });

  it('withAttempt adds one attempt without touching the original map', () => {
    const before = buildExerciseHistory([{ exerciseId: 'a', correct: true, at: 1 }]);
    const after = withAttempt(before, { exerciseId: 'a', correct: true, at: 5 });
    expect(after.get('a')).toEqual({ lastSeenAt: 5, correctStreak: 2, attempts: 2 });
    expect(before.get('a')).toEqual({ lastSeenAt: 1, correctStreak: 1, attempts: 1 });
  });
});

// --- selection order with a history ------------------------------------------

const t1Ids = makeStandardProgram().modules[0].topics[0].exercises.map((e) => e.id);
const e = (n: number) => `t1-e${n}`;
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => e(from + i));

/**
 * All 40 exercises of t1 seen. e1/e2 wrong last; e3 secured, answered correctly
 * yesterday; e4..e20 secured, 26..10 days ago; e21..e30 seen once, 2 days ago (one
 * timestamp: ties); e34 seen once an hour ago; e31..e33 secured within the last 20
 * hours; e35..e40 seen but with no recorded attempt (oldest possible).
 */
function scenario(): { progress: TopicProgress[]; history: Map<string, ExerciseHistory> } {
  const history = new Map<string, ExerciseHistory>();
  const put = (id: string, ago: number, correctStreak: number) =>
    history.set(id, { lastSeenAt: NOW - ago, correctStreak, attempts: correctStreak + 1 });
  put(e(1), HOUR, 0);
  put(e(2), 5 * DAY_MS, 0);
  put(e(3), DAY_MS, 2);
  for (let n = 4; n <= 20; n += 1) put(e(n), (30 - n) * DAY_MS, 3);
  for (let n = 21; n <= 30; n += 1) put(e(n), 2 * DAY_MS, 1);
  put(e(31), 3 * HOUR, 5);
  put(e(32), 2 * HOUR, 5);
  put(e(33), HOUR, 5);
  put(e(34), HOUR, 1);
  const progress = [
    makeProgress('t1', {
      status: 'review',
      reviewStage: 1,
      firstCompletedAt: NOW - 40 * DAY_MS,
      nextReviewAt: NOW - DAY_MS,
      seenExerciseIds: t1Ids,
      wrongExerciseIds: [e(1), e(2)],
    }),
  ];
  return { progress, history };
}

function input(
  sessionLength: SessionLength,
  progress: TopicProgress[],
  history: ReadonlyMap<string, ExerciseHistory> | undefined,
  seed = 1
): PlanInput {
  return {
    program: makeStandardProgram(),
    progress,
    sessionLength,
    inputShares: INPUT_PRESETS.normal,
    now: NOW,
    rng: mulberry32(seed),
    id: 'h-1',
    history,
  };
}

/** Every item of an open focus session on t1, cycle after cycle until it is exhausted. */
function fullFocusOrder(seed: number): string[] {
  const { progress, history } = scenario();
  const focusInput = input('open', progress, history, seed);
  let plan = planFocus(focusInput, 't1');
  for (;;) {
    const next = planNextCycle(plan, focusInput);
    if (next.items.length === plan.items.length) break;
    plan = next;
  }
  return plan.items.map((item) => item.exercise.id);
}

describe('selection order with a history', () => {
  it('wrong → not yet secured → secured, least recently seen first, last 20 h at the end', () => {
    for (const seed of [1, 2, 3, 4]) {
      const ids = fullFocusOrder(seed);
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
      // Wrong: e2 (5 days ago) before e1 (an hour ago).
      expect(ids.slice(0, 2)).toEqual([e(2), e(1)]);
      // Not yet secured: no attempt recorded, then 2 days ago (ties), then an hour ago.
      expect(ids.slice(2, 8).sort()).toEqual(range(35, 40).sort());
      expect(ids.slice(8, 18).sort()).toEqual(range(21, 30).sort());
      expect(ids[18]).toBe(e(34));
      // Secured: 26 → 10 days ago, then yesterday's e3, then the last 20 hours.
      expect(ids.slice(19, 36)).toEqual(range(4, 20));
      expect(ids[36]).toBe(e(3));
      expect(ids.slice(37)).toEqual([e(31), e(32), e(33)]);
    }
  });

  it('breaks ties at random, deterministically under a fixed seed', () => {
    expect(fullFocusOrder(7)).toEqual(fullFocusOrder(7));
    const tieOrders = new Set([1, 2, 3, 4, 5].map((seed) => fullFocusOrder(seed).join(',')));
    expect(tieOrders.size).toBeGreaterThan(1);
  });

  it('review block: wrong first, yesterday’s secured exercise only after everything older', () => {
    const { progress, history } = scenario();
    // Length 30: 15 new (t2), 10 review (t1), 5 phrases.
    const p = planSession(input(30, progress, history));
    const review = p.items.filter((i) => i.block === 'review').map((i) => i.exercise.id);
    expect(review).toHaveLength(10);
    expect(review.slice(0, 2)).toEqual([e(2), e(1)]);
    expect(review.slice(2, 8).sort()).toEqual(range(35, 40).sort());
    expect(review.slice(8).every((id) => range(21, 30).includes(id))).toBe(true);
    expect(review).not.toContain(e(3));
  });

  it('review block: with every exercise secured, picks the least recently seen', () => {
    const history = new Map<string, ExerciseHistory>();
    // e1 is the oldest, e40 the newest; e3 was answered correctly yesterday.
    t1Ids.forEach((id, i) =>
      history.set(id, { lastSeenAt: NOW - (60 - i) * DAY_MS, correctStreak: 2, attempts: 2 })
    );
    history.set(e(3), { lastSeenAt: NOW - DAY_MS, correctStreak: 2, attempts: 2 });
    const progress = scenario().progress.map((row) => ({ ...row, wrongExerciseIds: [] }));
    const p = planSession(input(30, progress, history));
    const review = p.items.filter((i) => i.block === 'review').map((i) => i.exercise.id);
    expect(review).toEqual([e(1), e(2), ...range(4, 11)]);
  });

  it('phrases block: least recently seen first across the set', () => {
    const phraseIds = Array.from({ length: 12 }, (_, i) => `ps1-p${i + 1}`);
    const history = new Map<string, ExerciseHistory>();
    // p12 is the oldest, p1 the newest.
    phraseIds.forEach((id, i) =>
      history.set(id, { lastSeenAt: NOW - (i + 2) * DAY_MS, correctStreak: 3, attempts: 3 })
    );
    const progress = [makeProgress('ps1', { seenExerciseIds: phraseIds })];
    const p = planSession(input(30, progress, history));
    const phrases = p.items.filter((i) => i.block === 'phrases').map((i) => i.exercise.id);
    expect(phrases).toEqual(['ps1-p12', 'ps1-p11', 'ps1-p10', 'ps1-p9', 'ps1-p8']);
  });
});

// --- 30-day simulation on the bundled course ---------------------------------

describe('30-day simulation on pt-PT-A1 (all answers correct)', () => {
  it('review and focus picks cycle through a topic before repeating an exercise', () => {
    const program: Program = validateProgram(ptPtA1Json);
    const byTopic = exercisesByTopic(program);
    const rng = mulberry32(42);
    let progress: TopicProgress[] = [];
    const attempts: HistoryAttempt[] = [];
    const shown: { exerciseId: string; topicId: string; at: number; block: string }[] = [];
    const start = Date.UTC(2026, 0, 1, 9);

    const run = (plan: SessionPlan, startedAt: number) => {
      const summary = plan.items.map((item, i) => {
        const at = startedAt + (i + 1) * 20_000;
        const row =
          progress.find((r) => r.topicId === item.topicId) ??
          emptyTopicProgress(item.topicId, program.id);
        const next = applyAttempt(row, item.exercise.id, true, at);
        progress = [...progress.filter((r) => r.topicId !== item.topicId), next];
        attempts.push({ exerciseId: item.exercise.id, correct: true, at });
        shown.push({ exerciseId: item.exercise.id, topicId: item.topicId, at, block: item.block });
        return { topicId: item.topicId, block: item.block, correct: true };
      });
      progress = finishSession(
        progress,
        summary,
        startedAt + (plan.items.length + 1) * 20_000,
        startedAt
      ).rows;
    };

    const inputAt = (now: number): PlanInput => ({
      program,
      progress,
      sessionLength: 10,
      inputShares: INPUT_PRESETS.normal,
      now,
      rng,
      history: buildExerciseHistory(attempts),
    });

    for (let day = 0; day < 30; day += 1) {
      const morning = start + day * DAY_MS;
      run(planSession(inputAt(morning)), morning);
      if (day % 3 === 2) {
        // Focus on the first completed topic, so it is drilled hard enough to repeat.
        const completed = progress
          .filter((row) => row.status !== 'new' && row.status !== 'learning')
          .map((row) => row.topicId)
          .filter((id) => program.modules.some((m) => m.topics.some((t) => t.id === id)));
        const order = [...byTopic.keys()];
        completed.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        if (completed.length > 0) {
          const evening = morning + 10 * HOUR;
          run(planFocus(inputAt(evening), completed[0]), evening);
        }
      }
    }

    let repeats = 0;
    shown.forEach((entry, index) => {
      if (entry.block !== 'review' && entry.block !== 'focus') return;
      const previous = shown
        .slice(0, index)
        .reverse()
        .find((other) => other.exerciseId === entry.exerciseId);
      if (!previous) return;
      repeats += 1;
      const between = new Set(
        shown
          .filter((other) => other.at > previous.at && other.at < entry.at)
          .map((other) => other.exerciseId)
      );
      const missing = (byTopic.get(entry.topicId) ?? [])
        .map((exercise) => exercise.id)
        .filter((id) => id !== entry.exerciseId && !between.has(id));
      expect(missing, `${entry.exerciseId} repeated too early`).toEqual([]);
    });
    // The property is only meaningful if repeats actually happened.
    expect(repeats).toBeGreaterThan(20);
  });
});
