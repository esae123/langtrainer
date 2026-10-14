import { useId, useState } from 'react';
import { ChevronRight, Download, Play } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { Card } from '../components/Card';
import { useToast } from '../components/toastStore';
import { useExportBackup } from '../backup/useExportBackup';
import { useActiveProgramEntry, useAllPrograms } from '../content/programRegistry';
import { CoursesSheet } from '../courses/CoursesSheet';
import { CourseSourceBadge } from '../courses/CourseMeta';
import { db } from '../db/db';
import { currentTopicOf } from '../engine/plan';
import { COMPLETION_THRESHOLD } from '../engine/progress';
import { useT } from '../i18n';
import { formatDate } from '../lib/formatDate';
import { discardActiveSession, useActiveSession } from '../session/activeSession';
import { SESSION_LENGTH_OPTIONS, type SessionLength } from '../settings/settings';
import { updateSettings, useSettings } from '../settings/settingsStore';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
// sessionStorage (not component state) so the dismissal survives navigating
// away and back — this screen remounts on every tab switch.
const BANNER_DISMISSED_KEY = 'langtrainer:backupBannerDismissed';

function readBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function LearnScreen() {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettings();
  const showToast = useToast();
  const runExport = useExportBackup();
  const [bannerDismissed, setBannerDismissed] = useState(readBannerDismissed);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const courseHintId = useId();

  const entries = useAllPrograms();
  const activeEntry = useActiveProgramEntry();
  const program = activeEntry?.program;
  // The *resolved* id, so a settings value pointing at a removed course still shows
  // the progress of the course that is actually active. `undefined` while the
  // installed courses load — nothing course-specific is shown until then.
  const programId = program?.id;
  const progress = useLiveQuery(
    async () => (programId ? db.topicProgress.where('programId').equals(programId).toArray() : []),
    [programId],
    []
  );
  const activeSession = useActiveSession();
  // A saved session can belong to a course that is no longer the active one.
  const sessionProgramTitle =
    activeSession && programId && activeSession.state.programId !== programId
      ? (entries?.find((entry) => entry.program.id === activeSession.state.programId)?.program
          .title ?? activeSession.state.programId)
      : null;

  function dismissBannerForToday() {
    setBannerDismissed(true);
    try {
      sessionStorage.setItem(BANNER_DISMISSED_KEY, 'true');
    } catch {
      // storage disabled — dismissal just won't survive a remount, which is acceptable
    }
  }

  const modulesCount = program?.modules.length ?? 0;
  const topicsCount = program?.modules.reduce((sum, m) => sum + m.topics.length, 0) ?? 0;
  const exercisesCount = program
    ? program.modules.reduce(
        (sum, m) => sum + m.topics.reduce((s, topic) => s + topic.exercises.length, 0),
        0
      ) + program.phraseSets.reduce((sum, ps) => sum + ps.exercises.length, 0)
    : 0;

  const currentTopic = program ? currentTopicOf(program, progress) : undefined;
  const currentModule = program?.modules.find((m) => m.id === currentTopic?.moduleId);
  const currentTopicProgress = progress.find((row) => row.topicId === currentTopic?.id);
  const requiresAllCorrect = program?.topicCompletionPolicy === 'all-exercises-correct';
  const topicThreshold = requiresAllCorrect
    ? (currentTopic?.exercises.length ?? 0)
    : COMPLETION_THRESHOLD;
  const seenCount = requiresAllCorrect && currentTopic
    ? currentTopic.exercises.filter(
        (exercise) =>
          currentTopicProgress?.seenExerciseIds.includes(exercise.id) &&
          !currentTopicProgress.wrongExerciseIds.includes(exercise.id)
      ).length
    : (currentTopicProgress?.seenExerciseIds.length ?? 0);
  const nextReviewAt = progress
    .filter((row) => row.nextReviewAt !== undefined && row.status !== 'mastered')
    .map((row) => row.nextReviewAt as number)
    .sort((a, b) => a - b)[0];

  const needsBackup =
    !bannerDismissed &&
    (settings.lastBackupAt === null || Date.now() - settings.lastBackupAt > SEVEN_DAYS_MS);

  function chipLabel(length: SessionLength) {
    return length === 'open' ? '∞' : String(length);
  }

  return (
    <div className="flex flex-col gap-5">
      {needsBackup && (
        <Card className="border-accent bg-accent-soft">
          <p className="font-medium text-accent">{t('backup.reminderTitle')}</p>
          <p className="mt-1 text-sm text-muted">{t('backup.reminderBody')}</p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => void runExport()}
              className="flex min-h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink"
            >
              <Download size={18} strokeWidth={2} aria-hidden />
              {t('backup.backupNow')}
            </button>
            <button
              type="button"
              onClick={dismissBannerForToday}
              className="min-h-9 rounded-lg px-3 text-sm font-medium text-accent"
            >
              {t('backup.dismiss')}
            </button>
          </div>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-semibold text-text">{t('learn.greeting')}</h1>
        <p className="text-muted">{t('learn.subtitle')}</p>
      </div>

      {activeSession && (
        <Card className="border-accent">
          <p className="font-medium text-text">{t('learn.resumeTitle')}</p>
          <p className="mt-1 text-sm text-muted">
            {t('learn.resumeBody', { done: activeSession.state.responses.length })}
          </p>
          {sessionProgramTitle && (
            <p className="mt-1 text-sm text-muted">
              {t('learn.resumeCourse', { title: sessionProgramTitle })}
            </p>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/session?resume=1')}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-accent-ink"
            >
              <Play size={18} strokeWidth={2} aria-hidden />
              {t('learn.resume')}
            </button>
            <button
              type="button"
              onClick={() => {
                void discardActiveSession(activeSession).then(() =>
                  showToast(t('learn.discarded'))
                );
              }}
              className="min-h-11 rounded-xl border border-line px-4 text-sm font-medium text-text"
            >
              {t('learn.discard')}
            </button>
          </div>
        </Card>
      )}

      {!activeEntry || !program ? (
        <Card>
          <p className="text-sm text-muted">{t('learn.loadingCourse')}</p>
        </Card>
      ) : (
        <>
          {/* The title is the heading *and* the button's name; its ::after stretches the
              tap target over the whole card. */}
          <Card className="relative flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                  {program.level}
                </span>
                <CourseSourceBadge entry={activeEntry} />
              </div>
              <h2 className="mt-1 text-lg font-semibold text-text">
                <button
                  type="button"
                  onClick={() => setCoursesOpen(true)}
                  aria-describedby={courseHintId}
                  className="text-left after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                >
                  {program.title}
                </button>
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t('learn.programSummary', {
                  modules: modulesCount,
                  topics: topicsCount,
                  exercises: exercisesCount,
                })}
              </p>
              <p id={courseHintId} className="mt-1 text-xs text-muted">
                {t('learn.courseCardHint')}
              </p>
            </div>
            <ChevronRight size={20} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
          </Card>

          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t('learn.currentTopic')}
            </p>
            {currentTopic ? (
              <>
                <h2 className="mt-1 text-lg font-semibold text-text">{currentTopic.title}</h2>
                {currentModule && <p className="text-sm text-muted">{currentModule.title}</p>}
                <div className="mt-3 flex items-center gap-3">
                  <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${Math.min(100, Math.round((seenCount / Math.max(topicThreshold, 1)) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium tabular-nums text-muted">
                    {seenCount}/{topicThreshold}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t(requiresAllCorrect ? 'learn.currentTopicMetaAllCorrect' : 'learn.currentTopicMeta', {
                    seen: seenCount,
                    threshold: topicThreshold,
                  })}
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-1 text-lg font-semibold text-text">
                  {t('learn.currentTopicNone')}
                </h2>
                <p className="text-sm text-muted">{t('learn.currentTopicNoneBody')}</p>
              </>
            )}
            <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
              {nextReviewAt === undefined
                ? t('learn.nextReviewNone')
                : nextReviewAt <= Date.now()
                  ? t('learn.nextReviewDue')
                  : t('learn.nextReview', { date: formatDate(nextReviewAt, settings.uiLanguage) })}
            </p>
          </Card>
        </>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-muted">{t('learn.sessionLength')}</p>
        <div className="flex flex-wrap gap-2">
          {SESSION_LENGTH_OPTIONS.map((length) => (
            <button
              key={String(length)}
              type="button"
              onClick={() => void updateSettings({ sessionLength: length })}
              aria-pressed={settings.sessionLength === length}
              className={`min-h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${
                settings.sessionLength === length
                  ? 'bg-accent text-accent-ink'
                  : 'border border-line bg-sheet text-muted'
              }`}
            >
              {chipLabel(length)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/session')}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-ink shadow-sm active:opacity-90"
      >
        <Play size={20} strokeWidth={2} aria-hidden />
        {t('learn.startSession')}
      </button>

      <CoursesSheet open={coursesOpen} onClose={() => setCoursesOpen(false)} />
    </div>
  );
}
