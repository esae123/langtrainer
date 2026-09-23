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
 * Default Gemini model — a current Flash-class model (cheap/fast, generous free tier).
 * Model aliases get retired periodically: if generation starts failing with 404, check
 * https://ai.google.dev/gemini-api/docs/models for the current alias and update this constant
 * (or pass --model / set GEMINI_MODEL).
 */
export const DEFAULT_MODEL = 'gemini-2.0-flash';

export const CHUNK_SIZE = 20;
export const MAX_REPAIR_ROUNDS = 2;
const DEFAULT_SLEEP_MS = 2000;
const MAX_RETRIES_429 = 5;

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
    jobs.push(briefToJob(cli.program, moduleId, brief, cli.count));
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

/** User prompt for one chunk of a job (docs/stage-4b-spec.md §3: "topic brief ... required id range"). */
export function buildUserPrompt(job: Job, chunk: { startNum: number; endNum: number; isContinuation: boolean }): string {
  const id = containerId(job);
  const range = `${id}-${String(chunk.startNum).padStart(2, '0')}..${id}-${String(chunk.endNum).padStart(2, '0')}`;
  const thisChunkCount = chunk.endNum - chunk.startNum + 1;

  const lines: string[] = [];
  if (job.kind === 'topic') {
    lines.push(
      'Write one Topic JSON.',
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
      'Write one PhraseSet JSON.',
      `programId: ${job.programId}`,
      `phraseSetId: ${job.phraseSetId}`,
      `title: ${job.title}`,
      `Core content: ${job.brief}`,
      `Total phrases: ${job.phraseCount}`,
      `Total exercise count for the phrase set: ${job.exerciseCount}`
    );
  }

  if (!chunk.isContinuation) {
    lines.push(
      job.kind === 'topic'
        ? 'Return the full Topic JSON (id, moduleId, title, kind, context, keyItems) with exercises'
        : 'Return the full PhraseSet JSON (id, title, phrases) with exercises',
      `${chunk.startNum}-${chunk.endNum} (required id range ${range}, exactly ${thisChunkCount} exercises).`
    );
  } else {
    lines.push(
      `Continue the same ${job.kind === 'topic' ? 'topic' : 'phrase set'}, do not repeat sentences already used`,
      `in the earlier exercises. Return ONLY {"exercises": [...]} with exercises ${chunk.startNum}-${chunk.endNum}`,
      `(required id range ${range}, exactly ${thisChunkCount} exercises).`
    );
  }
  lines.push('Return only the JSON.');
  return lines.join('\n');
}

function buildRepairPrompt(merged: Record<string, unknown>, problems: ContentProblem[]): string {
  return [
    'The following JSON has problems. Fix ALL of them and return the FULL corrected JSON (same shape',
    'as below, nothing else — no prose, no markdown fences).',
    '',
    'JSON:',
    JSON.stringify(merged),
    '',
    'Problems:',
    ...problems.map((p) => `- ${p.path}: ${p.message}`),
  ].join('\n');
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
}

interface GeminiCallOptions {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxRetries?: number;
}

/** Calls the Gemini REST API with `fetch` (no SDK). Retries on 429 with exponential backoff. */
export async function callGemini(opts: GeminiCallOptions): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
    systemInstruction: { role: 'system', parts: [{ text: opts.systemPrompt }] },
    generationConfig: { responseMimeType: 'application/json' },
  });
  const maxRetries = opts.maxRetries ?? MAX_RETRIES_429;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = res.headers.get('retry-after');
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 2 ** attempt * 1000;
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: GeminiUsage;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new Error('Gemini response had no text part');
    return { text, usage: json.usageMetadata };
  }
}

/** Parses the model's JSON reply, defensively stripping markdown fences if the model added any. */
export function parseModelJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed) as Record<string, unknown>;
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

/**
 * Validates the merged JSON as part of a temporary program containing the module's existing
 * topics plus the new/updated one (docs/stage-4b-spec.md §3), and returns only the problems that
 * belong to this job's own container (so pre-existing issues in sibling topics don't block it).
 */
export function validateMerged(job: Job, merged: Record<string, unknown>): ContentProblem[] {
  const meta = readProgramMeta(job.programId);
  let stub: Record<string, unknown>;
  let prefix: string;

  if (job.kind === 'topic') {
    const siblings = loadSiblingTopics(job.programId, job.moduleId, job.topicId);
    stub = {
      ...meta,
      modules: [{ id: job.moduleId, title: job.moduleId, description: '', topics: [...siblings, merged] }],
      phraseSets: [],
    };
    prefix = `modules.${job.moduleId}.topics.${job.topicId}.`;
  } else {
    stub = { ...meta, modules: [], phraseSets: [merged] };
    prefix = `phraseSets.${job.phraseSetId}.`;
  }

  try {
    const program = validateProgram(stub);
    const { problems } = checkContent(program);
    return problems.filter((p) => p.path.startsWith(prefix));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ path: prefix.slice(0, -1), message, severity: 'error' }];
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
    `  [${label} ${chunkLabel}] tokens — prompt: ${usage.promptTokenCount ?? '?'}, ` +
      `candidates: ${usage.candidatesTokenCount ?? '?'}, total: ${usage.totalTokenCount ?? '?'}`
  );
}

