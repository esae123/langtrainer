import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { LangTrainerDB, type TopicProgressRow } from '../db';

describe('LangTrainerDB schema', () => {
  it('creates all seven tables and round-trips a row in each', async () => {
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

    expect(await db.settings.count()).toBe(1);
    expect(await db.profile.count()).toBe(1);
    expect(await db.topicProgress.count()).toBe(1);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.customTopics.count()).toBe(1);
    expect(await db.generatedExercises.count()).toBe(1);

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

  it('migrates version 1 rows to version 2 by adding failedReviewsInARow', async () => {
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
    expect(db.verno).toBe(2);
    const row = (await db.topicProgress.get('legacy')) as TopicProgressRow;
    expect(row.failedReviewsInARow).toBe(0);
    // Existing data survives the upgrade untouched.
    expect(row.seenExerciseIds).toEqual(['e1']);
    expect(row.nextReviewAt).toBe(42);
    expect(row.history).toHaveLength(1);
    db.close();
  });
});
