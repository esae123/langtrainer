import {
  BACKUP_TABLE_NAMES,
  db,
  type AttemptRow,
  type CustomTopicRow,
  type GeneratedExerciseRow,
  type ProfileRow,
  type SessionRow,
  type SettingsRow,
  type TopicProgressRow,
} from '../db/db';
import { isRecord } from '../lib/isRecord';
import { DEFAULT_SETTINGS, type Settings } from '../settings/settings';
import { loadSettings, updateSettings } from '../settings/settingsStore';

export const BACKUP_APP_ID = 'langtrainer';
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupData {
  settings: SettingsRow[];
  profile: ProfileRow[];
  topicProgress: TopicProgressRow[];
  sessions: SessionRow[];
  attempts: AttemptRow[];
  customTopics: CustomTopicRow[];
  generatedExercises: GeneratedExerciseRow[];
}

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  data: BackupData;
}

const SETTINGS_ROW_KEY = 'settings';

/** Removes the Gemini API key from a settings value before it leaves the device. */
function stripApiKey(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { geminiApiKey: _omit, ...rest } = value;
  return rest;
}

export async function buildBackup(): Promise<BackupFile> {
  const [settings, profile, topicProgress, sessions, attempts, customTopics, generatedExercises] =
    await Promise.all([
      db.settings.toArray(),
      db.profile.toArray(),
      db.topicProgress.toArray(),
      db.sessions.toArray(),
      db.attempts.toArray(),
      db.customTopics.toArray(),
      db.generatedExercises.toArray(),
    ]);

  const sanitizedSettings = settings.map((row) =>
    row.key === SETTINGS_ROW_KEY ? { ...row, value: stripApiKey(row.value) } : row
  );

  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      settings: sanitizedSettings,
      profile,
      topicProgress,
      sessions,
      attempts,
      customTopics,
      generatedExercises,
    },
  };
}

export function backupFilename(date = new Date()): string {
  return `langtrainer-backup-${date.toISOString().slice(0, 10)}.json`;
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Exports all data (minus the API key) via the Web Share API, falling back to a download link. */
export async function exportBackup(): Promise<ExportOutcome> {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const filename = backupFilename();
  const file = new File([json], filename, { type: 'application/json' });

  const nav = navigator as ShareCapableNavigator;
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
    await updateSettings({ lastBackupAt: Date.now() });
    return 'shared';
  }

  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  await updateSettings({ lastBackupAt: Date.now() });
  return 'downloaded';
}

/** Validates the shape of a parsed backup JSON value; throws a descriptive Error otherwise. */
export function parseBackup(json: unknown): BackupFile {
  if (!isRecord(json)) throw new Error('Backup file is not a JSON object.');
  if (json.app !== BACKUP_APP_ID) throw new Error('Backup file is not a LangTrainer backup.');
  if (json.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${String(json.schemaVersion)}.`);
  }
  if (!isRecord(json.data)) throw new Error('Backup file is missing "data".');
  for (const name of BACKUP_TABLE_NAMES) {
    if (!Array.isArray(json.data[name])) {
      throw new Error(`Backup file is missing table "${name}".`);
    }
  }
  return json as unknown as BackupFile;
}

/**
 * Replaces all local data with the contents of a backup file, inside one Dexie
 * transaction. The device's current Gemini API key is preserved regardless of
 * what the backup contains (it is never included in exports in the first place).
 */
export async function importBackup(file: File): Promise<void> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const backup = parseBackup(json);
  const currentSettings = await loadSettings();

  await db.transaction(
    'rw',
    [db.settings, db.profile, db.topicProgress, db.sessions, db.attempts, db.customTopics, db.generatedExercises],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.profile.clear(),
        db.topicProgress.clear(),
        db.sessions.clear(),
        db.attempts.clear(),
        db.customTopics.clear(),
        db.generatedExercises.clear(),
      ]);
      await Promise.all([
        db.settings.bulkPut(backup.data.settings),
        db.profile.bulkPut(backup.data.profile),
        db.topicProgress.bulkPut(backup.data.topicProgress),
        db.sessions.bulkPut(backup.data.sessions),
        db.attempts.bulkPut(backup.data.attempts),
        db.customTopics.bulkPut(backup.data.customTopics),
        db.generatedExercises.bulkPut(backup.data.generatedExercises),
      ]);

      const importedSettingsRow = backup.data.settings.find((row) => row.key === SETTINGS_ROW_KEY);
      const merged: Settings = {
        ...DEFAULT_SETTINGS,
        ...(isRecord(importedSettingsRow?.value) ? importedSettingsRow.value : {}),
        geminiApiKey: currentSettings.geminiApiKey,
      };
      await db.settings.put({ key: SETTINGS_ROW_KEY, value: merged });
    }
  );
}
