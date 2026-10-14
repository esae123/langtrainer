// Shared file-loading logic for scripts/content-check.ts and scripts/content-build.ts.
// Reads content/<programId>/**/*.json off disk (default program pt-PT-A1, `--program <id>`) (see docs/content-authoring.md §1) and assembles
// a plain object shaped like a Program, ready for `validateProgram()`. Never throws on missing
// content files — those become entries in `problems` instead, so authors can check (or build)
// whatever content currently exists.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(SCRIPT_DIR, '..');
export const DEFAULT_PROGRAM_ID = 'pt-PT-A1';

/** content/<programId> */
export function contentRootFor(programId: string): string {
  return path.join(REPO_ROOT, 'content', programId);
}

/** `--program <id>` from argv, or the default course. */
export function programIdFromArgs(argv: readonly string[]): string {
  const i = argv.indexOf('--program');
  const value = i === -1 ? undefined : argv[i + 1];
  return value && !value.startsWith('--') ? value : DEFAULT_PROGRAM_ID;
}

/**
 * Ids of the courses built into the app: the JSON files imported by
 * src/content/programs/index.ts. Parsed from the source (Node can't import that module
 * directly — it imports JSON without an import attribute).
 */
export function bundledProgramIds(): string[] {
  const indexPath = path.join(REPO_ROOT, 'src', 'content', 'programs', 'index.ts');
  if (!existsSync(indexPath)) return [];
  const source = readFileSync(indexPath, 'utf8');
  return [...source.matchAll(/from\s+['"]\.\/([^'"]+)\.json['"]/g)].map((m) => m[1]);
}

/**
 * Where content:build writes a course: bundled courses go into the app
 * (src/content/programs/<id>.json, committed); any other course becomes an importable file
 * in dist-courses/<id>.json (gitignored) to be imported on the phone (docs/courses.md).
 */
export function buildOutputPath(
  programId: string,
  bundledIds: readonly string[] = bundledProgramIds()
): string {
  return bundledIds.includes(programId)
    ? path.join(REPO_ROOT, 'src', 'content', 'programs', `${programId}.json`)
    : path.join(REPO_ROOT, 'dist-courses', `${programId}.json`);
}

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

function readJson(root: string, relPath: string): Record<string, unknown> {
  const full = path.join(root, relPath);
  return JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown>;
}

function fileExists(root: string, relPath: string): boolean {
  return existsSync(path.join(root, relPath));
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
  coverage?: { items: { id: string; phrase: string }[]; minimumExercisesPerItem: number };
}

function isModuleTopicBrief(v: unknown): v is ModuleTopicBrief {
  return (
    typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).id === 'string'
  );
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
  root: string,
  moduleId: string,
  moduleJson: Record<string, unknown>,
  missingSeverity: 'error' | 'warning',
  problems: LoadProblem[]
): unknown[] {
  const topics: unknown[] = [];
  for (const topicId of moduleTopicOrder(moduleJson)) {
    const topicRelPath = `topics/${topicId}.json`;
    if (!fileExists(root, topicRelPath)) {
      problems.push({
        path: topicRelPath,
        message: `topic "${topicId}" (listed in modules/${moduleId}.json) is missing`,
        severity: missingSeverity,
      });
      continue;
    }
    const topic = readJson(root, topicRelPath);
    const brief = moduleTopicBriefs(moduleJson).find((entry) => entry.id === topicId);
    const existingCoverage = topic.coverage;
    const existingAssignments =
      typeof existingCoverage === 'object' && existingCoverage !== null
        ? (existingCoverage as Record<string, unknown>).assignments
        : undefined;
    topics.push(
      brief?.coverage
        ? {
            ...topic,
            coverage: {
              ...brief.coverage,
              ...(typeof existingAssignments === 'object' &&
              existingAssignments !== null &&
              !Array.isArray(existingAssignments)
                ? { assignments: existingAssignments as Record<string, string> }
                : {}),
            },
          }
        : topic
    );
  }
  return topics;
}

/** Every module id with a file under `modules/` (regardless of program.json's moduleOrder). */
function allModuleFileIds(root: string): string[] {
  const dir = path.join(root, 'modules');
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
export function loadProgram(
  allowMissing: boolean,
  programId: string = DEFAULT_PROGRAM_ID
): LoadResult {
  const root = contentRootFor(programId);
  const problems: LoadProblem[] = [];
  const missingSeverity: 'error' | 'warning' = allowMissing ? 'warning' : 'error';

  if (!fileExists(root, 'program.json')) {
    problems.push({
      path: 'program.json',
      message: `file not found (content/${programId}/program.json)`,
      severity: 'error',
    });
    return {
      program: { modules: [], phraseSets: [] },
      problems,
      unlistedModules: [],
      unlistedProblems: [],
    };
  }

  const programMeta = readJson(root, 'program.json');
  const moduleOrder = stringArray(programMeta.moduleOrder);
  const phraseSetOrder = stringArray(programMeta.phraseSetOrder);

  const modules: Record<string, unknown>[] = [];
  for (const moduleId of moduleOrder) {
    const moduleRelPath = `modules/${moduleId}.json`;
    if (!fileExists(root, moduleRelPath)) {
      problems.push({
        path: moduleRelPath,
        message: `module "${moduleId}" (listed in program.json moduleOrder) is missing`,
        severity: missingSeverity,
      });
      continue;
    }
    const moduleJson = readJson(root, moduleRelPath);
    modules.push({
      id: moduleJson.id,
      title: moduleJson.title,
      description: moduleJson.description,
      topics: loadModuleTopics(root, moduleId, moduleJson, missingSeverity, problems),
    });
  }

  // Modules that exist on disk but aren't (yet) in moduleOrder: still validated by
  // content-check (docs/stage-4b-spec.md follow-up), never built. Missing topic files here are
  // always warnings — an unlisted module is expected to still have brief-only topics.
  const unlistedProblems: LoadProblem[] = [];
  const unlistedModules: Record<string, unknown>[] = [];
  const listedIds = new Set(moduleOrder);
  for (const moduleId of allModuleFileIds(root)) {
    if (listedIds.has(moduleId)) continue;
    const moduleJson = readJson(root, `modules/${moduleId}.json`);
    unlistedModules.push({
      id: moduleJson.id,
      title: moduleJson.title,
      description: moduleJson.description,
      topics: loadModuleTopics(root, moduleId, moduleJson, 'warning', unlistedProblems),
    });
  }

  const phraseSets: unknown[] = [];
  for (const phraseSetId of phraseSetOrder) {
    const phraseSetRelPath = `phrases/${phraseSetId}.json`;
    if (!fileExists(root, phraseSetRelPath)) {
      problems.push({
        path: phraseSetRelPath,
        message: `phrase set "${phraseSetId}" (listed in program.json phraseSetOrder) is missing`,
        severity: missingSeverity,
      });
      continue;
    }
    phraseSets.push(readJson(root, phraseSetRelPath));
  }

  const program: Record<string, unknown> = {
    id: programMeta.id,
    title: programMeta.title,
    targetLanguage: programMeta.targetLanguage,
    supportLanguage: programMeta.supportLanguage,
    level: programMeta.level,
    ...(programMeta.topicCompletionPolicy === undefined
      ? {}
      : { topicCompletionPolicy: programMeta.topicCompletionPolicy }),
    modules,
    phraseSets,
  };

  return { program, problems, unlistedModules, unlistedProblems };
}
