// AI check of typed answers (docs/stage-7-spec.md). Pure request builder, response
// parser and error classifier, plus a small fetch wrapper whose `fetch` is injected.
// No React, no Dexie. The API key only ever goes into the Authorization header: it is
// never logged, put in a URL or included in an error message.
import type { Exercise, ExerciseType, InputMode } from '../content/types';

export type AiVerdict = 'correct' | 'almost' | 'incorrect';

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const AI_MAX_COMPLETION_TOKENS = 400;
export const AI_REASONING_EFFORT = 'low';
export const AI_TIMEOUT_MS = 15_000;
export const AI_RETRY_DELAY_MS = 2_000;

/** Open exercise types: the only ones the AI ever grades (§2.3). */
export const AI_EXERCISE_TYPES: readonly ExerciseType[] = [
  'build_phrase',
  'question_for_answer',
  'about_me',
];

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Gating (§2)
// ---------------------------------------------------------------------------

export interface AiGateInput {
  aiCheckEnabled: boolean;
  openaiApiKey: string;
  mode: InputMode;
  exerciseType: ExerciseType;
  /** The local check's verdict; ignored for about_me, which has no local check. */
  locallyCorrect: boolean;
}

/** The AI switch is on and a key is set (§2.1). Nothing AI-related happens otherwise. */
export function aiConfigured(settings: { aiCheckEnabled: boolean; openaiApiKey: string }): boolean {
  return settings.aiCheckEnabled === true && settings.openaiApiKey.trim() !== '';
}

/** Conditions 1–4 of §2: the AI is supposed to grade this answer. */
export function aiWanted(input: AiGateInput): boolean {
  if (!aiConfigured(input)) return false;
  if (input.mode !== 'typing') return false;
  if (!AI_EXERCISE_TYPES.includes(input.exerciseType)) return false;
  if (input.exerciseType === 'about_me') return true;
  return !input.locallyCorrect;
}

/**
 * `local`: today's behaviour. `ai`: call OpenAI. `fallback`: the AI was supposed to run
 * but can't (offline or suspended), so the learner grades themself.
 */
export type AiRoute = 'local' | 'ai' | 'fallback';

export function aiRoute(input: AiGateInput & { online: boolean; suspended: boolean }): AiRoute {
  if (!aiWanted(input)) return 'local';
  return input.online && !input.suspended ? 'ai' : 'fallback';
}

// ---------------------------------------------------------------------------
// Prompt and request (§3)
// ---------------------------------------------------------------------------

/** "pt-PT" → "European Portuguese"; falls back to the tag. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function isEuropeanPortuguese(tag: string): boolean {
  return tag.toLowerCase() === 'pt-pt';
}

export function buildSystemPrompt(targetLanguage: string): string {
  const variety = isEuropeanPortuguese(targetLanguage)
    ? ' Accept European Portuguese only — Brazilian forms, spellings and vocabulary are wrong.'
    : '';
  return [
    `You are a fair language teacher grading ONE learner answer for a course in ${languageName(targetLanguage)} (${targetLanguage}).${variety}`,
    'You get the exercise (its prompt, type, model answer and accepted answers, or for an "about me" question the question, a sample answer and hints), the topic, and the learner\'s answer.',
    'Return only a JSON object: {"verdict":"correct"|"almost"|"incorrect","correction":"<best corrected version of the learner\'s sentence>","explanation":"<one short sentence in English>"}.',
    'Grading rules:',
    '- correct: grammatical, natural, and expresses what the prompt asks; uses the target word/phrase/structure of the exercise when there is one (e.g. the phrasal verb, the verb form being drilled). Details not fixed by the prompt (names, who, when) may differ from the model answer. Ignore capitalisation, punctuation and missing accents.',
    '- almost: the target is used correctly and the meaning fits, but there is one small slip (a minor spelling mistake, a missing article, a small agreement error).',
    '- incorrect: the target word/phrase/structure is missing or used wrongly, a clear grammar error, wrong meaning, wrong register when the prompt fixes it, or a different language/variety.',
    "The correction keeps the learner's own sentence wherever it is right; when the answer is correct, the correction is the learner's sentence itself.",
  ].join('\n');
}

export interface AiCheckContext {
  targetLanguage: string;
  topicTitle: string;
  exercise: Exercise;
  learnerAnswer: string;
}

/** The exercise part of the user message: what the learner had to do and the model answer. */
function exercisePayload(exercise: Exercise): Record<string, unknown> {
  const base = { type: exercise.type, prompt: exercise.prompt };
  switch (exercise.type) {
    case 'build_phrase':
      return {
        ...base,
        modelAnswer: exercise.answer.join(' '),
        acceptedAnswers: exercise.acceptedAnswers ?? [],
      };
    case 'question_for_answer':
      return {
        ...base,
        givenAnswer: exercise.givenAnswer,
        modelAnswer: exercise.answer.join(' '),
        acceptedAnswers: exercise.acceptedAnswers ?? [],
      };
    case 'about_me':
      return {
        ...base,
        question: exercise.question,
        sampleAnswer: exercise.sampleAnswer,
        hints: exercise.hints,
      };
    default:
      return base;
  }
}

