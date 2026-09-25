import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import type { Exercise, Program } from '../../content/types';
import { db } from '../../db/db';
import { loadSettings, updateSettings } from '../../settings/settingsStore';

// A tiny bundled course, so these tests don't depend on the (much larger) authored one.
vi.mock('../../content/programs', () => {
  const bundled: Program = {
    id: 'pt-PT-A1',
    title: 'Português europeu A1',
    targetLanguage: 'pt-PT',
    supportLanguage: 'en',
    level: 'A1',
    modules: [
      {
        id: 'm1',
        title: 'Module 1 — Basics',
        description: 'Basics module.',
        topics: [
          {
            id: 'm1-greetings',
            moduleId: 'm1',
            title: 'Greetings',
            kind: 'situation',
            context: 'Say hello.',
            keyItems: [],
            exercises: [],
          },
        ],
      },
    ],
    phraseSets: [{ id: 'everyday-1', title: 'Everyday phrases 1', phrases: [], exercises: [] }],
  };
  return { programs: [bundled] };
});

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

function makeCourse(id: string, title: string, topicIds: string[]): Program {
  return {
    id,
    title,
    targetLanguage: 'en',
    supportLanguage: 'en',
    level: 'B2',
    modules: [
      {
        id: `${id}-m1`,
        title: 'Module 1',
        description: 'Words',
        topics: topicIds.map((topicId) => ({
          id: topicId,
          moduleId: `${id}-m1`,
          title: `Topic ${topicId}`,
          kind: 'vocabulary' as const,
          context: 'Context.',
          keyItems: [],
          exercises: [makeExercise(topicId, 1), makeExercise(topicId, 2)],
        })),
      },
    ],
    phraseSets: [],
  };
}

const IMPORTED = makeCourse('en-b2', 'English B2 — vocabulary', ['en-b2-m1-work']);

async function seedImported(program = IMPORTED) {
  await db.programs.put({
    id: program.id,
    program,
    source: 'imported',
    importedAt: 1,
    fileName: `${program.id}.json`,
  });
}

