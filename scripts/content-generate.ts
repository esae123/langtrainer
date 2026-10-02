// LangTrainer — Gemini-backed content generator (docs/stage-4b-spec.md §3).
// Node 24, no SDK: calls the Gemini REST API directly via global fetch, no new dependency.
//
// NOT verified against the real Gemini API in this repo — there is no GEMINI_API_KEY available
// here, and this script must never call the real API from an automated run. Unit tests
// (scripts/__tests__/content-generate.test.ts) mock `fetch`; treat the very first real run
// against a live key as exploratory, and read its printed report carefully.
//
// Usage:
//   node scripts/content-generate.ts --program pt-PT-A1 --module m2
//   node scripts/content-generate.ts --program pt-PT-A1 --topic m2-family-pets --force
//   node scripts/content-generate.ts --program pt-PT-A1 --phrases everyday-2
//   node scripts/content-generate.ts --program en-b2 --module m1 --dry-run
// Flags: --program <id> (default pt-PT-A1), --module <id>, --topic <id>, --phrases <id>,
//        --force (regenerate even if the file already exists), --dry-run (print prompts only,
//        no API calls, no GEMINI_API_KEY required), --model <name>, --count <n>,
//        --sleep <ms> (default 2000, pause between sequential calls).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContent, type ContentProblem } from '../src/content/contentRules.ts';
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
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const CHUNK_SIZE = 20;
export const MAX_REPAIR_ROUNDS = 2;
/** Generous: a 20-exercise chunk is ~8-10k tokens, and thinking models spend output tokens too. */
export const MAX_OUTPUT_TOKENS = 32768;
const DEFAULT_SLEEP_MS = 2000;
/** Total HTTP attempts per call (first try + retries) on 429/500/503. */
export const MAX_ATTEMPTS = 5;
/** Upper bound for one backoff wait, whatever the server asks for. */
export const MAX_RETRY_DELAY_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

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

export interface Cli {
  program: string;
  module?: string;
  topic?: string;
  phrases?: string;
  force: boolean;
  dryRun: boolean;
  model: string;
  count?: number;
  sleepMs: number;
}

