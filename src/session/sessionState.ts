// Session state machine (docs/stage-3-spec.md §5). Pure reducer: no React, no Dexie.
import type { InputMode } from '../content/types';
import type { CheckResult, ExerciseResponse } from '../engine/check';
import type { BlockKind, PlannedItem, SessionPlan } from '../engine/plan';

export type SessionPhase = 'context' | 'exercise' | 'feedback' | 'summary';

/** One answered exercise, ready to be written to the `attempts` table. */
export interface AttemptDraft {
  id: string;
  exerciseId: string;
  topicId: string;
  mode: InputMode;
  block: BlockKind;
  correct: boolean;
  diacriticsOk: boolean | null;
  answer: string;
  at: number;
  selfGraded?: boolean;
}

export interface FeedbackState {
  result: CheckResult;
  /** The learner's answer, as text. */
  answer: string;
  /** The structured answer, so the sheet can grade it per part (match_pairs). */
  response?: ExerciseResponse;
  /** about_me: the sheet shows the sample answer and waits for a self-grade. */
  awaitingSelfGrade: boolean;
}

export interface SessionState {
  sessionId: string;
  programId: string;
  plan: SessionPlan;
  index: number;
  phase: SessionPhase;
  responses: AttemptDraft[];
  startedAt: number;
  endedAt?: number;
  interrupted: boolean;
  feedback: FeedbackState | null;
}

export type SessionAction =
  | { type: 'init'; state: SessionState }
  | { type: 'showExercise' }
  | { type: 'submit'; draft: AttemptDraft; result: CheckResult; response?: ExerciseResponse }
  | { type: 'awaitSelfGrade'; result: CheckResult; answer: string }
  | { type: 'appendItems'; items: PlannedItem[] }
  | { type: 'next'; now: number }
  | { type: 'stop'; now: number };

function phaseFor(plan: SessionPlan, index: number): SessionPhase {
  const item = plan.items[index];
  if (!item) return 'summary';
  return item.showContextBefore ? 'context' : 'exercise';
}

export function initSessionState(plan: SessionPlan, now: number): SessionState {
  return {
    sessionId: plan.id,
    programId: plan.programId,
    plan,
    index: 0,
    phase: phaseFor(plan, 0),
    responses: [],
    startedAt: now,
    interrupted: false,
    feedback: null,
  };
}

export function currentItem(state: SessionState): PlannedItem | undefined {
  return state.plan.items[state.index];
}

export function sessionReducer(
  state: SessionState | null,
  action: SessionAction
): SessionState | null {
  if (action.type === 'init') return action.state;
  if (!state) return state;

  switch (action.type) {
    case 'showExercise':
      return state.phase === 'context' ? { ...state, phase: 'exercise' } : state;

    case 'submit': {
      // A second submit for the same exercise (e.g. the about_me self-grade) replaces
      // the draft instead of recording the exercise twice.
      const responses = state.responses.filter((draft) => draft.id !== action.draft.id);
      return {
        ...state,
        phase: 'feedback',
        responses: [...responses, action.draft],
        feedback: {
          result: action.result,
          answer: action.draft.answer,
          ...(action.response ? { response: action.response } : {}),
          awaitingSelfGrade: false,
        },
      };
    }

    case 'awaitSelfGrade':
      return {
        ...state,
        phase: 'feedback',
        feedback: { result: action.result, answer: action.answer, awaitingSelfGrade: true },
      };

    case 'appendItems':
      return {
        ...state,
        plan: { ...state.plan, items: [...state.plan.items, ...action.items] },
      };

    case 'next': {
      const index = state.index + 1;
      if (index >= state.plan.items.length) {
        return { ...state, phase: 'summary', endedAt: action.now, feedback: null };
      }
      return { ...state, index, phase: phaseFor(state.plan, index), feedback: null };
    }

    case 'stop':
      return {
        ...state,
        phase: 'summary',
        endedAt: action.now,
        interrupted: true,
        feedback: null,
      };
  }
}
