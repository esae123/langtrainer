import { describe, expect, it } from 'vitest';
import type { InputMode } from '../../content/types';
import {
  DEFAULT_SESSION_MIX,
  INPUT_PRESETS,
  SESSION_MIX_PRESETS,
  type SessionLength,
  type SessionMix,
} from '../../settings/settings';
import {
  makeProgram,
  makeProgress,
  makePhraseSet,
  makeStandardProgram,
  makeTopic,
  makeTranslateWord,
} from '../../test/fixtures';
import {
  BLOCK_COMPOSITION,
  OPEN_CYCLE,
  blockCountsFor,
  currentTopicOf,
  pickMode,
  planNextCycle,
  planSession,
  type SessionPlan,
} from '../plan';
import { mulberry32 } from '../rng';
import {
  DAY_MS,
  MIN_REVIEW_ATTEMPTS,
  applyAttempt,
  emptyTopicProgress,
  finishSession,
} from '../progress';
import type { TopicProgress } from '../types';

const NOW = 1_700_000_000_000;

function plan(overrides: {
  sessionLength?: SessionLength;
  progress?: TopicProgress[];
  seed?: number;
  program?: ReturnType<typeof makeStandardProgram>;
}): SessionPlan {
  return planSession({
    program: overrides.program ?? makeStandardProgram(),
    progress: overrides.progress ?? [],
    sessionLength: overrides.sessionLength ?? 10,
    inputShares: INPUT_PRESETS.normal,
    now: NOW,
    rng: mulberry32(overrides.seed ?? 1),
    id: 'sess-1',
  });
}

function countBlocks(p: SessionPlan) {
  return {
    new: p.items.filter((i) => i.block === 'new').length,
    review: p.items.filter((i) => i.block === 'review').length,
    phrases: p.items.filter((i) => i.block === 'phrases').length,
  };
}

describe('planSession block sizes', () => {
  it.each([5, 10, 15, 20, 30] as const)('length %i matches the composition table', (length) => {
    const p = plan({ sessionLength: length });
    expect(p.items).toHaveLength(length);
    expect(p.plannedLength).toBe(length);
    expect(countBlocks(p)).toEqual(BLOCK_COMPOSITION[length]);
  });

  it('orders blocks new -> review -> phrases', () => {
    const blocks = plan({ sessionLength: 10 }).items.map((i) => i.block);
    expect(blocks).toEqual(
      [...blocks].sort((a, b) => {
        const rank = { new: 0, review: 1, phrases: 2 };
        return rank[a] - rank[b];
      })
    );
  });

  it('marks an open session and plans one cycle of six', () => {
    const p = plan({ sessionLength: 'open' });
    expect(p.open).toBe(true);
    expect(p.plannedLength).toBe(0);
    expect(p.items).toHaveLength(6);
    expect(countBlocks(p)).toEqual({ new: 3, review: 2, phrases: 1 });
  });
});

describe('planNextCycle', () => {
  it('appends six more items without repeating an exercise', () => {
    const program = makeStandardProgram();
    const input = {
      program,
      progress: [],
      sessionLength: 'open' as const,
      inputShares: INPUT_PRESETS.normal,
      now: NOW,
      rng: mulberry32(7),
      id: 'sess-open',
    };
    let p = planSession(input);
    p = planNextCycle(p, input);
    p = planNextCycle(p, input);
    expect(p.items).toHaveLength(18);
    expect(new Set(p.items.map((i) => i.exercise.id)).size).toBe(18);
  });

  it('shows the context screen only the first time a topic appears', () => {
    const input = {
      program: makeStandardProgram(),
      progress: [],
      sessionLength: 'open' as const,
      inputShares: INPUT_PRESETS.normal,
      now: NOW,
      rng: mulberry32(3),
    };
    const p = planNextCycle(planSession(input), input);
    expect(p.items.filter((i) => i.showContextBefore)).toHaveLength(1);
    expect(p.items[0].showContextBefore).toBe(true);
  });
});

