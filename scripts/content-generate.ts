// LangTrainer — Gemini/OpenAI-backed content generator (docs/stage-4b-spec.md §3).
// Node 24, no SDK: calls the Gemini and OpenAI REST APIs directly via global fetch, no new
// dependency.
//
// NOT verified against the real Gemini or OpenAI APIs in this repo — there is no GEMINI_API_KEY
// or OPENAI_API_KEY available here, and this script must never call a real API from an automated
// run. Unit tests (scripts/__tests__/content-generate.test.ts) mock `fetch`; treat the very first
// real run against a live key as exploratory, and read its printed report carefully.
//
// Usage:
//   node scripts/content-generate.ts --program pt-PT-A1 --module m2
//   node scripts/content-generate.ts --program pt-PT-A1 --topic m2-family-pets --force
//   node scripts/content-generate.ts --program pt-PT-A1 --phrases everyday-2
//   node scripts/content-generate.ts --program en-b2 --module m1 --dry-run
//   node scripts/content-generate.ts --program pt-PT-A1 --topic m3-daily-routine --provider openai
// Flags: --program <id> (default pt-PT-A1), --module <id>, --topic <id>, --phrases <id>,
//        --force (regenerate even if the file already exists), --dry-run (print prompts only,
//        no API calls, no API key required), --provider <gemini|openai> (default gemini, or
//        AI_PROVIDER in .env), --model <name>, --thinking <low|high|medium> (gemini: thinking
//        level; openai: reasoning_effort), --count <n>, --sleep <ms> (default 2000, pause
//        between sequential calls).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContent, computeStats, type ContentProblem } from '../src/content/contentRules.ts';
import type { Exercise } from '../src/content/types.ts';
import { validateProgram } from '../src/content/validateProgram.ts';
import { moduleTopicBriefs, moduleTopicOrder, type ModuleTopicBrief } from './content-lib.ts';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(SCRIPT_DIR, '..');
const PROMPT_PARTS_DIR = path.join(SCRIPT_DIR, 'prompt-parts');

/**
 * Default Gemini model — a Flash-class model (cheap/fast, generous free tier).
 * Model names change and old ones get retired: if generation starts failing with 404, check
 * https://ai.google.dev/gemini-api/docs/models (or the model list in AI Studio) and pass
 * --model / set GEMINI_MODEL, or update this constant.
 */
export const DEFAULT_MODEL = 'gemini-3.6-flash';

export const CHUNK_SIZE = 20;
export const MAX_REPAIR_ROUNDS = 2;
/** Generous: a 20-exercise chunk is ~8-10k tokens, and thinking models spend output tokens too. */
export const MAX_OUTPUT_TOKENS = 65536;
const DEFAULT_SLEEP_MS = 2000;
/** Total HTTP attempts per call (first try + retries) on 429/500/502/503/504. */
export const MAX_ATTEMPTS = 5;
/** Upper bound for one backoff wait, whatever the server asks for. */
export const MAX_RETRY_DELAY_MS = 60_000;
/** First backoff pause when the API gives no delay; doubles per attempt (10s, 20s, 40s, 60s cap). Overload spikes (503) usually need more than a few seconds. */
export const BASE_RETRY_DELAY_MS = 10_000;
/** 504 is included for Gemini: long "thinking" generations can exceed the gateway's own timeout. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Thrown when the whole run must stop immediately — not just the current job/chunk: a Gemini
 * per-model *daily* free-tier quota exhausted (retrying or moving to the next topic would just
 * burn the same exhausted quota), or an OpenAI `insufficient_quota` (no credits — every further
 * call would fail the same way). Caught once, at the top of the jobs loop in `main`; never
 * written as a draft, and jobs not yet started are simply never attempted.
 */
export class StopRunError extends Error {}

// ---------- small fs helpers ----------

function programRoot(programId: string): string {
  return path.join(REPO_ROOT, 'content', programId);
}

function fileExists(p: string): boolean {
  return existsSync(p);
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function readText(p: string): string {
  return readFileSync(p, 'utf8');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort `.env` loader using Node's built-in support (no dependency). `.env` is optional —
 * GEMINI_API_KEY may already be set in the shell, or the run may be --dry-run (no key needed).
 */
export function loadEnvFile(): void {
  const envPath = path.join(REPO_ROOT, '.env');
  const loadEnvFile = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loadEnvFile !== 'function' || !fileExists(envPath)) return;
  try {
    loadEnvFile(envPath);
  } catch {
    // Malformed .env — ignore; GEMINI_API_KEY may still be set directly in the environment.
  }
}

// ---------- CLI ----------

export type Provider = 'gemini' | 'openai';

export interface Cli {
  program: string;
  module?: string;
  topic?: string;
  phrases?: string;
  force: boolean;
  dryRun: boolean;
  provider: Provider;
  /** Empty string when the active provider has no usable model (e.g. openai with no
   *  OPENAI_MODEL set) — checked before any real API call, never used as a literal model name. */
  model: string;
  /** Gemini 3 thinking level (low | high) or OpenAI `reasoning_effort` (low | medium | high);
   *  omitted from the request when unset. */
  thinkingLevel?: string;
  count?: number;
  sleepMs: number;
}

/**
 * Lowercases and validates `--provider`/`AI_PROVIDER` (review item 5): anything other than
 * "gemini"/"openai" (any case) is a clear configuration mistake, not silently treated as Gemini.
 * Unset (undefined/empty) defaults to "gemini".
 */
function normalizeProvider(value: string | undefined): Provider {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return 'gemini';
  const lower = trimmed.toLowerCase();
  if (lower === 'gemini' || lower === 'openai') return lower;
  throw new Error(
    `--provider/AI_PROVIDER must be "gemini" or "openai", got "${value}"`
  );
}

/** Parses a CLI integer flag (--count/--sleep): throws a clear error on a non-numeric value. */
function parseIntFlag(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${flag} must be a number, got "${raw}"`);
  return n;
}

export function parseArgs(argv: string[]): Cli {
  // A value flag at the end of argv, or immediately followed by another flag (e.g. `--count
  // --force`), has no value — never swallow the next flag's own name as if it were the value.
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1 || i === argv.length - 1) return undefined;
    const next = argv[i + 1];
    return next.startsWith('--') ? undefined : next;
  };
  const countRaw = get('--count');
  const sleepRaw = get('--sleep');
  const provider = normalizeProvider(get('--provider') ?? process.env.AI_PROVIDER);
  const model =
    get('--model') ??
    // `|| undefined`, not `??`: an empty GEMINI_MODEL=/OPENAI_MODEL= in .env must count as unset
    // (review item 4), not as an (invalid) empty-string model name.
    (provider === 'openai' ? process.env.OPENAI_MODEL || undefined : process.env.GEMINI_MODEL || undefined) ??
    (provider === 'gemini' ? DEFAULT_MODEL : undefined);
  const thinkingLevel =
    get('--thinking') ??
    ((provider === 'openai'
      ? process.env.OPENAI_REASONING_EFFORT
      : process.env.GEMINI_THINKING_LEVEL) || undefined);
  const sleepMs = parseIntFlag('--sleep', sleepRaw);
  return {
    program: get('--program') ?? 'pt-PT-A1',
    module: get('--module'),
    topic: get('--topic'),
    phrases: get('--phrases'),
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    provider,
    model: model ?? '',
    thinkingLevel,
    count: parseIntFlag('--count', countRaw),
    sleepMs: sleepMs ?? DEFAULT_SLEEP_MS,
  };
}

