// Wires the pure session reducer to Dexie: plan/resume, record attempts and topic
// progress, persist the in-progress state, finalise at the summary.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Program } from '../content/types';
import { db, type AttemptRow } from '../db/db';
import {
  checkAnswer,
  expectedAnswerText,
  responseToText,
  type ExerciseResponse,
  type SelfGrade,
} from '../engine/check';
import { planNextCycle, planSession, type PlanInput, type SessionPlan } from '../engine/plan';
import {
  applyAttempt,
  emptyTopicProgress,
  finishSession,
  type SessionAttemptSummary,
  type TopicOutcome,
} from '../engine/progress';
import { mulberry32, type Rng } from '../engine/rng';
import type { TopicProgress } from '../engine/types';
import type { Settings } from '../settings/settings';
import { clearActiveSession, readActiveSession, saveActiveSession } from './activeSession';
import {
  currentItem,
  initSessionState,
  sessionReducer,
  type AttemptDraft,
  type SessionState,
} from './sessionState';

export interface SessionRunner {
  state: SessionState | null;
  /** Per-topic status changes; available shortly after the summary opens. */
  outcomes: TopicOutcome[] | null;
  startExercises: () => void;
  submit: (response: ExerciseResponse) => void;
  selfGrade: (grade: SelfGrade) => void;
  next: () => void;
  stop: () => void;
}

function toAttemptRow(draft: AttemptDraft, sessionId: string): AttemptRow {
  return {
    id: draft.id,
    sessionId,
    exerciseId: draft.exerciseId,
    topicId: draft.topicId,
    mode: draft.mode,
    correct: draft.correct,
    ...(draft.diacriticsOk !== null ? { diacriticsOk: draft.diacriticsOk } : {}),
    ...(draft.selfGraded ? { selfGraded: true } : {}),
    answer: draft.answer,
    at: draft.at,
  };
}