describe('current topic selection', () => {
  it('picks the first topic in program order that is new or learning', () => {
    const program = makeStandardProgram();
    expect(currentTopicOf(program, [])?.id).toBe('t1');
    expect(
      currentTopicOf(program, [makeProgress('t1', { status: 'review', reviewStage: 1 })])?.id
    ).toBe('t2');
    expect(
      currentTopicOf(program, [
        makeProgress('t1', { status: 'mastered', reviewStage: 3 }),
        makeProgress('t2', { status: 'learning' }),
      ])?.id
    ).toBe('t2');
    expect(
      currentTopicOf(
        program,
        ['t1', 't2', 't3'].map((id) => makeProgress(id, { status: 'mastered', reviewStage: 3 }))
      )
    ).toBeUndefined();
  });

  it('puts the whole new block on the current topic, easiest first', () => {
    const p = plan({ sessionLength: 10 });
    const newItems = p.items.filter((i) => i.block === 'new');
    expect(newItems.every((i) => i.topicId === 't1')).toBe(true);
    const difficulties = newItems.map((i) => i.exercise.difficulty);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
  });

  it('replaces the new block with review exercises when every topic is completed', () => {
    const progress = ['t1', 't2', 't3'].map((id) =>
      makeProgress(id, { status: 'review', reviewStage: 1, nextReviewAt: NOW - DAY_MS })
    );
    const p = plan({ sessionLength: 10, progress });
    expect(countBlocks(p)).toEqual({ new: 0, review: 8, phrases: 2 });
    expect(p.items.some((i) => i.showContextBefore)).toBe(false);
  });
});

describe('review block selection', () => {
  const due = (topicId: string, nextReviewAt: number) =>
    makeProgress(topicId, { status: 'review', reviewStage: 1, nextReviewAt });

  it('takes the earliest due topic; a second one only with room for both', () => {
    const progress = [
      due('t2', NOW - 5 * DAY_MS),
      due('t3', NOW - 10 * DAY_MS),
      makeProgress('t1', { status: 'learning' }),
    ];
    const short = plan({ sessionLength: 10, progress });
    const shortTopics = new Set(
      short.items.filter((i) => i.block === 'review').map((i) => i.topicId)
    );
    expect(shortTopics).toEqual(new Set(['t3']));
    const long = plan({ sessionLength: 20, progress });
    const longTopics = new Set(
      long.items.filter((i) => i.block === 'review').map((i) => i.topicId)
    );
    expect(longTopics).toEqual(new Set(['t2', 't3']));
  });

  it('ignores topics whose review is not due yet', () => {
    const progress = [
      makeProgress('t1', { status: 'learning' }),
      due('t2', NOW + 5 * DAY_MS),
      makeProgress('t3', { status: 'mastered', reviewStage: 3 }),
    ];
    const p = plan({ sessionLength: 10, progress });
    const reviewTopics = new Set(p.items.filter((i) => i.block === 'review').map((i) => i.topicId));
    // Nothing due -> a random completed topic (t2 review or t3 mastered).
    expect(reviewTopics.size).toBe(1);
    expect(['t2', 't3']).toContain([...reviewTopics][0]);
  });

  it('falls back to more current-topic exercises when nothing is completed', () => {
    const p = plan({ sessionLength: 10, progress: [makeProgress('t1', { status: 'learning' })] });
    expect(p.items.filter((i) => i.block === 'review').every((i) => i.topicId === 't1')).toBe(true);
  });
});

