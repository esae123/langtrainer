import { Check, Play, Repeat, RotateCcw } from 'lucide-react';
import { Card } from '../components/Card';
import type { Program } from '../content/types';
import type { BlockKind } from '../engine/plan';
import { DAY_MS, type TopicOutcome } from '../engine/progress';
import { useT, type TranslationKey } from '../i18n';
import type { SessionState } from './sessionState';
import { topicInfo } from './topicLookup';

interface SummaryPanelProps {
  state: SessionState;
  /** Status changes; briefly `null` while end-of-session progress is written. */
  outcomes: TopicOutcome[] | null;
  program: Program | undefined;
  onDone: () => void;
  onAnother: () => void;
  /** Practice run over the wrong answers of this session (docs/stage-3b-spec.md §4). */
  onRetryMistakes: () => void;
  /** Practice run over every exercise of this session. */
  onRepeat: () => void;
}

const BLOCK_LABELS: Record<BlockKind, TranslationKey> = {
  new: 'session.block.new',
  review: 'session.summaryReviewBlock',
  phrases: 'session.block.phrases',
};

function days(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / DAY_MS));
}

export function SummaryPanel({
  state,
  outcomes,
  program,
  onDone,
  onAnother,
  onRetryMistakes,
  onRepeat,
}: SummaryPanelProps) {
  const t = useT();
  const total = state.responses.length;
  const correct = state.responses.filter((draft) => draft.correct).length;
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);
  const endedAt = state.endedAt ?? Date.now();
  const practice = state.plan.kind === 'practice';
  const wrong = total - correct;

  const blocks = (['new', 'review', 'phrases'] as BlockKind[])
    .map((block) => {
      const drafts = state.responses.filter((draft) => draft.block === block);
      return {
        block,
        total: drafts.length,
        correct: drafts.filter((draft) => draft.correct).length,
      };
    })
    .filter((row) => row.total > 0);

  /** The status change to show for a topic, or `null` for "just practised". */
  function changeFor(outcome: TopicOutcome): { key: TranslationKey; days?: number } | null {
    const { before, after } = outcome;
    if (after.status === 'mastered' && before.status !== 'mastered') {
      return { key: 'session.change.mastered' };
    }
    if (after.status === 'maintenance' && before.status !== 'maintenance') {
      return { key: 'session.change.maintenance' };
    }
    if (after.firstCompletedAt !== undefined && after.firstCompletedAt >= state.startedAt) {
      // The first review is scheduled relative to the moment the topic was completed
      // (mid-session), so measure the interval from there rather than from the summary.
      return {
        key: 'session.change.firstCompleted',
        days: after.nextReviewAt ? days(after.firstCompletedAt, after.nextReviewAt) : 7,
      };
    }
    if (!outcome.srsApplied || after.nextReviewAt === undefined) return null;
    if (after.nextReviewAt === before.nextReviewAt) return null;
    const key: TranslationKey =
      after.reviewStage > before.reviewStage
        ? 'session.change.readyForReview'
        : 'session.change.retry';
    return { key, days: days(endedAt, after.nextReviewAt) };
  }

  const topicRows = (
    outcomes ??
    [...new Set(state.responses.map((draft) => draft.topicId))].map((topicId) => ({
      topicId,
      correct: state.responses.filter((d) => d.topicId === topicId && d.correct).length,
      total: state.responses.filter((d) => d.topicId === topicId).length,
      before: { status: 'learning' as const, reviewStage: 0 as const },
      after: { status: 'learning' as const, reviewStage: 0 as const },
      reviewed: false,
      srsApplied: false,
    }))
  ).map((outcome) => ({ outcome, info: topicInfo(program, outcome.topicId) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-[calc(var(--spacing)*6+env(safe-area-inset-top))]">
        <div className="flex flex-col items-center gap-1 text-center">
          {state.interrupted && (
            <span className="rounded-full bg-highlight/30 px-2.5 py-0.5 text-xs font-semibold text-text">
              {t('session.summaryInterrupted')}
            </span>
          )}
          <p
            aria-label={t('session.summaryScore', { correct, total })}
            className="text-5xl font-semibold tabular-nums text-accent"
          >
            {percentage}%
          </p>
          <h1 className="text-lg font-semibold text-text">
            {practice ? t('session.practiceTitle') : t('session.summaryTitle')}
          </h1>
          <p className="text-sm text-muted">{t('session.summaryScore', { correct, total })}</p>
          {practice && state.plan.fromMistakes && (
            <p className="text-sm font-medium text-accent">
              {t('session.practiceFixed', { fixed: correct, of: state.plan.items.length })}
            </p>
          )}
        </div>

        {total === 0 ? (
          <Card className="mt-6">
            <p className="text-sm text-muted">{t('session.summaryEmpty')}</p>
          </Card>
        ) : (
          <>
            <section className="mt-6">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {t('session.summaryBlocks')}
              </h2>
              <Card className="!p-0">
                <ul className="divide-y divide-line">
                  {blocks.map((row) => (
                    <li
                      key={row.block}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="text-sm text-text">{t(BLOCK_LABELS[row.block])}</span>
                      <span className="text-sm font-medium tabular-nums text-text">
                        {row.correct}/{row.total}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            {/* Practice changes no topic status, so there is nothing to report. */}
            {!practice && (
              <section className="mt-5">
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('session.summaryTopics')}
                </h2>
                <Card className="!p-0">
                  <ul className="divide-y divide-line">
                    {topicRows.map(({ outcome, info }) => {
                      const change = changeFor(outcome);
                      return (
                        <li key={outcome.topicId} className="px-4 py-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-medium text-text">{info.title}</p>
                            <span className="shrink-0 text-sm tabular-nums text-muted">
                              {outcome.correct}/{outcome.total}
                            </span>
                          </div>
                          {change && (
                            <p className="mt-0.5 text-xs font-medium text-accent">
                              →{' '}
                              {t(
                                change.key,
                                change.days === undefined ? undefined : { days: change.days }
                              )}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            )}
          </>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-sheet/95 px-4 pt-3 pb-[calc(var(--spacing)*3+env(safe-area-inset-bottom))] backdrop-blur">
        {(wrong > 0 || !practice) && (
          <div className="flex gap-3">
            {wrong > 0 && (
              <button
                type="button"
                onClick={onRetryMistakes}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-accent text-sm font-semibold text-accent"
              >
                <RotateCcw size={18} strokeWidth={2} aria-hidden />
                {practice ? t('session.retryAgain') : t('session.retryMistakes')}
              </button>
            )}
            {!practice && total > 0 && (
              <button
                type="button"
                onClick={onRepeat}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold text-text"
              >
                <Repeat size={18} strokeWidth={2} aria-hidden />
                {t('session.repeatSession')}
              </button>
            )}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onDone}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-line text-base font-semibold text-text"
          >
            <Check size={20} strokeWidth={2} aria-hidden />
            {t('session.done')}
          </button>
          {!practice && (
            <button
              type="button"
              onClick={onAnother}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-ink shadow-sm active:opacity-90"
            >
              <Play size={20} strokeWidth={2} aria-hidden />
              {t('session.another')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
