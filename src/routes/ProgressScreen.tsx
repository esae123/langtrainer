import type { ReactNode } from 'react';
import { ChartLine, Flame, ListChecks, Play, Target, TrendingDown } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router';
import { Card } from '../components/Card';
import { useActiveProgram } from '../content/programRegistry';
import { db } from '../db/db';
import {
  needsWork,
  overview,
  recentSessions,
  streaks,
  topicStats,
  type TopicStat,
} from '../engine/stats';
import type { TopicStatus } from '../engine/types';
import { useT, type TranslationKey } from '../i18n';
import { formatDate, formatDateTime } from '../lib/formatDate';
import { useSettings } from '../settings/settingsStore';

const STATUS_LABEL: Record<TopicStatus, TranslationKey> = {
  new: 'progress.status.new',
  learning: 'progress.status.learning',
  review: 'progress.status.review',
  mastered: 'progress.status.mastered',
  maintenance: 'progress.status.maintenance',
};

const STATUS_CLASS: Record<TopicStatus, string> = {
  new: 'border border-line text-muted',
  learning: 'bg-accent-soft text-accent',
  review: 'bg-highlight/30 text-text',
  mastered: 'bg-ok-bg text-ok',
  maintenance: 'bg-bad-bg text-bad',
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
      {icon}
      {children}
    </h2>
  );
}

function Tile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1 break-words text-xs font-medium text-muted">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-text">{value}</span>
      {sub && <span className="break-words text-xs text-muted">{sub}</span>}
    </Card>
  );
}

function StatusBadge({ status }: { status: TopicStatus }) {
  const t = useT();
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}
    >
      {t(STATUS_LABEL[status])}
    </span>
  );
}

function TopicRow({ topic, locale }: { topic: TopicStat; locale: string }) {
  const t = useT();
  const fraction = topic.total === 0 ? 0 : Math.min(1, topic.seen / topic.total);
  return (
    <li>
      <Link to={`/library/${topic.topicId}`} className="flex min-h-11 flex-col gap-1.5 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words text-sm font-medium text-text">{topic.title}</span>
          <StatusBadge status={topic.status} />
        </div>
        <div
          role="progressbar"
          aria-label={t('progress.seenOf', { seen: topic.seen, total: topic.total })}
          aria-valuemin={0}
          aria-valuemax={topic.total}
          aria-valuenow={topic.seen}
          className="h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${fraction * 100}%` }} />
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 text-xs tabular-nums text-muted">
          <span>
            {topic.seen}/{topic.total}
            {topic.accuracy !== null && ` · ${percent(topic.accuracy)}`}
          </span>
          {topic.lastPractisedAt !== undefined && (
            <span>{t('progress.last', { date: formatDate(topic.lastPractisedAt, locale) })}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

export function ProgressScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { uiLanguage } = useSettings();
  const program = useActiveProgram();
  const programId = program?.id;

  const data = useLiveQuery(async () => {
    if (!programId) return null;
    const sessions = await db.sessions.filter((row) => row.programId === programId).toArray();
    const attempts =
      sessions.length === 0
        ? []
        : await db.attempts
            .where('sessionId')
            .anyOf(sessions.map((row) => row.id))
            .toArray();
    const progress = await db.topicProgress.where('programId').equals(programId).toArray();
    return { sessions, attempts, progress };
  }, [programId]);

  if (!program || !data) return null;

  const now = Date.now();
  const totals = overview(data.sessions, data.attempts);

  if (totals.sessions === 0) {
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <ChartLine size={48} strokeWidth={2} aria-hidden className="text-accent" />
        <Card className="w-full">
          <h2 className="text-lg font-semibold text-text">{t('progress.emptyTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('progress.emptyBody')}</p>
          <button
            type="button"
            onClick={() => navigate('/session')}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink"
          >
            <Play size={18} strokeWidth={2} aria-hidden />
            {t('progress.start')}
          </button>
        </Card>
      </div>
    );
  }

  const streak = streaks(data.sessions, now);
  const modules = topicStats(program, data.progress, data.attempts);
  const weak = needsWork(modules);
  const recent = recentSessions(data.sessions);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-text">{t('nav.progress')}</h1>

      <div className="grid grid-cols-2 gap-3">
        <Tile
          label={t('progress.streak')}
          value={t(streak.current === 1 ? 'progress.dayOne' : 'progress.days', {
            count: streak.current,
          })}
          sub={t('progress.best', { count: streak.best })}
          icon={<Flame size={14} strokeWidth={2} aria-hidden className="shrink-0 text-accent" />}
        />
        <Tile label={t('progress.sessions')} value={String(totals.sessions)} />
        <Tile label={t('progress.answered')} value={String(totals.answered)} />
        <Tile label={t('progress.accuracy')} value={percent(totals.accuracy)} />
      </div>

      {weak.length > 0 && (
        <section>
          <SectionTitle icon={<TrendingDown size={14} strokeWidth={2} aria-hidden />}>
            {t('progress.needsWork')}
          </SectionTitle>
          <Card className="!p-0">
            <ul className="divide-y divide-line">
              {weak.map((topic) => (
                <li key={topic.topicId}>
                  <Link
                    to={`/library/${topic.topicId}`}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 break-words text-sm font-medium text-text">
                      {topic.title}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-bad">
                      {percent(topic.accuracy ?? 0)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionTitle icon={<Target size={14} strokeWidth={2} aria-hidden />}>
          {t('progress.topics')}
        </SectionTitle>
        {modules.map((module) => (
          <div key={module.moduleId}>
            <h3 className="mb-1.5 break-words px-1 text-sm font-semibold text-text">
              {module.title}
            </h3>
            <Card className="!p-0">
              <ul className="divide-y divide-line">
                {module.topics.map((topic) => (
                  <TopicRow key={topic.topicId} topic={topic} locale={uiLanguage} />
                ))}
              </ul>
            </Card>
          </div>
        ))}
      </section>

      <section>
        <SectionTitle icon={<ListChecks size={14} strokeWidth={2} aria-hidden />}>
          {t('progress.recent')}
        </SectionTitle>
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {recent.map((session) => (
              <li
                key={session.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-text">
                  {formatDateTime(session.startedAt, uiLanguage)}
                  {session.kind === 'practice' && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                      {t('progress.practiceTag')}
                    </span>
                  )}
                  {session.interrupted && (
                    <span className="rounded-full bg-highlight/30 px-2 py-0.5 text-xs font-semibold text-text">
                      {t('progress.interruptedTag')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-text">
                  {session.correct}/{session.completed}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
