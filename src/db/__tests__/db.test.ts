import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { LangTrainerDB, type TopicProgressRow } from '../db';

describe('LangTrainerDB schema', () => {
  it('creates all eight tables and round-trips a row in each', async () => {
    const db = new LangTrainerDB('db-schema-test');

    await db.settings.put({ key: 'settings', value: { uiLanguage: 'en' } });
    await db.profile.put({ id: 'me', aboutMe: 'hi', updatedAt: 1 });
    await db.topicProgress.put({
      topicId: 't1',
      programId: 'pt-PT-A1',
      status: 'new',
      reviewStage: 0,
      failedReviewsInARow: 0,
      history: [],
      seenExerciseIds: [],
      wrongExerciseIds: [],
    });
    await db.sessions.put({
      id: 's1',
      programId: 'pt-PT-A1',
      startedAt: 1,
      plannedLength: 10,
      completed: 0,
      correct: 0,
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
        title: 'x',
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
    await db.programs.put({
      id: 'en-b2',
      source: 'imported',
      importedAt: 5,
      fileName: 'en-b2.json',
      program: {
        id: 'en-b2',
        title: 'English B2',
        targetLanguage: 'en',
        supportLanguage: 'en',
        level: 'B2',
        modules: [],
        phraseSets: [],
      },
    });

    expect(await db.settings.count()).toBe(1);
    expect(await db.profile.count()).toBe(1);
    expect(await db.topicProgress.count()).toBe(1);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.customTopics.count()).toBe(1);
    expect(await db.generatedExercises.count()).toBe(1);
    expect(await db.programs.get('en-b2')).toMatchObject({ source: 'imported', importedAt: 5 });

    db.close();
  });

  it('supports the indexed lookups used by future stages', async () => {
    const db = new LangTrainerDB('db-index-test');
    await db.topicProgress.bulkPut([
      {
        topicId: 't1',
        programId: 'pt-PT-A1',
        status: 'review',
        reviewStage: 1,
        failedReviewsInARow: 0,
        history: [],
        seenExerciseIds: [],
        wrongExerciseIds: [],
        nextReviewAt: 100,
      },
      {
        topicId: 't2',
        programId: 'pt-PT-A1',
        status: 'new',
        reviewStage: 0,
        failedReviewsInARow: 0,
        history: [],
        seenExerciseIds: [],
        wrongExerciseIds: [],
        nextReviewAt: 50,
      },
    ]);

    const byProgram = await db.topicProgress.where('programId').equals('pt-PT-A1').toArray();
    expect(byProgram).toHaveLength(2);

    const dueEarliest = await db.topicProgress.orderBy('nextReviewAt').first();
    expect(dueEarliest?.topicId).toBe('t2');

    await db.attempts.bulkPut([
      {
        id: 'a1',
        sessionId: 's1',
        exerciseId: 'e1',
        topicId: 't1',
        mode: 'tiles',
        correct: true,
        answer: 'x',
        at: 1,
      },
      {
        id: 'a2',
        sessionId: 's1',
        exerciseId: 'e2',
        topicId: 't2',
        mode: 'typing',
        correct: false,
        answer: 'y',
        at: 2,
      },
    ]);
    const bySession = await db.attempts.where('sessionId').equals('s1').toArray();
    expect(bySession).toHaveLength(2);

    db.close();
  });

  it('migrates version 1 rows through to version 4', async () => {
    const name = 'db-upgrade-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      settings: 'key',
      profile: 'id',
      topicProgress: 'topicId, programId, nextReviewAt',
      sessions: 'id, startedAt',
      attempts: 'id, sessionId, topicId, exerciseId',
      customTopics: 'id',
      generatedExercises: 'id, topicId',
    });
    await v1.open();
    await v1.table('topicProgress').put({
      topicId: 'legacy',
      programId: 'pt-PT-A1',
      status: 'review',
      reviewStage: 1,
      history: [{ at: 1, correct: 2, total: 3 }],
      seenExerciseIds: ['e1'],
      nextReviewAt: 42,
    });
    v1.close();

    const db = new LangTrainerDB(name);
    await db.open();
    expect(db.verno).toBe(4);
    const row = (await db.topicProgress.get('legacy')) as TopicProgressRow;
    expect(row.failedReviewsInARow).toBe(0);
    expect(row.wrongExerciseIds).toEqual([]);
    // Existing data survives the upgrade untouched.
    expect(row.seenExerciseIds).toEqual(['e1']);
    expect(row.nextReviewAt).toBe(42);
    expect(row.history).toHaveLength(1);
    // Version 4 only adds the (initially empty) programs store.
    expect(await db.programs.count()).toBe(0);
    db.close();
  });

  it('migrates version 2 rows to version 4 by adding wrongExerciseIds', async () => {
    const name = 'db-upgrade-v2-test';
    const v2 = new Dexie(name);
    const stores = {
      settings: 'key',
      profile: 'id',
      topicProgress: 'topicId, programId, nextReviewAt',
      sessions: 'id, startedAt',
      attempts: 'id, sessionId, topicId, exerciseId',
      customTopics: 'id',
      generatedExercises: 'id, topicId',
    };
    v2.version(1).stores(stores);
    v2.version(2).stores(stores);
    await v2.open();
    await v2.table('topicProgress').put({
      topicId: 'legacy2',
      programId: 'pt-PT-A1',
      status: 'learning',
      reviewStage: 0,
      failedReviewsInARow: 1,
      history: [],
      seenExerciseIds: ['e1', 'e2'],
    });
    v2.close();

    const db = new LangTrainerDB(name);
    await db.open();
    expect(db.verno).toBe(4);
    const row = (await db.topicProgress.get('legacy2')) as TopicProgressRow;
    expect(row.wrongExerciseIds).toEqual([]);
    expect(row.failedReviewsInARow).toBe(1);
    expect(row.seenExerciseIds).toEqual(['e1', 'e2']);
    db.close();
  });

  it('adds the programs store on the version 3 → 4 upgrade without touching data', async () => {
    const name = 'db-upgrade-v3-test';
    const stores = {
      settings: 'key',
      profile: 'id',
      topicProgress: 'topicId, programId, nextReviewAt',
      sessions: 'id, startedAt',
      attempts: 'id, sessionId, topicId, exerciseId',
      customTopics: 'id',
      generatedExercises: 'id, topicId',
    };
    const v3 = new Dexie(name);
    v3.version(1).stores(stores);
    v3.version(2).stores(stores);
    v3.version(3).stores(stores);
    await v3.open();
    await v3.table('topicProgress').put({
      topicId: 'legacy3',
      programId: 'pt-PT-A1',
      status: 'review',
      reviewStage: 2,
      failedReviewsInARow: 0,
      history: [{ at: 1, correct: 2, total: 3 }],
      seenExerciseIds: ['e1'],
      wrongExerciseIds: ['e2'],
      nextReviewAt: 77,
    });
    await v3.table('settings').put({ key: 'settings', value: { uiLanguage: 'ru' } });
    v3.close();

    const db = new LangTrainerDB(name);
    await db.open();
    expect(db.verno).toBe(4);
    expect(await db.programs.count()).toBe(0);
    const row = (await db.topicProgress.get('legacy3')) as TopicProgressRow;
    expect(row).toMatchObject({
      status: 'review',
      reviewStage: 2,
      wrongExerciseIds: ['e2'],
      nextReviewAt: 77,
    });
    expect(await db.settings.get('settings')).toMatchObject({ value: { uiLanguage: 'ru' } });
    db.close();
  });
});