export function buildUserMessage(ctx: AiCheckContext): string {
  return JSON.stringify({
    exercise: exercisePayload(ctx.exercise),
    topic: { title: ctx.topicTitle, tags: ctx.exercise.tags ?? [] },
    learnerAnswer: ctx.learnerAnswer,
  });
}

export function buildRequestBody(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxCompletionTokens = AI_MAX_COMPLETION_TOKENS
): Record<string, unknown> {
  // No temperature: reasoning models reject anything but the default.
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: maxCompletionTokens,
    reasoning_effort: AI_REASONING_EFFORT,
  };
}

export function buildRequestInit(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  };
}

// ---------------------------------------------------------------------------
// Response parsing (§3)
// ---------------------------------------------------------------------------

export interface AiVerdictResult {
  verdict: AiVerdict;
  correction: string;
  explanation: string;
  /** usage.total_tokens of the call, 0 when missing. */
  totalTokens: number;
}

const VERDICTS: readonly AiVerdict[] = ['correct', 'almost', 'incorrect'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The model's JSON reply, tolerating markdown fences; `null` when it isn't an object. */
export function parseVerdictContent(text: string): Omit<AiVerdictResult, 'totalTokens'> | null {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : '';
  if (!VERDICTS.includes(verdict as AiVerdict)) return null;
  return {
    verdict: verdict as AiVerdict,
    correction: typeof parsed.correction === 'string' ? parsed.correction.trim() : '',
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
  };
}

/** A chat-completions response body → verdict, or `null` (treated as unavailable). */
export function parseCompletion(json: unknown): AiVerdictResult | null {
  if (!isObject(json) || !Array.isArray(json.choices)) return null;
  const choice: unknown = json.choices[0];
  if (!isObject(choice) || !isObject(choice.message)) return null;
  const content = choice.message.content;
  if (typeof content !== 'string') return null;
  const parsed = parseVerdictContent(content);
  if (!parsed) return null;
  const usage = isObject(json.usage) ? json.usage : {};
  const totalTokens =
    typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : 0;
  return { ...parsed, totalTokens };
}

// ---------------------------------------------------------------------------
// Errors (§4)
// ---------------------------------------------------------------------------

export type AiErrorKind = 'invalidKey' | 'noCredit' | 'retryable' | 'other';

const BILLING_CODES = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'access_terminated',
]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function errorFields(bodyText: string): { code?: string; type?: string; message?: string } {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (!isObject(body) || !isObject(body.error)) return {};
    const { code, type, message } = body.error;
    return {
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof type === 'string' ? { type } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    };
  } catch {
    return {};
  }
}

export function classifyHttpError(status: number, bodyText: string): AiErrorKind {
  const { code, type } = errorFields(bodyText);
  if (status === 401 || code === 'invalid_api_key') return 'invalidKey';
  if (BILLING_CODES.has(code ?? '') || BILLING_CODES.has(type ?? '')) return 'noCredit';
  if (RETRYABLE_STATUSES.has(status)) return 'retryable';
  return 'other';
}

