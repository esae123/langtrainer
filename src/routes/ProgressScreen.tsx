import { useEffect, useState, type ReactNode } from 'react';
import {
  ChartLine,
  ChevronDown,
  Flame,
  ListChecks,
  Play,
  Target,
  TrendingDown,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router';
import { Card } from '../components/Card';
import { useActiveProgram } from '../content/programRegistry';
import { db } from '../db/db';
import { useStartFocus } from '../session/useStartFocus';
import { currentTopicOf } from '../engine/plan';
import { COMPLETED_STATUSES } from '../engine/progress';
import {
  needsWork,
  overview,
  recentSessions,
  streaks,
  topicStats,
  type ModuleStats,
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

const expandedKey = (programId: string) => `langtrainer:progress:expanded:${programId}`;
/** The module last opened automatically because it held the current topic. */
const autoExpandedKey = (programId: string) => `langtrainer:progress:autoExpanded:${programId}`;

function readExpanded(programId: string): string[] | null {
  try {
    const raw = localStorage.getItem(expandedKey(programId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

function readAutoExpanded(programId: string): string | null {
  try {
    return localStorage.getItem(autoExpandedKey(programId));
  } catch {
    return null;
  }
}

function writeExpanded(programId: string, moduleIds: string[], autoModuleId?: string): void {
  try {
    localStorage.setItem(expandedKey(programId), JSON.stringify(moduleIds));
    if (autoModuleId !== undefined) localStorage.setItem(autoExpandedKey(programId), autoModuleId);
  } catch {
    // storage disabled — the expanded modules just won't be remembered
  }
}

interface ExpandedState {
  expanded: string[];
  /** The module of the current topic that was last expanded automatically. */
  auto: string | null;
}

/** Opens the current topic's module once each time it changes (a new module reached). */
function withCurrentModule(state: ExpandedState, currentModuleId: string | undefined) {
  if (!currentModuleId || currentModuleId === state.auto) return state;
  return {
    expanded: state.expanded.includes(currentModuleId)
      ? state.expanded
      : [...state.expanded, currentModuleId],
    auto: currentModuleId,
  };
}

/**
 * Topics grouped under collapsible module headers (docs/stage-6-spec.md §3). By default
 * only the module of the current topic is open (the first module when there is none);
 * the learner's choice is remembered per course in localStorage. When the current topic
 * moves on to a new module, that module is opened once, even over a saved choice.
 */
function TopicsByModule({
  programId,
  modules,
  defaultModuleId,
  locale,
}: {
  programId: string;
  modules: ModuleStats[];
  defaultModuleId: string | undefined;
  locale: string;
}) {
  const t = useT();
  const [state, setState] = useState<ExpandedState>(() => {
    const saved = readExpanded(programId);
    if (saved === null) {
      return { expanded: defaultModuleId ? [defaultModuleId] : [], auto: defaultModuleId ?? null };
    }
    return withCurrentModule(
      { expanded: saved, auto: readAutoExpanded(programId) },
      defaultModuleId
    );
  });
  // The current module can also change while the screen is open (live data).
  const adjusted = withCurrentModule(state, defaultModuleId);
  if (adjusted !== state) setState(adjusted);
  const { expanded } = adjusted;

  // Remember an automatic expansion, so it happens only once per module.
  useEffect(() => {
    if (state.auto === null || readAutoExpanded(programId) === state.auto) return;
    writeExpanded(programId, state.expanded, state.auto);
  }, [programId, state]);

  function toggle(moduleId: string) {
    const next = expanded.includes(moduleId)
      ? expanded.filter((id) => id !== moduleId)
      : [...expanded, moduleId];
    setState({ ...adjusted, expanded: next });
    writeExpanded(programId, next);
  }

  return (
    <Card className="!p-0">
      <ul className="divide-y divide-line">
        {modules.map((module) => {
          const open = expanded.includes(module.moduleId);
          const completed = module.topics.filter((topic) =>
            COMPLETED_STATUSES.has(topic.status)
          ).length;
          const panelId = `progress-module-${module.moduleId}`;
          return (
            <li key={module.moduleId}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(module.moduleId)}
                className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words text-sm font-semibold text-text">
                    {module.title}
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {t('progress.moduleCompleted', {
                      completed,
                      total: module.topics.length,
                    })}
                  </span>
                </span>
                <ChevronDown
                  size={20}
                  strokeWidth={2}
                  aria-hidden
                  className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open && (
                <ul id={panelId} className="divide-y divide-line border-t border-line">
                  {module.topics.map((topic) => (
                    <TopicRow key={topic.topicId} topic={topic} locale={locale} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function ProgressScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { uiLanguage } = useSettings();
  const program = useActiveProgram();
  const programId = program?.id;
  const { startFocus, confirmSheet } = useStartFocus();

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
  const current = currentTopicOf(program, data.progress);
  const currentModuleId = (
    program.modules.find((module) => module.topics.some((topic) => topic.id === current?.id)) ??
    program.modules[0]
  )?.id;
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
                <li key={topic.topicId} className="flex items-center gap-2 pr-3">
                  <Link
                    to={`/library/${topic.topicId}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-2.5 pl-4"
                  >
                    <span className="min-w-0 break-words text-sm font-medium text-text">
                      {topic.title}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-bad">
                      {percent(topic.accuracy ?? 0)}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => startFocus(topic.topicId, topic.title)}
                    aria-label={t('progress.practiseTopic', { topic: topic.title })}
                    className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-accent px-3 text-sm font-semibold text-accent"
                  >
                    <Target size={16} strokeWidth={2} aria-hidden />
                    {t('progress.practise')}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section>
        <SectionTitle icon={<Target size={14} strokeWidth={2} aria-hidden />}>
          {t('progress.topics')}
        </SectionTitle>
        <TopicsByModule
          key={program.id}
          programId={program.id}
          modules={modules}
          defaultModuleId={currentModuleId}
          locale={uiLanguage}
        />
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
                  {session.kind === 'focus' && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                      {t('progress.focusTag')}
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
      {confirmSheet}
    </div>
  );
}
