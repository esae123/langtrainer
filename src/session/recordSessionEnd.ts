// End-of-session persistence shared by the summary, a discarded unfinished session and
// an expired snapshot: the `sessions` row plus `finishSession` (history, SRS).
import { db } from '../db/db';
import { finishSession, type SessionAttemptSummary, type TopicOutcome } from '../engine/progress';
import type { TopicProgress } from '../engine/types';
import type { SessionState } from './sessionState';

export interface RecordedSessionEnd {
  /** Updated progress rows of the touched topics (empty for practice runs). */
  rows: TopicProgress[];
  outcomes: TopicOutcome[];
}

/**
 * Writes the `sessions` row and, for regular and focus sessions, applies end-of-session
 * progress via `finishSession`. Practice runs are drill only: no history entry, no SRS
 * transition, no status change (docs/stage-3b-spec.md §4). Focus sessions do go through
 * finishSession: their attempts are all in the `focus` block, so it adds history but
 * never moves the SRS (docs/stage-6-spec.md §4).
 */
export async function recordSessionEnd(
  state: SessionState,
  endedAt: number,
  interrupted: boolean
): Promise<RecordedSessionEnd> {
  const { sessionId, programId, plan, responses, startedAt } = state;
  await db.sessions.put({
    id: sessionId,
    programId,
    startedAt,
    endedAt,
    plannedLength: plan.open ? responses.length : plan.plannedLength,
    completed: responses.length,
    correct: responses.filter((draft) => draft.correct).length,
    interrupted,
    kind: plan.kind,
  });

  if (plan.kind === 'practice') return { rows: [], outcomes: [] };

  const topicIds = [...new Set(responses.map((draft) => draft.topicId))];
  const summaries: SessionAttemptSummary[] = responses.map((draft) => ({
    topicId: draft.topicId,
    block: draft.block,
    correct: draft.correct,
  }));

  return db.transaction('rw', db.topicProgress, async () => {
    const rows = await Promise.all(topicIds.map((id) => db.topicProgress.get(id)));
    const present = rows.filter((row): row is TopicProgress => row !== undefined);
    const finished = finishSession(present, summaries, endedAt, startedAt);
    await db.topicProgress.bulkPut(finished.rows);
    return finished;
  });
}