export function parseArgs(argv: string[]): Cli {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 || i === argv.length - 1 ? undefined : argv[i + 1];
  };
  const countRaw = get('--count');
  const sleepRaw = get('--sleep');
  return {
    program: get('--program') ?? 'pt-PT-A1',
    module: get('--module'),
    topic: get('--topic'),
    phrases: get('--phrases'),
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    model: get('--model') ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    count: countRaw ? Number(countRaw) : undefined,
    sleepMs: sleepRaw ? Number(sleepRaw) : DEFAULT_SLEEP_MS,
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

function findModuleTopicBrief(programId: string, moduleId: string, topicId: string): ModuleTopicBrief | undefined {
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

function briefToJob(programId: string, moduleId: string, brief: ModuleTopicBrief, countOverride?: number): TopicJob {
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
    if (!moduleId) throw new Error(`topic "${cli.topic}" was not found in any module of program "${cli.program}"`);
    const brief = findModuleTopicBrief(cli.program, moduleId, cli.topic);
    if (!brief) throw new Error(`topic "${cli.topic}" was not found in any module of program "${cli.program}"`);
    // Same guard as --module/--phrases: never overwrite a (possibly hand-reviewed) file without --force.
    const topicPath = path.join(programRoot(cli.program), 'topics', `${brief.id}.json`);
    if (!fileExists(topicPath) || cli.force) jobs.push(briefToJob(cli.program, moduleId, brief, cli.count));
  }

  if (cli.module) {
    const modulePath = path.join(programRoot(cli.program), 'modules', `${cli.module}.json`);
    if (!fileExists(modulePath)) throw new Error(`module file not found: ${modulePath}`);
    for (const brief of moduleTopicBriefs(readJson(modulePath))) {
      const topicPath = path.join(programRoot(cli.program), 'topics', `${brief.id}.json`);
      if (fileExists(topicPath) && !cli.force) continue;
      jobs.push(briefToJob(cli.program, cli.module, brief, cli.count));
    }
  }

  if (cli.phrases) {
    const planPath = path.join(programRoot(cli.program), 'phrases.plan.json');
    if (!fileExists(planPath)) throw new Error(`phrases.plan.json not found for program "${cli.program}"`);
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
export function buildSystemPrompt(programId: string, programTitle: string, targetLanguage: string): string {
  const rulesPath = path.join(programRoot(programId), 'RULES.md');
  const rules = fileExists(rulesPath) ? readText(rulesPath).trim() : '(no RULES.md found for this program)';
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
export function normalizeMerged(job: Job, merged: Record<string, unknown>): Record<string, unknown> {
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
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : typeof v === 'string' ? v : undefined;
  return (
    join(exercise.sentence) ??
    (typeof exercise.template === 'string' ? exercise.template : undefined) ??
    join(exercise.answer) ??
    (typeof exercise.sampleAnswer === 'string' ? exercise.sampleAnswer : undefined)
  );
}

function usedSentences(exercises: Record<string, unknown>[]): string[] {
  return exercises.map(targetSentence).filter((x): x is string => typeof x === 'string' && x.length > 0);
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
  if (typeof header.context === 'string' && header.context.trim()) lines.push(`Topic context: ${header.context.trim()}`);
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

  const lines: string[] = [job.kind === 'topic' ? 'Write one Topic JSON.' : 'Write one PhraseSet JSON.'];
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
      lines.push('', 'The earlier part of this JSON already defines (keep using exactly this material):');
      lines.push(...headerSummary(previous.header));
    }
    if (previous && previous.sentences.length > 0) {
      lines.push('', 'Target sentences already used by the earlier exercises (do NOT repeat or trivially rephrase them):');
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

/** Problems grouped into a repair request: exercise problems by id, everything else is header-level. */
export function repairRequestFor(
  merged: Record<string, unknown>,
  problems: ContentProblem[],
  missingIds: string[]
): RepairRequest {
  const existing = new Set(exercisesOf(merged).map((e) => e.id));
  const fixIds: string[] = [];
  let fixHeader = false;
  for (const problem of problems) {
    if (problem.severity === 'warning') continue;
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
  const others = exercises.filter((e) => !(typeof e.id === 'string' && request.fixIds.includes(e.id)));
  const { exercises: _exercises, ...header } = merged;
  const noun = job.kind === 'topic' ? 'topic' : 'phrase set';

  const lines: string[] = [`Some parts of the ${noun} "${containerId(job)}" have problems. Fix ALL of them.`, ''];
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
    lines.push('', `Also write these missing exercises from scratch, following every rule: ${request.missingIds.join(', ')}`);
  }
  const taken = usedSentences(others);
  if (taken.length > 0) {
    lines.push('', 'Sentences used by the other exercises (do not repeat them):', ...taken.map((x) => `- ${x}`));
  }
  lines.push('', 'Problems:', ...problems.filter((p) => p.severity !== 'warning').map((p) => `- ${p.exerciseId ?? p.path}: ${p.message}`));
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

  const next = exercises.map((e) => (typeof e.id === 'string' && placed.has(e.id) ? { ...placed.get(e.id), id: e.id } : e));
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
  /** Total HTTP attempts on 429/500/503 (default MAX_ATTEMPTS). */
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
 * How long to wait before retrying (review S2): `Retry-After` (delta seconds or an HTTP date),
 * else the body's `error.details[].retryDelay` ("12s"), else exponential backoff. Never NaN,
 * never negative, never more than MAX_RETRY_DELAY_MS.
 */
export function retryDelayMs(retryAfter: string | null, bodyText: string, attempt: number, now = Date.now()): number {
  let ms: number | undefined;
  if (retryAfter !== null && retryAfter.trim() !== '') {
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
  if (ms === undefined || !Number.isFinite(ms)) ms = 2 ** attempt * 1000;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, ms));
}

/** Calls the Gemini REST API with `fetch` (no SDK). Retries 429/500/503 with backoff, up to MAX_ATTEMPTS tries. */
export async function callGemini(opts: GeminiCallOptions): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_OUTPUT_TOKENS },
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
      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        const waitMs = retryDelayMs(res.headers.get('retry-after'), errorText, attempt - 1);
        console.log(`  Gemini HTTP ${res.status} — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`);
        await wait(waitMs);
        continue;
      }
      throw new Error(`Gemini API error ${res.status}: ${errorText}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: GeminiUsage;
    };
    const candidate = json.candidates?.[0];
    // Thinking models may return several parts, some of them thoughts: keep only the answer.
    const texts = (candidate?.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text as string);
    if (texts.length === 0) {
      throw new Error(`Gemini response had no text part (finishReason: ${candidate?.finishReason ?? 'none'})`);
    }
    return { text: texts.join(''), usage: json.usageMetadata, finishReason: candidate?.finishReason };
  }
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
    const result = await callGemini({ model: cli.model, apiKey, systemPrompt, userPrompt });
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
    console.error(`  [${label}] ${reason}${attempt === 1 ? ' — retrying once' : ' — giving up on this call'}`);
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

function loadSiblingTopics(programId: string, moduleId: string, excludeTopicId: string): Record<string, unknown>[] {
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
function structuralProblems(job: Job, meta: Record<string, unknown>, merged: Record<string, unknown>, prefix: string): ContentProblem[] {
  const wrap = (container: Record<string, unknown>) =>
    job.kind === 'topic'
      ? { ...meta, modules: [{ id: job.moduleId, title: job.moduleId, description: '', topics: [container] }], phraseSets: [] }
      : { ...meta, modules: [], phraseSets: [container] };
  const stubHeader: Record<string, unknown> =
    job.kind === 'topic'
      ? { id: job.topicId, moduleId: job.moduleId, title: 'x', kind: 'grammar', context: 'x', keyItems: [] }
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
  const prefix = job.kind === 'topic' ? `modules.${job.moduleId}.topics.${job.topicId}.` : `phraseSets.${job.phraseSetId}.`;

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
    return [{ path: prefix.slice(0, -1), message: `module could not be validated: ${errorMessage(err)}`, severity: 'error' }];
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

function printUsage(label: string, chunkLabel: string, usage?: GeminiUsage): void {
  if (!usage) return;
  console.log(
    `  [${label}${chunkLabel ? ` ${chunkLabel}` : ''}] tokens — prompt: ${usage.promptTokenCount ?? '?'}, ` +
      `candidates: ${usage.candidatesTokenCount ?? '?'}, total: ${usage.totalTokenCount ?? '?'}`
  );
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
  problems: ContentProblem[];
  repairRounds: number;
}

function missingProblem(job: Job, missing: string[]): ContentProblem {
  return {
    path: `${containerId(job)}.exercises`,
    message: `${missing.length} exercise(s) missing: ${missing[0]}..${missing[missing.length - 1]} (a chunk was lost)`,
    severity: 'error',
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
      reply = await callForJson(cli, apiKey, systemPrompt, userPrompt, `${id} chunk ${i + 1}/${chunkCount}`);
    } catch (err) {
      fatal = { path: id, message: `generation stopped: ${errorMessage(err)}`, severity: 'error' };
      break;
    }
    if (reply) {
      const chunkExercises = exercisesOf(reply).slice(0, endNum - startNum + 1);
      merged = normalizeMerged(
        job,
        i === 0 ? { ...reply, exercises: chunkExercises } : { ...merged, exercises: [...soFar, ...chunkExercises] }
      );
    }
    // A lost chunk is not fatal: its exercises show up as missing and the repair round writes them.
    if (i < chunkCount - 1) await sleep(cli.sleepMs);
  }

  if (cli.dryRun) return { merged: {}, problems: [], repairRounds: 0 };

  const check = (): ContentProblem[] => {
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
      reply = await callForJson(cli, apiKey, systemPrompt, repairPrompt, `${id} repair ${round}/${MAX_REPAIR_ROUNDS}`);
    } catch (err) {
      return {
        merged,
        problems: [...problems, { path: id, message: `repair stopped: ${errorMessage(err)}`, severity: 'error' }],
        repairRounds: round,
      };
    }
    if (reply) merged = spliceRepair(job, merged, reply, request);
    problems = check();
  }

  return { merged, problems, repairRounds: round };
}

/** Writes `_draft-<id>.json` (whatever was generated) and prints why. */
function writeDraft(job: Job, merged: Record<string, unknown>, problems: ContentProblem[], why: string): void {
  const dPath = draftPath(job);
  mkdirSync(path.dirname(dPath), { recursive: true });
  writeFileSync(dPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  console.error(`\n${containerId(job)}: ${why} — wrote ${path.relative(REPO_ROOT, dPath)}`);
  for (const p of problems) console.error(`  - ${p.exerciseId ?? p.path}: ${p.message}`);
}

/** Runs one job (topic or phrase set) against real content files: generate, validate, write. */
export async function runJob(job: Job, cli: Cli, apiKey: string, programMetaFor: (id: string) => Record<string, unknown>): Promise<boolean> {
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
    // Not expected (API failures are returned as problems), but never lose the run silently.
    writeDraft(job, normalizeMerged(job, {}), [{ path: containerId(job), message: errorMessage(err) }], 'generation crashed');
    return false;
  }
  if (cli.dryRun) return true;
  const { merged, problems, repairRounds } = result;

  if (hasBlockingProblems(problems)) {
    writeDraft(job, merged, problems, `still failing after ${repairRounds} repair round(s)`);
    return false;
  }

  const outPath = outputPath(job);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, await formatJson(merged), 'utf8');
  console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
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

// ---------- CLI entry point ----------

async function main(): Promise<void> {
  // .env must be loaded before parsing: parseArgs falls back to process.env.GEMINI_MODEL.
  loadEnvFile();
  const cli = parseArgs(process.argv.slice(2));

  if (!cli.module && !cli.topic && !cli.phrases) {
    console.error(
      'Usage: node scripts/content-generate.ts --program <id> (--module <id> | --topic <id> | --phrases <id>) ' +
        '[--force] [--dry-run] [--model <name>] [--count <n>] [--sleep <ms>]'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Model: ${cli.model}`);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!cli.dryRun && !apiKey) {
    console.error(
      'GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in, or pass --dry-run to preview ' +
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
    console.log('Nothing to generate — every requested topic/phrase set already has a file (use --force to redo).');
    return;
  }

  let ok = true;
  for (const job of jobs) {
    const jobOk = await runJob(job, cli, apiKey ?? '', readProgramMeta);
    ok = ok && jobOk;
  }
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
