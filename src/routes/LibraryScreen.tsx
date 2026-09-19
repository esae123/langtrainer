import { Link, useNavigate } from 'react-router';
import { Card } from '../components/Card';
import { getProgram } from '../content/programs';
import { useT, type TranslationKey } from '../i18n';
import { useSettings } from '../settings/settingsStore';

export function LibraryScreen() {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettings();
  const program = getProgram(settings.activeProgramId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('library.back')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl text-slate-500 dark:text-slate-400"
        >
          ←
        </button>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{t('library.title')}</h1>
      </div>

      {!program && (
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('library.notFoundBody')}</p>
        </Card>
      )}

      {program && (
        <>
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('library.modulesHeading')}
            </h2>
            <div className="flex flex-col gap-4">
              {program.modules.map((module) => (
                <Card key={module.id} className="!p-0">
                  <div className="px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{module.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {t('library.moduleTopics', { count: module.topics.length })}
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {module.topics.map((topic) => (
                      <Link
                        key={topic.id}
                        to={`/library/${topic.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="flex flex-col">
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {topic.title}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {t(`library.kind.${topic.kind}` as TranslationKey)} ·{' '}
                            {t('library.exercisesCount', { count: topic.exercises.length })}
                          </span>
                        </span>
                        <span aria-hidden className="text-slate-400">
                          ›
                        </span>
                      </Link>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('library.phraseSetsHeading')}
            </h2>
            <Card className="divide-y divide-slate-100 !p-0 dark:divide-slate-800">
              {program.phraseSets.map((phraseSet) => (
                <Link
                  key={phraseSet.id}
                  to={`/library/${phraseSet.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {phraseSet.title}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t('library.exercisesCount', { count: phraseSet.exercises.length })}
                    </span>
                  </span>
                  <span aria-hidden className="text-slate-400">
                    ›
                  </span>
                </Link>
              ))}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
