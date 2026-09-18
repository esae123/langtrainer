import { describe, expect, it } from 'vitest';
import { LangTrainerDB } from '../db';

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
        history: [],
        seenExerciseIds: [],
        nextReviewAt: 100,
      },
      {
        topicId: 't2',
        programId: 'pt-PT-A1',
        status: 'new',
        reviewStage: 0,
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
      { id: 'a1', sessionId: 's1', exerciseId: 'e1', topicId: 't1', mode: 'tiles', correct: true, answer: 'x', at: 1 },
      { id: 'a2', sessionId: 's1', exerciseId: 'e2', topicId: 't2', mode: 'typing', correct: false, answer: 'y', at: 2 },
    ]);
    const bySession = await db.attempts.where('sessionId').equals('s1').toArray();
    expect(bySession).toHaveLength(2);

    db.close();
  });
});
