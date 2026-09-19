// "First letter + length" hint for typed answers (docs/stage-3b-spec.md §3).
// Pure: no React, no Dexie, no clock.
import type { Exercise, InputMode } from '../content/types';

/** Answers longer than this (in words) get no hint — they would give too much away. */
export const MAX_HINT_WORDS = 2;

/** Characters that are shown as themselves instead of an underscore. */
const SHOWN_AS_IS = new Set(['-', "'", '’']);
/** Punctuation the checker ignores anyway, so the hint drops it too. */
const TRAILING_PUNCTUATION = /[.,!?;:…]+$/u;

export interface HintWord {
  /** e.g. `s _ _ _ _` (first letter, then one underscore per remaining letter). */
  skeleton: string;
  /** Letters the learner has to type in this word (separators excluded). */
  letters: number;
}

function hintWord(word: string): HintWord | null {
  const cleaned = word.replace(TRAILING_PUNCTUATION, '');
  if (cleaned === '') return null;

  const parts: string[] = [];
  let letters = 0;
  let firstLetterShown = false;
  for (const char of cleaned) {
    if (SHOWN_AS_IS.has(char)) {
      parts.push(char);
      continue;
    }
    letters += 1;
    if (firstLetterShown) {
      parts.push('_');
    } else {
      parts.push(char.toLocaleLowerCase());
      firstLetterShown = true;
    }
  }
  if (letters === 0) return null;
  return { skeleton: parts.join(' '), letters };
}

/**
 * The per-word hint for an expected answer, or `null` when no hint should be shown
 * (empty answer, or more than two words).
 */
export function typingHintWords(expected: string): HintWord[] | null {
  const words = expected.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0 || words.length > MAX_HINT_WORDS) return null;
  const hints = words.map(hintWord).filter((word): word is HintWord => word !== null);
  return hints.length === 0 ? null : hints;
}

/** Total number of letters across the hinted words. */
export function hintLetterCount(words: readonly HintWord[]): number {
  return words.reduce((sum, word) => sum + word.letters, 0);
}

/**
 * The answer a typing hint should describe for this exercise, or `null` when the type
 * or mode gets no hint. `fill_gaps` is handled by its own view (one hint per gap).
 */
export function hintExpectedFor(exercise: Exercise, mode: InputMode): string | null {
  if (mode !== 'typing') return null;
  switch (exercise.type) {
    case 'translate_word':
      return exercise.answer;
    case 'number_sequence':
      return exercise.answerWords[0] ?? null;
    case 'find_error':
      return exercise.correction;
    case 'build_phrase':
    case 'question_for_answer':
      // typingHintWords drops anything longer than two words, which is the common case.
      return exercise.answer.join(' ');
    case 'fill_gaps':
    case 'match_pairs':
    case 'order_dialogue':
    case 'about_me':
      return null;
  }
}
