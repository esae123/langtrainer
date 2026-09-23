import { describe, expect, it } from 'vitest';
import {
  MAX_COURSE_FILE_BYTES,
  checkCourseFile,
  courseFileName,
  formatCourseProblems,
  type InstalledCourse,
} from '../importProgram';
import type { Exercise, Program } from '../types';

/** A translate_word exercise that satisfies every rule in contentRules.ts. */
function makeExercise(containerId: string, n: number): Exercise {
  const nn = String(n).padStart(2, '0');
  return {
    id: `${containerId}-${nn}`,
    type: 'translate_word',
    topicId: containerId,
    difficulty: 1,
    allowedModes: ['tiles'],
    prompt: 'Translate the bold word.',
    explanation: 'Because of the ending.',
    direction: 'toTarget',
    sentence: `Sentence ${nn} with **work** in it.`,
    word: 'work',
    answer: 'trabalho',
    options: ['trabalho', 'trabalhas', 'trabalha', 'trabalham'],
  };
}

function makeCourse(id: string, topicIds: string[], phraseSetIds: string[] = []): Program {
  return {
    id,
    title: `Course ${id}`,
    targetLanguage: 'pt-PT',
    supportLanguage: 'en',
    level: 'A1',
    modules: [
      {
        id: `${id}-m1`,
        title: 'Module 1',
        description: 'Basics',
        topics: topicIds.map((topicId) => ({
          id: topicId,
          moduleId: `${id}-m1`,
          title: `Topic ${topicId}`,
          kind: 'grammar' as const,
          context: 'A short rule.',
          keyItems: [{ target: 'falar', support: 'to speak' }],
          exercises: [makeExercise(topicId, 1), makeExercise(topicId, 2)],
        })),
      },
    ],
    phraseSets: phraseSetIds.map((setId) => ({
      id: setId,
      title: `Phrases ${setId}`,
      phrases: [{ target: 'Bom dia', support: 'Good morning' }],
      exercises: [makeExercise(setId, 1)],
    })),
  };
}

const installedBundled: InstalledCourse = {
  id: 'pt-PT-A1',
  title: 'Português europeu A1',
  source: 'bundled',
  contentIds: ['m1-greetings', 'everyday-1'],
};

function check(json: unknown, installed: InstalledCourse[] = [installedBundled]) {
  const text = JSON.stringify(json);
  return checkCourseFile(text, text.length, installed);
}

describe('checkCourseFile — happy path', () => {
  it('accepts a valid course that collides with nothing', () => {
    const result = check(makeCourse('en-b2', ['en-b2-m1-work'], ['en-b2-everyday']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.id).toBe('en-b2');
    expect(result.replacesImported).toBe(false);
  });

  it('accepts a file built by content-build.ts, which carries a $generated marker', () => {
    const result = check({ $generated: 'do not edit', ...makeCourse('en-b2', ['en-b2-m1-work']) });
    expect(result.ok).toBe(true);
  });

  it('flags a re-import of an installed course as a replacement, ignoring its own ids', () => {
    const installed: InstalledCourse[] = [
      installedBundled,
      { id: 'en-b2', title: 'Course en-b2', source: 'imported', contentIds: ['en-b2-m1-work'] },
    ];
    const result = check(makeCourse('en-b2', ['en-b2-m1-work']), installed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replacesImported).toBe(true);
  });
});

describe('checkCourseFile — rejections', () => {
  it('rejects a file over the size limit without even parsing it', () => {
    const result = checkCourseFile('', MAX_COURSE_FILE_BYTES + 1, [installedBundled]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].code).toBe('tooLarge');
  });

  it('rejects invalid JSON', () => {
    const result = checkCourseFile('{ not json', 10, [installedBundled]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].code).toBe('notJson');
  });

  it('rejects a structurally invalid program with the validator message', () => {
    const { title: _dropped, ...noTitle } = makeCourse('en-b2', ['en-b2-m1-work']);
    const result = check(noTitle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toMatch(/\$\.title/);
  });

  it('reports content-rule problems (path + message) and saves nothing', () => {
    const course = makeCourse('en-b2', ['en-b2-m1-work']);
    course.modules[0].topics[0].exercises[0].id = 'wrong-id';
    const result = check(course);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((p) => p.path.endsWith('.id'))).toBe(true);
    expect(result.problems.some((p) => /must match the pattern/.test(p.message))).toBe(true);
  });

  it('rejects a course whose id is built into the app', () => {
    const result = check(makeCourse('pt-PT-A1', ['pt-a1-extra']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].code).toBe('bundledId');
  });

  it('rejects topic and phrase-set ids already used by another installed course', () => {
    const result = check(makeCourse('en-b2', ['m1-greetings'], ['everyday-1']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const collisions = result.problems.filter((p) => p.code === 'idCollision');
    expect(collisions.map((p) => p.vars?.id).sort()).toEqual(['everyday-1', 'm1-greetings']);
  });

  it('also catches collisions against another *imported* course', () => {
    const installed: InstalledCourse[] = [
      installedBundled,
      { id: 'fr-a2', title: 'French A2', source: 'imported', contentIds: ['shared-topic'] },
    ];
    const result = check(makeCourse('en-b2', ['shared-topic']), installed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]).toMatchObject({ code: 'idCollision' });
    expect(result.problems[0].vars?.title).toBe('French A2');
  });
});

describe('problem formatting and file names', () => {
  it('joins problems as "path: message" lines for the clipboard', () => {
    expect(
      formatCourseProblems([
        { path: '$.a', message: 'first' },
        { path: '$.b', message: 'second' },
      ])
    ).toBe('$.a: first\n$.b: second');
  });

  it('builds a safe course file name', () => {
    expect(courseFileName('pt-PT-A1')).toBe('pt-PT-A1.json');
    expect(courseFileName('weird id/../x')).toBe('weird-id-..-x.json');
  });
});
