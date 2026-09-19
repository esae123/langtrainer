import { useNavigate, useParams } from 'react-router';
import { Card } from '../components/Card';
import type { Exercise, Program, Topic } from '../content/types';
import { getProgram } from '../content/programs';
import { useT, type TranslationKey } from '../i18n';
import { MiniMarkdown } from '../lib/markdownLite';
import { difficultyDots, renderCorrectAnswer } from '../lib/renderExercise';
import { useSettings } from '../settings/settingsStore';

function findTopic(program: Program, topicId: string): Topic | undefined {
  for (const module of program.modules) {
    const topic = module.topics.find((t) => t.id === topicId);
    if (topic) return topic;
  }
  return undefined;
}

function ExerciseCard({ exercise }: { exercise: Exercise }) {
  const t = useT();
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700 dark:bg-accent-700/20 dark:text-accent-200">
          {t(`library.type.${exercise.type}` as TranslationKey)}
        </span>
        <span aria-label={`${t('library.difficulty')}: ${exercise.difficulty}`} className="text-xs text-accent-600 dark:text-accent-300">
          {difficultyDots(exercise.difficulty)}
        </span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('library.allowedModes')}:{' '}
        {exercise.allowedModes.map((mode) => t(`library.mode.${mode}` as TranslationKey)).join(', ')}
      </p>
      <p className="text-sm text-slate-800 dark:text-slate-100">{exercise.prompt}</p>
      {exercise.type === 'question_for_answer' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('library.given')}: {exercise.givenAnswer}
        </p>
      )}
      <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
        {t('library.answer')}: {renderCorrectAnswer(exercise)}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{exercise.explanation}</p>
    </Card>
  );
}

export function LibraryDetailScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId: string }>();
  const settings = useSettings();
  const program = getProgram(settings.activeProgramId);

  const topic = program && itemId ? findTopic(program, itemId) : undefined;
  const phraseSet = program && itemId && !topic ? program.phraseSets.find((p) => p.id === itemId) : undefined;

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
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {topic?.title ?? phraseSet?.title ?? t('library.notFoundTitle')}
        </h1>
      </div>

      {!topic && !phraseSet && (
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('library.notFoundBody')}</p>
        </Card>
      )}

      {topic && (
        <>
          <Card>
            <MiniMarkdown text={topic.context} />
          </Card>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('library.keyItems')}
            </h2>
            <Card className="!p-0">
              <div className="grid grid-cols-3 gap-x-2 border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span>{t('library.target')}</span>
                <span>{t('library.support')}</span>
                <span>{t('library.note')}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {topic.keyItems.map((item, i) => (
                  <div key={i} className="grid grid-cols-3 gap-x-2 px-4 py-2 text-sm">
                    <span className="font-medium text-slate-900 dark:text-slate-50">{item.target}</span>
                    <span className="text-slate-600 dark:text-slate-300">{item.support}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{item.note ?? '—'}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('library.exercisesHeading')} ({topic.exercises.length})
            </h2>
            {topic.exercises.map((exercise) => (
              <ExerciseCard key={exercise.id} exercise={exercise} />
            ))}
          </section>
        </>
      )}

      {phraseSet && (
        <>
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('library.phrasesHeading')}
            </h2>
            <Card className="!p-0">
              <div className="grid grid-cols-2 gap-x-2 border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span>{t('library.target')}</span>
                <span>{t('library.support')}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {phraseSet.phrases.map((phrase, i) => (
                  <div key={i} className="px-4 py-2">
                    <div className="grid grid-cols-2 gap-x-2 text-sm">
                      <span className="font-medium text-slate-900 dark:text-slate-50">{phrase.target}</span>
                      <span className="text-slate-600 dark:text-slate-300">{phrase.support}</span>
                    </div>
                    {(phrase.register || phrase.situation) && (
                      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                        {phrase.register ? t(`library.registerValue.${phrase.register}` as TranslationKey) : null}
                        {phrase.register && phrase.situation ? ' · ' : null}
                        {phrase.situation ?? null}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('library.exercisesHeading')} ({phraseSet.exercises.length})
            </h2>
            {phraseSet.exercises.map((exercise) => (
              <ExerciseCard key={exercise.id} exercise={exercise} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