/** Picks a file in the hidden course-import input. */
function pickCourseFile(contents: string, name = 'course.json') {
  const input = screen.getByTestId('course-file-input') as HTMLInputElement;
  const file = new File([contents], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

afterEach(async () => {
  window.location.hash = '';
  sessionStorage.clear();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('course switcher', () => {
  it('lists every installed course and switches the active one', async () => {
    await seedImported();
    render(<App />);

    // The course title is both the card's heading and its button (docs/stage-4a-spec.md §2).
    expect(
      await screen.findByRole('heading', { name: 'Português europeu A1' })
    ).toBeInTheDocument();
    expect(screen.getByText('Tap to switch course')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Português europeu A1' }));

    expect(await screen.findByRole('heading', { name: 'Courses' })).toBeInTheDocument();
    const row = await screen.findByRole('button', { name: /English B2 — vocabulary/ });
    expect(screen.getByText('Imported')).toBeInTheDocument();
    // One-line progress summary per course.
    expect(screen.getAllByText(/topics completed/).length).toBe(2);

    fireEvent.click(row);

    await waitFor(async () => expect((await loadSettings()).activeProgramId).toBe('en-b2'));
    // The sheet closes and the Learn card shows the newly active course.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('English B2 — vocabulary')).toBeInTheDocument();
  });
});

describe('session in an imported course', () => {
  // Regression: the imported courses load asynchronously; the runner plans exactly once,
  // so it used to plan the bundled fallback course before the imported one appeared.
  it('plans a new session from the active imported course', async () => {
    await seedImported();
    await updateSettings({ activeProgramId: 'en-b2' });
    window.location.hash = '#/session';
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Topic en-b2-m1-work' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing to practise yet')).not.toBeInTheDocument();
    await waitFor(async () => {
      const row = await db.settings.get('activeSession');
      expect((row?.value as { state: { programId: string } }).state.programId).toBe('en-b2');
    });
  });

  it('shows the imported active course on Learn without the bundled one first', async () => {
    await seedImported();
    await updateSettings({ activeProgramId: 'en-b2' });
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'English B2 — vocabulary' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Português europeu A1' })).not.toBeInTheDocument();
  });
});

describe('importing a course from a file', () => {
  it('validates, saves and activates the course', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('AI');

    const course = makeCourse('en-b2', 'English B2 — vocabulary', ['en-b2-m1-work']);
    pickCourseFile(JSON.stringify(course), 'en-b2.json');

    expect(await screen.findByText('Course imported')).toBeInTheDocument();
    const row = await db.programs.get('en-b2');
    expect(row).toMatchObject({ source: 'imported', fileName: 'en-b2.json' });
    expect((await loadSettings()).activeProgramId).toBe('en-b2');
  });

  it('asks before replacing an already imported course and keeps progress', async () => {
    await seedImported();
    await db.topicProgress.put({
      topicId: 'en-b2-m1-work',
      programId: 'en-b2',
      status: 'review',
      reviewStage: 1,
      failedReviewsInARow: 0,
      history: [],
      seenExerciseIds: ['en-b2-m1-work-01'],
      wrongExerciseIds: [],
    });
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('AI');

    const v2 = makeCourse('en-b2', 'English B2 — vocabulary', ['en-b2-m1-work', 'en-b2-m1-study']);
    pickCourseFile(JSON.stringify(v2), 'en-b2-v2.json');

    expect(
      await screen.findByText('Replace course «English B2 — vocabulary»?')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(await screen.findByText('Course imported')).toBeInTheDocument();
    await waitFor(async () =>
      expect((await db.programs.get('en-b2'))?.fileName).toBe('en-b2-v2.json')
    );
    expect((await db.programs.get('en-b2'))?.program.modules[0].topics).toHaveLength(2);
    expect(await db.topicProgress.get('en-b2-m1-work')).toMatchObject({ status: 'review' });
  });

  it('shows the problems and saves nothing when the file breaks a content rule', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('AI');

    const broken = makeCourse('en-b2', 'English B2', ['en-b2-m1-work']);
    broken.modules[0].topics[0].exercises[0].id = 'not-a-valid-id';
    pickCourseFile(JSON.stringify(broken));

    expect(await screen.findByText("This course can't be imported")).toBeInTheDocument();
    expect(screen.getByText(/must match the pattern/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy all/i })).toBeInTheDocument();
    expect(await db.programs.count()).toBe(0);
  });

  it('refuses a file that reuses a bundled course id', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('AI');

    pickCourseFile(JSON.stringify(makeCourse('pt-PT-A1', 'Fake', ['pt-extra'])));

    expect(
      await screen.findByText('This course is built into the app and cannot be replaced.')
    ).toBeInTheDocument();
    expect(await db.programs.count()).toBe(0);
  });

  it('refuses a file whose topic id is already used by another course', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('AI');

    pickCourseFile(JSON.stringify(makeCourse('en-b2', 'English B2', ['m1-greetings'])));

    expect(
      await screen.findByText(
        /The id «m1-greetings» is already used by the course «Português europeu A1»/
      )
    ).toBeInTheDocument();
    expect(await db.programs.count()).toBe(0);
  });

  it('rejects a file that is not JSON', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByText('AI');

    pickCourseFile('{ not json');

    expect(await screen.findByText('This file is not valid JSON.')).toBeInTheDocument();
    expect(await db.programs.count()).toBe(0);
  });
});

describe('library — courses as sections', () => {
  it('marks the bundled and imported courses and removes an imported one', async () => {
    await seedImported();
    await updateSettings({ activeProgramId: 'en-b2' });
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
    window.location.hash = '#/library';
    render(<App />);

    expect(await screen.findByRole('heading', { name: /content library/i })).toBeInTheDocument();
    expect(await screen.findByText('Imported')).toBeInTheDocument();
    expect(screen.getByText('Built in')).toBeInTheDocument();
    expect(screen.getByText('Module 1 — Basics')).toBeInTheDocument();
    expect(screen.getByText('Topic en-b2-m1-work')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove course/i }));
    expect(await screen.findByText('Remove «English B2 — vocabulary»?')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/also delete my progress/i));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Course removed')).toBeInTheDocument();
    await waitFor(async () => expect(await db.programs.count()).toBe(0));
    expect(await db.topicProgress.get('en-b2-m1-work')).toBeUndefined();
    // The active course falls back to the bundled one.
    expect((await loadSettings()).activeProgramId).toBe('pt-PT-A1');
  });

  it('keeps progress when the checkbox is left off', async () => {
    await seedImported();
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
    window.location.hash = '#/library';
    render(<App />);

    await screen.findByText('Imported');
    fireEvent.click(await screen.findByRole('button', { name: /remove course/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Course removed')).toBeInTheDocument();
    await waitFor(async () => expect(await db.programs.count()).toBe(0));
    expect(await db.topicProgress.get('en-b2-m1-work')).toBeDefined();
  });
});