function outputPath(job: Job): string {
  return job.kind === 'topic'
    ? path.join(programRoot(job.programId), 'topics', `${job.topicId}.json`)
    : path.join(programRoot(job.programId), 'phrases', `${job.phraseSetId}.json`);
}

function draftPath(job: Job): string {
  const dir = job.kind === 'topic' ? 'topics' : 'phrases';
  return path.join(programRoot(job.programId), dir, `_draft-${containerId(job)}.json`);
}

export interface GenerateResult {
  merged: Record<string, unknown>;
  problems: ContentProblem[];
  repairRounds: number;
}

/**
 * Core generation loop, independent of the filesystem (job/cli/systemPrompt/validate are all
 * plain inputs): chunked generation via `callGemini`/global `fetch`, merge, validate, then up to
 * `MAX_REPAIR_ROUNDS` repair calls while `validate` still reports a blocking problem. Exported
 * for direct unit testing (scripts/__tests__/content-generate.test.ts) with a mocked `fetch` and
 * a stub `validate`, without touching real content files.
 */
export async function generateAndRepair(
  job: Job,
  cli: Cli,
  apiKey: string,
  systemPrompt: string,
  validate: (merged: Record<string, unknown>) => ContentProblem[]
): Promise<GenerateResult> {
  const total = exerciseCount(job);
  const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));
  const chunks: Record<string, unknown>[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const startNum = i * CHUNK_SIZE + 1;
    const endNum = Math.min(total, (i + 1) * CHUNK_SIZE);
    const userPrompt = buildUserPrompt(job, { startNum, endNum, isContinuation: i > 0 });

    if (cli.dryRun) {
      console.log(`\n=== ${containerId(job)} — chunk ${i + 1}/${chunkCount} ===`);
      console.log('--- system prompt ---');
      console.log(systemPrompt);
      console.log('--- user prompt ---');
      console.log(userPrompt);
      continue;
    }

    const result = await callGemini({ model: cli.model, apiKey, systemPrompt, userPrompt });
    printUsage(containerId(job), `chunk ${i + 1}/${chunkCount}`, result.usage);
    chunks.push(parseModelJson(result.text));
    if (i < chunkCount - 1) await sleep(cli.sleepMs);
  }

  if (cli.dryRun) return { merged: {}, problems: [], repairRounds: 0 };

  let merged = mergeExerciseChunks(chunks);
  let problems = validate(merged);

  let round = 0;
  while (hasBlockingProblems(problems) && round < MAX_REPAIR_ROUNDS) {
    round++;
    const repairPrompt = buildRepairPrompt(merged, problems);
    const result = await callGemini({ model: cli.model, apiKey, systemPrompt, userPrompt: repairPrompt });
    printUsage(containerId(job), `repair ${round}/${MAX_REPAIR_ROUNDS}`, result.usage);
    merged = parseModelJson(result.text);
    problems = validate(merged);
    if (hasBlockingProblems(problems) && round < MAX_REPAIR_ROUNDS) await sleep(cli.sleepMs);
  }

  return { merged, problems, repairRounds: round };
}

/** Runs one job (topic or phrase set) against real content files: generate, validate, write. */
export async function runJob(job: Job, cli: Cli, apiKey: string, programMetaFor: (id: string) => Record<string, unknown>): Promise<boolean> {
  const meta = programMetaFor(job.programId);
  const systemPrompt = buildSystemPrompt(
    job.programId,
    typeof meta.title === 'string' ? meta.title : job.programId,
    typeof meta.targetLanguage === 'string' ? meta.targetLanguage : '?'
  );

  const { merged, problems } = await generateAndRepair(job, cli, apiKey, systemPrompt, (m) => validateMerged(job, m));
  if (cli.dryRun) return true;

  if (hasBlockingProblems(problems)) {
    const dPath = draftPath(job);
    mkdirSync(path.dirname(dPath), { recursive: true });
    writeFileSync(dPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    console.error(`\n${containerId(job)}: still failing after ${MAX_REPAIR_ROUNDS} repair rounds — wrote ${dPath}`);
    for (const p of problems) console.error(`  - ${p.path}: ${p.message}`);
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
  const cli = parseArgs(process.argv.slice(2));

  if (!cli.module && !cli.topic && !cli.phrases) {
    console.error(
      'Usage: node scripts/content-generate.ts --program <id> (--module <id> | --topic <id> | --phrases <id>) ' +
        '[--force] [--dry-run] [--model <name>] [--count <n>] [--sleep <ms>]'
    );
    process.exitCode = 1;
    return;
  }

  loadEnvFile();
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
