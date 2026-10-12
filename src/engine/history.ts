// Per-exercise answer history, derived from the stored attempts (no extra table). Pure:
// planning uses it to show the least recently seen, least secured exercises first.

/** What planning needs to know about one exercise's past answers. */
export interface ExerciseHistory {
  /** Time of the latest attempt. */
  lastSeenAt: number;
  /** Consecutive correct answers ending with the latest one (0 if the latest was wrong). */
  correctStreak: number;
  /** All attempts on the exercise. */
  attempts: number;
}

/** The fields of an attempt row the history is built from. */
export interface HistoryAttempt {
  exerciseId: string;
  correct: boolean;
  at: number;
}

/** A correct streak of at least this length marks an exercise as secured. */
export const SECURED_STREAK = 2;

/** Exercises seen within this window go to the end of their selection group. */
export const RECENT_WINDOW_MS = 20 * 60 * 60 * 1000;

function step(previous: ExerciseHistory | undefined, attempt: HistoryAttempt): ExerciseHistory {
  return {
    lastSeenAt: Math.max(previous?.lastSeenAt ?? attempt.at, attempt.at),
    correctStreak: attempt.correct ? (previous?.correctStreak ?? 0) + 1 : 0,
    attempts: (previous?.attempts ?? 0) + 1,
  };
}

/**
 * exerciseId -> history, from every attempt of a course, replayed in time order (ties
 * keep their input order). Practice attempts count like any other: a correct answer in
 * Retry mistakes / Repeat session is real evidence the learner knows the exercise.
 */
export function buildExerciseHistory(
  attempts: Iterable<HistoryAttempt>
): Map<string, ExerciseHistory> {
  const sorted = [...attempts].sort((a, b) => a.at - b.at);
  const history = new Map<string, ExerciseHistory>();
  for (const attempt of sorted) {
    history.set(attempt.exerciseId, step(history.get(attempt.exerciseId), attempt));
  }
  return history;
}

/** A copy of `history` with one more (latest) attempt applied. */
export function withAttempt(
  history: ReadonlyMap<string, ExerciseHistory>,
  attempt: HistoryAttempt
): Map<string, ExerciseHistory> {
  const next = new Map(history);
  next.set(attempt.exerciseId, step(history.get(attempt.exerciseId), attempt));
  return next;
}
