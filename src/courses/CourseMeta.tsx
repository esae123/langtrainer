import { useLiveQuery } from 'dexie-react-hooks';
import { programCounts, type ProgramEntry } from '../content/programRegistry';
import { db } from '../db/db';
import { COMPLETED_STATUSES } from '../engine/progress';
import { useT } from '../i18n';
import { languageLabel } from '../lib/languageLabel';
import { useSettings } from '../settings/settingsStore';

/** "Built in" / "Imported" pill, shown next to a course title. */
export function CourseSourceBadge({ entry }: { entry: ProgramEntry }) {
  const t = useT();
  const imported = entry.source === 'imported';
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
        imported ? 'bg-accent-soft text-accent' : 'border border-line text-muted'
      }`}
    >
      {t(imported ? 'courses.source.imported' : 'courses.source.bundled')}
    </span>
  );
}

/** Level · target language · module and topic counts of a course. */
export function CourseCountsLine({ entry }: { entry: ProgramEntry }) {
  const t = useT();
  const { uiLanguage } = useSettings();
  const counts = programCounts(entry.program);
  return (
    <span className="text-xs text-muted">
      {t('courses.meta', {
        level: entry.program.level,
        language: languageLabel(entry.program.targetLanguage, uiLanguage),
        modules: t(
          counts.modules === 1 ? 'courses.modulesCount.one' : 'courses.modulesCount.other',
          {
            count: counts.modules,
          }
        ),
        topics: t(counts.topics === 1 ? 'courses.topicsCount.one' : 'courses.topicsCount.other', {
          count: counts.topics,
        }),
      })}
    </span>
  );
}

/**
 * Per-course progress in one line ("3 of 12 topics completed"). Counts only topics that
 * still exist in the course, so a replaced course never reports more than it has.
 */
export function CourseProgressLine({ entry }: { entry: ProgramEntry }) {
  const t = useT();
  const rows = useLiveQuery(
    () => db.topicProgress.where('programId').equals(entry.program.id).toArray(),
    [entry.program.id],
    []
  );
  const completedIds = new Set(
    rows.filter((row) => COMPLETED_STATUSES.has(row.status)).map((row) => row.topicId)
  );
  const topics = entry.program.modules.flatMap((module) => module.topics);
  const completed = topics.filter((topic) => completedIds.has(topic.id)).length;
  return (
    <span className="text-xs text-muted">
      {t('courses.progressSummary', { completed, total: topics.length })}
    </span>
  );
}
