import { useCallback, useEffect, useState } from 'react';
import type { FindErrorExercise } from '../content/types';
import { useT } from '../i18n';
import { hapticTap } from '../lib/haptics';
import { TextAnswerInput } from './widgets/TextAnswerInput';
import type { ExerciseViewProps } from './types';

/** find_error: tap the wrong word, then choose or spell the correct one. */
export function FindErrorView({
  exercise,
  mode,
  seed,
  onChange,
  onSubmit,
}: ExerciseViewProps<FindErrorExercise>) {
  const t = useT();
  const [index, setIndex] = useState<number | null>(null);
  const [replacement, setReplacement] = useState<string | null>(null);

  useEffect(() => {
    onChange(
      index !== null && replacement !== null ? { kind: 'findError', index, replacement } : null
    );
  }, [index, replacement, onChange]);

  const handleText = useCallback((text: string | null) => setReplacement(text), []);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {t('session.tapWrongWord')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('session.sentence')}
        className="flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-3 dark:bg-slate-800/60"
      >
        {exercise.sentence.map((token, i) => {
          const selected = index === i;
          return (
            <button
              key={`${i}-${token}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                hapticTap();
                setIndex(i);
              }}
              className={`min-h-11 rounded-xl border px-3 py-2 text-[17px] font-medium transition-transform active:scale-[0.97] ${
                selected
                  ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-100'
                  : 'border-transparent bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              {token}
            </button>
          );
        })}
      </div>

      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {mode === 'tiles' ? t('session.chooseCorrection') : t('session.typeCorrection')}
      </p>
      <TextAnswerInput
        answer={exercise.correction}
        options={exercise.options}
        mode={mode}
        seed={seed}
        onText={handleText}
        onSubmit={onSubmit}
        label={t('session.chooseCorrection')}
      />
    </div>
  );
}
