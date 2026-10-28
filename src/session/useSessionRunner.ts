// Wires the pure session reducer to Dexie: plan/resume, record attempts and topic
// progress, persist the in-progress state, finalise at the summary.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useAiCheck } from '../ai/useAiCheck';
import type { Program } from '../content/types';
import { db, type AttemptRow } from '../db/db';
import {
  checkAnswer,
  expectedAnswerText,
  responseToText,
  selfGradedResult,
  type ExerciseResponse,
  type SelfGrade,
} from '../engine/check';
import { buildExerciseHistory, withAttempt, type ExerciseHistory } from '../engine/history';
import {
  exercisesByTopic,
  isStrictCourse,
  planFocus,
  planNextCycle,
  planSession,
  type PlanInput,
  type SessionPlan,
} from '../engine/plan';
import {
  applyAttempt,
  emptyTopicProgress,
  reconcileStrictTopic,
  type TopicOutcome,
} from '../engine/progress';
import { mulberry32, type Rng } from '../engine/rng';
import type { TopicProgress } from '../engine/types';
import type { Settings } from '../settings/settings';
import {
  clearActiveSession,
  discardActiveSession,
  readActiveSession,
  resumesSnapshot,
  saveActiveSession,
} from './activeSession';
import { recordSessionEnd } from './recordSessionEnd';
import {
  currentItem,
  initSessionState,
  sessionReducer,
  settleResumedState,
  type AttemptDraft,
  type SessionState,
} from './sessionState';
import { topicInfo } from './topicLookup';

export interface SessionRunner {
  state: SessionState | null;
  /** Per-topic status changes; available shortly after the summary opens. */
  outcomes: TopicOutcome[] | null;
  startExercises: () => void;
  submit: (response: ExerciseResponse) => void;
  selfGrade: (grade: SelfGrade) => void;
  /** "Skip — grade myself" while the AI check is running. */
  skipAi: () => void;
  next: () => void;
  stop: () => void;
}

function toAttemptRow(draft: AttemptDraft, sessionId: string, practice: boolean): AttemptRow {
  return {
    id: draft.id,
    sessionId,
    exerciseId: draft.exerciseId,
    topicId: draft.topicId,
    mode: draft.mode,
    correct: draft.correct,
    ...(draft.diacriticsOk !== null ? { diacriticsOk: draft.diacriticsOk } : {}),
    ...(draft.selfGraded ? { selfGraded: true } : {}),
    ...(draft.gradedBy ? { gradedBy: draft.gradedBy } : {}),
    ...(draft.aiVerdict ? { aiVerdict: draft.aiVerdict } : {}),
    ...(practice ? { practice: true } : {}),
    block: draft.block,
    answer: draft.answer,
    at: draft.at,
  };
}

/**
 * @param practicePlan when given, this exact plan is run as a practice session instead
 *        of planning (or resuming) a regular one.
 * @param focusTopicId when given (and no practice plan), plans a focus session on that
 *        topic or phrase set (docs/stage-6-spec.md §4) instead of a regular one.
 */
