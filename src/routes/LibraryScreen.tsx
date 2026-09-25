import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Card } from '../components/Card';
import { resolveActiveEntry, useAllPrograms, type ProgramEntry } from '../content/programRegistry';
import { CourseActions } from '../courses/CourseActions';
import { CourseCountsLine, CourseSourceBadge } from '../courses/CourseMeta';
import { useT, type TranslationKey } from '../i18n';
import { useSettings } from '../settings/settingsStore';

/** One installed course: header with its badge and actions, then modules → topics. */
function CourseSection({ entry, active }: { entry: ProgramEntry; active: boolean }) {
  const t = useT();
  const { program } = entry;

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-text">{program.title}</h2>
          {active && (
            <span className="flex items-center gap-1 text-xs font-semibold text-accent">
              <Check size={14} strokeWidth={2.5} aria-hidden />
              {t('courses.active')}
            </span>
          )}
          <span className="ml-auto">
            <CourseSourceBadge entry={entry} />
          </span>
        </div>
        <p className="mt-1">
          <CourseCountsLine entry={entry} />
        </p>
        {entry.source === 'imported' && <CourseActions entry={entry} />}
      </Card>

      <div>
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('library.modulesHeading')}
        </h3>
        <div className="flex flex-col gap-4">
          {program.modules.map((module) => (
            <Card key={module.id} className="!p-0">
              <div className="px-4 py-3">
                <h4 className="text-sm font-semibold text-text">{module.title}</h4>
                <p className="mt-0.5 text-xs text-muted">
                  {t('library.moduleTopics', { count: module.topics.length })}
                </p>
              </div>
              <div className="divide-y divide-line">
                {module.topics.map((topic) => (
                  <Link
                    key={topic.id}
                    to={`/library/${topic.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-text">{topic.title}</span>
                      <span className="text-xs text-muted">
                        {t(`library.kind.${topic.kind}` as TranslationKey)} ·{' '}
                        {t('library.exercisesCount', { count: topic.exercises.length })}
                      </span>
                    </span>
                    <ChevronRight size={20} strokeWidth={2} aria-hidden className="text-muted" />
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {program.phraseSets.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('library.phraseSetsHeading')}
          </h3>
          <Card className="divide-y divide-line !p-0">
            {program.phraseSets.map((phraseSet) => (
              <Link
                key={phraseSet.id}
                to={`/library/${phraseSet.id}`}
                className="flex min-h-11 items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-text">{phraseSet.title}</span>
                  <span className="text-xs text-muted">
                    {t('library.exercisesCount', { count: phraseSet.exercises.length })}
                  </span>
                </span>
                <ChevronRight size={20} strokeWidth={2} aria-hidden className="text-muted" />
              </Link>
            ))}
          </Card>
        </div>
      )}
    </section>
  );
}

/** Every installed course, bundled ones first (docs/stage-4a-spec.md §4). */
export function LibraryScreen() {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettings();
  const entries = useAllPrograms();
  // The *resolved* active course, so a stale `activeProgramId` still marks the one in use.
  const activeId = entries
    ? resolveActiveEntry(entries, settings.activeProgramId)?.program.id
    : undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('library.back')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted"
        >
          <ArrowLeft size={22} strokeWidth={2} aria-hidden />
        </button>
        <h1 className="text-2xl font-semibold text-text">{t('library.title')}</h1>
      </div>

      {entries === undefined && <p className="text-sm text-muted">{t('learn.loadingCourse')}</p>}

      {entries?.length === 0 && (
        <Card>
          <p className="text-sm text-muted">{t('library.coursesEmpty')}</p>
        </Card>
      )}

      {entries?.map((entry) => (
        <CourseSection
          key={entry.program.id}
          entry={entry}
          active={entry.program.id === activeId}
        />
      ))}
    </div>
  );
}
