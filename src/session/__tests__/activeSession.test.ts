import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { planSession } from '../../engine/plan';
import { mulberry32 } from '../../engine/rng';
import { INPUT_PRESETS } from '../../settings/settings';
import { makeStandardProgram } from '../../test/fixtures';
import {
  ACTIVE_SESSION_KEY,
  ACTIVE_SESSION_MAX_AGE_MS,
  clearActiveSession,
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
  await db.settings.clear();
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