// ---------- jobs ----------

export interface TopicJob {
  kind: 'topic';
  programId: string;
  moduleId: string;
  topicId: string;
  title: string;
  topicKind: string;
  count: number;
  brief: string;
  known?: string;
  avoid?: string;
}

export interface PhraseJob {
  kind: 'phrases';
  programId: string;
  phraseSetId: string;
  title: string;
  brief: string;
  phraseCount: number;
  exerciseCount: number;
}

export type Job = TopicJob | PhraseJob;

function containerId(job: Job): string {
  return job.kind === 'topic' ? job.topicId : job.phraseSetId;
}

function exerciseCount(job: Job): number {
  return job.kind === 'topic' ? job.count : job.exerciseCount;
}

function findModuleTopicBrief(
  programId: string,
  moduleId: string,
  topicId: string
): ModuleTopicBrief | undefined {
  const modulePath = path.join(programRoot(programId), 'modules', `${moduleId}.json`);
  if (!fileExists(modulePath)) return undefined;
  return moduleTopicBriefs(readJson(modulePath)).find((t) => t.id === topicId);
}

function findModuleIdForTopic(programId: string, topicId: string): string | undefined {
  const modulesDir = path.join(programRoot(programId), 'modules');
  if (!fileExists(modulesDir)) return undefined;
  for (const f of readdirSync(modulesDir)) {
    if (!f.endsWith('.json')) continue;
    const moduleId = f.slice(0, -'.json'.length);
    if (findModuleTopicBrief(programId, moduleId, topicId)) return moduleId;
  }
  return undefined;
}

function briefToJob(
  programId: string,
  moduleId: string,
  brief: ModuleTopicBrief,
  countOverride?: number
): TopicJob {
  return {
    kind: 'topic',
    programId,
    moduleId,
    topicId: brief.id,
    title: brief.title ?? brief.id,
    topicKind: brief.kind ?? 'vocabulary',
    count: countOverride ?? brief.count ?? 40,
    brief: brief.brief ?? '',
    known: brief.known,
    avoid: brief.avoid,
  };
}

interface PhraseSetPlanEntry {
  id: string;
  title: string;
  brief: string;
  phrases: number;
  exercises: number;
}

/** Builds the list of generation jobs for one CLI invocation (may be more than one for --module). */
export function buildJobs(cli: Cli): Job[] {
  const jobs: Job[] = [];

  if (cli.topic) {
    const moduleId = findModuleIdForTopic(cli.program, cli.topic);
    if (!moduleId)
      throw new Error(
        `topic "${cli.topic}" was not found in any module of program "${cli.program}"`
      );
    const brief = findModuleTopicBrief(cli.program, moduleId, cli.topic);
    if (!brief)
      throw new Error(
        `topic "${cli.topic}" was not found in any module of program "${cli.program}"`
      );
    // Same guard as --module/--phrases: never overwrite a (possibly hand-reviewed) file without --force.
    const topicPath = path.join(programRoot(cli.program), 'topics', `${brief.id}.json`);
    if (!fileExists(topicPath) || cli.force)
      jobs.push(briefToJob(cli.program, moduleId, brief, cli.count));
  }

  if (cli.module) {
    const modulePath = path.join(programRoot(cli.program), 'modules', `${cli.module}.json`);
    if (!fileExists(modulePath)) throw new Error(`module file not found: ${modulePath}`);
    for (const brief of moduleTopicBriefs(readJson(modulePath))) {
      // --topic + --module for the same topic must not queue it twice (nit): --topic above
      // already added it (or decided to skip it without --force).
      if (cli.topic === brief.id) continue;
      const topicPath = path.join(programRoot(cli.program), 'topics', `${brief.id}.json`);
      if (fileExists(topicPath) && !cli.force) continue;
      jobs.push(briefToJob(cli.program, cli.module, brief, cli.count));
    }
  }

  if (cli.phrases) {
    const planPath = path.join(programRoot(cli.program), 'phrases.plan.json');
    if (!fileExists(planPath))
      throw new Error(`phrases.plan.json not found for program "${cli.program}"`);
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as PhraseSetPlanEntry[];
    const entry = plan.find((p) => p.id === cli.phrases);
    if (!entry) throw new Error(`phrase set "${cli.phrases}" not found in ${planPath}`);
    const phraseSetPath = path.join(programRoot(cli.program), 'phrases', `${entry.id}.json`);
    if (!fileExists(phraseSetPath) || cli.force) {
      jobs.push({
        kind: 'phrases',
        programId: cli.program,
        phraseSetId: entry.id,
        title: entry.title,
        brief: entry.brief,
        phraseCount: entry.phrases,
        exerciseCount: cli.count ?? entry.exercises,
      });
    }
  }

  return jobs;
}

// ---------- prompt assembly ----------

function readPromptPart(name: string): string {
  return readText(path.join(PROMPT_PARTS_DIR, name)).trim();
}

/** System prompt = intro + this program's RULES.md + the shared pedagogy/schema/examples/self-check. */
export function buildSystemPrompt(
  programId: string,
  programTitle: string,
  targetLanguage: string
): string {
  const rulesPath = path.join(programRoot(programId), 'RULES.md');
  const rules = fileExists(rulesPath)
    ? readText(rulesPath).trim()
    : '(no RULES.md found for this program)';
  const intro =
    `You are an experienced teacher preparing "${programTitle}" (target language: ${targetLanguage}) exercises ` +
    'for a language-learning app. You output ONLY one JSON object, no prose, no markdown fences. The JSON must ' +
    'follow the schema and the rules below exactly.';
  return [
    intro,
    '',
    'LANGUAGE RULES',
    rules,
    '',
    readPromptPart('pedagogy.md'),
    '',
    readPromptPart('schema.md'),
    '',
    readPromptPart('examples.md'),
    '',
    readPromptPart('self-check.md'),
  ].join('\n');
}

// ---------- ids and normalisation ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `<containerId>-NN`, 1-based. */
export function exerciseIdFor(container: string, n: number): string {
  return `${container}-${String(n).padStart(2, '0')}`;
}

function exercisesOf(obj: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(obj.exercises) ? obj.exercises.filter(isObject) : [];
}

/**
 * Forces the job's own ids onto whatever the model returned (review B3): topic/phrase-set id,
 * the topic's moduleId, every exercise's topicId and sequential exercise ids `<id>-01…`. The
 * model sometimes "improves" an id; without this, the validation filter (which keys on the job
 * id) would silently drop its problems and a broken file would be written. Extra exercises
 * beyond the job's count are dropped. Missing title/kind (first chunk lost) fall back to the brief.
 */
