// Renders the "correct answer" of an Exercise as a single human-readable string, per type,
// for the Content library detail screen (docs/content-authoring.md §4 lists the shape of
// each type). Not used by the (future) training UI — this is a read-only summary view.
import type { Exercise } from '../content/types';

export function renderCorrectAnswer(exercise: Exercise): string {
  switch (exercise.type) {
    case 'build_phrase':
      return exercise.answer.join(' ');
    case 'fill_gaps': {
      let gapIndex = 0;
      return exercise.template.replace(/___/g, () => exercise.gaps[gapIndex++]?.answer ?? '___');
    }
    case 'question_for_answer':
      return exercise.answer.join(' ');
    case 'about_me':
      return exercise.sampleAnswer;
    case 'find_error': {
      const tokens = [...exercise.sentence];
      tokens[exercise.wrongIndex] = exercise.correction;
      return tokens.join(' ');
    }
    case 'number_sequence':
      return exercise.sequence
        .map((n) => (n === null ? exercise.answerWords[0] ?? '?' : String(n)))
        .join(', ');
    case 'match_pairs':
      return exercise.pairs.map((p) => `${p.target} = ${p.support}`).join('  ·  ');
    case 'order_dialogue':
      return exercise.lines.map((l) => `${l.speaker}: ${l.text}`).join('  /  ');
    case 'translate_word':
      return `${exercise.word} → ${exercise.answer}`;
  }
}

/** "●●○" for difficulty 2 of 3 — a compact visual difficulty indicator. */
export function difficultyDots(difficulty: 1 | 2 | 3): string {
  return '●'.repeat(difficulty) + '○'.repeat(3 - difficulty);
}
