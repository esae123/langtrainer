import { useEffect, useId, useRef } from 'react';
import { Check, LoaderCircle, NotebookPen, Sparkles, X } from 'lucide-react';
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
  /** "Skip — grade myself" while the AI check is running. */
  onSkipAi: () => void;
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
export function FeedbackSheet({
  exercise,
  feedback,
  onContinue,
  onSelfGrade,
  onSkipAi,
}: FeedbackSheetProps) {
  const t = useT();
  const titleId = useId();
  const { result, awaitingSelfGrade, ai } = feedback;
  const aiPending = feedback.aiPending === true;
  const accentsOnly = result.correct && result.diacriticsOk === false;
  // Nothing to dismiss to while the learner still has to self-grade or the AI is checking.
  const blocking = awaitingSelfGrade || aiPending;

  // Escape continues, just like Escape closes the shared Sheet. While the learner still
  // has to self-grade there is nothing to dismiss to, so Escape is ignored then.
  useEffect(() => {
    if (blocking) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onContinue();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [blocking, onContinue]);

  // Hand focus back to whatever had it (the exercise area) when the sheet goes away,
  // so keyboard users don't land back at the top of the document.
  const restoreFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useEffect(() => {
    const previous = restoreFocusRef.current;
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);
  // match_pairs is graded pair by pair instead of as one answer string.
  const matchPairs = exercise.type === 'match_pairs' ? exercise : null;
  const pairs = matchPairs && feedback.response?.kind === 'pairs' ? feedback.response.pairs : null;

  const aboutMe = exercise.type === 'about_me';
  // The self-grade shows a "sample answer" for about_me and the model answer otherwise.
  const selfGradeLabel = aboutMe ? t('session.sampleAnswer') : t('session.modelAnswer');
  const tone =
    awaitingSelfGrade || aiPending
      ? 'neutral'
      : result.correct
        ? accentsOnly
          ? 'accents'
          : 'correct'
        : 'wrong';
  const title = aiPending
    ? t('session.aiChecking')
    : awaitingSelfGrade
      ? selfGradeLabel
      : tone === 'wrong'
        ? t('session.feedbackWrong')
        : ai?.verdict === 'almost'
          ? t('session.aiAlmost')
          : tone === 'accents'
            ? t('session.feedbackAccents')
            : t('session.feedbackCorrect');
  const Icon = aiPending
    ? LoaderCircle
    : awaitingSelfGrade
      ? NotebookPen
      : result.correct
        ? Check
        : X;
  // The learner's own answer stays visible around the AI check; struck through only
  // when it was judged wrong.
  const aiInvolved = aiPending || feedback.aiFallback === true || ai !== undefined;
  const showYourAnswer =
    !pairs && feedback.answer !== '' && (aiInvolved || (!result.correct && !awaitingSelfGrade));
  const strikeYourAnswer = !result.correct && !awaitingSelfGrade && !aiPending;
  const showCorrection =
    ai !== undefined &&
    ai.correction !== '' &&
    (ai.verdict !== 'correct' || ai.correction !== feedback.answer.trim());
  const titleColor = tone === 'wrong' ? 'text-bad' : tone === 'neutral' ? 'text-text' : 'text-ok';

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[480px] rounded-t-2xl border-t border-line bg-sheet px-4 pb-[calc(var(--spacing)*4+env(safe-area-inset-bottom))] pt-4 shadow-xl motion-safe:animate-sheet-up"
      >
        <div aria-live="polite" className={`flex flex-wrap items-center gap-2 ${titleColor}`}>
          <Icon
            size={22}
            strokeWidth={2}
            aria-hidden
            className={aiPending ? 'motion-safe:animate-spin' : undefined}
          />
          <h2 id={titleId} className={`text-lg font-semibold ${titleColor}`}>
            {title}
          </h2>
          {ai && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              <Sparkles size={12} strokeWidth={2} aria-hidden />
              {t('session.aiCheckedBy')}
            </span>
          )}
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

          {showYourAnswer && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('session.yourAnswer')}
              </p>
              <p
                className={`break-words text-[15px] ${
                  strikeYourAnswer ? 'text-muted line-through' : 'text-text'
                }`}
              >
                {feedback.answer}
              </p>
            </div>
          )}

          {ai && (showCorrection || ai.explanation !== '') && (
            <div aria-live="polite" className="flex flex-col gap-1">
              {showCorrection && (
                <div
                  className={`rounded-xl px-3 py-2 ${
                    ai.verdict === 'incorrect' ? 'bg-bad-bg' : 'bg-ok-bg'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('session.aiCorrection')}
                  </p>
                  <p
                    className={`break-words text-[15px] font-medium ${
                      ai.verdict === 'incorrect' ? 'text-bad' : 'text-ok'
                    }`}
                  >
                    {ai.correction}
                  </p>
                </div>
              )}
              {ai.explanation !== '' && (
                <p className="break-words text-sm text-text">{ai.explanation}</p>
              )}
            </div>
          )}

          {feedback.aiFallback && awaitingSelfGrade && (
            <p className="text-sm text-muted">{t('session.aiFallbackNote')}</p>
          )}

          {!pairs && !aiPending && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {awaitingSelfGrade ? selfGradeLabel : t('session.correctAnswer')}
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

          {!aiPending && (
            <p className="text-sm leading-relaxed text-muted">{exercise.explanation}</p>
          )}
        </div>

        {aiPending ? (
          <button
            type="button"
            autoFocus
            onClick={onSkipAi}
            className="mt-4 min-h-11 w-full rounded-2xl text-sm font-semibold text-accent underline underline-offset-4"
          >
            {t('session.aiSkip')}
          </button>
        ) : awaitingSelfGrade ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-text">{t('session.selfGradeQuestion')}</p>
            <div className="flex gap-2">
              {SELF_GRADES.map(({ grade, labelKey }, i) => (
                <button
                  key={grade}
                  type="button"
                  // Focus starts on the first option so the sheet is reachable by keyboard.
                  autoFocus={i === 0}
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
