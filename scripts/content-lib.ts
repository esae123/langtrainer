// Shared file-loading logic for scripts/content-check.ts and scripts/content-build.ts.
// Reads content/pt-PT-A1/**/*.json off disk (see docs/content-authoring.md §1) and assembles
// a plain object shaped like a Program, ready for `validateProgram()`. Never throws on missing
// content files — those become entries in `problems` instead, so authors can check (or build)
// whatever content currently exists.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_ROOT = path.join(SCRIPT_DIR, '..', 'content', 'pt-PT-A1');

export interface LoadProblem {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface LoadResult {
  /** Plain JSON shape matching Program, ready for validateProgram(). */
  program: Record<string, unknown>;
  problems: LoadProblem[];
}

function readJson(relPath: string): Record<string, unknown> {
  const full = path.join(CONTENT_ROOT, relPath);
  return JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown>;
}

function fileExists(relPath: string): boolean {
  return existsSync(path.join(CONTENT_ROOT, relPath));
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Loads program.json, every module in its moduleOrder, every topic in each module's
 * topicOrder, and every phrase set in phraseSetOrder. Missing files are reported as
 * `problems` (severity 'error' unless `allowMissing`, in which case 'warning') and simply
 * left out of the assembled program, so the rest of the content can still be checked/built.
 */
export function loadProgram(allowMissing: boolean): LoadResult {
  const problems: LoadProblem[] = [];
  const missingSeverity: 'error' | 'warning' = allowMissing ? 'warning' : 'error';

  if (!fileExists('program.json')) {
    problems.push({ path: 'program.json', message: 'file not found', severity: 'error' });
    return { program: { modules: [], phraseSets: [] }, problems };
  }

  const programMeta = readJson('program.json');
  const moduleOrder = stringArray(programMeta.moduleOrder);
  const phraseSetOrder = stringArray(programMeta.phraseSetOrder);

  const modules: Record<string, unknown>[] = [];
  for (const moduleId of moduleOrder) {
    const moduleRelPath = `modules/${moduleId}.json`;
    if (!fileExists(moduleRelPath)) {
      problems.push({
        path: moduleRelPath,
        message: `module "${moduleId}" (listed in program.json moduleOrder) is missing`,
        severity: missingSeverity,
      });
      continue;
    }
    const moduleJson = readJson(moduleRelPath);
    const topicOrder = stringArray(moduleJson.topicOrder);
    const topics: unknown[] = [];
    for (const topicId of topicOrder) {
      const topicRelPath = `topics/${topicId}.json`;
      if (!fileExists(topicRelPath)) {
        problems.push({
          path: topicRelPath,
          message: `topic "${topicId}" (listed in modules/${moduleId}.json topicOrder) is missing`,
          severity: missingSeverity,
        });
        continue;
      }
      topics.push(readJson(topicRelPath));
    }
    modules.push({
      id: moduleJson.id,
      title: moduleJson.title,
      description: moduleJson.description,
      topics,
    });
  }

  const phraseSets: unknown[] = [];
  for (const phraseSetId of phraseSetOrder) {
    const phraseSetRelPath = `phrases/${phraseSetId}.json`;
    if (!fileExists(phraseSetRelPath)) {
      problems.push({
        path: phraseSetRelPath,
        message: `phrase set "${phraseSetId}" (listed in program.json phraseSetOrder) is missing`,
        severity: missingSeverity,
      });
      continue;
    }
    phraseSets.push(readJson(phraseSetRelPath));
  }

  const program: Record<string, unknown> = {
    id: programMeta.id,
    title: programMeta.title,
    targetLanguage: programMeta.targetLanguage,
    supportLanguage: programMeta.supportLanguage,
    level: programMeta.level,
    modules,
    phraseSets,
  };

  return { program, problems };
}
