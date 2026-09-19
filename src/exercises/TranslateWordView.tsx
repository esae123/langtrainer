import { useCallback } from 'react';
import type { TranslateWordExercise } from '../content/types';
import { MiniMarkdown } from '../lib/markdownLite';
import { TextAnswerInput } from './widgets/TextAnswerInput';
import type { ExerciseViewProps } from './types';

/** translate_word: the sentence with the bold word, then options / letters / typing. */
export function TranslateWordView({
  exercise,
  mode,
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
      <div className="rounded-2xl bg-slate-100 px-4 py-3 text-[17px] leading-relaxed dark:bg-slate-800/60">
        <MiniMarkdown text={exercise.sentence} />
      </div>
      <TextAnswerInput
        answer={exercise.answer}
        options={exercise.options}
        mode={mode}
        seed={seed}
        onText={handleText}
        onSubmit={onSubmit}
      />
    </div>
  );
}
