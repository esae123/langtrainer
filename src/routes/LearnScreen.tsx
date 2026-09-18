import { useState } from 'react';
import { Card } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { useExportBackup } from '../backup/useExportBackup';
import { getProgram } from '../content/programs';
import { useT } from '../i18n';
import { SESSION_LENGTH_OPTIONS, type SessionLength } from '../settings/settings';
import { updateSettings, useSettings } from '../settings/settingsStore';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function LearnScreen() {
  const t = useT();
  const settings = useSettings();
  const runExport = useExportBackup();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const program = getProgram(settings.activeProgramId);
  const topicsCount = program?.modules.reduce((sum, m) => sum + m.topics.length, 0) ?? 0;

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
          <p className="font-medium text-accent-800 dark:text-accent-200">{t('backup.reminderTitle')}</p>
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
              onClick={() => setBannerDismissed(true)}
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

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-300">
          {program?.level ?? '—'}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
          {program?.title ?? settings.activeProgramId}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('learn.topicsCount', { count: topicsCount })}
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
        onClick={() => setSheetOpen(true)}
        className="min-h-12 rounded-2xl bg-accent-600 text-base font-semibold text-white shadow-sm active:opacity-90"
      >
        {t('learn.startSession')}
      </button>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {t('learn.comingSoonTitle')}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('learn.comingSoonBody')}</p>
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          className="mt-5 min-h-11 w-full rounded-xl bg-accent-600 text-sm font-semibold text-white"
        >
          {t('learn.comingSoonClose')}
        </button>
      </Sheet>
    </div>
  );
}
