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
}

const BLOCK_LABELS: Record<BlockKind, TranslationKey> = {
  new: 'session.block.new',
  review: 'session.summaryReviewBlock',
  phrases: 'session.block.phrases',
};

function days(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / DAY_MS));
}

export function SummaryPanel({ state, outcomes, program, onDone, onAnother }: SummaryPanelProps) {
  const t = useT();
  const total = state.responses.length;
  const correct = state.responses.filter((draft) => draft.correct).length;
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);
  const endedAt = state.endedAt ?? Date.now();

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
      return {
        key: 'session.change.firstCompleted',
        days: after.nextReviewAt ? days(endedAt, after.nextReviewAt) : 7,
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
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
              {t('session.summaryInterrupted')}
            </span>
          )}
          <p
            aria-label={t('session.summaryScore', { correct, total })}
            className="text-5xl font-semibold tabular-nums text-accent-600 dark:text-accent-300"
          >
            {percentage}%
          </p>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {t('session.summaryTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('session.summaryScore', { correct, total })}
          </p>
        </div>

        {total === 0 ? (
          <Card className="mt-6">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('session.summaryEmpty')}
            </p>
          </Card>
        ) : (
          <>
            <section className="mt-6">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('session.summaryBlocks')}
              </h2>
              <Card className="!p-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {blocks.map((row) => (
                    <li
                      key={row.block}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="text-sm text-slate-700 dark:text-slate-200">
                        {t(BLOCK_LABELS[row.block])}
                      </span>
                      <span className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-50">
                        {row.correct}/{row.total}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            <section className="mt-5">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('session.summaryTopics')}
              </h2>
              <Card className="!p-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topicRows.map(({ outcome, info }) => {
                    const change = changeFor(outcome);
                    return (
                      <li key={outcome.topicId} className="px-4 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                            {info.title}
                          </p>
                          <span className="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">
                            {outcome.correct}/{outcome.total}
                          </span>
                        </div>
                        {change && (
                          <p className="mt-0.5 text-xs font-medium text-accent-700 dark:text-accent-300">
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
          </>
        )}
      </div>

      <div className="safe-bottom sticky bottom-0 flex gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={onDone}
          className="min-h-12 flex-1 rounded-2xl border border-slate-300 text-base font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          {t('session.done')}
        </button>
        <button
          type="button"
          onClick={onAnother}
          className="min-h-12 flex-1 rounded-2xl bg-accent-600 text-base font-semibold text-white shadow-sm active:opacity-90"
        >
          {t('session.another')}
        </button>
      </div>
    </div>
  );
}
