import { describe, expect, it } from 'vitest';
import type { Exercise } from '../../content/types';
import { makeBuildPhrase, makeTranslateWord } from '../../test/fixtures';
import { hintExpectedFor, hintLetterCount, typingHintWords } from '../hint';

/** The rendered hint line, the way TypingHint composes it. */
function line(expected: string): string | null {
  const words = typingHintWords(expected);
  if (!words) return null;
  return `${words.map((w) => w.skeleton).join('   ')} (${hintLetterCount(words)} letters)`;
}

describe('typingHintWords', () => {
  it('shows the first letter, one underscore per remaining letter and the length', () => {
    expect(line('sopa')).toBe('s _ _ _ (4 letters)');
    expect(typingHintWords('sopa')).toEqual([{ skeleton: 's _ _ _', letters: 4 }]);
  });

  it('lowercases the first letter and keeps accents as the letter itself', () => {
    expect(line('Ótimo')).toBe('ó _ _ _ _ (5 letters)');
  });

  it('shows hyphens and apostrophes as themselves without counting them', () => {
    expect(line('chamo-me')).toBe('c _ _ _ _ - _ _ (7 letters)');
    expect(line("d'água")).toBe("d ' _ _ _ _ (5 letters)");
  });

  it('hints two-word answers per word with the total length', () => {
    expect(line('boa noite')).toBe('b _ _   n _ _ _ _ (8 letters)');
  });

  it('gives no hint for three words or more, or for an empty answer', () => {
    expect(typingHintWords('eu falo inglês')).toBeNull();
    expect(typingHintWords('   ')).toBeNull();
    expect(typingHintWords('')).toBeNull();
  });

  it('drops trailing punctuation the checker ignores anyway', () => {
    expect(line('olá!')).toBe('o _ _ (3 letters)');
  });
});

describe('hintExpectedFor', () => {
  const translate = makeTranslateWord('tw', 't1');
  const build = makeBuildPhrase('bp', 't1');

  it('only hints in typing mode', () => {
    expect(hintExpectedFor(translate, 'tiles')).toBeNull();
    expect(hintExpectedFor(translate, 'letters')).toBeNull();
    expect(hintExpectedFor(translate, 'typing')).toBe('trabalho');
  });

  it('uses the right field per type', () => {
    const numberSequence: Exercise = {
      id: 'ns',
      type: 'number_sequence',
      topicId: 't1',
      difficulty: 1,
      allowedModes: ['typing'],
      prompt: 'p',
      explanation: 'e',
      sequence: [1, null],
      answerWords: ['cinco', '5'],
      options: ['cinco'],
    };
    const findError: Exercise = {
      id: 'fe',
      type: 'find_error',
      topicId: 't1',
      difficulty: 1,
      allowedModes: ['typing'],
      prompt: 'p',
      explanation: 'e',
      sentence: ['Eu', 'falas'],
      wrongIndex: 1,
      correction: 'falo',
      options: ['falo'],
    };
    expect(hintExpectedFor(numberSequence, 'typing')).toBe('cinco');
    expect(hintExpectedFor(findError, 'typing')).toBe('falo');
    // Long phrases return their answer, which typingHintWords then refuses to hint.
    expect(hintExpectedFor(build, 'typing')).toBe('Eu falo inglês.');
    expect(typingHintWords(hintExpectedFor(build, 'typing')!)).toBeNull();
  });

  it('leaves fill_gaps, matching, ordering and about_me without a prompt hint', () => {
    const matchPairs: Exercise = {
      id: 'mp',
      type: 'match_pairs',
      topicId: 't1',
      difficulty: 1,
      allowedModes: ['tiles'],
      prompt: 'p',
      explanation: 'e',
      pairs: [{ target: 'falo', support: 'I speak' }],
    };
    expect(hintExpectedFor(matchPairs, 'typing')).toBeNull();
  });
});