export function normalizeMerged(
  job: Job,
  merged: Record<string, unknown>
): Record<string, unknown> {
  const id = containerId(job);
  const exercises = exercisesOf(merged)
    .slice(0, exerciseCount(job))
    .map((exercise, i) => {
      const { id: _id, type, topicId: _topicId, ...rest } = exercise;
      return { id: exerciseIdFor(id, i + 1), type, topicId: id, ...rest };
    });
  const { id: _id, moduleId: _moduleId, exercises: _exercises, ...rest } = merged;
  if (job.kind === 'topic') {
    return {
      id,
      moduleId: job.moduleId,
      ...rest,
      title: typeof rest.title === 'string' ? rest.title : job.title,
      kind: typeof rest.kind === 'string' ? rest.kind : job.topicKind,
      exercises,
    };
  }
  return { id, ...rest, title: typeof rest.title === 'string' ? rest.title : job.title, exercises };
}

/** Ids the job asked for but the merged JSON does not have (a lost or short chunk). */
export function missingExerciseIds(job: Job, merged: Record<string, unknown>): string[] {
  const have = exercisesOf(merged).length;
  const ids: string[] = [];
  for (let n = have + 1; n <= exerciseCount(job); n++) ids.push(exerciseIdFor(containerId(job), n));
  return ids;
}

/**
 * The "target sentence" of an exercise as the model wrote it (lenient: raw JSON, any type),
 * so later chunks and repairs can be told which sentences are already taken.
 */
function targetSentence(exercise: Record<string, unknown>): string | undefined {
  const join = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string').join(' ')
      : typeof v === 'string'
        ? v
        : undefined;
  return (
    join(exercise.sentence) ??
    (typeof exercise.template === 'string' ? exercise.template : undefined) ??
    join(exercise.answer) ??
    (typeof exercise.sampleAnswer === 'string' ? exercise.sampleAnswer : undefined)
  );
}

function usedSentences(exercises: Record<string, unknown>[]): string[] {
  return exercises
    .map(targetSentence)
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
}

// ---------- prompts ----------

function jobDescriptionLines(job: Job): string[] {
  const lines: string[] = [];
  if (job.kind === 'topic') {
    lines.push(
      `programId: ${job.programId}`,
      `moduleId: ${job.moduleId}`,
      `topicId: ${job.topicId}`,
      `title: ${job.title}`,
      `kind: ${job.topicKind}`,
      `Core content: ${job.brief}`
    );
    if (job.known) lines.push(`Grammar already known by the learner (may be reused): ${job.known}`);
    if (job.avoid) lines.push(`Grammar NOT yet known (do not use): ${job.avoid}`);
    lines.push(`Total exercise count for the topic: ${job.count}`);
  } else {
    lines.push(
      `programId: ${job.programId}`,
      `phraseSetId: ${job.phraseSetId}`,
      `title: ${job.title}`,
      `Core content: ${job.brief}`,
      `Total phrases: ${job.phraseCount}`,
      `Total exercise count for the phrase set: ${job.exerciseCount}`
    );
  }
  return lines;
}

/** What a continuation chunk must know about the chunks before it (review S5). */
export interface ChunkContext {
  /** Topic context / phrase list and key items from chunk 1, so later chunks stay on the same material. */
  header?: Record<string, unknown>;
  /** Target sentences already used by earlier exercises. */
  sentences: string[];
}

/** Topic context + keyItems (or the phrase list) of the first chunk, compact. */
function headerSummary(header: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof header.context === 'string' && header.context.trim())
    lines.push(`Topic context: ${header.context.trim()}`);
  if (Array.isArray(header.keyItems) && header.keyItems.length > 0) {
    lines.push(`Key items: ${JSON.stringify(header.keyItems)}`);
  }
  if (Array.isArray(header.phrases) && header.phrases.length > 0) {
    lines.push(`Phrases of the set: ${JSON.stringify(header.phrases)}`);
  }
  return lines;
}

/** User prompt for one chunk of a job (docs/stage-4b-spec.md §3: "topic brief ... required id range"). */
export function buildUserPrompt(
  job: Job,
  chunk: { startNum: number; endNum: number; isContinuation: boolean },
  previous?: ChunkContext
): string {
  const id = containerId(job);
  const range = `${exerciseIdFor(id, chunk.startNum)}..${exerciseIdFor(id, chunk.endNum)}`;
  const thisChunkCount = chunk.endNum - chunk.startNum + 1;

  const lines: string[] = [
    job.kind === 'topic' ? 'Write one Topic JSON.' : 'Write one PhraseSet JSON.',
  ];
  lines.push(...jobDescriptionLines(job));

  if (!chunk.isContinuation) {
    lines.push(
      job.kind === 'topic'
        ? 'Return the full Topic JSON (id, moduleId, title, kind, context, keyItems) with exercises'
        : 'Return the full PhraseSet JSON (id, title, phrases) with exercises',
      `${chunk.startNum}-${chunk.endNum} (required id range ${range}, exactly ${thisChunkCount} exercises).`
    );
  } else {
    if (previous?.header) {
      lines.push(
        '',
        'The earlier part of this JSON already defines (keep using exactly this material):'
      );
      lines.push(...headerSummary(previous.header));
    }
    if (previous && previous.sentences.length > 0) {
      lines.push(
        '',
        'Target sentences already used by the earlier exercises (do NOT repeat or trivially rephrase them):'
      );
      lines.push(...previous.sentences.map((sentence) => `- ${sentence}`));
    }
    lines.push(
      '',
      `Continue the same ${job.kind === 'topic' ? 'topic' : 'phrase set'}, do not repeat sentences already used`,
      `in the earlier exercises. Return ONLY {"exercises": [...]} with exercises ${chunk.startNum}-${chunk.endNum}`,
      `(required id range ${range}, exactly ${thisChunkCount} exercises).`
    );
  }
  lines.push('Return only the JSON.');
  return lines.join('\n');
}

/** What one repair round asks for. */
export interface RepairRequest {
  /** Existing exercises to fix, by id. */
  fixIds: string[];
  /** Ids to write from scratch (lost/short chunks). */
  missingIds: string[];
  /** Topic-level fields (context, keyItems, …) have problems too. */
  fixHeader: boolean;
}

/**
 * A problem tagged `kind: 'missing'` is a lost/short chunk (see `missingProblem`), not a broken
 * header field — `repairRequestFor` must not ask the model to rewrite the header just because a
 * chunk never came back (review item 1). `ContentProblem` itself (contentRules.ts) is out of
 * scope here, so the tag is a local, optional extension of it.
 */
export type TaggedProblem = ContentProblem & { kind?: 'missing' };

/** Problems grouped into a repair request: exercise problems by id, everything else is header-level. */
export function repairRequestFor(
  merged: Record<string, unknown>,
  problems: TaggedProblem[],
  missingIds: string[]
): RepairRequest {
  const existing = new Set(exercisesOf(merged).map((e) => e.id));
  const fixIds: string[] = [];
  let fixHeader = false;
  for (const problem of problems) {
    if (problem.severity === 'warning') continue;
    if (problem.kind === 'missing') continue; // a lost chunk, not a header problem
    if (problem.exerciseId && existing.has(problem.exerciseId)) {
      if (!fixIds.includes(problem.exerciseId)) fixIds.push(problem.exerciseId);
    } else if (!problem.exerciseId) {
      fixHeader = true;
    }
  }
  return { fixIds, missingIds, fixHeader };
}

