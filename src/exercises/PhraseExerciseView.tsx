import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BuildPhraseExercise, QuestionForAnswerExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { finalPunctuationMark } from '../engine/text';
import { TextAnswerInput } from './widgets/TextAnswerInput';
import { TileBank } from './widgets/TileBank';
import { toTiles } from './widgets/tiles';
import type { ExerciseViewProps } from './types';

type PhraseExercise = BuildPhraseExercise | QuestionForAnswerExercise;

/** build_phrase and question_for_answer: assemble a whole sentence. */
export function PhraseExerciseView({
  exercise,
  mode,
  targetLanguage = 'pt-PT',
  seed,
  onChange,
  onSubmit,
}: ExerciseViewProps<PhraseExercise>) {
  const answerText = exercise.answer.join(' ');
  const finalMark = useMemo(() => finalPunctuationMark(answerText), [answerText]);
  const tiles = useMemo(
    () => toTiles(shuffle([...exercise.answer, ...exercise.distractors], mulberry32(seed))),
    [exercise.answer, exercise.distractors, seed]
  );
  const [placedIds, setPlacedIds] = useState<string[]>([]);

  useEffect(() => {
    if (mode !== 'tiles') return;
    const byId = new Map(tiles.map((tile) => [tile.id, tile.label]));
    const tokens = placedIds.map((id) => byId.get(id) ?? '');
    onChange(tokens.length > 0 ? { kind: 'tokens', tokens } : null);
  }, [mode, placedIds, tiles, onChange]);

  const handleText = useCallback(
    (text: string | null) => onChange(text === null ? null : { kind: 'text', text }),
    [onChange]
  );

  return (
    <div className="flex flex-col gap-4">
      {exercise.type === 'question_for_answer' && (
        <blockquote className="max-w-[90%] self-end rounded-2xl rounded-br-sm border border-line bg-sheet px-4 py-3 text-[17px] text-text">
          {exercise.givenAnswer}
        </blockquote>
      )}

      {mode === 'tiles' ? (
        <TileBank
          tiles={tiles}
          placedIds={placedIds}
          onChange={setPlacedIds}
          slots={exercise.answer.length}
          finalMark={finalMark}
        />
      ) : (
        <TextAnswerInput
          answer={answerText}
          targetLanguage={targetLanguage}
          mode={mode}
          seed={seed}
          onText={handleText}
          onSubmit={onSubmit}
          multiline={mode === 'typing'}
        />
      )}
    </div>
  );
}
