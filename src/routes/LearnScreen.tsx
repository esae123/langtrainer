import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { Card } from '../components/Card';
import { useToast } from '../components/toastStore';
import { useExportBackup } from '../backup/useExportBackup';
import { getProgram } from '../content/programs';
import { db } from '../db/db';
import { currentTopicOf } from '../engine/plan';
import { COMPLETION_THRESHOLD } from '../engine/progress';
import { useT } from '../i18n';
import { formatDate } from '../lib/formatDate';
import { clearActiveSession, useActiveSession } from '../session/activeSession';
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

  const program = getProgram(settings.activeProgramId);
  const progress = useLiveQuery(
    () => db.topicProgress.where('programId').equals(settings.activeProgramId).toArray(),
    [settings.activeProgramId],
    []
  );
  const activeSession = useActiveSession();

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
  const seenCount =
    progress.find((row) => row.topicId === currentTopic?.id)?.seenExerciseIds.length ?? 0;
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
        <Card className="border-accent-200 bg-accent-50 dark:border-accent-700/50 dark:bg-accent-700/10">
          <p className="font-medium text-accent-800 dark:text-accent-200">
            {t('backup.reminderTitle')}
          </p>
          <p className="mt-1 text-sm text-accent-700/80 dark:text-accent-200/70">
            {t('backup.reminderBody')}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => void runExport()}
              className="min-h-9 rounded-lg bg-accent-600 px-3 text-sm font-semibold text-white"
            >
              {t('backup.backupNow')}
            </button>
            <button
              type="button"
              onClick={dismissBannerForToday}
              className="min-h-9 rounded-lg px-3 text-sm font-medium text-accent-700 dark:text-accent-200"
            >
              {t('backup.dismiss')}
            </button>
          </div>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
          {t('learn.greeting')}
        </h1>
        <p className="text-slate-500 dark:text-slate-400">{t('learn.subtitle')}</p>
      </div>

      {activeSession && (
        <Card className="border-accent-300 dark:border-accent-700/60">
          <p className="font-medium text-slate-900 dark:text-slate-50">{t('learn.resumeTitle')}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('learn.resumeBody', { done: activeSession.state.responses.length })}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/session?resume=1')}
              className="min-h-11 flex-1 rounded-xl bg-accent-600 text-sm font-semibold text-white"
            >
              {t('learn.resume')}
            </button>
            <button
              type="button"
              onClick={() => {
                void clearActiveSession().then(() => showToast(t('learn.discarded')));
              }}
              className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              {t('learn.discard')}
            </button>
          </div>
        </Card>
      )}

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-300">
          {program?.level ?? '—'}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
          {program?.title ?? settings.activeProgramId}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('learn.programSummary', {
            modules: modulesCount,
            topics: topicsCount,
            exercises: exercisesCount,
          })}
        </p>
      </Card>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('learn.currentTopic')}
        </p>
        {currentTopic ? (
          <>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
              {currentTopic.title}
            </h2>
            {currentModule && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{currentModule.title}</p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <div
                aria-hidden
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              >
                <div
                  className="h-full rounded-full bg-accent-600"
                  style={{
                    width: `${Math.min(100, Math.round((seenCount / COMPLETION_THRESHOLD) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-sm font-medium tabular-nums text-slate-600 dark:text-slate-300">
                {seenCount}/{COMPLETION_THRESHOLD}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {t('learn.currentTopicMeta', {
                seen: seenCount,
                threshold: COMPLETION_THRESHOLD,
              })}
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
              {t('learn.currentTopicNone')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('learn.currentTopicNoneBody')}
            </p>
          </>
        )}
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {nextReviewAt === undefined
            ? t('learn.nextReviewNone')
            : nextReviewAt <= Date.now()
              ? t('learn.nextReviewDue')
              : t('learn.nextReview', { date: formatDate(nextReviewAt, settings.uiLanguage) })}
        </p>
      </Card>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          {t('learn.sessionLength')}
        </p>
        <div className="flex flex-wrap gap-2">
          {SESSION_LENGTH_OPTIONS.map((length) => (
            <button
              key={String(length)}
              type="button"
              onClick={() => void updateSettings({ sessionLength: length })}
              aria-pressed={settings.sessionLength === length}
              className={`min-h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${
                settings.sessionLength === length
                  ? 'bg-accent-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
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
        className="min-h-12 rounded-2xl bg-accent-600 text-base font-semibold text-white shadow-sm active:opacity-90"
      >
        {t('learn.startSession')}
      </button>
    </div>
  );
}