/**
 * Repair prompt (review B4): only the affected exercises plus the problem list, not the whole
 * 40-exercise JSON — the reply is small, so it neither truncates nor rewrites good exercises.
 */
export function buildRepairPrompt(
  job: Job,
  merged: Record<string, unknown>,
  problems: ContentProblem[],
  request: RepairRequest
): string {
  const exercises = exercisesOf(merged);
  const toFix = exercises.filter((e) => typeof e.id === 'string' && request.fixIds.includes(e.id));
  const others = exercises.filter(
    (e) => !(typeof e.id === 'string' && request.fixIds.includes(e.id))
  );
  const { exercises: _exercises, ...header } = merged;
  const noun = job.kind === 'topic' ? 'topic' : 'phrase set';

  const lines: string[] = [
    `Some parts of the ${noun} "${containerId(job)}" have problems. Fix ALL of them.`,
    '',
  ];
  lines.push(...jobDescriptionLines(job));
  if (request.fixHeader) {
    lines.push('', `Current ${noun} fields (without exercises):`, JSON.stringify(header));
  } else {
    lines.push('', ...headerSummary(header));
  }
  if (toFix.length > 0) {
    lines.push('', 'Exercises to fix (keep each id):', JSON.stringify(toFix));
  }
  if (request.missingIds.length > 0) {
    lines.push(
      '',
      `Also write these missing exercises from scratch, following every rule: ${request.missingIds.join(', ')}`
    );
  }
  const taken = usedSentences(others);
  if (taken.length > 0) {
    lines.push(
      '',
      'Sentences used by the other exercises (do not repeat them):',
      ...taken.map((x) => `- ${x}`)
    );
  }
  lines.push(
    '',
    'Problems:',
    ...problems
      .filter((p) => p.severity !== 'warning')
      .map((p) => `- ${p.exerciseId ?? p.path}: ${p.message}`)
  );
  lines.push(
    '',
    'Return ONLY one JSON object: {' +
      (request.fixHeader ? `"header": { every ${noun} field except exercises, corrected }, ` : '') +
      '"exercises": [ the fixed and the new exercises, each with its id ]}. No prose, no markdown fences.'
  );
  return lines.join('\n');
}

/**
 * Splices a repair reply back into the merged JSON: returned exercises replace the requested
 * ones by id (an exercise whose id the model changed takes the next unfilled requested id, in
 * order), missing ones are appended in id order, and a returned `header` replaces the topic
 * fields. Anything the model sent that was not asked for is ignored.
 */
export function spliceRepair(
  job: Job,
  merged: Record<string, unknown>,
  reply: Record<string, unknown>,
  request: RepairRequest
): Record<string, unknown> {
  const exercises = exercisesOf(merged);
  const pending = [...request.fixIds, ...request.missingIds];
  const placed = new Map<string, Record<string, unknown>>();
  const unmatched: Record<string, unknown>[] = [];
  for (const exercise of exercisesOf(reply)) {
    const idx = typeof exercise.id === 'string' ? pending.indexOf(exercise.id) : -1;
    if (idx === -1) {
      unmatched.push(exercise);
      continue;
    }
    placed.set(pending[idx], exercise);
    pending.splice(idx, 1);
  }
  for (const exercise of unmatched) {
    const id = pending.shift();
    if (!id) break;
    placed.set(id, exercise);
  }

  const next = exercises.map((e) =>
    typeof e.id === 'string' && placed.has(e.id) ? { ...placed.get(e.id), id: e.id } : e
  );
  for (const id of request.missingIds) {
    const exercise = placed.get(id);
    if (!exercise) break; // keep ids sequential: stop at the first one still missing
    next.push({ ...exercise, id });
  }

  let base: Record<string, unknown> = merged;
  if (request.fixHeader && isObject(reply.header)) {
    const { exercises: _exercises, ...header } = reply.header;
    base = { ...merged, ...header };
  }
  return normalizeMerged(job, { ...base, exercises: next });
}

// ---------- Gemini REST call ----------

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiResult {
  text: string;
  usage?: GeminiUsage;
  /** e.g. "STOP", "MAX_TOKENS", "SAFETY". */
  finishReason?: string;
}

interface GeminiCallOptions {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  /** Gemini 3 `generationConfig.thinkingConfig.thinkingLevel`; not sent when undefined. */
  thinkingLevel?: string;
  /** Overrides MAX_OUTPUT_TOKENS — some older models cap lower (GEMINI_MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
  /** Total HTTP attempts on 429/500/502/503/504 (default MAX_ATTEMPTS). */
  maxAttempts?: number;
  /** Injected in tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Parses "12s" / "1.5s" (google.rpc.RetryInfo) into ms. */
function parseDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return m ? Number(m[1]) * 1000 : undefined;
}

/**
 * How long to wait before retrying (review S2): `Retry-After-Ms` (OpenAI sends this — plain
 * milliseconds, checked first per review item 7), else `Retry-After` (delta seconds or an HTTP
 * date), else the body's `error.details[].retryDelay` ("12s"), else exponential backoff. Never
 * NaN, never negative, never more than MAX_RETRY_DELAY_MS.
 */
export function retryDelayMs(
  retryAfter: string | null,
  bodyText: string,
  attempt: number,
  now = Date.now(),
  retryAfterMs: string | null = null
): number {
  let ms: number | undefined;
  if (retryAfterMs !== null && retryAfterMs.trim() !== '') {
    const millis = Number(retryAfterMs);
    if (Number.isFinite(millis)) ms = millis;
  }
  if (ms === undefined && retryAfter !== null && retryAfter.trim() !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) ms = seconds * 1000;
    else {
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at)) ms = at - now;
    }
  }
  if (ms === undefined) {
    try {
      const body = JSON.parse(bodyText) as { error?: { details?: { retryDelay?: unknown }[] } };
      for (const detail of body.error?.details ?? []) {
        const parsed = parseDurationMs(detail?.retryDelay);
        if (parsed !== undefined) {
          ms = parsed;
          break;
        }
      }
    } catch {
      // not JSON — fall back to backoff
    }
  }
  if (ms === undefined || !Number.isFinite(ms)) ms = BASE_RETRY_DELAY_MS * 2 ** attempt;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, ms));
}

/** "3h 5m" / "5m" / "<1m", for a human-readable quota reset hint. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Detects a Gemini *daily* free-tier quota failure in a 429 body (review: Task B) — a
 * `QuotaFailure` violation whose `quotaId` contains "PerDay", or any `retryDelay` over 10
 * minutes (a per-minute quota resets fast; only a daily one waits that long). Per-minute 429s
 * (short retryDelay, no "PerDay" quotaId) are not matched here and keep retrying as before.
 */
function geminiDailyQuotaInfo(
  bodyText: string
): { quotaId?: string; resetMs?: number } | undefined {
  let body: {
    error?: {
      details?: Array<{
        '@type'?: string;
        violations?: Array<{ quotaId?: string }>;
        retryDelay?: unknown;
      }>;
    };
  };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const details = body.error?.details ?? [];
  let quotaId: string | undefined;
  for (const detail of details) {
    for (const violation of detail.violations ?? []) {
      if (violation.quotaId?.includes('PerDay')) quotaId = violation.quotaId;
    }
  }
  let resetMs: number | undefined;
  for (const detail of details) {
    const parsed = parseDurationMs(detail.retryDelay);
    if (parsed !== undefined) resetMs = parsed;
  }
  if (quotaId !== undefined || (resetMs !== undefined && resetMs > 10 * 60_000)) {
    return { quotaId, resetMs };
  }
  return undefined;
}

