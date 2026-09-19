import { useMemo } from 'react';
import { mulberry32 } from '../../engine/rng';
import { useT } from '../../i18n';
import { hapticTap } from '../../lib/haptics';
import { letterBoxes, letterKeys } from './letters';

interface LetterBoardProps {
  /** The target text; its characters define the boxes. */
  answer: string;
  /** Letters typed so far, in order, for the fillable positions only. */
  typed: string;
  onChange: (typed: string) => void;
  seed: number;
}

/**
 * One box per character of the answer (spaces, hyphens and apostrophes pre-filled),
 * with a letter keyboard built from the answer's own letters plus a few distractors.
 * Keys never disappear once used; comparison is case-insensitive.
 */
export function LetterBoard({ answer, typed, onChange, seed }: LetterBoardProps) {
  const t = useT();
  const keys = useMemo(() => letterKeys(answer, mulberry32(seed)), [answer, seed]);
  const boxRows = letterBoxes(answer, typed);
  const filled = typed.length;
  const total = boxRows.flat().filter((box) => !box.fixed).length;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-col gap-2"
        aria-label={t('session.letterBoard', { filled, total })}
        role="group"
      >
        {boxRows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex flex-wrap gap-1.5">
            {row.map((box, i) => (
              <span
                key={i}
                className={`flex h-11 min-w-8 items-center justify-center rounded-lg border px-1 text-[17px] font-semibold ${
                  box.fixed
                    ? 'border-transparent text-slate-400 dark:text-slate-500'
                    : box.value
                      ? 'border-accent-300 bg-accent-50 text-accent-800 dark:border-accent-700/60 dark:bg-accent-700/20 dark:text-accent-100'
                      : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                {box.value || ' '}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" aria-label={t('session.letterKeys')} role="group">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              hapticTap();
              if (typed.length < total) onChange(typed + key);
            }}
            className="min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-[17px] font-semibold text-slate-800 shadow-sm transition-transform active:scale-[0.97] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          aria-label={t('session.backspace')}
          onClick={() => {
            hapticTap();
            onChange(typed.slice(0, -1));
          }}
          className="min-h-11 min-w-11 rounded-xl border border-slate-200 bg-slate-100 px-3 text-[17px] text-slate-600 shadow-sm transition-transform active:scale-[0.97] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
