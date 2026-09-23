// Shared file-loading logic for scripts/content-check.ts and scripts/content-build.ts.
// Reads content/pt-PT-A1/**/*.json off disk (see docs/content-authoring.md §1) and assembles
// a plain object shaped like a Program, ready for `validateProgram()`. Never throws on missing
// content files — those become entries in `problems` instead, so authors can check (or build)
// whatever content currently exists.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  /** Plain JSON shape matching Program, ready for validateProgram(). Modules = moduleOrder only. */
  program: Record<string, unknown>;
  /** Problems for program.json, the moduleOrder modules and phraseSetOrder phrase sets. */
  problems: LoadProblem[];
  /**
   * Modules whose file exists under `modules/` but that are not (yet) listed in program.json's
   * moduleOrder (docs/stage-4b-spec.md follow-up: "modules not yet listed must still be
   * validated"). `content-check` validates and reports these under a separate heading;
   * `content-build` ignores them — only moduleOrder is ever built.
   */
  unlistedModules: Record<string, unknown>[];
  /**
   * Problems for `unlistedModules`' own topics. Missing topic files here are always warnings
   * (never errors, regardless of `allowMissing`): a module not yet in moduleOrder is expected
   * to have brief-only topics with no file yet.
   */
  unlistedProblems: LoadProblem[];
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
 * One entry of a module file's `topics[]` (stage 4b module shape, docs/stage-4b-spec.md §1):
 * a topic id plus authoring metadata (brief, known/avoid grammar) for topics that may or may
 * not have a topic file on disk yet. Consumed by scripts/content-generate.ts; content-check
 * and content-build only ever need the derived topic id order (see `moduleTopicOrder` below).
 */
export interface ModuleTopicBrief {
  id: string;
  title?: string;
  kind?: string;
  count?: number;
  brief?: string;
  known?: string;
  avoid?: string;
}

function isModuleTopicBrief(v: unknown): v is ModuleTopicBrief {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).id === 'string';
}

/** Reads the `topics[]` briefs of a module file, or `[]` if it uses the old topicOrder-only shape. */
export function moduleTopicBriefs(moduleJson: Record<string, unknown>): ModuleTopicBrief[] {
  const topics = moduleJson.topics;
  if (!Array.isArray(topics)) return [];
  return topics.filter(isModuleTopicBrief);
}

/**
 * The ordered list of topic ids for a module file, in either shape (docs/stage-4b-spec.md §1):
 * the new `topics: [{ id, title, kind, brief, ... }]` (briefs; id order == topic order) or the
 * old `topicOrder: [topicId, ...]` (kept for backwards compatibility). `topics` wins if present.
 */
export function moduleTopicOrder(moduleJson: Record<string, unknown>): string[] {
  const briefs = moduleTopicBriefs(moduleJson);
  if (briefs.length > 0) return briefs.map((t) => t.id);
  return stringArray(moduleJson.topicOrder);
}

/**
 * Loads one module file's topics off disk (both shapes, see `moduleTopicOrder`). Missing topic
 * files become `problems` at `missingSeverity` and are simply left out of the returned topics.
 */
function loadModuleTopics(
  moduleId: string,
  moduleJson: Record<string, unknown>,
  missingSeverity: 'error' | 'warning',
  problems: LoadProblem[]
): unknown[] {
  const topics: unknown[] = [];
  for (const topicId of moduleTopicOrder(moduleJson)) {
    const topicRelPath = `topics/${topicId}.json`;
    if (!fileExists(topicRelPath)) {
      problems.push({
        path: topicRelPath,
        message: `topic "${topicId}" (listed in modules/${moduleId}.json) is missing`,
        severity: missingSeverity,
      });
      continue;
    }
    topics.push(readJson(topicRelPath));
  }
  return topics;
}

/** Every module id with a file under `modules/` (regardless of program.json's moduleOrder). */
function allModuleFileIds(): string[] {
  const dir = path.join(CONTENT_ROOT, 'modules');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
}

/**
 * Loads program.json, every module in its moduleOrder, every topic in each module's
 * topicOrder/topics, and every phrase set in phraseSetOrder. Missing files are reported as
 * `problems` (severity 'error' unless `allowMissing`, in which case 'warning') and simply
 * left out of the assembled program, so the rest of the content can still be checked/built.
 *
 * Modules present under `modules/*.json` but not listed in moduleOrder are loaded separately
 * into `unlistedModules`/`unlistedProblems` (see `LoadResult`) — `content-build` ignores them,
 * `content-check` validates and reports them under their own heading.
 */
export function loadProgram(allowMissing: boolean): LoadResult {
  const problems: LoadProblem[] = [];
  const missingSeverity: 'error' | 'warning' = allowMissing ? 'warning' : 'error';

  if (!fileExists('program.json')) {
    problems.push({ path: 'program.json', message: 'file not found', severity: 'error' });
    return { program: { modules: [], phraseSets: [] }, problems, unlistedModules: [], unlistedProblems: [] };
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
    modules.push({
      id: moduleJson.id,
      title: moduleJson.title,
      description: moduleJson.description,
      topics: loadModuleTopics(moduleId, moduleJson, missingSeverity, problems),
    });
  }

  // Modules that exist on disk but aren't (yet) in moduleOrder: still validated by
  // content-check (docs/stage-4b-spec.md follow-up), never built. Missing topic files here are
  // always warnings — an unlisted module is expected to still have brief-only topics.
  const unlistedProblems: LoadProblem[] = [];
  const unlistedModules: Record<string, unknown>[] = [];
  const listedIds = new Set(moduleOrder);
  for (const moduleId of allModuleFileIds()) {
    if (listedIds.has(moduleId)) continue;
    const moduleJson = readJson(`modules/${moduleId}.json`);
    unlistedModules.push({
      id: moduleJson.id,
      title: moduleJson.title,
      description: moduleJson.description,
      topics: loadModuleTopics(moduleId, moduleJson, 'warning', unlistedProblems),
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

  return { program, problems, unlistedModules, unlistedProblems };
}
