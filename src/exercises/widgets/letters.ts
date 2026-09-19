// Pure helpers for the LetterBoard: which positions the learner has to fill, how the
// typed letters compose back into the answer, and which keys the board offers.
import { shuffle, type Rng } from '../../engine/rng';

/**
 * Characters shown pre-filled in the boxes: separators and punctuation, so the learner
 * only ever produces letters (an answer like "Eu falo inglês." would otherwise need a
 * full-stop key). Terminal punctuation is dropped from a partially composed answer,
 * which is harmless because normalize() ignores it when checking.
 */
export const PREFILLED_CHARS = new Set([
  ' ',
  '-',
  "'",
  '’',
  '.',
  ',',
  '!',
  '?',
  ':',
  ';',
  '«',
  '»',
  '"',
]);

/** Accent families used to pick "twin" distractor letters first. */
export const LETTER_TWINS: string[][] = [
  ['a', 'á', 'ã', 'à', 'â'],
  ['e', 'é', 'ê'],
  ['o', 'ó', 'õ', 'ô'],
  ['i', 'í'],
  ['u', 'ú'],
  ['c', 'ç'],
];

const COMMON_LETTERS = ['a', 'e', 'o', 's', 'r', 'm', 't', 'i', 'n', 'l', 'u', 'd', 'p', 'v'];
const DISTRACTOR_COUNT = 4;

export function isPrefilled(char: string): boolean {
  return PREFILLED_CHARS.has(char);
}

/** The answer split into rows of characters — one row per word. */
export function letterRows(answer: string): string[][] {
  return answer
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word.toLowerCase()]);
}

/** How many characters the learner has to type (everything except pre-filled ones). */
export function fillableCount(answer: string): number {
  return letterRows(answer)
    .flat()
    .filter((char) => !isPrefilled(char)).length;
}

/**
 * Rebuilds the answer text from the letters typed so far: pre-filled characters come
 * from the answer itself, the rest from `typed` in order. Missing letters are omitted.
 */
export function composeLetters(answer: string, typed: string): string {
  const source = [...typed];
  const rows = letterRows(answer);
  let cursor = 0;
  let out = '';
  for (let row = 0; row < rows.length; row += 1) {
    // Stop at the first box the learner has not filled yet.
    if (cursor >= source.length && row > 0) return out;
    if (row > 0) out += ' ';
    for (const char of rows[row]) {
      if (cursor >= source.length) return out;
      out += isPrefilled(char) ? char : source[cursor++];
    }
  }
  return out;
}

export interface LetterBox {
  /** The character from the answer this box belongs to. */
  char: string;
  /** What to display: the answer's own character, the typed letter, or ''. */
  value: string;
  /** Pre-filled separators are not typed by the learner. */
  fixed: boolean;
}

/** The boxes to render, one row per word, with the typed letters already placed. */
export function letterBoxes(answer: string, typed: string): LetterBox[][] {
  const rows = letterRows(answer);
  let cursor = 0;
  const out: LetterBox[][] = [];
  for (const row of rows) {
    const boxes: LetterBox[] = [];
    for (const char of row) {
      if (isPrefilled(char)) {
        boxes.push({ char, value: char, fixed: true });
        continue;
      }
      boxes.push({ char, value: cursor < typed.length ? typed[cursor] : '', fixed: false });
      cursor += 1;
    }
    out.push(boxes);
  }
  return out;
}

export function isLettersComplete(answer: string, typed: string): boolean {
  return typed.length >= fillableCount(answer) && fillableCount(answer) > 0;
}

/** The letter keys: every letter of the answer plus a few plausible distractors. */
export function letterKeys(answer: string, rng: Rng): string[] {
  const needed = new Set(
    letterRows(answer)
      .flat()
      .filter((char) => !isPrefilled(char))
  );
  const distractors: string[] = [];
  const add = (char: string) => {
    if (needed.has(char) || distractors.includes(char)) return;
    if (distractors.length >= DISTRACTOR_COUNT) return;
    distractors.push(char);
  };

  // Accent twins of letters that really are in the answer make the best distractors.
  for (const family of LETTER_TWINS) {
    if (!family.some((char) => needed.has(char))) continue;
    for (const char of family) add(char);
  }
  for (const char of COMMON_LETTERS) add(char);

  return shuffle([...needed, ...distractors], rng);
}