describe('exercise selection', () => {
  it('prefers unseen exercises', () => {
    const program = makeStandardProgram();
    const seen = program.modules[0].topics[0].exercises.slice(0, 30).map((e) => e.id);
    const p = plan({
      sessionLength: 5,
      progress: [makeProgress('t1', { status: 'learning', seenExerciseIds: seen })],
    });
    const newIds = p.items.filter((i) => i.block === 'new').map((i) => i.exercise.id);
    expect(newIds.every((id) => !seen.includes(id))).toBe(true);
  });

  it('prefers unseen phrase exercises', () => {
    const program = makeStandardProgram();
    const seen = program.phraseSets[0].exercises.slice(0, 6).map((e) => e.id);
    const p = plan({
      sessionLength: 10,
      progress: [makeProgress('ps1', { status: 'learning', seenExerciseIds: seen })],
    });
    const phraseIds = p.items.filter((i) => i.block === 'phrases').map((i) => i.exercise.id);
    expect(phraseIds.every((id) => !seen.includes(id))).toBe(true);
  });

  it('offers exercises answered wrong before the other seen ones', () => {
    const program = makeStandardProgram();
    const all = program.modules[0].topics[0].exercises.map((e) => e.id);
    // Only two unseen exercises are left, so the plan has to reach into the seen pool.
    const seen = all.slice(0, 38);
    const wrong = [seen[20], seen[7]];
    const p = plan({
      sessionLength: 10,
      seed: 4,
      progress: [
        makeProgress('t1', {
          status: 'learning',
          seenExerciseIds: seen,
          wrongExerciseIds: wrong,
        }),
        // Nothing completed, so the review block also comes from t1 — and after the
        // ten unseen exercises it has to reach into the seen pool.
      ],
    });
    const ids = p.items.filter((i) => i.topicId === 't1').map((i) => i.exercise.id);
    const seenPicked = ids.filter((id) => seen.includes(id));
    // Whatever the seed, past mistakes come before the other already-seen exercises.
    expect(seenPicked.slice(0, wrong.length).sort()).toEqual([...wrong].sort());
  });

  it('never repeats an exercise inside one session', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = plan({ sessionLength: 30, seed });
      expect(new Set(p.items.map((i) => i.exercise.id)).size).toBe(p.items.length);
    }
  });

  it('tops up from the available pools when a block runs short', () => {
    const program = makeProgram(
      [{ id: 'm1', title: 'M', description: 'd', topics: [makeTopic('t1', 'm1', 8)] }],
      [makePhraseSet('ps1', 1)]
    );
    const p = plan({ sessionLength: 5, program });
    expect(p.items).toHaveLength(5);
    expect(new Set(p.items.map((i) => i.exercise.id)).size).toBe(5);
  });

  it('plans fewer items than asked only when the program runs out of exercises', () => {
    const program = makeProgram([
      { id: 'm1', title: 'M', description: 'd', topics: [makeTopic('t1', 'm1', 3)] },
    ]);
    const p = plan({ sessionLength: 10, program });
    expect(p.items).toHaveLength(3);
    // plannedLength follows the real plan so the progress counter stays honest.
    expect(p.plannedLength).toBe(3);
  });
});

describe('input mode weighting', () => {
  it('only ever picks an allowed mode', () => {
    const program = makeProgram([
      {
        id: 'm1',
        title: 'M',
        description: 'd',
        topics: [
          makeTopic('t1', 'm1', 0, {
            exercises: Array.from({ length: 30 }, (_, i) =>
              makeTranslateWord(`t1-e${i}`, 't1', { allowedModes: ['tiles', 'letters'] })
            ),
          }),
        ],
      },
    ]);
    const p = plan({ sessionLength: 20, program, seed: 9 });
    expect(p.items.every((i) => i.exercise.allowedModes.includes(i.mode))).toBe(true);
    expect(p.items.some((i) => i.mode === 'letters')).toBe(true);
  });

  it('falls back to the highest-share allowed mode when the drawn one is not allowed', () => {
    // typing has share 0 in the easy preset, so a typing-only exercise still renders.
    const onlyTyping: InputMode[] = ['typing'];
    expect(pickMode(onlyTyping, INPUT_PRESETS.easy, mulberry32(1))).toBe('typing');
    // letters beats typing in the normal preset.
    expect(
      new Set(
        Array.from({ length: 50 }, (_, i) =>
          pickMode(['letters', 'typing'], { tiles: 100, letters: 0, typing: 0 }, mulberry32(i))
        )
      )
    ).toEqual(new Set(['letters']));
  });

  it('roughly follows the configured shares', () => {
    const program = makeProgram([
      {
        id: 'm1',
        title: 'M',
        description: 'd',
        topics: [
          makeTopic('t1', 'm1', 0, {
            exercises: Array.from({ length: 200 }, (_, i) => makeTranslateWord(`t1-e${i}`, 't1')),
          }),
        ],
      },
    ]);
    const p = planSession({
      program,
      progress: [],
      sessionLength: 30,
      inputShares: { tiles: 100, letters: 0, typing: 0 },
      now: NOW,
      rng: mulberry32(5),
    });
    expect(p.items.every((i) => i.mode === 'tiles')).toBe(true);
  });
});

