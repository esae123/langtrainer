import { useCallback } from 'react';
import type { NumberSequenceExercise } from '../content/types';
import { useT } from '../i18n';
import { TextAnswerInput } from './widgets/TextAnswerInput';
import type { ExerciseViewProps } from './types';

/** number_sequence: `1 · 3 · ? · 7` as chips, then options / letters / typing. */
export function NumberSequenceView({
  exercise,
  mode,
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
                ? 'border-accent-400 bg-accent-50 text-accent-700 dark:border-accent-600 dark:bg-accent-700/20 dark:text-accent-200'
                : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
            }`}
          >
            {value === null ? '?' : value}
          </span>
        ))}
      </div>
      <TextAnswerInput
        answer={exercise.answerWords[0] ?? ''}
        options={exercise.options}
        mode={mode}
        seed={seed}
        onText={handleText}
        onSubmit={onSubmit}
      />
    </div>
  );
}
