import { useCallback } from 'react';
import type { TranslateWordExercise } from '../content/types';
import { MiniMarkdown } from '../lib/markdownLite';
import { TextAnswerInput } from './widgets/TextAnswerInput';
import type { ExerciseViewProps } from './types';

/** translate_word: the sentence with the bold word, then options / letters / typing. */
export function TranslateWordView({
  exercise,
  mode,
  targetLanguage = 'pt-PT',
  seed,
  onChange,
  onSubmit,
}: ExerciseViewProps<TranslateWordExercise>) {
  const handleText = useCallback(
    (text: string | null) => onChange(text === null ? null : { kind: 'text', text }),
    [onChange]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-sheet px-4 py-3">
        {/* Same 17px body type as the other exercises, with the target word marked. */}
        <MiniMarkdown
          text={exercise.sentence}
          className="flex flex-col gap-3 text-[17px] leading-relaxed text-text"
          strongClassName="rounded bg-highlight/30 px-1 font-semibold"
        />
      </div>
      <TextAnswerInput
        answer={exercise.answer}
        targetLanguage={targetLanguage}
        options={exercise.options}
        mode={mode}
        seed={seed}
        onText={handleText}
        onSubmit={onSubmit}
      />
    </div>
  );
}
