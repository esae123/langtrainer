import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { loadSettings, updateSettings } from '../../settings/settingsStore';
import { buildBackup, importBackup, parseBackup } from '../backup';

async function clearAllTables() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

async function seedFixtureData(geminiApiKey: string) {
  await updateSettings({ geminiApiKey, uiLanguage: 'ru' });
  await db.profile.put({ id: 'me', aboutMe: 'Learning Portuguese', updatedAt: 10 });
  await db.topicProgress.put({
    topicId: 't1',
    programId: 'pt-PT-A1',
    status: 'learning',
    reviewStage: 1,
    history: [{ at: 1, correct: 3, total: 4 }],
    seenExerciseIds: ['e1'],
  });
  await db.sessions.put({
    id: 's1',
    programId: 'pt-PT-A1',
    startedAt: 1,
    plannedLength: 10,
    completed: 4,
    correct: 3,
    interrupted: false,
  });
  await db.attempts.put({
    id: 'a1',
    sessionId: 's1',
    exerciseId: 'e1',
    topicId: 't1',
    mode: 'tiles',
    correct: true,
    answer: 'ola',
    at: 1,
  });
  await db.customTopics.put({
    id: 'c1',
    programId: 'pt-PT-A1',
    topic: {
      id: 't1',
      moduleId: 'm1',
      title: 'Custom topic',
      kind: 'vocabulary',
      context: '',
      keyItems: [],
      exercises: [],
    },
    createdAt: 1,
  });
  await db.generatedExercises.put({
    id: 'g1',
    topicId: 't1',
    exercise: {
      id: 'e1',
      type: 'translate_word',
      topicId: 't1',
      difficulty: 1,
      allowedModes: ['typing'],
      prompt: 'p',
      explanation: 'e',
      direction: 'toTarget',
      sentence: 's',
      word: 'w',
      answer: 'a',
      options: ['a', 'b'],
    },
    createdAt: 1,
  });
}

beforeEach(async () => {
  await clearAllTables();
});

describe('buildBackup', () => {
  it('never includes the Gemini API key', async () => {
    await seedFixtureData('super-secret-key');
    const backup = await buildBackup();
    const settingsRow = backup.data.settings.find((row) => row.key === 'settings');
    expect(settingsRow).toBeDefined();
    expect(settingsRow?.value).not.toHaveProperty('geminiApiKey');
    expect(JSON.stringify(backup)).not.toContain('super-secret-key');
  });

  it('tags the export with the app id and schema version', async () => {
    const backup = await buildBackup();
    expect(backup.app).toBe('langtrainer');
    expect(backup.schemaVersion).toBe(1);
    expect(new Date(backup.exportedAt).toString()).not.toBe('Invalid Date');
  });
});

describe('export -> import round trip', () => {
  it('restores every table and preserves the current device API key', async () => {
    await seedFixtureData('device-a-key');
    const backup = await buildBackup();

    // Simulate a fresh device: wipe everything, then set a *different* local API key
    // before importing — the import must not touch it, since it's not in the backup.
    await clearAllTables();
    await updateSettings({ geminiApiKey: 'device-b-key' });

    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);

    const settings = await loadSettings();
    expect(settings.geminiApiKey).toBe('device-b-key');
    expect(settings.uiLanguage).toBe('ru');

    expect(await db.profile.get('me')).toMatchObject({ aboutMe: 'Learning Portuguese' });
    expect(await db.topicProgress.get('t1')).toMatchObject({ status: 'learning' });
    expect(await db.sessions.get('s1')).toMatchObject({ completed: 4, correct: 3 });
    expect(await db.attempts.get('a1')).toMatchObject({ correct: true, answer: 'ola' });
    expect(await db.customTopics.get('c1')).toMatchObject({ programId: 'pt-PT-A1' });
    expect(await db.generatedExercises.get('g1')).toMatchObject({ topicId: 't1' });
  });

  it('replaces existing data rather than merging it', async () => {
    await seedFixtureData('key-1');
    const backup = await buildBackup();

    // Leave a row that is *not* in the backup; it must be gone after import.
    await db.sessions.put({
      id: 'leftover',
      programId: 'pt-PT-A1',
      startedAt: 1,
      plannedLength: 5,
      completed: 0,
      correct: 0,
      interrupted: true,
    });

    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);

    expect(await db.sessions.get('leftover')).toBeUndefined();
    expect(await db.sessions.get('s1')).toBeDefined();
  });
});

describe('parseBackup / importBackup rejects malformed input', () => {
  it('rejects invalid JSON', async () => {
    const file = new File(['{ not valid json'], 'bad.json');
    await expect(importBackup(file)).rejects.toThrow();
  });

  it('rejects a JSON value that is not an object', () => {
    expect(() => parseBackup([1, 2, 3])).toThrow();
    expect(() => parseBackup('hello')).toThrow();
  });

  it('rejects the wrong app id', () => {
    expect(() =>
      parseBackup({ app: 'other-app', schemaVersion: 1, exportedAt: '', data: {} })
    ).toThrow();
  });

  it('rejects an unsupported schema version', () => {
    expect(() =>
      parseBackup({ app: 'langtrainer', schemaVersion: 99, exportedAt: '', data: {} })
    ).toThrow();
  });

  it('rejects a backup missing one of the required tables', () => {
    expect(() =>
      parseBackup({
        app: 'langtrainer',
        schemaVersion: 1,
        exportedAt: '',
        data: { settings: [], profile: [], topicProgress: [], sessions: [], attempts: [], customTopics: [] },
      })
    ).toThrow(/generatedExercises/);
  });
});
