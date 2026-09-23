// Validating a course JSON file before it is installed on the device
// (docs/stage-4a-spec.md §3). Pure: no React, no Dexie — the caller passes in a
// description of the courses that are already installed.
import { checkContent } from './contentRules';
import { validateProgram } from './validateProgram';
import type { Program } from './types';

/** Course files are a few hundred kB at most; anything larger is a mistaken pick. */
export const MAX_COURSE_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Problems authored here (rather than by the validator or the content rules) carry a
 * code so the UI can show a translated message; everything else falls back to the
 * validator's English diagnostic, which is also what "Copy all" puts on the clipboard.
 */
export type CourseProblemCode = 'tooLarge' | 'notJson' | 'bundledId' | 'idCollision';

export interface CourseProblem {
  path: string;
  message: string;
  code?: CourseProblemCode;
  vars?: Record<string, string | number>;
}

/** What the registry knows about one already-installed course. */
export interface InstalledCourse {
  id: string;
  title: string;
  source: 'bundled' | 'imported';
  /** Topic and phrase-set ids, which must be unique across all installed courses. */
  contentIds: string[];
}

export type CourseCheckResult =
  | { ok: true; program: Program; replacesImported: boolean }
  | { ok: false; problems: CourseProblem[] };

/**
 * Structural validation + content rules + cross-course id uniqueness for one course
 * file. `text` is the raw file contents; `byteLength` its size on disk.
 *
 * Files produced by `scripts/content-build.ts` carry a leading `$generated` marker —
 * `validateProgram` only reads the fields it knows, so such a file is accepted as is.
 */
export function checkCourseFile(
  text: string,
  byteLength: number,
  installed: readonly InstalledCourse[]
): CourseCheckResult {
  if (byteLength > MAX_COURSE_FILE_BYTES) {
    return {
      ok: false,
      problems: [
        {
          path: '$',
          code: 'tooLarge',
          message: `File is ${Math.round(byteLength / 1024 / 1024)} MB; the limit is ${MAX_COURSE_FILE_BYTES / 1024 / 1024} MB.`,
        },
      ],
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      problems: [{ path: '$', code: 'notJson', message: 'This file is not valid JSON.' }],
    };
  }

  let program: Program;
  try {
    program = validateProgram(json);
  } catch (err) {
    // The validator throws on the first structural problem, so this is a list of one.
    return {
      ok: false,
      problems: [{ path: '$', message: err instanceof Error ? err.message : String(err) }],
    };
  }

  const bundled = installed.find(
    (course) => course.id === program.id && course.source === 'bundled'
  );
  if (bundled) {
    return {
      ok: false,
      problems: [
        {
          path: '$.id',
          code: 'bundledId',
          message: `Course id "${program.id}" is built into the app and cannot be replaced.`,
          vars: { id: program.id, title: bundled.title },
        },
      ],
    };
  }

  const problems: CourseProblem[] = checkContent(program).problems.map((problem) => ({
    path: problem.path,
    message: problem.message,
  }));

  // Topic ids double as progress keys, so two installed courses sharing one would mix
  // their progress; ids are therefore unique across every installed course.
  const ownIds = new Set([
    ...program.modules.flatMap((module) => module.topics.map((topic) => topic.id)),
    ...program.phraseSets.map((set) => set.id),
  ]);
  for (const course of installed) {
    if (course.id === program.id) continue; // replacing this very course
    for (const id of course.contentIds) {
      if (!ownIds.has(id)) continue;
      problems.push({
        path: `$.${id}`,
        code: 'idCollision',
        message: `Topic/phrase-set id "${id}" is already used by the course "${course.title}" (${course.id}).`,
        vars: { id, title: course.title },
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    program,
    replacesImported: installed.some(
      (course) => course.id === program.id && course.source === 'imported'
    ),
  };
}

/** Reads a picked file and runs `checkCourseFile` over it. */
export async function readAndCheckCourseFile(
  file: File,
  installed: readonly InstalledCourse[]
): Promise<CourseCheckResult> {
  if (file.size > MAX_COURSE_FILE_BYTES) return checkCourseFile('', file.size, installed);
  return checkCourseFile(await file.text(), file.size, installed);
}

/** The whole problem list as plain text, for the "Copy all" button. */
export function formatCourseProblems(problems: readonly CourseProblem[]): string {
  return problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
}

/** A course file name that is stable and safe on every platform. */
export function courseFileName(programId: string): string {
  return `${programId.replace(/[^a-zA-Z0-9._-]+/g, '-')}.json`;
}
