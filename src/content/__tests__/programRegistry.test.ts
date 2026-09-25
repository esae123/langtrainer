import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { loadSettings, updateSettings } from '../../settings/settingsStore';
import {
  bundledEntries,
  contentIdsOf,
  getProgramSync,
  isBundledProgramId,
  loadAllEntries,
  programCounts,
  putImportedProgram,
  removeImportedProgram,
  resolveActiveEntry,
} from '../programRegistry';
import type { Program } from '../types';
import { readActiveSession, saveActiveSession } from '../../session/activeSession';
import type { SessionState } from '../../session/sessionState';

/** Just enough of a session snapshot for `readActiveSession` to accept it. */
function savedSessionOf(programId: string): SessionState {
  return {
    sessionId: `s-${programId}`,
    programId,
    index: 0,
    responses: [],
    plan: { items: [] },
  } as unknown as SessionState;
}

const BUNDLED_ID = bundledEntries[0].program.id;

function makeCourse(id: string, topicIds: string[], phraseSetIds: string[] = []): Program {
  return {
    id,
    title: `Course ${id}`,
    targetLanguage: 'en',
    supportLanguage: 'en',
    level: 'B2',
    modules: [
      {
        id: `${id}-m1`,
        title: 'Module 1',
        description: 'Basics',
        topics: topicIds.map((topicId) => ({
          id: topicId,
          moduleId: `${id}-m1`,
          title: `Topic ${topicId}`,
          kind: 'vocabulary' as const,
          context: 'Context.',
          keyItems: [],
          exercises: [],
        })),
      },
    ],
    phraseSets: phraseSetIds.map((setId) => ({
      id: setId,
      title: `Phrases ${setId}`,
      phrases: [],
      exercises: [],
    })),
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('program registry — merging bundled and imported courses', () => {
  it('ships at least one bundled course, reachable synchronously', () => {
    expect(bundledEntries.length).toBeGreaterThan(0);
    expect(isBundledProgramId(BUNDLED_ID)).toBe(true);
    expect(getProgramSync(BUNDLED_ID)?.id).toBe(BUNDLED_ID);
    expect(getProgramSync('nope')).toBeUndefined();
  });

  it('lists bundled courses first, then imported ones by import time', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']), 'en-b2.json');
    await db.programs.update('en-b2', { importedAt: 2 });
    await putImportedProgram(makeCourse('fr-a2', ['fr-a2-m1-cafe']));
    await db.programs.update('fr-a2', { importedAt: 1 });

    const entries = await loadAllEntries();
    expect(entries.map((entry) => entry.program.id)).toEqual([BUNDLED_ID, 'fr-a2', 'en-b2']);
    expect(entries[0].source).toBe('bundled');
    expect(entries[2]).toMatchObject({ source: 'imported', fileName: 'en-b2.json' });
  });

  it('ignores a stored row whose program is damaged, and one shadowing a bundled id', async () => {
    await db.programs.put({
      id: 'broken',
      // A hand-edited backup could contain anything here.
      program: { id: 'broken' } as unknown as Program,
      source: 'imported',
      importedAt: 1,
    });
    await db.programs.put({
      id: BUNDLED_ID,
      program: makeCourse(BUNDLED_ID, ['x']),
      source: 'imported',
      importedAt: 2,
    });

    const entries = await loadAllEntries();
    expect(entries.map((entry) => entry.program.id)).toEqual([BUNDLED_ID]);
    expect(entries[0].source).toBe('bundled');
  });
});

describe('resolveActiveEntry', () => {
  it('returns the course the id points at', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    const entries = await loadAllEntries();
    expect(resolveActiveEntry(entries, 'en-b2')?.program.id).toBe('en-b2');
  });

  it('falls back to the first bundled course when the id is gone', async () => {
    const entries = await loadAllEntries();
    expect(resolveActiveEntry(entries, 'removed-course')?.program.id).toBe(BUNDLED_ID);
  });

  it('returns undefined when nothing is installed at all', () => {
    expect(resolveActiveEntry([], 'anything')).toBeUndefined();
  });
});