export function useSessionRunner(
  program: Program | undefined,
  settings: Settings,
  resume: boolean,
  practicePlan?: SessionPlan,
  focusTopicId?: string
): SessionRunner {
  const [state, dispatch] = useReducer(sessionReducer, null);
  const [outcomes, setOutcomes] = useState<TopicOutcome[] | null>(null);
  const bootstrappedRef = useRef(false);
  const finalizedRef = useRef<string | null>(null);
  const rngRef = useRef<Rng>(mulberry32(1));
  const progressRef = useRef<TopicProgress[]>([]);
  /** Per-exercise answer history of the course, kept current as answers are recorded. */
  const historyRef = useRef<ReadonlyMap<string, ExerciseHistory>>(new Map());
  const ai = useAiCheck(settings);
  /** Draft id of the answer whose AI check is in flight, or null. */
  const pendingAiRef = useRef<string | null>(null);

  const planInput = useCallback(
    (now: number): PlanInput | null =>
      program
        ? {
            program,
            progress: progressRef.current,
            sessionLength: settings.sessionLength,
            inputShares: settings.inputShares,
            sessionMix: settings.sessionMix,
            now,
            rng: rngRef.current,
            history: historyRef.current,
          }
        : null,
    [program, settings.sessionLength, settings.inputShares, settings.sessionMix]
  );

  // Plan a new session, or pick up the persisted one. `bootstrappedRef` keeps this to
  // exactly one plan per mount (it survives StrictMode's mount → cleanup → mount, and
  // stops a new `planInput` identity from re-planning mid-session). Because of that the
  // async body deliberately has no "cancelled" guard: under StrictMode the only run is
  // the one started before the simulated unmount, so bailing out of its dispatch would
  // leave the screen stuck on "Preparing your session…" forever. Dispatching into an
  // unmounted reducer is a no-op in React 19, so letting it through is safe.
  useEffect(() => {
    if (!program || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    void (async () => {
      const now = Date.now();
      rngRef.current = mulberry32(now >>> 0);
      let rows = await db.topicProgress.where('programId').equals(program.id).toArray();
      if (isStrictCourse(program)) {
        // A strict topic whose every current exercise is answered correctly but which
        // never got its completion marker (a stale id used to block it) is completed now.
        const byTopic = exercisesByTopic(program);
        const healed = rows.map((row) =>
          reconcileStrictTopic(
            row,
            (byTopic.get(row.topicId) ?? []).map((e) => e.id),
            now
          )
        );
        const changed = healed.filter((row, i) => row !== rows[i]);
        if (changed.length > 0) await db.topicProgress.bulkPut(changed);
        rows = healed;
      }
      progressRef.current = rows;

      if (practicePlan) {
        dispatch({ type: 'init', state: initSessionState(practicePlan, now) });
        return;
      }

      // One query for the whole course (topics and phrase sets); planNextCycle on a
      // resumed open session needs it too, so it is loaded before the resume check.
      const attempts = await db.attempts
        .where('topicId')
        .anyOf([...exercisesByTopic(program).keys()])
        .toArray();
      historyRef.current = buildExerciseHistory(attempts);

      // Never overwrite an unfinished session silently (Android restores a killed PWA at
      // its last URL, so /session or /session?focus=X can reopen while a snapshot
      // exists). `readActiveSession` also finalises an expired snapshot. An explicit
      // resume, a plain /session, or a focus URL for the same topic picks the saved
      // session up; any other snapshot is recorded as interrupted before planning anew.
      const stored = await readActiveSession(now);
      if (stored) {
        if (
          resume ||
          (resumesSnapshot(stored, focusTopicId) && stored.state.programId === program.id)
        ) {
          dispatch({ type: 'init', state: settleResumedState(stored.state) });
          return;
        }
        await discardActiveSession(stored);
      }
      const input = planInput(now);
      if (!input) return;
      const plan = focusTopicId ? planFocus(input, focusTopicId) : planSession(input);
      dispatch({ type: 'init', state: initSessionState(plan, now) });
    })();
  }, [program, resume, planInput, practicePlan, focusTopicId]);

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
    const now = state.endedAt ?? Date.now();

    void (async () => {
      const result = await recordSessionEnd(state, now, state.interrupted);
      if (state.plan.kind !== 'practice') progressRef.current = result.rows;
      setOutcomes(result.outcomes);
    })();
  }, [state]);

  const record = useCallback(
    async (draft: AttemptDraft, sessionId: string, programId: string, practice: boolean) => {
      // Synchronously, before any await, so the next cycle's plan already sees it.
      historyRef.current = withAttempt(historyRef.current, draft);
      await db.attempts.put(toAttemptRow(draft, sessionId, practice));
      const updated = await db.transaction('rw', db.topicProgress, async () => {
        const existing = await db.topicProgress.get(draft.topicId);
        // A practice answer never creates a progress row and only ever clears a past
        // mistake; everything else stays exactly as it was.
        if (practice && !existing) return undefined;
        const row = existing ?? emptyTopicProgress(draft.topicId, programId);
        // Strict courses judge completion on the topic's current exercise ids.
        const strictExerciseIds =
          program && isStrictCourse(program)
            ? (exercisesByTopic(program).get(draft.topicId) ?? []).map((exercise) => exercise.id)
            : undefined;
        const next = applyAttempt(
          row,
          draft.exerciseId,
          draft.correct,
          draft.at,
          practice,
          strictExerciseIds
        );
        if (next === row && existing) return existing;
        await db.topicProgress.put(next);
        return next;
      });
      if (!updated) return;
      progressRef.current = [
        ...progressRef.current.filter((row) => row.topicId !== updated.topicId),
        updated,
      ];
    },
    [program]
  );

  const startExercises = useCallback(() => dispatch({ type: 'showExercise' }), []);

  const submit = useCallback(
    (response: ExerciseResponse) => {
      if (!state) return;
      const item = currentItem(state);
      if (!item || state.phase !== 'exercise') return;
      const answer = responseToText(response);
      const aboutMe = item.exercise.type === 'about_me' && response.kind !== 'selfGrade';
      const result = aboutMe ? null : checkAnswer(item.exercise, item.mode, response);
      const pendingResult = {
        correct: false,
        diacriticsOk: null,
        expected: expectedAnswerText(item.exercise),
      };

      // The AI only ever runs when switched on with a key, for a typed open answer the
      // local check did not accept (docs/stage-7-spec.md §2).
      const route = ai.route({
        mode: item.mode,
        exerciseType: item.exercise.type,
        locallyCorrect: result?.correct ?? false,
      });

      if (route === 'fallback') {
        dispatch({ type: 'awaitSelfGrade', answer, result: pendingResult, aiFallback: true });
        return;
      }

      if (route === 'ai') {
        const draftId = `${state.sessionId}-${item.exercise.id}`;
        const { sessionId, programId } = state;
        const practice = state.plan.kind === 'practice';
        pendingAiRef.current = draftId;
        dispatch({ type: 'awaitAi', answer, result: pendingResult });
        ai.start(
          {
            targetLanguage: program?.targetLanguage ?? 'pt-PT',
            topicTitle: topicInfo(program, item.topicId).title,
            exercise: item.exercise,
            learnerAnswer: answer,
          },
          (outcome) => {
            if (pendingAiRef.current !== draftId) return;
            pendingAiRef.current = null;
            if (outcome.kind !== 'verdict') {
              dispatch({ type: 'aiUnavailable' });
              return;
            }
            const { verdict, correction, explanation } = outcome.result;
            // "almost" counts as correct.
            const correct = verdict !== 'incorrect';
            const draft: AttemptDraft = {
              id: draftId,
              exerciseId: item.exercise.id,
              topicId: item.topicId,
              mode: item.mode,
              block: item.block,
              correct,
              diacriticsOk: null,
              answer,
              at: Date.now(),
              gradedBy: 'ai',
              aiVerdict: verdict,
            };
            dispatch({
              type: 'submit',
              draft,
              result: { ...pendingResult, correct },
              response,
              ai: { verdict, correction, explanation },
            });
            void record(draft, sessionId, programId, practice);
          }
        );
        return;
      }

      if (!result) {
        dispatch({ type: 'awaitSelfGrade', answer, result: pendingResult });
        return;
      }

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
        gradedBy: 'local',
      };
      dispatch({ type: 'submit', draft, result, response });
      void record(draft, state.sessionId, state.programId, state.plan.kind === 'practice');
    },
    [state, record, ai, program]
  );

  const skipAi = useCallback(() => {
    if (!pendingAiRef.current) return;
    pendingAiRef.current = null;
    ai.cancel();
    dispatch({ type: 'aiUnavailable' });
  }, [ai]);

  const next = useCallback(() => {
    if (!state) return;
    pendingAiRef.current = null;
    ai.cancel();
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
  }, [state, planInput, ai]);

  const selfGrade = useCallback(
    (grade: SelfGrade) => {
      if (!state?.feedback) return;
      const item = currentItem(state);
      if (!item) return;
      const answer = state.feedback.answer;
      const result = selfGradedResult(item.exercise, grade);
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
        gradedBy: 'self',
      };
      dispatch({ type: 'submit', draft, result });
      void record(draft, state.sessionId, state.programId, state.plan.kind === 'practice');
      // The sample answer has already been shown, so grading also continues.
      next();
    },
    [state, record, next]
  );

  const stop = useCallback(() => {
    pendingAiRef.current = null;
    ai.cancel();
    dispatch({ type: 'stop', now: Date.now() });
  }, [ai]);

  return { state, outcomes, startExercises, submit, selfGrade, skipAi, next, stop };
}
