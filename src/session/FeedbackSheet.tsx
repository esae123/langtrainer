import { useId } from 'react';
import { Check, NotebookPen, X } from 'lucide-react';
import type { Exercise } from '../content/types';
import { gradePairs, type SelfGrade } from '../engine/check';
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

/** match_pairs: every pair marked right or wrong, with the correct partner (§1). */
function PairGrades({
  exercise,
  chosen,
}: {
  exercise: Extract<Exercise, { type: 'match_pairs' }>;
  chosen: { target: string; support: string }[];
}) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-1">
      {gradePairs(exercise, chosen).map((grade) => (
        <li
          key={grade.target}
          className={`rounded-lg px-2 py-1 text-[15px] ${
            grade.correct ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'
          }`}
        >
          <span className="font-medium">{grade.target}</span> = {grade.chosen ?? '—'}
          {!grade.correct && (
            <span className="block text-xs">
              {t('session.correctPartner', { answer: grade.expected })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Bottom sheet that slides in over the exercise after every answer. */
export function FeedbackSheet({ exercise, feedback, onContinue, onSelfGrade }: FeedbackSheetProps) {
  const t = useT();
  const titleId = useId();
  const { result, awaitingSelfGrade } = feedback;
  const accentsOnly = result.correct && result.diacriticsOk === false;
  // match_pairs is graded pair by pair instead of as one answer string.
  const matchPairs = exercise.type === 'match_pairs' ? exercise : null;
  const pairs = matchPairs && feedback.response?.kind === 'pairs' ? feedback.response.pairs : null;

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
  const Icon = awaitingSelfGrade ? NotebookPen : result.correct ? Check : X;
  const titleColor = tone === 'wrong' ? 'text-bad' : tone === 'neutral' ? 'text-text' : 'text-ok';

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[480px] rounded-t-2xl border-t border-line bg-sheet px-4 pb-[calc(var(--spacing)*4+env(safe-area-inset-bottom))] pt-4 shadow-xl motion-safe:animate-sheet-up"
      >
        <div aria-live="polite" className={`flex items-center gap-2 ${titleColor}`}>
          <Icon size={22} strokeWidth={2} aria-hidden />
          <h2 id={titleId} className={`text-lg font-semibold ${titleColor}`}>
            {title}
          </h2>
        </div>

        <div className="mt-3 flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
          {matchPairs && pairs && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('session.matchResults')}
              </p>
              <div className="mt-1">
                <PairGrades exercise={matchPairs} chosen={pairs} />
              </div>
            </div>
          )}

          {!pairs && !result.correct && !awaitingSelfGrade && feedback.answer !== '' && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('session.yourAnswer')}
              </p>
              <p className="text-[15px] text-muted line-through">{feedback.answer}</p>
            </div>
          )}

          {!pairs && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {awaitingSelfGrade ? t('session.sampleAnswer') : t('session.correctAnswer')}
              </p>
              <p className="text-[15px] font-medium text-text">{renderCorrectAnswer(exercise)}</p>
              {result.correct && result.matchedAccepted && (
                <p className="mt-0.5 text-xs text-muted">
                  {t('session.alsoAccepted', { answer: result.matchedAccepted })}
                </p>
              )}
            </div>
          )}

          {awaitingSelfGrade && exercise.type === 'about_me' && exercise.hints.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('session.hints')}
              </p>
              <p className="text-[15px] text-text">{exercise.hints.join(' · ')}</p>
            </div>
          )}

          <p className="text-sm leading-relaxed text-muted">{exercise.explanation}</p>
        </div>

        {awaitingSelfGrade ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-text">{t('session.selfGradeQuestion')}</p>
            <div className="flex gap-2">
              {SELF_GRADES.map(({ grade, labelKey }) => (
                <button
                  key={grade}
                  type="button"
                  onClick={() => onSelfGrade(grade)}
                  className={`min-h-12 flex-1 rounded-xl text-sm font-semibold ${
                    grade === 'no' ? 'border border-line text-text' : 'bg-accent text-accent-ink'
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
            className="mt-4 min-h-12 w-full rounded-2xl bg-accent text-base font-semibold text-accent-ink shadow-sm active:opacity-90"
          >
            {t('session.continue')}
          </button>
        )}
      </div>
    </div>
  );
}
