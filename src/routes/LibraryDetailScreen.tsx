import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Card } from '../components/Card';
import type { Exercise, PhraseSet, Topic } from '../content/types';
import { useAllPrograms, type ProgramEntry } from '../content/programRegistry';
import { useT, type TranslationKey } from '../i18n';
import { MiniMarkdown } from '../lib/markdownLite';
import { difficultyDots, renderCorrectAnswer } from '../lib/renderExercise';

/**
 * Topic and phrase-set ids are unique across every installed course (import rejects
 * collisions), so the item can be looked up without knowing which course it is in.
 */
function findItem(
  entries: readonly ProgramEntry[],
  itemId: string
): { topic?: Topic; phraseSet?: PhraseSet } {
  for (const { program } of entries) {
    for (const module of program.modules) {
      const topic = module.topics.find((candidate) => candidate.id === itemId);
      if (topic) return { topic };
    }
    const phraseSet = program.phraseSets.find((candidate) => candidate.id === itemId);
    if (phraseSet) return { phraseSet };
  }
  return {};
}

function ExerciseCard({ exercise }: { exercise: Exercise }) {
  const t = useT();
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
          {t(`library.type.${exercise.type}` as TranslationKey)}
        </span>
        <span
          aria-label={`${t('library.difficulty')}: ${exercise.difficulty}`}
          className="text-xs text-accent"
        >
          {difficultyDots(exercise.difficulty)}
        </span>
      </div>
      <p className="text-xs text-muted">
        {t('library.allowedModes')}:{' '}
        {exercise.allowedModes
          .map((mode) => t(`library.mode.${mode}` as TranslationKey))
          .join(', ')}
      </p>
      <p className="text-sm text-text">{exercise.prompt}</p>
      {exercise.type === 'question_for_answer' && (
        <p className="text-xs text-muted">
          {t('library.given')}: {exercise.givenAnswer}
        </p>
      )}
      <p className="text-sm font-medium text-text">
        {t('library.answer')}: {renderCorrectAnswer(exercise)}
      </p>
      <p className="text-xs text-muted">{exercise.explanation}</p>
    </Card>
  );
}

export function LibraryDetailScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId: string }>();
  const entries = useAllPrograms();
  const loading = entries === undefined;
  const { topic, phraseSet } = entries && itemId ? findItem(entries, itemId) : {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('library.back')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted"
        >
          <ArrowLeft size={22} strokeWidth={2} aria-hidden />
        </button>
        <h1 className="text-lg font-semibold text-text">
          {topic?.title ?? phraseSet?.title ?? (loading ? '' : t('library.notFoundTitle'))}
        </h1>
      </div>

      {!loading && !topic && !phraseSet && (
        <Card>
          <p className="text-sm text-muted">{t('library.notFoundBody')}</p>
        </Card>
      )}

      {topic && (
        <>
          <Card>
            <MiniMarkdown text={topic.context} />
          </Card>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('library.keyItems')}
            </h2>
            <Card className="!p-0">
              <div className="grid grid-cols-3 gap-x-2 border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <span>{t('library.target')}</span>
                <span>{t('library.support')}</span>
                <span>{t('library.note')}</span>
              </div>
              <div className="divide-y divide-line">
                {topic.keyItems.map((item, i) => (
                  <div key={i} className="grid grid-cols-3 gap-x-2 px-4 py-2 text-sm">
                    <span className="font-medium text-text">{item.target}</span>
                    <span className="text-muted">{item.support}</span>
                    <span className="text-xs text-muted">{item.note ?? '—'}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
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
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('library.phrasesHeading')}
            </h2>
            <Card className="!p-0">
              <div className="grid grid-cols-2 gap-x-2 border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <span>{t('library.target')}</span>
                <span>{t('library.support')}</span>
              </div>
              <div className="divide-y divide-line">
                {phraseSet.phrases.map((phrase, i) => (
                  <div key={i} className="px-4 py-2">
                    <div className="grid grid-cols-2 gap-x-2 text-sm">
                      <span className="font-medium text-text">{phrase.target}</span>
                      <span className="text-muted">{phrase.support}</span>
                    </div>
                    {(phrase.register || phrase.situation) && (
                      <p className="mt-0.5 text-xs text-muted">
                        {phrase.register
                          ? t(`library.registerValue.${phrase.register}` as TranslationKey)
                          : null}
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
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
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
