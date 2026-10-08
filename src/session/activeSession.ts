// Persistence of the in-progress session (docs/stage-3-spec.md §5). Stored in the
// existing `settings` table under a single key, so no schema change is needed.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { isRecord } from '../lib/isRecord';
import { recordSessionEnd } from './recordSessionEnd';
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

/**
 * Drops an unfinished session. With at least one answer it is first recorded exactly
 * like a stopped session — the `sessions` row with `interrupted: true` and
 * `finishSession` — so its answers keep counting for the streak and history.
 * `endedAt` defaults to now; an expired snapshot uses its last save instead.
 */
export async function discardActiveSession(
  stored: StoredActiveSession,
  endedAt = Date.now()
): Promise<void> {
  try {
    if (stored.state.responses.length > 0) {
      await recordSessionEnd(stored.state, stored.state.endedAt ?? endedAt, true);
    }
  } finally {
    await clearActiveSession();
  }
}

/**
 * The persisted session, or `null` when absent or older than 24 hours. An expired
 * snapshot is discarded (recorded as interrupted when it has answers).
 */
export async function readActiveSession(now = Date.now()): Promise<StoredActiveSession | null> {
  const row = await db.settings.get(ACTIVE_SESSION_KEY);
  if (!row || !looksLikeSession(row.value)) return null;
  if (now - row.value.savedAt > ACTIVE_SESSION_MAX_AGE_MS) {
    await discardActiveSession(row.value, row.value.savedAt);
    return null;
  }
  return row.value;
}

/**
 * Whether opening `/session` without `?resume=1` should pick up `stored` instead of
 * planning anew: a plain `/session` resumes any saved session, `/session?focus=X` only a
 * focus session on the same topic.
 */
export function resumesSnapshot(
  stored: StoredActiveSession | null | undefined,
  focusTopicId: string | undefined
): boolean {
  if (!stored) return false;
  if (!focusTopicId) return true;
  return stored.state.plan.kind === 'focus' && stored.state.plan.focusTopicId === focusTopicId;
}

/** Live view for the Learn screen's "Resume session" card. `undefined` while loading. */
export function useActiveSession(): StoredActiveSession | null | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get(ACTIVE_SESSION_KEY);
    if (!row || !looksLikeSession(row.value)) return null;
    return Date.now() - row.value.savedAt > ACTIVE_SESSION_MAX_AGE_MS ? null : row.value;
  }, []);
}