/** OpenAI's own error message from a response body, for the Settings "Test connection". */
export function apiErrorMessage(bodyText: string): string | undefined {
  return errorFields(bodyText).message;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

export type AiUnavailableReason =
  'invalidKey' | 'noCredit' | 'error' | 'timeout' | 'network' | 'badResponse' | 'aborted';

export type AiCheckOutcome =
  | { kind: 'verdict'; result: AiVerdictResult }
  | { kind: 'unavailable'; reason: AiUnavailableReason };

export interface AiCallDeps {
  fetchFn?: FetchFn;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Aborts the whole check (the "Skip — grade myself" link, leaving the session). */
  signal?: AbortSignal;
}

type CallResult =
  | { ok: true; json: unknown }
  | {
      ok: false;
      kind: AiErrorKind | 'timeout' | 'network' | 'aborted' | 'badResponse';
      status?: number;
      message?: string;
    };

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

function defaultFetch(input: string, init: RequestInit): Promise<Response> {
  // Read at call time so tests can stub the global.
  return globalThis.fetch(input, init);
}

async function callOnce(
  apiKey: string,
  body: Record<string, unknown>,
  deps: AiCallDeps
): Promise<CallResult> {
  const outer = deps.signal;
  if (outer?.aborted) return { ok: false, kind: 'aborted' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? AI_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  outer?.addEventListener('abort', forwardAbort);

  try {
    const fetchFn = deps.fetchFn ?? defaultFetch;
    const res = await fetchFn(OPENAI_CHAT_URL, buildRequestInit(apiKey, body, controller.signal));
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        kind: classifyHttpError(res.status, text),
        status: res.status,
        message: apiErrorMessage(text),
      };
    }
    try {
      return { ok: true, json: await res.json() };
    } catch {
      return { ok: false, kind: 'badResponse' };
    }
  } catch {
    if (outer?.aborted) return { ok: false, kind: 'aborted' };
    return { ok: false, kind: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forwardAbort);
  }
}

function isTransient(kind: string): boolean {
  return kind === 'retryable' || kind === 'timeout' || kind === 'network';
}

function unavailableReason(result: Extract<CallResult, { ok: false }>): AiUnavailableReason {
  switch (result.kind) {
    case 'invalidKey':
    case 'noCredit':
    case 'timeout':
    case 'network':
    case 'aborted':
    case 'badResponse':
      return result.kind;
    default:
      return 'error';
  }
}

export interface AiCheckRequest {
  apiKey: string;
  model: string;
  context: AiCheckContext;
}

/**
 * Grades one answer. A transient failure (429 rate limit, 5xx, timeout, network) gets
 * exactly one retry after `retryDelayMs`; everything else, and a reply that can't be
 * parsed into a verdict, comes back as `unavailable` — never as a verdict.
 */
export async function runAiCheck(
  request: AiCheckRequest,
  deps: AiCallDeps = {}
): Promise<AiCheckOutcome> {
  const body = buildRequestBody(
    request.model.trim(),
    buildSystemPrompt(request.context.targetLanguage),
    buildUserMessage(request.context)
  );
  let result = await callOnce(request.apiKey, body, deps);
  if (!result.ok && isTransient(result.kind)) {
    await (deps.sleep ?? abortableSleep)(deps.retryDelayMs ?? AI_RETRY_DELAY_MS, deps.signal);
    if (deps.signal?.aborted) return { kind: 'unavailable', reason: 'aborted' };
    result = await callOnce(request.apiKey, body, deps);
  }
  if (!result.ok) return { kind: 'unavailable', reason: unavailableReason(result) };
  const parsed = parseCompletion(result.json);
  return parsed
    ? { kind: 'verdict', result: parsed }
    : { kind: 'unavailable', reason: 'badResponse' };
}

export type ConnectionResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalidKey' | 'noCredit' | 'network' | 'timeout' | 'error';
      /** OpenAI's own message for other errors (e.g. an unknown model). */
      message?: string;
      status?: number;
    };

/** One tiny request for the Settings "Test connection" button. No retry. */
export async function testConnection(
  apiKey: string,
  model: string,
  deps: AiCallDeps = {}
): Promise<ConnectionResult> {
  const body = buildRequestBody(
    model.trim(),
    'Reply with the JSON object {"ok":true}.',
    'Connection test. Reply in JSON.',
    64
  );
  const result = await callOnce(apiKey, body, deps);
  if (result.ok) return { ok: true };
  switch (result.kind) {
    case 'invalidKey':
    case 'noCredit':
    case 'network':
    case 'timeout':
      return { ok: false, reason: result.kind };
    default:
      return {
        ok: false,
        reason: 'error',
        ...(result.message ? { message: result.message } : {}),
        ...(result.status ? { status: result.status } : {}),
      };
  }
}
