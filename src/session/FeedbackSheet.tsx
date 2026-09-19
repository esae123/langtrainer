import { useId } from 'react';
import type { Exercise } from '../content/types';
import type { SelfGrade } from '../engine/check';
import { useT, type TranslationKey } from '../i18n';
import { renderCorrectAnswer } from '../lib/renderExercise';
import type { FeedbackState } from './sessionState';

interface FeedbackSheetProps {
  exercise: Exercise;
  feedback: FeedbackState;
  onContinue: () => void;
  onSelfGrade: (grade: SelfGrade) => void;
}

const SELF_GRADES: { grade: SelfGrade; labelKey: TranslationKey }[] = [
  { grade: 'yes', labelKey: 'session.selfGrade.yes' },
  { grade: 'mostly', labelKey: 'session.selfGrade.mostly' },
  { grade: 'no', labelKey: 'session.selfGrade.no' },
];

/** Bottom sheet that slides in over the exercise after every answer. */
export function FeedbackSheet({ exercise, feedback, onContinue, onSelfGrade }: FeedbackSheetProps) {
  const t = useT();
  const titleId = useId();
  const { result, awaitingSelfGrade } = feedback;
  const accentsOnly = result.correct && result.diacriticsOk === false;

  const tone = awaitingSelfGrade
    ? 'neutral'
    : result.correct
      ? accentsOnly
        ? 'accents'
        : 'correct'
      : 'wrong';
  const title = awaitingSelfGrade
    ? t('session.sampleAnswer')
    : tone === 'wrong'
      ? t('session.feedbackWrong')
      : tone === 'accents'
        ? t('session.feedbackAccents')
        : t('session.feedbackCorrect');
  const icon = awaitingSelfGrade ? '📝' : result.correct ? '✅' : '❌';
  const titleColor =
    tone === 'wrong'
      ? 'text-rose-700 dark:text-rose-300'
      : tone === 'neutral'
        ? 'text-slate-900 dark:text-slate-50'
        : 'text-emerald-700 dark:text-emerald-300';

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[480px] rounded-t-2xl border-t border-slate-200 bg-white px-4 pb-[calc(var(--spacing)*4+env(safe-area-inset-bottom))] pt-4 shadow-xl motion-safe:animate-sheet-up dark:border-slate-800 dark:bg-slate-900"
      >
        <div aria-live="polite" className="flex items-center gap-2">
          <span aria-hidden className="text-xl">
            {icon}
          </span>
          <h2 id={titleId} className={`text-lg font-semibold ${titleColor}`}>
            {title}
          </h2>
        </div>

        <div className="mt-3 flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
          {!result.correct && !awaitingSelfGrade && feedback.answer !== '' && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t('session.yourAnswer')}
              </p>
              <p className="text-[15px] text-slate-500 line-through dark:text-slate-400">
                {feedback.answer}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {awaitingSelfGrade ? t('session.sampleAnswer') : t('session.correctAnswer')}
            </p>
            <p className="text-[15px] font-medium text-slate-900 dark:text-slate-50">
              {renderCorrectAnswer(exercise)}
            </p>
            {result.correct && result.matchedAccepted && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t('session.alsoAccepted', { answer: result.matchedAccepted })}
              </p>
            )}
          </div>

          {awaitingSelfGrade && exercise.type === 'about_me' && exercise.hints.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t('session.hints')}
              </p>
              <p className="text-[15px] text-slate-700 dark:text-slate-200">
                {exercise.hints.join(' · ')}
              </p>
            </div>
          )}

          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {exercise.explanation}
          </p>
        </div>

        {awaitingSelfGrade ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('session.selfGradeQuestion')}
            </p>
            <div className="flex gap-2">
              {SELF_GRADES.map(({ grade, labelKey }) => (
                <button
                  key={grade}
                  type="button"
                  onClick={() => onSelfGrade(grade)}
                  className={`min-h-12 flex-1 rounded-xl text-sm font-semibold ${
                    grade === 'no'
                      ? 'border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200'
                      : 'bg-accent-600 text-white'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            autoFocus
            onClick={onContinue}
            className="mt-4 min-h-12 w-full rounded-2xl bg-accent-600 text-base font-semibold text-white shadow-sm active:opacity-90"
          >
            {t('session.continue')}
          </button>
        )}
      </div>
    </div>
  );
}