/** Calls the Gemini REST API with `fetch` (no SDK). Retries 429/500/502/503/504 with backoff, up to MAX_ATTEMPTS tries. */
export async function callGemini(opts: GeminiCallOptions): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      ...(opts.thinkingLevel ? { thinkingConfig: { thinkingLevel: opts.thinkingLevel } } : {}),
    },
  });
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const wait = opts.sleepFn ?? sleep;

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      // The key goes in a header, never in the URL (URLs end up in logs and error messages).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body,
    });

    if (!res.ok) {
      const errorText = await res.text();
      if (res.status === 429) {
        const quota = geminiDailyQuotaInfo(errorText);
        if (quota) {
          const resetHint = quota.resetMs !== undefined ? `in ~${formatDuration(quota.resetMs)}` : 'tomorrow';
          throw new StopRunError(
            `Gemini daily free-tier quota exhausted for model "${opts.model}"` +
              `${quota.quotaId ? ` (${quota.quotaId})` : ''} — resets ${resetHint}. ` +
              'Quotas are per model: try a different one with --model, or wait and retry tomorrow. ' +
              'Stopping the whole run now — content already written is untouched.'
          );
        }
      }
      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        const waitMs = retryDelayMs(res.headers.get('retry-after'), errorText, attempt - 1);
        console.log(
          `  Gemini HTTP ${res.status} — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
        );
        await wait(waitMs);
        continue;
      }
      throw new Error(`Gemini API error ${res.status}: ${errorText}`);
    }
    const json = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
        finishReason?: string;
      }[];
      usageMetadata?: GeminiUsage;
    };
    const candidate = json.candidates?.[0];
    // Thinking models may return several parts, some of them thoughts: keep only the answer.
    const texts = (candidate?.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text as string);
    if (texts.length === 0) {
      throw new Error(
        `Gemini response had no text part (finishReason: ${candidate?.finishReason ?? 'none'})`
      );
    }
    return {
      text: texts.join(''),
      usage: json.usageMetadata,
      finishReason: candidate?.finishReason,
    };
  }
}

// ---------- OpenAI REST call ----------

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAIResult {
  text: string;
  usage?: OpenAIUsage;
  /** e.g. "stop", "length", "content_filter". */
  finishReason?: string;
}

interface OpenAICallOptions {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  /** Sent as `reasoning_effort` (low | medium | high); not sent when undefined. */
  reasoningEffort?: string;
  /** Overrides MAX_OUTPUT_TOKENS — some models cap lower (OPENAI_MAX_COMPLETION_TOKENS). */
  maxCompletionTokens?: number;
  /** Total HTTP attempts on 429/500/502/503/504 (default MAX_ATTEMPTS). */
  maxAttempts?: number;
  /** Injected in tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** A 429 whose body is `error.code`/`error.type` === "insufficient_quota" — no credits left; retrying never helps. */
function isInsufficientQuota(bodyText: string): boolean {
  try {
    const body = JSON.parse(bodyText) as { error?: { code?: string; type?: string } };
    return body.error?.code === 'insufficient_quota' || body.error?.type === 'insufficient_quota';
  } catch {
    return false;
  }
}

/**
 * Calls the OpenAI chat completions REST API with `fetch` (no SDK). Retries 429/500/502/503/504 with
 * the same backoff as `callGemini`, up to `maxAttempts` tries — except a 429 that is
 * `insufficient_quota` (no billing credits), which throws `StopRunError` immediately: every
 * further call would fail the exact same way, so retrying or moving to the next job is pointless.
 */
export async function callOpenAI(opts: OpenAICallOptions): Promise<OpenAIResult> {
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = JSON.stringify({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: opts.maxCompletionTokens ?? MAX_OUTPUT_TOKENS,
    ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  });
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const wait = opts.sleepFn ?? sleep;

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      // The key goes in the Authorization header, never in the URL or logged anywhere.
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body,
    });

    if (!res.ok) {
      const errorText = await res.text();
      if (res.status === 429 && isInsufficientQuota(errorText)) {
        throw new StopRunError(
          'OpenAI quota/credits exhausted — check billing at ' +
            'https://platform.openai.com/account/billing. Stopping the whole run now — content ' +
            'already written is untouched.'
        );
      }
      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        // OpenAI sends `retry-after-ms` (plain milliseconds) alongside `retry-after` (seconds);
        // retryDelayMs checks it first (review item 7).
        const waitMs = retryDelayMs(
          res.headers.get('retry-after'),
          errorText,
          attempt - 1,
          undefined,
          res.headers.get('retry-after-ms')
        );
        console.log(
          `  OpenAI HTTP ${res.status} — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
        );
        await wait(waitMs);
        continue;
      }
      throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
    }
    const json = (await res.json()) as {
      choices?: {
        message?: { content?: string; refusal?: string };
        finish_reason?: string;
      }[];
      usage?: OpenAIUsage;
    };
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) {
      throw new Error(`OpenAI refused the request: ${choice.message.refusal}`);
    }
    const text = choice?.message?.content;
    if (typeof text !== 'string') {
      // A reasoning model can hit its token cap before emitting any content: content is then
      // null with finish_reason "length" — a cut-off reply (handled by callForJson's retry-once
      // and the repair loop), not a hard failure (nit: do not throw here).
      if (choice?.finish_reason === 'length') {
        return { text: '', usage: json.usage, finishReason: 'length' };
      }
      throw new Error(
        `OpenAI response had no message content (finish_reason: ${choice?.finish_reason ?? 'none'})`
      );
    }
    return { text, usage: json.usage, finishReason: choice?.finish_reason };
  }
}

function openaiMaxCompletionTokens(): number {
  const raw = process.env.OPENAI_MAX_COMPLETION_TOKENS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MAX_OUTPUT_TOKENS;
}

/**
 * Overrides MAX_OUTPUT_TOKENS (65536) for Gemini — some older models cap `maxOutputTokens` as low
 * as 8192 and reject the default (review item 8).
 */
function geminiMaxOutputTokens(): number {
  const raw = process.env.GEMINI_MAX_OUTPUT_TOKENS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MAX_OUTPUT_TOKENS;
}

/** Common shape both providers are normalised to, for `callForJson`/`printUsage`. */
interface ModelCallResult {
  text: string;
  /** Normalised: Gemini's "MAX_TOKENS" / OpenAI's "length" both come out as "MAX_TOKENS". */
  finishReason?: string;
  usage?: { prompt?: number; completion?: number; total?: number };
}

