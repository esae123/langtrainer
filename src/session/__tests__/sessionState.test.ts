import { describe, expect, it } from 'vitest';
import { INPUT_PRESETS } from '../../settings/settings';
import { makeStandardProgram } from '../../test/fixtures';
import type { CheckResult } from '../../engine/check';
import { planSession, type SessionPlan } from '../../engine/plan';
import { mulberry32 } from '../../engine/rng';
import {
  currentItem,
  initSessionState,
  sessionReducer,
  settleResumedState,
  type AttemptDraft,
  type SessionState,
} from '../sessionState';

const NOW = 1_700_000_000_000;

function makePlan(length: 5 | 10 | 'open' = 5): SessionPlan {
  return planSession({
    program: makeStandardProgram(),
    progress: [],
    sessionLength: length,
    inputShares: INPUT_PRESETS.normal,
    now: NOW,
    rng: mulberry32(11),
    id: 'sess-1',
  });
}

function draftFor(state: SessionState, correct: boolean): AttemptDraft {
  const item = currentItem(state)!;
  return {
    id: `${state.sessionId}-${item.exercise.id}`,
    exerciseId: item.exercise.id,
    topicId: item.topicId,
    mode: item.mode,
    block: item.block,
    correct,
    diacriticsOk: null,
    answer: 'answer',
    at: NOW,
  };
}

const result: CheckResult = { correct: true, diacriticsOk: null, expected: 'x' };

describe('sessionReducer', () => {
  it('starts on the context screen when the first item asks for it', () => {
    const state = initSessionState(makePlan(), NOW);
    expect(state.phase).toBe('context');
    expect(state.index).toBe(0);
    expect(state.plan.items[0].showContextBefore).toBe(true);
    expect(sessionReducer(state, { type: 'showExercise' })?.phase).toBe('exercise');
  });

  it('runs start -> exercise -> feedback -> next -> summary', () => {
    let state = initSessionState(makePlan(5), NOW);
    state = sessionReducer(state, { type: 'showExercise' })!;

    for (let i = 0; i < 5; i += 1) {
      expect(state.phase).toBe('exercise');
      state = sessionReducer(state, { type: 'submit', draft: draftFor(state, true), result })!;
      expect(state.phase).toBe('feedback');
      expect(state.feedback).toMatchObject({ answer: 'answer', awaitingSelfGrade: false });
      state = sessionReducer(state, { type: 'next', now: NOW + i })!;
    }

    expect(state.phase).toBe('summary');
    expect(state.responses).toHaveLength(5);
    expect(state.interrupted).toBe(false);
    expect(state.endedAt).toBe(NOW + 4);
  });

  it('records only answered items when the learner stops mid-way', () => {
    let state = initSessionState(makePlan(5), NOW);
    state = sessionReducer(state, { type: 'showExercise' })!;
    state = sessionReducer(state, { type: 'submit', draft: draftFor(state, true), result })!;
    state = sessionReducer(state, { type: 'next', now: NOW + 1 })!;
    state = sessionReducer(state, { type: 'submit', draft: draftFor(state, false), result })!;
    state = sessionReducer(state, { type: 'stop', now: NOW + 2 })!;

    expect(state.phase).toBe('summary');
    expect(state.interrupted).toBe(true);
    expect(state.responses).toHaveLength(2);
    expect(state.responses.filter((draft) => draft.correct)).toHaveLength(1);
    expect(state.feedback).toBeNull();
  });

  it('keeps one draft per exercise so a self-grade replaces the first submit', () => {
    let state = initSessionState(makePlan(5), NOW);
    state = sessionReducer(state, { type: 'showExercise' })!;
    const first = draftFor(state, false);
    state = sessionReducer(state, { type: 'submit', draft: first, result })!;
    state = sessionReducer(state, {
      type: 'submit',
      draft: { ...first, correct: true, selfGraded: true },
      result,
    })!;
    expect(state.responses).toHaveLength(1);
    expect(state.responses[0]).toMatchObject({ correct: true, selfGraded: true });
  });

  it('shows the sample answer while waiting for a self-grade', () => {
    let state = initSessionState(makePlan(5), NOW);
    state = sessionReducer(state, { type: 'showExercise' })!;
    state = sessionReducer(state, {
      type: 'awaitSelfGrade',
      answer: 'Moro em Lisboa.',
      result: { correct: false, diacriticsOk: null, expected: 'sample' },
    })!;
    expect(state.phase).toBe('feedback');
    expect(state.feedback?.awaitingSelfGrade).toBe(true);
    expect(state.responses).toHaveLength(0);
  });

  it('shows the context screen again when the next item introduces a topic', () => {
    const plan = makePlan(5);
    plan.items[1] = { ...plan.items[1], showContextBefore: true };
    let state = initSessionState(plan, NOW);
    state = sessionReducer(state, { type: 'showExercise' })!;
    state = sessionReducer(state, { type: 'submit', draft: draftFor(state, true), result })!;
    state = sessionReducer(state, { type: 'next', now: NOW })!;
    expect(state.phase).toBe('context');
  });

  it('appends items for an open-ended session instead of finishing', () => {
    const plan = makePlan('open');
    let state = initSessionState(plan, NOW);
    expect(state.plan.items).toHaveLength(6);
    state = sessionReducer(state, { type: 'appendItems', items: plan.items.slice(0, 2) })!;
    expect(state.plan.items).toHaveLength(8);
    expect(state.plan.plannedLength).toBe(0);
  });

  it('ignores actions before init', () => {
    expect(sessionReducer(null, { type: 'next', now: NOW })).toBeNull();
  });
});

describe('AI check states (docs/stage-7-spec.md)', () => {
  const pending: CheckResult = { correct: false, diacriticsOk: null, expected: 'x' };

  function inExercise(): SessionState {
    return sessionReducer(initSessionState(makePlan(5), NOW), { type: 'showExercise' })!;
  }

  it('awaitAi shows a pending feedback without recording anything', () => {
    const state = sessionReducer(inExercise(), { type: 'awaitAi', result: pending, answer: 'a' })!;
    expect(state.phase).toBe('feedback');
    expect(state.feedback).toMatchObject({ aiPending: true, awaitingSelfGrade: false });
    expect(state.responses).toHaveLength(0);
  });

  it('aiUnavailable turns a pending check into the self-grade fallback', () => {
    let state = sessionReducer(inExercise(), { type: 'awaitAi', result: pending, answer: 'a' })!;
    state = sessionReducer(state, { type: 'aiUnavailable' })!;
    expect(state.feedback).toMatchObject({ awaitingSelfGrade: true, aiFallback: true });
    expect(state.feedback?.aiPending).toBeUndefined();
  });

  it('aiUnavailable is ignored once the verdict is in', () => {
    let state = inExercise();
    state = sessionReducer(state, {
      type: 'submit',
      draft: { ...draftFor(state, true), gradedBy: 'ai', aiVerdict: 'almost' },
      result,
      ai: { verdict: 'almost', correction: 'c', explanation: 'e' },
    })!;
    expect(sessionReducer(state, { type: 'aiUnavailable' })).toBe(state);
    expect(state.feedback?.ai?.verdict).toBe('almost');
  });

  it('a snapshot saved mid-check resumes as the self-grade fallback', () => {
    const state = sessionReducer(inExercise(), { type: 'awaitAi', result: pending, answer: 'a' })!;
    expect(settleResumedState(state).feedback).toMatchObject({
      awaitingSelfGrade: true,
      aiFallback: true,
    });
    const plain = inExercise();
    expect(settleResumedState(plain)).toBe(plain);
  });
});
