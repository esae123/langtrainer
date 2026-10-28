import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { ACTIVE_SESSION_KEY } from '../../session/activeSession';
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
    failedReviewsInARow: 0,
    history: [{ at: 1, correct: 3, total: 4 }],
    seenExerciseIds: ['e1'],
    wrongExerciseIds: [],
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
  await db.programs.put({
    id: 'en-b2',
    source: 'imported',
    importedAt: 20,
    fileName: 'en-b2.json',
    program: {
      id: 'en-b2',
      title: 'English B2',
      targetLanguage: 'en',
      supportLanguage: 'en',
      level: 'B2',
      modules: [
        {
          id: 'en-b2-m1',
          title: 'Module 1',
          description: 'Words',
          topics: [
            {
              id: 'en-b2-m1-work',
              moduleId: 'en-b2-m1',
              title: 'Work',
              kind: 'vocabulary',
              context: 'Context.',
              keyItems: [],
              exercises: [],
            },
          ],
        },
      ],
      phraseSets: [],
    },
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

  it('leaves the in-progress session snapshot out of the export', async () => {
    await seedFixtureData('key');
    await db.settings.put({
      key: ACTIVE_SESSION_KEY,
      value: { savedAt: 1, state: { sessionId: 's-live' } },
    });

    const backup = await buildBackup();
    expect(backup.data.settings.map((row) => row.key)).not.toContain(ACTIVE_SESSION_KEY);
    expect(JSON.stringify(backup)).not.toContain('s-live');
  });

  it('ignores an activeSession row coming from an older backup', async () => {
    const backup = await buildBackup();
    backup.data.settings.push({
      key: ACTIVE_SESSION_KEY,
      value: { savedAt: 1, state: { sessionId: 's-stale' } },
    });

    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);
    expect(await db.settings.get(ACTIVE_SESSION_KEY)).toBeUndefined();
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

  it('carries imported courses, so they travel with the backup', async () => {
    await seedFixtureData('key');
    const backup = await buildBackup();
    expect(backup.data.programs).toHaveLength(1);
    expect(backup.data.programs[0].program.modules[0].topics[0].id).toBe('en-b2-m1-work');

    await clearAllTables();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);

    const restored = await db.programs.get('en-b2');
    expect(restored).toMatchObject({ source: 'imported', fileName: 'en-b2.json' });
    expect(restored?.program.title).toBe('English B2');
  });

  it('keeps the session mix setting through a round trip', async () => {
    const sessionMix = { preset: 'custom' as const, shares: { new: 20, review: 70, phrases: 10 } };
    await updateSettings({ sessionMix });
    const backup = await buildBackup();

    await clearAllTables();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);
    expect((await loadSettings()).sessionMix).toEqual(sessionMix);
  });

  it('gives a backup made before the session mix existed the default mix', async () => {
    await seedFixtureData('key');
    const backup = await buildBackup();
    const row = backup.data.settings.find((entry) => entry.key === 'settings');
    delete (row?.value as Record<string, unknown>).sessionMix;

    await clearAllTables();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);
    const settings = await loadSettings();
    expect(settings.sessionMix).toEqual({
      preset: 'balanced',
      shares: { new: 50, review: 33, phrases: 17 },
    });
    expect(settings.uiLanguage).toBe('ru');
  });

  it('accepts an older backup that has no programs table', async () => {
    await seedFixtureData('key');
    const backup = await buildBackup();
    const older = { ...backup, data: { ...backup.data } } as unknown as Record<string, unknown>;
    delete (older.data as Record<string, unknown>).programs;

    const file = new File([JSON.stringify(older)], 'backup.json', { type: 'application/json' });
    await importBackup(file);

    expect(await db.programs.count()).toBe(0);
    expect(await db.topicProgress.get('t1')).toBeDefined();
  });

  it('accepts a backup file shared as text/plain (Chrome Android share target)', async () => {
    await seedFixtureData('key');
    const backup = await buildBackup();

    await clearAllTables();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'text/plain' });
    await importBackup(file);

    expect(await db.profile.get('me')).toMatchObject({ aboutMe: 'Learning Portuguese' });
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
        data: {
          settings: [],
          profile: [],
          topicProgress: [],
          sessions: [],
          attempts: [],
          customTopics: [],
        },
      })
    ).toThrow(/generatedExercises/);
  });
});

describe('AI check settings in backups (docs/stage-7-spec.md §1, §5)', () => {
  it('never exports the OpenAI API key', async () => {
    await updateSettings({ openaiApiKey: 'sk-very-secret', aiCheckEnabled: true });
    const backup = await buildBackup();
    const settingsRow = backup.data.settings.find((row) => row.key === 'settings');
    expect(settingsRow?.value).not.toHaveProperty('openaiApiKey');
    expect(JSON.stringify(backup)).not.toContain('sk-very-secret');
  });

  it("keeps the current device's key and switch on import", async () => {
    await updateSettings({ openaiApiKey: 'sk-device-a', aiCheckEnabled: false, uiLanguage: 'ru' });
    const backup = await buildBackup();
    // A hand-edited file must not be able to override them either.
    const row = backup.data.settings.find((entry) => entry.key === 'settings');
    Object.assign(row?.value as Record<string, unknown>, {
      openaiApiKey: 'sk-from-file',
      aiCheckEnabled: true,
    });

    await clearAllTables();
    await updateSettings({ openaiApiKey: 'sk-device-b', aiCheckEnabled: true });
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);

    const settings = await loadSettings();
    expect(settings.openaiApiKey).toBe('sk-device-b');
    expect(settings.aiCheckEnabled).toBe(true);
    expect(settings.uiLanguage).toBe('ru');
  });

  it('round-trips gradedBy and aiVerdict on attempts', async () => {
    await db.attempts.put({
      id: 'ai1',
      sessionId: 's1',
      exerciseId: 'e1',
      topicId: 't1',
      mode: 'typing',
      correct: true,
      answer: 'Eu fala inglês',
      at: 1,
      gradedBy: 'ai',
      aiVerdict: 'almost',
    });
    const backup = await buildBackup();
    await clearAllTables();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    await importBackup(file);
    expect(await db.attempts.get('ai1')).toMatchObject({ gradedBy: 'ai', aiVerdict: 'almost' });
  });

  it('migrates settings stored before Stage 7 with the AI defaults', async () => {
    await db.settings.put({ key: 'settings', value: { uiLanguage: 'ru', geminiApiKey: 'old' } });
    const settings = await loadSettings();
    expect(settings).toMatchObject({
      aiCheckEnabled: false,
      openaiApiKey: '',
      openaiModel: 'gpt-5.4-mini',
      geminiApiKey: 'old',
    });
  });
});
