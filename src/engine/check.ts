// Answer checking (docs/stage-3-spec.md §3). Pure: no React, no Dexie, no clock.
import type { Exercise, InputMode, MatchPairsExercise } from '../content/types';
import { levenshtein, normalize, normalizeStripped } from './text';

/** Minimum expected length before the typing mode forgives one typo. */
export const TYPO_MIN_LENGTH = 5;

export type SelfGrade = 'yes' | 'mostly' | 'no';

export type ExerciseResponse =
  /** Tiles: the ordered tokens the learner placed. */
  | { kind: 'tokens'; tokens: string[] }
  /** Letters / typing: one composed string. */
  | { kind: 'text'; text: string }
  /** fill_gaps: one value per gap, in template order. */
  | { kind: 'gaps'; values: string[] }
  | { kind: 'findError'; index: number | null; replacement: string }
  /** match_pairs: the pairs the learner linked, graded only once everything is paired. */
  | { kind: 'pairs'; pairs: { target: string; support: string }[] }
  /** order_dialogue: original line indices in the order the learner placed them. */
  | { kind: 'order'; order: number[] }
  /** about_me: free text plus the learner's own verdict. */
  | { kind: 'selfGrade'; text: string; grade: SelfGrade };

export interface CheckResult {
  correct: boolean;
  /** `null` when the learner did not type the characters (tiles, matching, ordering). */
  diacriticsOk: boolean | null;
  expected: string;
  matchedAccepted?: string;
}

interface TextMatch {
  correct: boolean;
  diacriticsOk: boolean | null;
  matched?: string;
}

function textOf(response: ExerciseResponse): string {
  switch (response.kind) {
    case 'tokens':
      return response.tokens.join(' ');
    case 'text':
      return response.text;
    case 'gaps':
      return response.values.join(' | ');
    case 'findError':
      return response.index === null ? '' : `#${response.index + 1} → ${response.replacement}`;
    case 'pairs':
      return response.pairs.map((p) => `${p.target} = ${p.support}`).join('  ·  ');
    case 'order':
      return response.order.map((i) => i + 1).join(' ');
    case 'selfGrade':
      return response.text;
  }
}

/** The learner's answer as one display/storage string. */
export function responseToText(response: ExerciseResponse): string {
  return textOf(response);
}

/**
 * Compares one piece of learner text against an expected string plus accepted
 * variants, following the per-mode rules of §3. Candidates are tried in three
 * passes so an exact match always wins over an accent-only or typo match.
 */
function matchText(
  actual: string,
  expected: string,
  accepted: readonly string[],
  mode: InputMode
): TextMatch {
  const candidates = [expected, ...accepted];
  const actualNorm = normalize(actual);

  for (const candidate of candidates) {
    if (actualNorm === normalize(candidate)) {
      return {
        correct: true,
        diacriticsOk: mode === 'tiles' ? null : true,
        matched: candidate,
      };
    }
  }
  if (mode === 'tiles') return { correct: false, diacriticsOk: null };

  const actualStripped = normalizeStripped(actual);
  for (const candidate of candidates) {
    if (actualStripped === normalizeStripped(candidate)) {
      return { correct: true, diacriticsOk: false, matched: candidate };
    }
  }

  if (mode === 'typing') {
    for (const candidate of candidates) {
      const candidateNorm = normalize(candidate);
      if (candidateNorm.length < TYPO_MIN_LENGTH) continue;
      const strippedDistance = levenshtein(actualStripped, normalizeStripped(candidate));
      if (strippedDistance > 1) continue;
      // "diacriticsOk computed on the un-stripped comparison": accents only count as
      // wrong if keeping them makes the answer *further* from the expected string.
      const plainDistance = levenshtein(actualNorm, candidateNorm);
      return {
        correct: true,
        diacriticsOk: plainDistance <= strippedDistance,
        matched: candidate,
      };
    }
  }

  return { correct: false, diacriticsOk: false };
}

/** The correct answer as one string, per type — used for feedback and the accent note. */
export function expectedAnswerText(exercise: Exercise): string {
  switch (exercise.type) {
    case 'build_phrase':
    case 'question_for_answer':
      return exercise.answer.join(' ');
    case 'fill_gaps': {
      let gapIndex = 0;
      return exercise.template.replace(/___/g, () => exercise.gaps[gapIndex++]?.answer ?? '___');
    }
    case 'translate_word':
      return exercise.answer;
    case 'number_sequence':
      return exercise.answerWords[0] ?? '';
    case 'find_error':
      return exercise.correction;
    case 'match_pairs':
      return exercise.pairs.map((p) => `${p.target} = ${p.support}`).join('  ·  ');
    case 'order_dialogue':
      return exercise.lines.map((l) => `${l.speaker}: ${l.text}`).join('  /  ');
    case 'about_me':
      return exercise.sampleAnswer;
  }
}

