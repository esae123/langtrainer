import { describe, expect, it } from 'vitest';
import type { InputMode } from '../../content/types';
import { INPUT_PRESETS, type SessionLength } from '../../settings/settings';
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
  currentTopicOf,
  pickMode,
  planNextCycle,
  planSession,
  type SessionPlan,
} from '../plan';
import { mulberry32 } from '../rng';
import { DAY_MS } from '../progress';
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

  it('takes due topics earliest first, spread over at most two topics', () => {
    const progress = [
      due('t2', NOW - 5 * DAY_MS),
      due('t3', NOW - 10 * DAY_MS),
      makeProgress('t1', { status: 'learning' }),
    ];
    const p = plan({ sessionLength: 10, progress });
    const reviewTopics = new Set(p.items.filter((i) => i.block === 'review').map((i) => i.topicId));
    expect(reviewTopics).toEqual(new Set(['t2', 't3']));
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