export function useSessionRunner(
  program: Program | undefined,
  settings: Settings,
  resume: boolean
): SessionRunner {
  const [state, dispatch] = useReducer(sessionReducer, null);
  const [outcomes, setOutcomes] = useState<TopicOutcome[] | null>(null);
  const bootstrappedRef = useRef(false);
  const finalizedRef = useRef<string | null>(null);
  const rngRef = useRef<Rng>(mulberry32(1));
  const progressRef = useRef<TopicProgress[]>([]);

  const planInput = useCallback(
    (now: number): PlanInput | null =>
      program
        ? {
            program,
            progress: progressRef.current,
            sessionLength: settings.sessionLength,
            inputShares: settings.inputShares,
            now,
            rng: rngRef.current,
          }
        : null,
    [program, settings.sessionLength, settings.inputShares]
  );

  // Plan a new session, or pick up the persisted one. Runs once per mount.
  useEffect(() => {
    if (!program || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    let cancelled = false;

    void (async () => {
      const now = Date.now();
      rngRef.current = mulberry32(now >>> 0);
      const rows = await db.topicProgress.where('programId').equals(program.id).toArray();
      progressRef.current = rows;
      if (cancelled) return;

      if (resume) {
        const stored = await readActiveSession(now);
        if (stored && !cancelled) {
          dispatch({ type: 'init', state: stored.state });
          return;
        }
      }
      const input = planInput(now);
      if (!input || cancelled) return;
      dispatch({ type: 'init', state: initSessionState(planSession(input), now) });
    })();

    return () => {
      cancelled = true;
    };
  }, [program, resume, planInput]);

  // Persist on every transition; drop the snapshot once the summary is reached.
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'summary') {
      void clearActiveSession();
      return;
    }
    void saveActiveSession(state);
  }, [state]);

  // Write the session row and apply end-of-session progress exactly once.
  useEffect(() => {
    if (!state || state.phase !== 'summary') return;
    if (finalizedRef.current === state.sessionId) return;
    finalizedRef.current = state.sessionId;
    const { sessionId, programId, plan, responses, startedAt, interrupted } = state;
    const now = state.endedAt ?? Date.now();

    void (async () => {
      await db.sessions.put({
        id: sessionId,
        programId,
        startedAt,
        endedAt: now,
        plannedLength: plan.open ? responses.length : plan.plannedLength,
        completed: responses.length,
        correct: responses.filter((draft) => draft.correct).length,
        interrupted,
      });

      const topicIds = [...new Set(responses.map((draft) => draft.topicId))];
      const summaries: SessionAttemptSummary[] = responses.map((draft) => ({
        topicId: draft.topicId,
        block: draft.block,
        correct: draft.correct,
      }));

      const result = await db.transaction('rw', db.topicProgress, async () => {
        const rows = await Promise.all(topicIds.map((id) => db.topicProgress.get(id)));
        const present = rows.filter((row): row is TopicProgress => row !== undefined);
        const finished = finishSession(present, summaries, now);
        await db.topicProgress.bulkPut(finished.rows);
        return finished;
      });
      progressRef.current = result.rows;
      setOutcomes(result.outcomes);
    })();
  }, [state]);

  const record = useCallback(async (draft: AttemptDraft, sessionId: string, programId: string) => {
    await db.attempts.put(toAttemptRow(draft, sessionId));
    const updated = await db.transaction('rw', db.topicProgress, async () => {
      const existing =
        (await db.topicProgress.get(draft.topicId)) ?? emptyTopicProgress(draft.topicId, programId);
      const next = applyAttempt(existing, draft.exerciseId, draft.correct, draft.at);
      await db.topicProgress.put(next);
      return next;
    });
    progressRef.current = [
      ...progressRef.current.filter((row) => row.topicId !== updated.topicId),
      updated,
    ];
  }, []);

  const startExercises = useCallback(() => dispatch({ type: 'showExercise' }), []);

  const submit = useCallback(
    (response: ExerciseResponse) => {
      if (!state) return;
      const item = currentItem(state);
      if (!item || state.phase !== 'exercise') return;
      const answer = responseToText(response);

      if (item.exercise.type === 'about_me' && response.kind !== 'selfGrade') {
        dispatch({
          type: 'awaitSelfGrade',
          answer,
          result: {
            correct: false,
            diacriticsOk: null,
            expected: expectedAnswerText(item.exercise),
          },
        });
        return;
      }

      const result = checkAnswer(item.exercise, item.mode, response);
      const draft: AttemptDraft = {
        id: `${state.sessionId}-${item.exercise.id}`,
        exerciseId: item.exercise.id,
        topicId: item.topicId,
        mode: item.mode,
        block: item.block,
        correct: result.correct,
        diacriticsOk: result.diacriticsOk,
        answer,
        at: Date.now(),
      };
      dispatch({ type: 'submit', draft, result, response });
      void record(draft, state.sessionId, state.programId);
    },
    [state, record]
  );

  const next = useCallback(() => {
    if (!state) return;
    const now = Date.now();
    if (state.plan.open && state.index + 1 >= state.plan.items.length) {
      const input = planInput(now);
      if (input) {
        const extended: SessionPlan = planNextCycle(state.plan, input);
        const added = extended.items.slice(state.plan.items.length);
        if (added.length > 0) dispatch({ type: 'appendItems', items: added });
      }
    }
    dispatch({ type: 'next', now });
  }, [state, planInput]);

  const selfGrade = useCallback(
    (grade: SelfGrade) => {
      if (!state?.feedback) return;
      const item = currentItem(state);
      if (!item) return;
      const answer = state.feedback.answer;
      const result = checkAnswer(item.exercise, item.mode, {
        kind: 'selfGrade',
        text: answer,
        grade,
      });
      const draft: AttemptDraft = {
        id: `${state.sessionId}-${item.exercise.id}`,
        exerciseId: item.exercise.id,
        topicId: item.topicId,
        mode: item.mode,
        block: item.block,
        correct: result.correct,
        diacriticsOk: null,
        answer,
        at: Date.now(),
        selfGraded: true,
      };
      dispatch({ type: 'submit', draft, result });
      void record(draft, state.sessionId, state.programId);
      // The sample answer has already been shown, so grading also continues.
      next();
    },
    [state, record, next]
  );

  const stop = useCallback(() => dispatch({ type: 'stop', now: Date.now() }), []);

  return { state, outcomes, startExercises, submit, selfGrade, next, stop };
}