/**
 * The learner's own verdict on any exercise (about_me, or an open answer the AI check
 * was supposed to grade but could not): Yes/Mostly count as correct.
 */
export function selfGradedResult(exercise: Exercise, grade: SelfGrade): CheckResult {
  return { correct: grade !== 'no', diacriticsOk: null, expected: expectedAnswerText(exercise) };
}

export interface PairGrade {
  target: string;
  /** What the learner linked to this target, or `undefined` if it stayed unpaired. */
  chosen?: string;
  expected: string;
  correct: boolean;
}

/**
 * Grades the pairs a learner linked, in the exercise's own order: used by the feedback
 * sheet to mark correct pairs and show the right partner for the wrong ones (§1).
 */
export function gradePairs(
  exercise: MatchPairsExercise,
  chosen: readonly { target: string; support: string }[]
): PairGrade[] {
  return exercise.pairs.map((pair) => {
    const link = chosen.find((entry) => entry.target === pair.target);
    return {
      target: pair.target,
      ...(link ? { chosen: link.support } : {}),
      expected: pair.support,
      correct: link?.support === pair.support,
    };
  });
}

function joined(match: TextMatch, expected: string): CheckResult {
  return {
    correct: match.correct,
    diacriticsOk: match.diacriticsOk,
    expected,
    ...(match.matched !== undefined && match.matched !== expected
      ? { matchedAccepted: match.matched }
      : {}),
  };
}

export function checkAnswer(
  exercise: Exercise,
  mode: InputMode,
  response: ExerciseResponse
): CheckResult {
  const expected = expectedAnswerText(exercise);

  switch (exercise.type) {
    case 'build_phrase':
    case 'question_for_answer':
      return joined(
        matchText(textOf(response), expected, exercise.acceptedAnswers ?? [], mode),
        expected
      );

    case 'translate_word':
      return joined(
        matchText(textOf(response), exercise.answer, exercise.acceptedAnswers ?? [], mode),
        expected
      );

    case 'number_sequence':
      return joined(
        matchText(
          textOf(response),
          exercise.answerWords[0] ?? '',
          exercise.answerWords.slice(1),
          mode
        ),
        expected
      );

    case 'fill_gaps': {
      const values = response.kind === 'gaps' ? response.values : [];
      const matches = exercise.gaps.map((gap, i) =>
        matchText(values[i] ?? '', gap.answer, gap.accepted ?? [], mode)
      );
      const correct = matches.length > 0 && matches.every((m) => m.correct);
      const diacriticsOk =
        mode === 'tiles' ? null : correct ? matches.every((m) => m.diacriticsOk !== false) : false;
      return { correct, diacriticsOk, expected };
    }

    case 'find_error': {
      if (response.kind !== 'findError' || response.index === null) {
        return { correct: false, diacriticsOk: mode === 'tiles' ? null : false, expected };
      }
      const match = matchText(response.replacement, exercise.correction, [], mode);
      return {
        correct: response.index === exercise.wrongIndex && match.correct,
        diacriticsOk: match.diacriticsOk,
        expected,
      };
    }

    case 'match_pairs': {
      // Free pairing (docs/stage-3b-spec.md §1): mis-taps are not errors, the learner
      // links everything first and the whole set is graded in one go.
      if (response.kind !== 'pairs') return { correct: false, diacriticsOk: null, expected };
      const allRight = exercise.pairs.every((pair) =>
        response.pairs.some(
          (chosen) => chosen.target === pair.target && chosen.support === pair.support
        )
      );
      return {
        correct: allRight && response.pairs.length === exercise.pairs.length,
        diacriticsOk: null,
        expected,
      };
    }

    case 'order_dialogue': {
      const order = response.kind === 'order' ? response.order : [];
      const correct =
        order.length === exercise.lines.length && order.every((value, i) => value === i);
      return { correct, diacriticsOk: null, expected };
    }

    case 'about_me': {
      // No automatic grading in Stage 3 — the learner's own verdict decides.
      const grade = response.kind === 'selfGrade' ? response.grade : 'no';
      return { correct: grade !== 'no', diacriticsOk: null, expected };
    }
  }
}
