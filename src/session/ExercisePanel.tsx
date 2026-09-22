import { useCallback, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ExerciseResponse, SelfGrade } from '../engine/check';
import type { PlannedItem } from '../engine/plan';
import { hintExpectedFor } from '../engine/hint';
import { hashString } from '../engine/rng';
import { ExerciseArea } from '../exercises/ExerciseArea';
import { TypingHint } from '../exercises/widgets/TypingHint';
import { useT } from '../i18n';
import { FeedbackSheet } from './FeedbackSheet';
import type { FeedbackState } from './sessionState';

interface ExercisePanelProps {
  item: PlannedItem;
  /** Zero-based position in the plan. */
  index: number;
  /** Planned length, or 0 for an open-ended session. */
  total: number;
  /** Small label in the top bar, e.g. "Review · Greetings". */
  blockLabel: string;
  /** Slim banner shown on the first exercise of a review/phrases block. */
  banner: string | null;
  feedback: FeedbackState | null;
  onSubmit: (response: ExerciseResponse) => void;
  onContinue: () => void;
  onSelfGrade: (grade: SelfGrade) => void;
  onStop: () => void;
}

/** The exercise screen: top bar with progress and stop, body, and the Check button. */
export function ExercisePanel({
  item,
  index,
  total,
  blockLabel,
  banner,
  feedback,
  onSubmit,
  onContinue,
  onSelfGrade,
  onStop,
}: ExercisePanelProps) {
  const t = useT();
  const [response, setResponse] = useState<ExerciseResponse | null>(null);
  const handleChange = useCallback((next: ExerciseResponse | null) => setResponse(next), []);
  const submit = useCallback(() => {
    if (response) onSubmit(response);
  }, [response, onSubmit]);

  const open = total === 0;
  const progressText = open
    ? t('session.progressOpen', { index: index + 1 })
    : t('session.progress', { index: index + 1, total });
  const progressLabel = open
    ? t('session.progressLabelOpen', { index: index + 1 })
    : t('session.progressLabel', { index: index + 1, total });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-sheet/95 px-4 pb-2 pt-[calc(var(--spacing)*3+env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-accent">
              {blockLabel}
            </p>
            <p aria-label={progressLabel} className="text-sm font-medium text-muted">
              {progressText}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('session.stop')}
            onClick={onStop}
            className="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted"
          >
            <X size={24} strokeWidth={2} aria-hidden />
          </button>
        </div>
        {!open && (
          <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.round((index / Math.max(total, 1)) * 100)}%` }}
            />
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {banner && (
          <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-xs font-semibold text-accent">
            {banner}
          </p>
        )}
        <p className="mb-2 text-[15px] font-medium text-muted">{item.exercise.prompt}</p>
        <TypingHint expected={hintExpectedFor(item.exercise, item.mode)} className="mb-4" />
        <ExerciseArea
          key={item.exercise.id}
          exercise={item.exercise}
          mode={item.mode}
          seed={hashString(item.exercise.id)}
          onChange={handleChange}
          onSubmit={submit}
        />
      </div>

      <div className="sticky bottom-0 border-t border-line bg-sheet/95 px-4 pt-3 pb-[calc(var(--spacing)*3+env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          disabled={!response}
          onClick={submit}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-ink shadow-sm transition-opacity active:opacity-90 disabled:bg-line disabled:text-muted"
        >
          <Check size={20} strokeWidth={2} aria-hidden />
          {t('session.check')}
        </button>
      </div>

      {feedback && (
        <FeedbackSheet
          exercise={item.exercise}
          feedback={feedback}
          onContinue={onContinue}
          onSelfGrade={onSelfGrade}
        />
      )}
    </div>
  );
}
