import { useCallback } from 'react';
import type { NumberSequenceExercise } from '../content/types';
import { useT } from '../i18n';
import { TextAnswerInput } from './widgets/TextAnswerInput';
import type { ExerciseViewProps } from './types';

/** number_sequence: `1 · 3 · ? · 7` as chips, then options / letters / typing. */
export function NumberSequenceView({
  exercise,
  mode,
  targetLanguage = 'pt-PT',
  seed,
  onChange,
  onSubmit,
}: ExerciseViewProps<NumberSequenceExercise>) {
  const t = useT();
  const handleText = useCallback(
    (text: string | null) => onChange(text === null ? null : { kind: 'text', text }),
    [onChange]
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-label={t('session.sequence')}
        className="flex flex-wrap items-center justify-center gap-2"
      >
        {exercise.sequence.map((value, i) => (
          <span
            key={i}
            className={`flex h-12 min-w-12 items-center justify-center rounded-xl border px-3 text-lg font-semibold ${
              value === null
                ? 'border-accent bg-accent-soft text-text'
                : 'border-line bg-sheet text-text'
            }`}
          >
            {value === null ? '?' : value}
          </span>
        ))}
      </div>
      <TextAnswerInput
        answer={exercise.answerWords[0] ?? ''}
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
