// Persistence of the in-progress session (docs/stage-3-spec.md §5). Stored in the
// existing `settings` table under a single key, so no schema change is needed.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { isRecord } from '../lib/isRecord';
import type { SessionState } from './sessionState';

export const ACTIVE_SESSION_KEY = 'activeSession';
/** Older snapshots are ignored (and cleaned up) instead of offered for resuming. */
export const ACTIVE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface StoredActiveSession {
  state: SessionState;
  savedAt: number;
}

function looksLikeSession(value: unknown): value is StoredActiveSession {
  if (!isRecord(value) || typeof value.savedAt !== 'number') return false;
  const state = value.state;
  if (!isRecord(state)) return false;
  const plan = state.plan;
  return (
    typeof state.sessionId === 'string' &&
    typeof state.index === 'number' &&
    Array.isArray(state.responses) &&
    isRecord(plan) &&
    Array.isArray(plan.items)
  );
}

export async function saveActiveSession(state: SessionState, now = Date.now()): Promise<void> {
  const stored: StoredActiveSession = { state, savedAt: now };
  await db.settings.put({ key: ACTIVE_SESSION_KEY, value: stored });
}

export async function clearActiveSession(): Promise<void> {
  await db.settings.delete(ACTIVE_SESSION_KEY);
}

/** The persisted session, or `null` when absent or older than 24 hours. */
export async function readActiveSession(now = Date.now()): Promise<StoredActiveSession | null> {
  const row = await db.settings.get(ACTIVE_SESSION_KEY);
  if (!row || !looksLikeSession(row.value)) return null;
  if (now - row.value.savedAt > ACTIVE_SESSION_MAX_AGE_MS) {
    await clearActiveSession();
    return null;
  }
  return row.value;
}

/** Live view for the Learn screen's "Resume session" card. `undefined` while loading. */
export function useActiveSession(): StoredActiveSession | null | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get(ACTIVE_SESSION_KEY);
    if (!row || !looksLikeSession(row.value)) return null;
    return Date.now() - row.value.savedAt > ACTIVE_SESSION_MAX_AGE_MS ? null : row.value;
  }, []);
}
