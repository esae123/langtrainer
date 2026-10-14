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
  targetLanguage = 'pt-PT',
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
      <p className="text-xs font-medium text-muted">{t('session.tapWrongWord')}</p>
      <div
        role="radiogroup"
        aria-label={t('session.sentence')}
        className="flex flex-wrap gap-2 rounded-2xl border border-line bg-sheet p-3"
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
                  ? 'border-highlight bg-highlight/30 text-text'
                  : 'border-transparent bg-sheet text-text shadow-sm'
              }`}
            >
              {token}
            </button>
          );
        })}
      </div>

      <p className="text-xs font-medium text-muted">
        {mode === 'tiles' ? t('session.chooseCorrection') : t('session.typeCorrection')}
      </p>
      <TextAnswerInput
        answer={exercise.correction}
        targetLanguage={targetLanguage}
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
