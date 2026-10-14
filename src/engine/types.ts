// Progress shapes used by the engine. Declared here (not in src/db) so the engine
// stays free of Dexie; src/db/db.ts re-exports these as its row types.

export type TopicStatus = 'new' | 'learning' | 'review' | 'mastered' | 'maintenance';

export interface TopicHistoryEntry {
  at: number;
  correct: number;
  total: number;
}

export interface TopicProgress {
  topicId: string;
  programId: string;
  status: TopicStatus;
  firstCompletedAt?: number;
  /** First time every exercise in a strict-coverage topic was answered correctly. */
  allExercisesCompletedAt?: number;
  lastReviewedAt?: number;
  nextReviewAt?: number;
  reviewStage: 0 | 1 | 2 | 3;
  /** Consecutive reviews finished below 100%; drives the stage-3 → maintenance rule. */
  failedReviewsInARow: number;
  history: TopicHistoryEntry[];
  seenExerciseIds: string[];
  /**
   * Exercises whose last attempt was wrong; planning offers them again before the
   * rest (docs/stage-3b-spec.md §5). Cleared as soon as one is answered correctly,
   * in a practice session too.
   */
  wrongExerciseIds: string[];
}