describe('context screen', () => {
  it('is shown before the first exercise of the new block', () => {
    const p = plan({ sessionLength: 10 });
    expect(p.items[0]).toMatchObject({ block: 'new', showContextBefore: true });
    expect(p.items.filter((i) => i.showContextBefore)).toHaveLength(1);
  });
});

describe('determinism', () => {
  it('produces the same plan for the same seed', () => {
    const a = plan({ sessionLength: 15, seed: 42 });
    const b = plan({ sessionLength: 15, seed: 42 });
    expect(a.items.map((i) => `${i.exercise.id}:${i.mode}`)).toEqual(
      b.items.map((i) => `${i.exercise.id}:${i.mode}`)
    );
  });
});

describe('session mix (blockCountsFor)', () => {
  const LENGTHS: SessionLength[] = [5, 10, 15, 20, 30, 'open'];
  const sum = (c: { new: number; review: number; phrases: number }) => c.new + c.review + c.phrases;
  const mix = (preset: SessionMix['preset'], shares = DEFAULT_SESSION_MIX.shares): SessionMix => ({
    preset,
    shares,
  });

  it('balanced is exactly the old table and open cycle (also the default)', () => {
    for (const length of [5, 10, 15, 20, 30] as const) {
      expect(blockCountsFor(length, DEFAULT_SESSION_MIX)).toEqual(BLOCK_COMPOSITION[length]);
      expect(blockCountsFor(length)).toEqual(BLOCK_COMPOSITION[length]);
    }
    expect(blockCountsFor('open', DEFAULT_SESSION_MIX)).toEqual(OPEN_CYCLE);
    expect(blockCountsFor('open')).toEqual({ new: 3, review: 2, phrases: 1 });
  });

  it.each(['more-new', 'more-review'] as const)(
    '%s sums to the length for every length',
    (preset) => {
      for (const length of LENGTHS) {
        const counts = blockCountsFor(length, mix(preset, SESSION_MIX_PRESETS[preset]));
        expect(sum(counts)).toBe(length === 'open' ? 6 : length);
      }
    }
  );

  it('uses largest-remainder rounding', () => {
    const moreNew = mix('more-new', SESSION_MIX_PRESETS['more-new']);
    expect(blockCountsFor(10, moreNew)).toEqual({ new: 7, review: 2, phrases: 1 });
    expect(blockCountsFor(15, moreNew)).toEqual({ new: 11, review: 3, phrases: 1 });
    expect(blockCountsFor('open', moreNew)).toEqual({ new: 4, review: 1, phrases: 1 });
    const moreReview = mix('more-review', SESSION_MIX_PRESETS['more-review']);
    expect(blockCountsFor(5, moreReview)).toEqual({ new: 1, review: 3, phrases: 1 });
    expect(blockCountsFor(20, moreReview)).toEqual({ new: 6, review: 11, phrases: 3 });
    expect(blockCountsFor('open', moreReview)).toEqual({ new: 2, review: 3, phrases: 1 });
  });

  it('gives a zero share zero items', () => {
    for (const length of LENGTHS) {
      const noPhrases = blockCountsFor(length, mix('custom', { new: 60, review: 40, phrases: 0 }));
      expect(noPhrases.phrases).toBe(0);
      expect(sum(noPhrases)).toBe(length === 'open' ? 6 : length);
      const onlyReview = blockCountsFor(length, mix('custom', { new: 0, review: 100, phrases: 0 }));
      expect(onlyReview).toEqual({ new: 0, review: sum(onlyReview), phrases: 0 });
    }
  });

  it('planSession and planNextCycle follow the mix', () => {
    const sessionMix = mix('custom', { new: 0, review: 50, phrases: 50 });
    const progress = [
      makeProgress('t1', { status: 'review', reviewStage: 1, nextReviewAt: NOW - DAY_MS }),
    ];
    const input = {
      program: makeStandardProgram(),
      progress,
      sessionLength: 10 as const,
      inputShares: INPUT_PRESETS.normal,
      sessionMix,
      now: NOW,
      rng: mulberry32(5),
    };
    expect(countBlocks(planSession(input))).toEqual({ new: 0, review: 5, phrases: 5 });
    const open = { ...input, sessionLength: 'open' as const };
    const extended = planNextCycle(planSession(open), open);
    expect(countBlocks(extended)).toEqual({ new: 0, review: 6, phrases: 6 });
  });
});