/** Dispatches to `callGemini` or `callOpenAI` per `cli.provider` and normalises the result. */
async function callModel(
  cli: Cli,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<ModelCallResult> {
  if (cli.provider === 'openai') {
    const result = await callOpenAI({
      model: cli.model,
      apiKey,
      systemPrompt,
      userPrompt,
      reasoningEffort: cli.thinkingLevel,
      maxCompletionTokens: openaiMaxCompletionTokens(),
    });
    return {
      text: result.text,
      finishReason: result.finishReason === 'length' ? 'MAX_TOKENS' : result.finishReason,
      usage: {
        prompt: result.usage?.prompt_tokens,
        completion: result.usage?.completion_tokens,
        total: result.usage?.total_tokens,
      },
    };
  }
  const result = await callGemini({
    model: cli.model,
    thinkingLevel: cli.thinkingLevel,
    apiKey,
    systemPrompt,
    userPrompt,
    maxOutputTokens: geminiMaxOutputTokens(),
  });
  return {
    text: result.text,
    finishReason: result.finishReason,
    usage: {
      prompt: result.usage?.promptTokenCount,
      completion: result.usage?.candidatesTokenCount,
      total: result.usage?.totalTokenCount,
    },
  };
}

/** Parses the model's JSON reply, defensively stripping markdown fences if the model added any. */
export function parseModelJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const parsed: unknown = JSON.parse(fenced ? fenced[1] : trimmed);
  if (!isObject(parsed)) throw new Error('model reply is not a JSON object');
  return parsed;
}

/**
 * One call whose reply must be a complete JSON object: a reply cut off at MAX_TOKENS or one that
 * does not parse is retried once (review B4). Returns null when both tries fail; HTTP errors
 * (after callGemini's own retries) are thrown.
 */
async function callForJson(
  cli: Cli,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  label: string
): Promise<Record<string, unknown> | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callModel(cli, apiKey, systemPrompt, userPrompt);
    printUsage(label, attempt === 1 ? '' : '(retry)', result.usage);
    let reason: string;
    if (result.finishReason === 'MAX_TOKENS') {
      reason = 'the reply was cut off (finishReason MAX_TOKENS)';
    } else {
      try {
        return parseModelJson(result.text);
      } catch (err) {
        reason = `the reply is not valid JSON (${err instanceof Error ? err.message : String(err)})`;
      }
    }
    console.error(
      `  [${label}] ${reason}${attempt === 1 ? ' — retrying once' : ' — giving up on this call'}`
    );
    if (attempt === 1) await sleep(cli.sleepMs);
  }
  return null;
}

/** Merges chunk responses: first chunk is the base object, later chunks contribute only exercises. */
export function mergeExerciseChunks(chunks: Record<string, unknown>[]): Record<string, unknown> {
  const [first, ...rest] = chunks;
  if (!first) throw new Error('mergeExerciseChunks: no chunks to merge');
  const exercises: unknown[] = Array.isArray(first.exercises) ? [...first.exercises] : [];
  for (const c of rest) {
    if (Array.isArray(c.exercises)) exercises.push(...c.exercises);
  }
  return { ...first, exercises };
}

// ---------- validation against the real program (docs/stage-4b-spec.md §3) ----------

function loadSiblingTopics(
  programId: string,
  moduleId: string,
  excludeTopicId: string
): Record<string, unknown>[] {
  const root = programRoot(programId);
  const modulePath = path.join(root, 'modules', `${moduleId}.json`);
  if (!fileExists(modulePath)) return [];
  const ids = moduleTopicOrder(readJson(modulePath)).filter((id) => id !== excludeTopicId);
  const topics: Record<string, unknown>[] = [];
  for (const id of ids) {
    const p = path.join(root, 'topics', `${id}.json`);
    if (fileExists(p)) topics.push(readJson(p));
  }
  return topics;
}

function readProgramMeta(programId: string): Record<string, unknown> {
  return readJson(path.join(programRoot(programId), 'program.json'));
}

export function hasBlockingProblems(problems: ContentProblem[]): boolean {
  return problems.some((p) => p.severity !== 'warning');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Structural (validateProgram) problems of the job's own container, one per broken exercise:
 * validateProgram stops at the first error, so each exercise is checked on its own inside a
 * known-good stub container, and the header is checked with no exercises.
 */
function structuralProblems(
  job: Job,
  meta: Record<string, unknown>,
  merged: Record<string, unknown>,
  prefix: string
): ContentProblem[] {
  const wrap = (container: Record<string, unknown>) =>
    job.kind === 'topic'
      ? {
          ...meta,
          modules: [
            { id: job.moduleId, title: job.moduleId, description: '', topics: [container] },
          ],
          phraseSets: [],
        }
      : { ...meta, modules: [], phraseSets: [container] };
  const stubHeader: Record<string, unknown> =
    job.kind === 'topic'
      ? {
          id: job.topicId,
          moduleId: job.moduleId,
          title: 'x',
          kind: 'grammar',
          context: 'x',
          keyItems: [],
        }
      : { id: job.phraseSetId, title: 'x', phrases: [] };

  const problems: ContentProblem[] = [];
  try {
    validateProgram(wrap({ ...merged, exercises: [] }));
  } catch (err) {
    problems.push({ path: prefix.slice(0, -1), message: errorMessage(err), severity: 'error' });
  }
  const exercises = exercisesOf(merged);
  exercises.forEach((exercise, i) => {
    try {
      validateProgram(wrap({ ...stubHeader, exercises: [exercise] }));
    } catch (err) {
      problems.push({
        path: `${prefix}exercises[${i}]`,
        message: errorMessage(err).replace('.exercises[0]', `.exercises[${i}]`),
        severity: 'error',
        ...(typeof exercise.id === 'string' ? { exerciseId: exercise.id } : {}),
        exerciseNumber: i + 1,
        exerciseCount: exercises.length,
      });
    }
  });
  return problems;
}

/**
 * Validates the merged JSON as part of a temporary program containing the module's existing
 * topics plus the new/updated one (docs/stage-4b-spec.md §3), and returns only the problems that
 * belong to this job's own container (so pre-existing issues in sibling topics don't block it).
 * Call it on `normalizeMerged` output: the filter keys on the job's id.
 */
export function validateMerged(job: Job, merged: Record<string, unknown>): ContentProblem[] {
  const meta = readProgramMeta(job.programId);
  const prefix =
    job.kind === 'topic'
      ? `modules.${job.moduleId}.topics.${job.topicId}.`
      : `phraseSets.${job.phraseSetId}.`;

  const structural = structuralProblems(job, meta, merged, prefix);
  if (structural.length > 0) return structural;

  const stub =
    job.kind === 'topic'
      ? {
          ...meta,
          modules: [
            {
              id: job.moduleId,
              title: job.moduleId,
              description: '',
              topics: [...loadSiblingTopics(job.programId, job.moduleId, job.topicId), merged],
            },
          ],
          phraseSets: [],
        }
      : { ...meta, modules: [], phraseSets: [merged] };

  try {
    const program = validateProgram(stub);
    const { problems } = checkContent(program);
    return problems.filter((p) => p.path.startsWith(prefix));
  } catch (err) {
    // Only a broken *sibling* topic can get here — the job's own container passed above.
    return [
      {
        path: prefix.slice(0, -1),
        message: `module could not be validated: ${errorMessage(err)}`,
        severity: 'error',
      },
    ];
  }
}

// ---------- Prettier formatting (devDependency already installed, no new runtime dependency) ----------

async function formatJson(obj: unknown): Promise<string> {
  const raw = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    const prettier = await import('prettier');
    return await prettier.format(raw, { parser: 'json' });
  } catch {
    return raw; // Prettier not resolvable (e.g. minimal test env) — plain JSON.stringify is fine.
  }
}

