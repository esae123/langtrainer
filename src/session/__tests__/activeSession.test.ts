import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { planSession } from '../../engine/plan';
import { mulberry32 } from '../../engine/rng';
import { INPUT_PRESETS } from '../../settings/settings';
import { makeProgress, makeStandardProgram } from '../../test/fixtures';
import {
  ACTIVE_SESSION_KEY,
  ACTIVE_SESSION_MAX_AGE_MS,
  clearActiveSession,
  discardActiveSession,
  readActiveSession,
  saveActiveSession,
} from '../activeSession';
import { initSessionState, sessionReducer } from '../sessionState';

const NOW = 1_700_000_000_000;

function state() {
  return initSessionState(
    planSession({
      program: makeStandardProgram(),
      progress: [],
      sessionLength: 5,
      inputShares: INPUT_PRESETS.normal,
      now: NOW,
      rng: mulberry32(3),
      id: 'sess-persist',
    }),
    NOW
  );
}

afterEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('activeSession persistence', () => {
  it('round-trips the whole session state', async () => {
    const saved = sessionReducer(state(), { type: 'showExercise' })!;
    await saveActiveSession(saved, NOW);

    const stored = await readActiveSession(NOW + 1000);
    expect(stored?.savedAt).toBe(NOW);
    expect(stored?.state.phase).toBe('exercise');
    expect(stored?.state.sessionId).toBe('sess-persist');
    expect(stored?.state.plan.items).toHaveLength(5);
    expect(stored?.state.plan.items[0].exercise.id).toBe(saved.plan.items[0].exercise.id);
  });

  it('ignores and cleans up a snapshot older than 24 hours', async () => {
    await saveActiveSession(state(), NOW);
    expect(await readActiveSession(NOW + ACTIVE_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(await db.settings.get(ACTIVE_SESSION_KEY)).toBeUndefined();
  });

  it('records an expired snapshot with answers as an interrupted session', async () => {
    const started = state();
    const item = started.plan.items[0];
    await db.topicProgress.put(makeProgress(item.topicId, { status: 'learning' }));
    const answered = sessionReducer(started, {
      type: 'submit',
      draft: {
        id: `sess-persist-${item.exercise.id}`,
        exerciseId: item.exercise.id,
        topicId: item.topicId,
        mode: item.mode,
        block: item.block,
        correct: true,
        diacriticsOk: null,
        answer: 'x',
        at: NOW + 1000,
      },
      result: { correct: true, diacriticsOk: null, expected: 'x' },
    })!;
    await saveActiveSession(answered, NOW + 2000);

    expect(await readActiveSession(NOW + 2000 + ACTIVE_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(await db.settings.get(ACTIVE_SESSION_KEY)).toBeUndefined();
    const sessions = await db.sessions.toArray();
    expect(sessions).toEqual([
      expect.objectContaining({
        id: 'sess-persist',
        startedAt: NOW,
        endedAt: NOW + 2000,
        completed: 1,
        correct: 1,
        interrupted: true,
      }),
    ]);
    expect((await db.topicProgress.get(item.topicId))?.history).toEqual([
      { at: NOW + 2000, correct: 1, total: 1 },
    ]);
  });

  it('an expired snapshot without answers leaves no session row', async () => {
    await saveActiveSession(state(), NOW);
    expect(await readActiveSession(NOW + ACTIVE_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(await db.sessions.count()).toBe(0);
  });

  it('discarding a session with answers records it, without answers just clears it', async () => {
    await saveActiveSession(state(), NOW);
    await discardActiveSession((await readActiveSession(NOW))!);
    expect(await readActiveSession(NOW)).toBeNull();
    expect(await db.sessions.count()).toBe(0);
  });

  it('ignores a malformed snapshot', async () => {
    await db.settings.put({ key: ACTIVE_SESSION_KEY, value: { nope: true } });
    expect(await readActiveSession(NOW)).toBeNull();
  });

  it('clears the snapshot', async () => {
    await saveActiveSession(state(), NOW);
    await clearActiveSession();
    expect(await readActiveSession(NOW)).toBeNull();
  });
});