describe('review scheduling (docs/stage-6-spec.md §1)', () => {
  // A 4-topic, 2-module program so up to three topics can be due while one is current.
  function bigProgram() {
    return makeProgram(
      [
        {
          id: 'm1',
          title: 'Module 1',
          description: 'd',
          topics: [makeTopic('t1', 'm1', 40), makeTopic('t2', 'm1', 40)],
        },
        {
          id: 'm2',
          title: 'Module 2',
          description: 'd',
          topics: [makeTopic('t3', 'm2', 40), makeTopic('t4', 'm2', 40)],
        },
      ],
      [makePhraseSet('ps1', 30)]
    );
  }
  const dueRow = (topicId: string, daysAgo: number) =>
    makeProgress(topicId, {
      status: 'review',
      reviewStage: 1,
      firstCompletedAt: NOW - 60 * DAY_MS,
      nextReviewAt: NOW - daysAgo * DAY_MS,
    });
  const dueSets: Record<number, TopicProgress[]> = {
    0: [],
    1: [dueRow('t1', 3)],
    2: [dueRow('t1', 3), dueRow('t2', 9)],
    3: [dueRow('t1', 3), dueRow('t2', 9), dueRow('t3', 1)],
  };
  const reviewCounts = (p: SessionPlan) => {
    const counts = new Map<string, number>();
    for (const item of p.items.filter((i) => i.block === 'review')) {
      counts.set(item.topicId, (counts.get(item.topicId) ?? 0) + 1);
    }
    return counts;
  };
  const input = (sessionLength: SessionLength, progress: TopicProgress[], seed = 1) => ({
    program: bigProgram(),
    progress,
    sessionLength,
    inputShares: INPUT_PRESETS.normal,
    now: NOW,
    rng: mulberry32(seed),
    id: 'sess-r',
  });

  for (const length of [5, 10, 15, 20, 30] as const) {
    for (const dueCount of [0, 1, 2, 3]) {
      it(`length ${length}, ${dueCount} due: each due review topic gets >= 3 items`, () => {
        const progress = dueSets[dueCount];
        const p = planSession(input(length, progress));
        expect(p.items).toHaveLength(length);
        expect(new Set(p.items.map((i) => i.exercise.id)).size).toBe(length);
        const counts = reviewCounts(p);
        if (dueCount === 0) {
          // Fallback unchanged: nothing completed, so the review block is the current topic.
          expect([...counts.keys()]).toEqual(['t1']);
          expect(counts.get('t1')).toBe(BLOCK_COMPOSITION[length].review);
          return;
        }
        for (const [, n] of counts) expect(n).toBeGreaterThanOrEqual(MIN_REVIEW_ATTEMPTS);
        // Earliest due first (t2 is overdue the longest).
        expect(counts.has(dueCount >= 2 ? 't2' : 't1')).toBe(true);
        const target = BLOCK_COMPOSITION[length].review;
        expect(counts.size).toBe(Math.min(dueCount, target >= 2 * MIN_REVIEW_ATTEMPTS ? 2 : 1));
      });
    }
  }

  it('length 5 borrows from the new block: 1 new, 3 review, 1 phrase', () => {
    const p = planSession(input(5, dueSets[1]));
    expect(countBlocks(p)).toEqual({ new: 1, review: 3, phrases: 1 });
  });

  it('borrows from phrases when the new block is empty', () => {
    const p = planSession({
      ...input(5, dueSets[1]),
      sessionMix: { preset: 'custom', shares: { new: 0, review: 20, phrases: 80 } },
    });
    expect(countBlocks(p)).toEqual({ new: 0, review: 3, phrases: 2 });
  });

  it('respects a review share of 0', () => {
    const p = planSession({
      ...input(10, dueSets[2]),
      sessionMix: { preset: 'custom', shares: { new: 70, review: 0, phrases: 30 } },
    });
    expect(countBlocks(p).review).toBe(0);
    expect(p.items).toHaveLength(10);
  });

  for (const dueCount of [0, 1, 2, 3]) {
    it(`open session, ${dueCount} due: each due topic reaches 3 items, then the next`, () => {
      const progress = dueSets[dueCount];
      const open = input('open', progress, 3);
      let p = planSession(open);
      for (let i = 0; i < 4; i += 1) p = planNextCycle(p, open);
      expect(p.items).toHaveLength(30);
      expect(new Set(p.items.map((i) => i.exercise.id)).size).toBe(30);
      const counts = reviewCounts(p);
      const due = progress.map((row) => row.topicId);
      for (const id of due) expect(counts.get(id) ?? 0).toBeGreaterThanOrEqual(MIN_REVIEW_ATTEMPTS);
      // The first cycle alone already gives the earliest due topic enough items.
      if (dueCount > 0) {
        const first = reviewCounts(planSession(input('open', progress, 3)));
        const earliest = dueCount >= 2 ? 't2' : 't1';
        expect(first.get(earliest)).toBe(MIN_REVIEW_ATTEMPTS);
        expect(first.size).toBe(1);
      }
    });
  }

  it('a stuck overdue topic advances a stage after one regular session', () => {
    for (const length of [5, 10, 15, 20, 30] as const) {
      const progress = [
        dueRow('t1', 40),
        dueRow('t2', 20),
        // t3 is the current topic.
      ];
      const p = planSession(input(length, progress));
      const startedAt = NOW;
      const end = NOW + 10 * 60 * 1000;
      let rows = [...progress];
      for (const item of p.items) {
        const existing =
          rows.find((row) => row.topicId === item.topicId) ??
          emptyTopicProgress(item.topicId, 'pt-PT-A1');
        const next = applyAttempt(existing, item.exercise.id, true, startedAt + 1);
        rows = [...rows.filter((row) => row.topicId !== item.topicId), next];
      }
      const { rows: finished, outcomes } = finishSession(
        rows,
        p.items.map((item) => ({ topicId: item.topicId, block: item.block, correct: true })),
        end,
        startedAt
      );
      const t1 = finished.find((row) => row.topicId === 't1');
      expect(t1).toMatchObject({ reviewStage: 2, nextReviewAt: end + 30 * DAY_MS });
      expect(outcomes.find((o) => o.topicId === 't1')?.srsApplied).toBe(true);
      // Every topic that got review items had enough for the SRS to move.
      for (const outcome of outcomes.filter((o) => o.reviewed)) {
        expect(outcome.srsApplied).toBe(true);
      }
    }
  });
});