// ---------- one job end to end ----------

function printUsage(
  label: string,
  chunkLabel: string,
  usage?: { prompt?: number; completion?: number; total?: number }
): void {
  if (!usage) return;
  console.log(
    `  [${label}${chunkLabel ? ` ${chunkLabel}` : ''}] tokens — prompt: ${usage.prompt ?? '?'}, ` +
      `completion: ${usage.completion ?? '?'}, total: ${usage.total ?? '?'}`
  );
}

/** Difficulty-band targets from the pedagogy (`scripts/prompt-parts/pedagogy.md`, ≈8/18/14 of 40). */
const DIFFICULTY_TARGET: Record<'1' | '2' | '3', number> = { '1': 8, '2': 18, '3': 14 };

/**
 * Prints the type mix and difficulty stats of a freshly written topic, and WARNs (never fails —
 * these are informational, a human still reviews the content) when `build_phrase` < 10,
 * `question_for_answer` < 8, or a difficulty band is off its ≈8/18/14 target by more than 4
 * (review item 9).
 */
function printTopicStats(job: TopicJob, merged: Record<string, unknown>): void {
  const stats = computeStats(exercisesOf(merged) as unknown as Exercise[]);
  const typeMix = Object.entries(stats.byType)
    .map(([type, n]) => `${type}: ${n}`)
    .join(', ');
  console.log(`  Type mix — ${typeMix}`);
  console.log(
    `  Difficulty — 1: ${stats.byDifficulty['1']}, 2: ${stats.byDifficulty['2']}, 3: ${stats.byDifficulty['3']}`
  );

  const buildPhrase = stats.byType.build_phrase ?? 0;
  if (buildPhrase < 10) {
    console.log(`  WARN: only ${buildPhrase} build_phrase exercise(s) (pedagogy expects >= 10)`);
  }
  const questionForAnswer = stats.byType.question_for_answer ?? 0;
  if (questionForAnswer < 8) {
    console.log(
      `  WARN: only ${questionForAnswer} question_for_answer exercise(s) (pedagogy expects >= 8)`
    );
  }
  for (const band of ['1', '2', '3'] as const) {
    const target = DIFFICULTY_TARGET[band];
    const actual = stats.byDifficulty[band];
    if (Math.abs(actual - target) > 4) {
      console.log(
        `  WARN: difficulty ${band} has ${actual} exercise(s), more than 4 away from the ≈${target} target`
      );
    }
  }
}

function outputPath(job: Job): string {
  return job.kind === 'topic'
    ? path.join(programRoot(job.programId), 'topics', `${job.topicId}.json`)
    : path.join(programRoot(job.programId), 'phrases', `${job.phraseSetId}.json`);
}

export function draftPath(job: Job): string {
  const dir = job.kind === 'topic' ? 'topics' : 'phrases';
  return path.join(programRoot(job.programId), dir, `_draft-${containerId(job)}.json`);
}

export interface GenerateResult {
  merged: Record<string, unknown>;
  problems: TaggedProblem[];
  repairRounds: number;
}

function missingProblem(job: Job, missing: string[]): TaggedProblem {
  return {
    path: `${containerId(job)}.exercises`,
    message: `${missing.length} exercise(s) missing: ${missing[0]}..${missing[missing.length - 1]} (a chunk was lost)`,
    severity: 'error',
    kind: 'missing',
  };
}

/**
 * Core generation loop, independent of the filesystem (job/cli/systemPrompt/validate are all
 * plain inputs): chunked generation via `callGemini`/global `fetch`, merge + normalise ids,
 * validate, then up to `MAX_REPAIR_ROUNDS` targeted repair calls while there is a blocking
 * problem or missing exercises. Never throws on an API failure: whatever was merged so far is
 * returned with the failure as a problem, so the caller can always write a draft. Exported for
 * unit tests with a mocked `fetch` and a stub `validate`.
 */
export async function generateAndRepair(
  job: Job,
  cli: Cli,
  apiKey: string,
  systemPrompt: string,
  validate: (merged: Record<string, unknown>) => ContentProblem[]
): Promise<GenerateResult> {
  const id = containerId(job);
  const total = exerciseCount(job);
  const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));
  let merged: Record<string, unknown> = normalizeMerged(job, {});
  let fatal: ContentProblem | null = null;

  for (let i = 0; i < chunkCount; i++) {
    const startNum = i * CHUNK_SIZE + 1;
    const endNum = Math.min(total, (i + 1) * CHUNK_SIZE);
    const soFar = exercisesOf(merged);
    const { exercises: _exercises, ...header } = merged;
    const userPrompt = buildUserPrompt(
      job,
      { startNum, endNum, isContinuation: i > 0 },
      i > 0 ? { header, sentences: usedSentences(soFar) } : undefined
    );

    if (cli.dryRun) {
      console.log(`\n=== ${id} — chunk ${i + 1}/${chunkCount} ===`);
      console.log('--- system prompt ---');
      console.log(systemPrompt);
      console.log('--- user prompt ---');
      console.log(userPrompt);
      continue;
    }

    let reply: Record<string, unknown> | null;
    try {
      reply = await callForJson(
        cli,
        apiKey,
        systemPrompt,
        userPrompt,
        `${id} chunk ${i + 1}/${chunkCount}`
      );
    } catch (err) {
      if (err instanceof StopRunError) throw err;
      fatal = { path: id, message: `generation stopped: ${errorMessage(err)}`, severity: 'error' };
      break;
    }
    if (reply) {
      const chunkExercises = exercisesOf(reply).slice(0, endNum - startNum + 1);
      merged = normalizeMerged(
        job,
        i === 0
          ? { ...reply, exercises: chunkExercises }
          : { ...merged, exercises: [...soFar, ...chunkExercises] }
      );
    }
    // A lost chunk is not fatal: its exercises show up as missing and the repair round writes them.
    if (i < chunkCount - 1) await sleep(cli.sleepMs);
  }

  if (cli.dryRun) return { merged: {}, problems: [], repairRounds: 0 };

  const check = (): TaggedProblem[] => {
    const missing = missingExerciseIds(job, merged);
    const problems = validate(merged);
    return missing.length > 0 ? [...problems, missingProblem(job, missing)] : problems;
  };

  if (fatal) return { merged, problems: [...check(), fatal], repairRounds: 0 };

  let problems = check();
  let round = 0;
  while (hasBlockingProblems(problems) && round < MAX_REPAIR_ROUNDS) {
    round++;
    await sleep(cli.sleepMs);
    const request = repairRequestFor(merged, problems, missingExerciseIds(job, merged));
    const repairPrompt = buildRepairPrompt(job, merged, problems, request);
    let reply: Record<string, unknown> | null;
    try {
      reply = await callForJson(
        cli,
        apiKey,
        systemPrompt,
        repairPrompt,
        `${id} repair ${round}/${MAX_REPAIR_ROUNDS}`
      );
    } catch (err) {
      if (err instanceof StopRunError) throw err;
      return {
        merged,
        problems: [
          ...problems,
          { path: id, message: `repair stopped: ${errorMessage(err)}`, severity: 'error' },
        ],
        repairRounds: round,
      };
    }
    if (reply) merged = spliceRepair(job, merged, reply, request);
    problems = check();
  }

  return { merged, problems, repairRounds: round };
}