describe('putImportedProgram / removeImportedProgram', () => {
  it('keeps progress when a course is replaced by a new version', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']), 'v1.json');
    await db.topicProgress.put({
      topicId: 'en-b2-m1-work',
      programId: 'en-b2',
      status: 'review',
      reviewStage: 1,
      failedReviewsInARow: 0,
      history: [{ at: 1, correct: 5, total: 5 }],
      seenExerciseIds: ['en-b2-m1-work-01'],
      wrongExerciseIds: [],
    });

    // Same topic id, more topics: a new version of the same course.
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work', 'en-b2-m1-study']), 'v2.json');

    expect(await db.programs.count()).toBe(1);
    expect(await db.programs.get('en-b2')).toMatchObject({ fileName: 'v2.json' });
    expect(await db.topicProgress.get('en-b2-m1-work')).toMatchObject({ status: 'review' });
  });

  it('removes the course but keeps progress by default', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await db.topicProgress.put({
      topicId: 'en-b2-m1-work',
      programId: 'en-b2',
      status: 'learning',
      reviewStage: 0,
      failedReviewsInARow: 0,
      history: [],
      seenExerciseIds: [],
      wrongExerciseIds: [],
    });

    await removeImportedProgram('en-b2', false);

    expect(await db.programs.get('en-b2')).toBeUndefined();
    expect(await db.topicProgress.get('en-b2-m1-work')).toBeDefined();
  });

  it('deletes progress, sessions and their attempts when asked to', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await db.topicProgress.bulkPut([
      {
        topicId: 'en-b2-m1-work',
        programId: 'en-b2',
        status: 'learning',
        reviewStage: 0,
        failedReviewsInARow: 0,
        history: [],
        seenExerciseIds: [],
        wrongExerciseIds: [],
      },
      {
        topicId: 'm1-greetings',
        programId: BUNDLED_ID,
        status: 'learning',
        reviewStage: 0,
        failedReviewsInARow: 0,
        history: [],
        seenExerciseIds: [],
        wrongExerciseIds: [],
      },
    ]);
    await db.sessions.bulkPut([
      {
        id: 's-en',
        programId: 'en-b2',
        startedAt: 1,
        plannedLength: 5,
        completed: 5,
        correct: 5,
        interrupted: false,
      },
      {
        id: 's-pt',
        programId: BUNDLED_ID,
        startedAt: 2,
        plannedLength: 5,
        completed: 5,
        correct: 5,
        interrupted: false,
      },
    ]);
    await db.attempts.bulkPut([
      {
        id: 'a-en',
        sessionId: 's-en',
        exerciseId: 'e1',
        topicId: 'en-b2-m1-work',
        mode: 'tiles',
        correct: true,
        answer: 'x',
        at: 1,
      },
      {
        id: 'a-pt',
        sessionId: 's-pt',
        exerciseId: 'e2',
        topicId: 'm1-greetings',
        mode: 'tiles',
        correct: true,
        answer: 'y',
        at: 2,
      },
    ]);

    await removeImportedProgram('en-b2', true);

    expect(await db.topicProgress.get('en-b2-m1-work')).toBeUndefined();
    expect(await db.sessions.get('s-en')).toBeUndefined();
    expect(await db.attempts.get('a-en')).toBeUndefined();
    // Another course's data is untouched.
    expect(await db.topicProgress.get('m1-greetings')).toBeDefined();
    expect(await db.sessions.get('s-pt')).toBeDefined();
    expect(await db.attempts.get('a-pt')).toBeDefined();
  });

  it('always drops a saved in-progress session of the removed course', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await saveActiveSession(savedSessionOf('en-b2'));

    await removeImportedProgram('en-b2', false);

    expect(await readActiveSession()).toBeNull();
  });

  it('keeps a saved session that belongs to another course', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await saveActiveSession(savedSessionOf(BUNDLED_ID));

    await removeImportedProgram('en-b2', true);

    expect((await readActiveSession())?.state.programId).toBe(BUNDLED_ID);
  });

  it("deletes the course's custom topics only together with its progress", async () => {
    const custom = (id: string, programId: string) => ({
      id,
      programId,
      createdAt: 1,
      topic: makeCourse(programId, [id]).modules[0].topics[0],
    });
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await db.customTopics.bulkPut([custom('c-en', 'en-b2'), custom('c-pt', BUNDLED_ID)]);

    await removeImportedProgram('en-b2', false);
    expect(await db.customTopics.get('c-en')).toBeDefined();

    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await removeImportedProgram('en-b2', true);
    expect(await db.customTopics.get('c-en')).toBeUndefined();
    expect(await db.customTopics.get('c-pt')).toBeDefined();
  });

  it('moves the active course back to a bundled one when the active course is removed', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await updateSettings({ activeProgramId: 'en-b2' });

    await removeImportedProgram('en-b2', false);

    expect((await loadSettings()).activeProgramId).toBe(BUNDLED_ID);
  });

  it('leaves the active course alone when a different course is removed', async () => {
    await putImportedProgram(makeCourse('en-b2', ['en-b2-m1-work']));
    await putImportedProgram(makeCourse('fr-a2', ['fr-a2-m1-cafe']));
    await updateSettings({ activeProgramId: 'fr-a2' });

    await removeImportedProgram('en-b2', false);

    expect((await loadSettings()).activeProgramId).toBe('fr-a2');
  });
});

describe('course counts and content ids', () => {
  it('counts modules, topics and exercises', () => {
    const counts = programCounts(makeCourse('en-b2', ['a', 'b'], ['ps']));
    expect(counts).toEqual({ modules: 1, topics: 2, exercises: 0 });
  });

  it('lists topic and phrase-set ids', () => {
    expect(contentIdsOf(makeCourse('en-b2', ['a', 'b'], ['ps']))).toEqual(['a', 'b', 'ps']);
  });
});