/** True when nothing useful was ever received: no exercises and no topic/phrase-set context. */
function hasNoContent(merged: Record<string, unknown>): boolean {
  if (exercisesOf(merged).length > 0) return false;
  return !(typeof merged.context === 'string' && merged.context.trim().length > 0);
}

/**
 * Writes `_draft-<id>.json` (whatever was generated) and prints why — unless nothing at all was
 * generated (review: Task C), in which case only the failure is printed: an empty draft file
 * with 0 exercises is never useful and just clutters `content/<programId>/` with files for
 * topics that were never really attempted.
 */
async function writeDraft(
  job: Job,
  merged: Record<string, unknown>,
  problems: ContentProblem[],
  why: string
): Promise<void> {
  if (hasNoContent(merged)) {
    console.error(`\n${containerId(job)}: ${why} — no content was received, not writing a draft`);
    for (const p of problems) console.error(`  - ${p.exerciseId ?? p.path}: ${p.message}`);
    return;
  }
  const dPath = draftPath(job);
  mkdirSync(path.dirname(dPath), { recursive: true });
  // formatJson (Prettier), not a bare JSON.stringify (nit) — drafts are read by a human while
  // debugging, and should be formatted exactly like a real topic/phrase-set file.
  writeFileSync(dPath, await formatJson(merged), 'utf8');
  console.error(`\n${containerId(job)}: ${why} — wrote ${path.relative(REPO_ROOT, dPath)}`);
  for (const p of problems) console.error(`  - ${p.exerciseId ?? p.path}: ${p.message}`);
}

/** Runs one job (topic or phrase set) against real content files: generate, validate, write. */
export async function runJob(
  job: Job,
  cli: Cli,
  apiKey: string,
  programMetaFor: (id: string) => Record<string, unknown>
): Promise<boolean> {
  const meta = programMetaFor(job.programId);
  const systemPrompt = buildSystemPrompt(
    job.programId,
    typeof meta.title === 'string' ? meta.title : job.programId,
    typeof meta.targetLanguage === 'string' ? meta.targetLanguage : '?'
  );

  let result: GenerateResult;
  try {
    result = await generateAndRepair(job, cli, apiKey, systemPrompt, (m) => validateMerged(job, m));
  } catch (err) {
    // StopRunError must stop the whole run (caller's loop), not just this job — never swallow it.
    if (err instanceof StopRunError) throw err;
    // Not expected otherwise (API failures are returned as problems), but never lose the run silently.
    await writeDraft(
      job,
      normalizeMerged(job, {}),
      [{ path: containerId(job), message: errorMessage(err) }],
      'generation crashed'
    );
    return false;
  }
  if (cli.dryRun) return true;
  const { merged, problems, repairRounds } = result;

  if (hasBlockingProblems(problems)) {
    await writeDraft(job, merged, problems, `still failing after ${repairRounds} repair round(s)`);
    return false;
  }

  const outPath = outputPath(job);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, await formatJson(merged), 'utf8');
  console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
  // The job succeeded: any earlier `_draft-<id>.json` from a previous failed attempt is now
  // stale and would otherwise sit next to the real file forever (review item 2).
  const oldDraft = draftPath(job);
  if (fileExists(oldDraft)) rmSync(oldDraft);
  if (job.kind === 'topic') printTopicStats(job, merged);
  if (problems.length > 0) {
    console.log('  (non-blocking warnings remain — review before shipping:)');
    for (const p of problems) console.log(`    - ${p.path}: ${p.message}`);
  }
  console.log(
    job.kind === 'topic'
      ? `Next steps: review the language, then add "${job.topicId}" to modules/${job.moduleId}.json ` +
          '(already there if this ran via --module/--topic) and run `npm run content:build` once the ' +
          'module is added to program.json moduleOrder.'
      : `Next steps: review the language, then add "${job.phraseSetId}" to program.json phraseSetOrder ` +
          'and run `npm run content:build`.'
  );
  return true;
}

/**
 * The clear failure message for `--provider openai` with no usable model (no OPENAI_MODEL, no
 * `--model`) — never a hardcoded model name, since OpenAI retires/renames model ids; the user is
 * told where to look instead. Returns undefined when the provider has a model (or isn't openai).
 */
export function openAiModelError(cli: Cli): string | undefined {
  if (cli.provider !== 'openai' || cli.model) return undefined;
  return (
    'OPENAI_MODEL is not set. Set OPENAI_MODEL in .env (or pass --model <name>) to a current OpenAI ' +
    'model id — do not guess, check a current "mini"-class model on ' +
    'https://platform.openai.com/docs/pricing for a cheap default.'
  );
}

// ---------- CLI entry point ----------

async function main(): Promise<void> {
  // .env must be loaded before parsing: parseArgs falls back to process.env.GEMINI_MODEL/OPENAI_MODEL.
  loadEnvFile();
  let cli: Cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (!cli.module && !cli.topic && !cli.phrases) {
    console.error(
      'Usage: node scripts/content-generate.ts --program <id> (--module <id> | --topic <id> | --phrases <id>) ' +
        '[--force] [--dry-run] [--provider <gemini|openai>] [--model <name>] [--thinking <low|high|medium>] ' +
        '[--count <n>] [--sleep <ms>]'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Provider: ${cli.provider}  Model: ${cli.model || '(not set)'}` +
      `${cli.thinkingLevel ? ` (thinking/reasoning: ${cli.thinkingLevel})` : ''}`
  );

  const modelError = openAiModelError(cli);
  if (modelError) {
    console.error(modelError);
    // Dry runs never call the API, so let them through to still preview the prompts.
    if (!cli.dryRun) {
      process.exitCode = 1;
      return;
    }
  }

  const apiKeyEnvVar = cli.provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  const apiKey = process.env[apiKeyEnvVar];
  if (!cli.dryRun && !apiKey) {
    console.error(
      `${apiKeyEnvVar} is not set. Copy .env.example to .env and fill it in, or pass --dry-run to preview ` +
        'the prompts without calling the API.'
    );
    process.exitCode = 1;
    return;
  }

  let jobs: Job[];
  try {
    jobs = buildJobs(cli);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (jobs.length === 0) {
    console.log(
      'Nothing to generate — every requested topic/phrase set already has a file (use --force to redo).'
    );
    return;
  }

  let ok = true;
  for (const job of jobs) {
    try {
      const jobOk = await runJob(job, cli, apiKey ?? '', readProgramMeta);
      ok = ok && jobOk;
    } catch (err) {
      if (!(err instanceof StopRunError)) throw err;
      // Stop the whole run immediately: jobs not yet started are never attempted (no empty
      // draft for them), and anything already written by earlier jobs in this loop stays.
      console.error(`\n${err.message}`);
      ok = false;
      break;
    }
  }
  if (!ok) process.exitCode = 1;
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
