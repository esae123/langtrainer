import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentProblem } from '../../src/content/contentRules.ts';
import {
  buildJobs,
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  callGemini,
  callOpenAI,
  DEFAULT_MODEL,
  draftPath,
  generateAndRepair,
  hasBlockingProblems,
  MAX_OUTPUT_TOKENS,
  MAX_RETRY_DELAY_MS,
  mergeExerciseChunks,
  MAX_REPAIR_ROUNDS,
  normalizeMerged,
  openAiModelError,
  parseArgs,
  parseModelJson,
  repairRequestFor,
  REPO_ROOT,
  retryDelayMs,
  runJob,
  StopRunError,
  validateMerged,
  type Cli,
  type TopicJob,
} from '../content-generate.ts';

// A topic that has a brief but no file yet, found at run time so these tests do not break as
// content gets written (pt-PT-A1 is complete; en-b2 briefs are used while they still lack files).
function topicWithoutFile(): { program: string; topic: string } | undefined {
  for (const program of ['pt-PT-A1', 'en-b2']) {
    const modulesDir = path.join(REPO_ROOT, 'content', program, 'modules');
    if (!existsSync(modulesDir)) continue;
    for (const file of readdirSync(modulesDir).filter((f) => f.endsWith('.json'))) {
      const mod = JSON.parse(readFileSync(path.join(modulesDir, file), 'utf8')) as {
        topics?: { id: string }[];
      };
      for (const t of mod.topics ?? []) {
        if (!existsSync(path.join(REPO_ROOT, 'content', program, 'topics', `${t.id}.json`)))
          return { program, topic: t.id };
      }
    }
  }
  return undefined;
}
const unwritten = topicWithoutFile();

function fakeCli(overrides: Partial<Cli> = {}): Cli {
  return {
    program: 'pt-PT-A1',
    force: false,
    fresh: false,
    dryRun: false,
    provider: 'gemini',
    model: 'test-model',
    sleepMs: 0,
    ...overrides,
  };
}

function fakeTopicJob(overrides: Partial<TopicJob> = {}): TopicJob {
  return {
    kind: 'topic',
    programId: 'pt-PT-A1',
    moduleId: 'm2',
    topicId: 'm2-classroom-objects',
    title: 'Classroom objects',
    topicKind: 'vocabulary',
    count: 20,
    brief: 'livro, caderno, lápis; classroom requests',
    known: 'Module 1 grammar',
    avoid: 'past tenses',
    ...overrides,
  };
}

/** A minimal well-formed fetch Response for a successful Gemini generateContent call. */
function geminiOk(payload: unknown, usage?: Record<string, number>): Response {
  return geminiRaw(JSON.stringify(payload), 'STOP', usage);
}

/** A 200 response with arbitrary text (possibly invalid JSON) and finishReason. */
function geminiRaw(text: string, finishReason = 'STOP', usage?: Record<string, number>): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as unknown as Headers,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] }, finishReason }],
      usageMetadata: usage,
    }),
    text: async () => '',
  } as unknown as Response;
}

/** Fake exercises `<id>-NN` for NN in [from, to], each with a distinct sentence. */
function fakeExercises(id: string, from: number, to: number, extra: Record<string, unknown> = {}) {
  const out: Record<string, unknown>[] = [];
  for (let n = from; n <= to; n++) {
    const nn = String(n).padStart(2, '0');
    out.push({
      id: `${id}-${nn}`,
      type: 'translate_word',
      topicId: id,
      sentence: `Sentence ${nn}.`,
      ...extra,
    });
  }
  return out;
}

/**
 * Fully schema-valid `translate_word` exercises (unlike `fakeExercises`, which is only good
 * enough for tests that stub out `validate`) — for tests that exercise the real
 * `runJob`/`validateMerged` path end to end and need it to succeed.
 */
function validExercises(id: string, from: number, to: number, difficulty = 1) {
  const out: Record<string, unknown>[] = [];
  for (let n = from; n <= to; n++) {
    const nn = String(n).padStart(2, '0');
    out.push({
      id: `${id}-${nn}`,
      type: 'translate_word',
      topicId: id,
      difficulty,
      allowedModes: ['tiles'],
      prompt: `Translate word ${nn}.`,
      explanation: `Explanation ${nn}.`,
      direction: 'toTarget',
      sentence: `Sentence with **word${nn}** in it.`,
      word: `word${nn}`,
      answer: `resposta${nn}`,
      options: [`resposta${nn}`, `a${nn}`, `b${nn}`, `c${nn}`],
    });
  }
  return out;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string) as Record<string, unknown>;
}

function userPromptOf(fetchMock: ReturnType<typeof vi.fn>, call: number): string {
  const body = requestBody(fetchMock, call) as { contents: { parts: { text: string }[] }[] };
  return body.contents[0].parts[0].text;
}

function gemini429(retryAfterSeconds = '0'): Response {
  return {
    ok: false,
    status: 429,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'retry-after' ? retryAfterSeconds : null),
    } as unknown as Headers,
    json: async () => ({}),
    text: async () => 'rate limited',
  } as unknown as Response;
}

/** A 429 with a Gemini QuotaFailure body whose violation quotaId contains "PerDay". */
function geminiDailyQuota429(retryDelay = '7200s'): Response {
  const body = JSON.stringify({
    error: {
      message: 'quota exceeded',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateContentPerDayPerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
      ],
    },
  });
  return {
    ok: false,
    status: 429,
    headers: { get: () => null } as unknown as Headers,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

/** A minimal well-formed fetch Response for a successful OpenAI chat completions call. */
function openAiOk(
  content: unknown,
  finishReason = 'stop',
  usage?: Record<string, number>
): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as unknown as Headers,
    json: async () => ({
      choices: [{ message: { content: text }, finish_reason: finishReason }],
      usage,
    }),
    text: async () => '',
  } as unknown as Response;
}

function openAiError(status: number, bodyText = 'server error'): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null } as unknown as Headers,
    json: async () => ({}),
    text: async () => bodyText,
  } as unknown as Response;
}

function openAiInsufficientQuota(): Response {
  return openAiError(
    429,
    JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your quota' } })
  );
}

function openAiRequestBody(
  fetchMock: ReturnType<typeof vi.fn>,
  call: number
): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string) as Record<string, unknown>;
}

function geminiError(status: number): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null } as unknown as Headers,
    json: async () => ({}),
    text: async () => 'server error',
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildSystemPrompt', () => {
  it('includes the program RULES.md, pedagogy, schema and self-check sections', () => {
    const prompt = buildSystemPrompt('pt-PT-A1', 'Português europeu A1', 'pt-PT');
    expect(prompt).toContain('LANGUAGE RULES');
    expect(prompt).toContain('estar a + infinitivo'); // from content/pt-PT-A1/RULES.md
    expect(prompt).toContain('PEDAGOGY');
    expect(prompt).toContain('SCHEMA (TypeScript)');
    expect(prompt).toContain('SELF-CHECK BEFORE ANSWERING');
  });

  it('uses a different program title/target language per program (en-b2)', () => {
    const prompt = buildSystemPrompt('en-b2', 'English B2 — vocabulary and natural speech', 'en');
    expect(prompt).toContain('English B2 — vocabulary and natural speech');
    expect(prompt).toContain('target language: en');
    expect(prompt).toContain('gap-like paraphrase'); // from content/en-b2/RULES.md
  });
});

describe('buildUserPrompt', () => {
  it('contains the topic brief and the required id range for the first chunk', () => {
    const job = fakeTopicJob();
    const prompt = buildUserPrompt(job, { startNum: 1, endNum: 20, isContinuation: false });
    expect(prompt).toContain(job.brief);
    expect(prompt).toContain(job.known!);
    expect(prompt).toContain(job.avoid!);
    expect(prompt).toContain('m2-classroom-objects-01..m2-classroom-objects-20');
  });

  it("asks for a continuation with the second chunk's id range, without repeating sentences", () => {
    const job = fakeTopicJob({ count: 40 });
    const prompt = buildUserPrompt(job, { startNum: 21, endNum: 40, isContinuation: true });
    expect(prompt).toContain('m2-classroom-objects-21..m2-classroom-objects-40');
    expect(prompt.toLowerCase()).toContain('do not repeat sentences');
  });
});

describe('mergeExerciseChunks', () => {
  it('concatenates exercises across chunks, keeping the first chunk as the base object', () => {
    const merged = mergeExerciseChunks([
      {
        id: 'm2-a',
        title: 'A',
        context: 'c',
        keyItems: [],
        exercises: [{ id: 'm2-a-01' }, { id: 'm2-a-02' }],
      },
      { exercises: [{ id: 'm2-a-03' }] },
    ]);
    expect(merged.id).toBe('m2-a');
    expect(merged.context).toBe('c');
    expect((merged.exercises as { id: string }[]).map((e) => e.id)).toEqual([
      'm2-a-01',
      'm2-a-02',
      'm2-a-03',
    ]);
  });

  it('throws when given no chunks', () => {
    expect(() => mergeExerciseChunks([])).toThrow();
  });
});

describe('parseModelJson', () => {
  it('parses plain JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a markdown fence if the model added one despite being asked not to', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });
});

describe('hasBlockingProblems', () => {
  it('is false for no problems or warning-only problems', () => {
    expect(hasBlockingProblems([])).toBe(false);
    expect(hasBlockingProblems([{ path: 'p', message: 'm', severity: 'warning' }])).toBe(false);
  });

  it('is true when any problem has no severity (defaults to error) or severity "error"', () => {
    expect(hasBlockingProblems([{ path: 'p', message: 'm' }])).toBe(true);
    expect(hasBlockingProblems([{ path: 'p', message: 'm', severity: 'error' }])).toBe(true);
  });
});

describe('callGemini', () => {
  it('returns the text and usage from a successful response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ exercises: [] }, { totalTokenCount: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGemini({
      model: 'm',
      apiKey: 'k',
      systemPrompt: 'sys',
      userPrompt: 'usr',
    });
    expect(JSON.parse(result.text)).toEqual({ exercises: [] });
    expect(result.usage).toEqual({ totalTokenCount: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 with backoff (per Retry-After) and eventually succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gemini429('0'))
      .mockResolvedValueOnce(gemini429('0'))
      .mockResolvedValueOnce(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGemini({
      model: 'm',
      apiKey: 'k',
      systemPrompt: 'sys',
      userPrompt: 'usr',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(result.text)).toEqual({ exercises: [] });
  });

  it('gives up after maxAttempts tries and throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gemini429('0'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callGemini({
        model: 'm',
        apiKey: 'k',
        systemPrompt: 'sys',
        userPrompt: 'usr',
        maxAttempts: 2,
      })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 500 and 503 too, waiting per the body retryDelay', async () => {
    const waits: number[] = [];
    const retryBody = JSON.stringify({
      error: { details: [{ '@type': 'RetryInfo', retryDelay: '3s' }] },
    });
    const withBody = (status: number) =>
      ({ ...geminiError(status), text: async () => retryBody }) as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(withBody(500))
      .mockResolvedValueOnce(withBody(503))
      .mockResolvedValueOnce(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callGemini({
      model: 'm',
      apiKey: 'k',
      systemPrompt: 'sys',
      userPrompt: 'usr',
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([3000, 3000]);
  });

  it('throws immediately on a non-retryable error response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiError(400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr' })
    ).rejects.toThrow(/Gemini API error 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the key in x-goog-api-key (not the URL), maxOutputTokens, and no systemInstruction role', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callGemini({
      model: 'gemini-x',
      apiKey: 'SECRET',
      systemPrompt: 'sys',
      userPrompt: 'usr',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('SECRET');
    expect(url).toContain('models/gemini-x:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET');
    const body = requestBody(fetchMock, 0) as {
      systemInstruction: Record<string, unknown>;
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.systemInstruction).not.toHaveProperty('role');
  });

  it('sends thinkingConfig.thinkingLevel only when a thinking level is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callGemini({ model: 'gemini-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' });
    await callGemini({
      model: 'gemini-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      thinkingLevel: 'high',
    });
    const plain = requestBody(fetchMock, 0) as { generationConfig: Record<string, unknown> };
    const thinking = requestBody(fetchMock, 1) as { generationConfig: Record<string, unknown> };
    expect(plain.generationConfig).not.toHaveProperty('thinkingConfig');
    expect(thinking.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high' });
  });

  it('joins all text parts and skips thought parts', async () => {
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [{ text: 'thinking…', thought: true }, { text: '{"a":' }, { text: '1}' }],
            },
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    const result = await callGemini({
      model: 'm',
      apiKey: 'k',
      systemPrompt: 'sys',
      userPrompt: 'usr',
    });
    expect(result.text).toBe('{"a":1}');
    expect(result.finishReason).toBe('STOP');
  });
});

describe('retryDelayMs', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');

  it('reads Retry-After as seconds or as an HTTP date', () => {
    expect(retryDelayMs('7', '', 0, now)).toBe(7000);
    expect(retryDelayMs('Fri, 25 Sep 2026 12:00:10 GMT', '', 0, now)).toBe(10_000);
  });

  it('falls back to error.details[].retryDelay, then to exponential backoff', () => {
    const body = JSON.stringify({ error: { details: [{ foo: 1 }, { retryDelay: '12s' }] } });
    expect(retryDelayMs(null, body, 0, now)).toBe(12_000);
    expect(retryDelayMs(null, 'not json', 2, now)).toBe(40_000);
  });

  it('never returns NaN or more than the cap', () => {
    expect(retryDelayMs('soon-ish', '', 1, now)).toBe(20_000);
    expect(retryDelayMs('3600', '', 0, now)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(null, '', 20, now)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs('Fri, 25 Sep 2026 11:00:00 GMT', '', 0, now)).toBe(0);
  });
});

describe('generateAndRepair — repair loop', () => {
  it('does not call the repair prompt when the first validation has no blocking problems', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      geminiOk({
        id: 'm2-classroom-objects',
        exercises: fakeExercises('m2-classroom-objects', 1, 20),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const validate = vi.fn().mockReturnValue([]);

    const job = fakeTopicJob({ count: 20 });
    const result = await generateAndRepair(job, fakeCli(), 'key', 'sys', validate);

    expect(fetchMock).toHaveBeenCalledTimes(1); // one chunk, no repair
    expect(result.repairRounds).toBe(0);
    expect(result.problems).toEqual([]);
  });

  it('sends a repair call including the problems, and re-validates the corrected JSON', async () => {
    const id = 'm2-classroom-objects';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiOk({ id, exercises: fakeExercises(id, 1, 20, { bad: true }) }))
      .mockResolvedValueOnce(geminiOk({ exercises: [{ id: `${id}-01`, bad: false }] }));
    vi.stubGlobal('fetch', fetchMock);

    const problem: ContentProblem = {
      path: 'x',
      message: 'bad exercise',
      severity: 'error',
      exerciseId: `${id}-01`,
    };
    const validate = vi.fn().mockReturnValueOnce([problem]).mockReturnValueOnce([]);

    const job = fakeTopicJob({ count: 20 });
    const result = await generateAndRepair(job, fakeCli(), 'key', 'sys', validate);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairPrompt = fetchMock.mock.calls[1][1].body as string;
    expect(repairPrompt).toContain('bad exercise');
    expect(result.repairRounds).toBe(1);
    expect(result.problems).toEqual([]);
  });

  it('stops after MAX_REPAIR_ROUNDS rounds even if problems remain', async () => {
    const alwaysBadPayload = {
      id: 'm2-classroom-objects',
      exercises: fakeExercises('m2-classroom-objects', 1, 20),
    };
    const fetchMock = vi.fn().mockResolvedValue(geminiOk(alwaysBadPayload));
    vi.stubGlobal('fetch', fetchMock);

    const problem: ContentProblem = { path: 'x', message: 'still bad', severity: 'error' };
    const validate = vi.fn().mockReturnValue([problem]);

    const job = fakeTopicJob({ count: 20 });
    const result = await generateAndRepair(job, fakeCli(), 'key', 'sys', validate);

    // 1 initial chunk call + MAX_REPAIR_ROUNDS repair calls.
    expect(fetchMock).toHaveBeenCalledTimes(1 + MAX_REPAIR_ROUNDS);
    expect(result.repairRounds).toBe(MAX_REPAIR_ROUNDS);
    expect(hasBlockingProblems(result.problems)).toBe(true);
  });
});

describe('buildJobs — never overwrites without --force (review B2)', () => {
  it('skips --topic when the topic file already exists', () => {
    expect(existsSync(path.join(REPO_ROOT, 'content/pt-PT-A1/topics/m2-family-pets.json'))).toBe(
      true
    );
    expect(buildJobs(fakeCli({ topic: 'm2-family-pets' }))).toEqual([]);
  });

  it('regenerates an existing --topic with --force', () => {
    const jobs = buildJobs(fakeCli({ topic: 'm2-family-pets', force: true }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'topic', topicId: 'm2-family-pets', moduleId: 'm2' });
  });

  it('still builds a --topic job when there is no file yet', () => {
    if (!unwritten) return; // every briefed topic already has a file
    expect(buildJobs(fakeCli({ program: unwritten.program, topic: unwritten.topic }))).toHaveLength(
      1
    );
  });
});

describe('ids forced to the job (review B3)', () => {
  it('normalises topic id, moduleId, topicIds and renumbers exercise ids', () => {
    const job = fakeTopicJob({ count: 3 });
    const normalized = normalizeMerged(job, {
      id: 'm2-classroom',
      moduleId: 'm9',
      title: 'T',
      exercises: [
        { id: 'x-7', type: 'translate_word', topicId: 'm2-classroom' },
        { id: 'x-7', type: 'translate_word', topicId: 'other' },
        { type: 'translate_word' },
        { id: 'extra', type: 'translate_word' },
      ],
    });
    expect(normalized).toMatchObject({ id: 'm2-classroom-objects', moduleId: 'm2' });
    const exercises = normalized.exercises as { id: string; topicId: string }[];
    expect(exercises.map((e) => e.id)).toEqual([
      'm2-classroom-objects-01',
      'm2-classroom-objects-02',
      'm2-classroom-objects-03',
    ]);
    expect(exercises.every((e) => e.topicId === 'm2-classroom-objects')).toBe(true);
  });

  it('validation still sees problems when the model changed the topic id', () => {
    const job = fakeTopicJob({ topicId: 'm2-family-pets', moduleId: 'm2', count: 40 });
    const topic = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'content/pt-PT-A1/topics/m2-family-pets.json'), 'utf8')
    ) as Record<string, unknown>;
    const exercises = topic.exercises as Record<string, unknown>[];
    exercises[4] = { ...exercises[4], prompt: '' }; // a content-rule error
    const renamed = { ...topic, id: 'm2-family' };

    expect(validateMerged(job, renamed)).toEqual([]); // the old failure mode: problems filtered away
    const problems = validateMerged(job, normalizeMerged(job, renamed));
    expect(problems.some((p) => p.exerciseId === 'm2-family-pets-05')).toBe(true);
  });

  it('generateAndRepair validates the normalised JSON', async () => {
    const job = fakeTopicJob({ count: 20 });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          geminiOk({ id: 'renamed', moduleId: 'm7', exercises: fakeExercises('renamed', 5, 24) })
        )
    );
    const validate = vi.fn().mockReturnValue([]);

    const result = await generateAndRepair(job, fakeCli(), 'key', 'sys', validate);
    const seen = validate.mock.calls[0][0] as {
      id: string;
      moduleId: string;
      exercises: { id: string }[];
    };
    expect(seen.id).toBe('m2-classroom-objects');
    expect(seen.moduleId).toBe('m2');
    expect(seen.exercises[0].id).toBe('m2-classroom-objects-01');
    expect(seen.exercises[19].id).toBe('m2-classroom-objects-20');
    expect(result.merged.id).toBe('m2-classroom-objects');
  });
});

describe('continuation chunks (review S5)', () => {
  it('passes the earlier sentences and the topic context/keyItems to chunk 2', async () => {
    const id = 'm2-classroom-objects';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        geminiOk({
          id,
          context: 'Classroom objects context.',
          keyItems: [{ target: 'o livro', support: 'the book' }],
          exercises: fakeExercises(id, 1, 20),
        })
      )
      .mockResolvedValueOnce(geminiOk({ exercises: fakeExercises(id, 21, 40) }));
    vi.stubGlobal('fetch', fetchMock);

    await generateAndRepair(fakeTopicJob({ count: 40 }), fakeCli(), 'key', 'sys', () => []);
    const second = userPromptOf(fetchMock, 1);
    expect(second).toContain('Sentence 01.');
    expect(second).toContain('Sentence 20.');
    expect(second).toContain('Classroom objects context.');
    expect(second).toContain('o livro');
    expect(second).toContain(`${id}-21..${id}-40`);
  });
});

describe('truncated / invalid replies and targeted repair (review B4)', () => {
  const id = 'm2-classroom-objects';

  it('retries a chunk once when it was cut off at MAX_TOKENS', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        geminiRaw('{"id": "m2-classroom-objects", "exercises": [{"id"', 'MAX_TOKENS')
      )
      .mockResolvedValueOnce(geminiOk({ id, exercises: fakeExercises(id, 1, 20) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAndRepair(
      fakeTopicJob({ count: 20 }),
      fakeCli(),
      'key',
      'sys',
      () => []
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.problems).toEqual([]);
    expect(result.merged.exercises).toHaveLength(20);
  });

  it('keeps chunk 1 when chunk 2 is invalid twice, then repair writes only the missing exercises', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        geminiOk({ id, context: 'c', keyItems: [], exercises: fakeExercises(id, 1, 20) })
      )
      .mockResolvedValueOnce(geminiRaw('not json at all'))
      .mockResolvedValueOnce(geminiRaw('{"exercises": [', 'MAX_TOKENS'))
      .mockResolvedValueOnce(geminiOk({ exercises: fakeExercises(id, 21, 40) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAndRepair(
      fakeTopicJob({ count: 40 }),
      fakeCli(),
      'key',
      'sys',
      () => []
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const repairPrompt = userPromptOf(fetchMock, 3);
    expect(repairPrompt).toContain(`${id}-21, ${id}-22`);
    expect(repairPrompt).toContain(`${id}-40`);
    expect(repairPrompt).not.toContain('"id":"m2-classroom-objects-01"'); // good exercises are not resent
    expect(result.repairRounds).toBe(1);
    expect(result.problems).toEqual([]);
    const ids = (result.merged.exercises as { id: string }[]).map((e) => e.id);
    expect(ids).toHaveLength(40);
    expect(ids[39]).toBe(`${id}-40`);
  });

  it('repair sends only the affected exercises and splices the fix back by id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiOk({ id, exercises: fakeExercises(id, 1, 20) }))
      .mockResolvedValueOnce(
        geminiOk({
          exercises: [{ id: `${id}-05`, type: 'translate_word', sentence: 'Fixed five.' }],
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const problem: ContentProblem = {
      path: 'p',
      message: 'wrong options',
      severity: 'error',
      exerciseId: `${id}-05`,
    };
    const validate = vi.fn().mockReturnValueOnce([problem]).mockReturnValue([]);

    const result = await generateAndRepair(
      fakeTopicJob({ count: 20 }),
      fakeCli(),
      'key',
      'sys',
      validate
    );
    const repairPrompt = userPromptOf(fetchMock, 1);
    expect(repairPrompt).toContain(`"id":"${id}-05"`);
    expect(repairPrompt).not.toContain(`"id":"${id}-06"`);
    expect(repairPrompt).toContain('wrong options');
    const exercises = result.merged.exercises as { id: string; sentence: string }[];
    expect(exercises).toHaveLength(20);
    expect(exercises[4]).toMatchObject({ id: `${id}-05`, sentence: 'Fixed five.' });
    expect(exercises[5].sentence).toBe('Sentence 06.');
  });

  it('buildRepairPrompt asks for the header only when a topic-level field is broken', () => {
    const job = fakeTopicJob({ count: 20 });
    const merged = normalizeMerged(job, {
      context: '',
      keyItems: [],
      exercises: fakeExercises(id, 1, 20),
    });
    const prompt = buildRepairPrompt(
      job,
      merged,
      [{ path: 'x.context', message: 'empty context' }],
      {
        fixIds: [],
        missingIds: [],
        fixHeader: true,
      }
    );
    expect(prompt).toContain('"header"');
    expect(prompt).not.toContain(`"id":"${id}-01"`);
  });

  it('never throws on an API failure and returns what was merged', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiOk({ id, exercises: fakeExercises(id, 1, 20) }))
      .mockResolvedValueOnce(geminiError(400));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAndRepair(
      fakeTopicJob({ count: 40 }),
      fakeCli(),
      'key',
      'sys',
      () => []
    );
    expect(result.merged.exercises).toHaveLength(20);
    expect(hasBlockingProblems(result.problems)).toBe(true);
    expect(result.problems.some((p) => /Gemini API error 400/.test(p.message))).toBe(true);
  });

  it('runJob writes _draft-<id>.json with the merged chunks when generation fails', async () => {
    const job = fakeTopicJob({ topicId: 'm2-zz-generator-test', count: 40 });
    const draft = draftPath(job);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          geminiOk({ id: 'm2-zz-generator-test', exercises: fakeExercises('x', 1, 20) })
        )
        .mockResolvedValueOnce(geminiError(400))
    );
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(false);
      const written = JSON.parse(readFileSync(draft, 'utf8')) as {
        id: string;
        exercises: unknown[];
      };
      expect(written.id).toBe('m2-zz-generator-test');
      expect(written.exercises).toHaveLength(20);
    } finally {
      rmSync(draft, { force: true });
    }
  });
});

describe('callOpenAI', () => {
  it('sends the right URL, bearer header, response_format and max_completion_tokens, no temperature', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({ model: 'gpt-x', apiKey: 'SECRET', systemPrompt: 'sys', userPrompt: 'usr' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(url).not.toContain('SECRET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer SECRET');
    const body = openAiRequestBody(fetchMock, 0) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: Record<string, unknown>;
      max_completion_tokens: number;
      temperature?: unknown;
      reasoning_effort?: unknown;
    };
    expect(body.model).toBe('gpt-x');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_completion_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('sends reasoning_effort only when set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({ model: 'gpt-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' });
    await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      reasoningEffort: 'medium',
    });

    const plain = openAiRequestBody(fetchMock, 0);
    const withEffort = openAiRequestBody(fetchMock, 1) as { reasoning_effort: string };
    expect(plain).not.toHaveProperty('reasoning_effort');
    expect(withEffort.reasoning_effort).toBe('medium');
  });

  it('respects an explicit maxCompletionTokens override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      maxCompletionTokens: 4096,
    });
    const body = openAiRequestBody(fetchMock, 0) as { max_completion_tokens: number };
    expect(body.max_completion_tokens).toBe(4096);
  });

  it('parses choices[0].message.content and usage/finish_reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      openAiOk({ exercises: [{ id: 'x-01' }] }, 'stop', {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
    });
    expect(JSON.parse(result.text)).toEqual({ exercises: [{ id: 'x-01' }] });
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  });

  it('reports finish_reason "length" (like Gemini MAX_TOKENS) without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiOk('{"exercises":[', 'length'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
    });
    expect(result.finishReason).toBe('length');
  });

  it('throws on a refusal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null } as unknown as Headers,
      json: async () => ({
        choices: [{ message: { refusal: 'cannot help with that' }, finish_reason: 'stop' }],
      }),
      text: async () => '',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(/cannot help with that/);
  });

  it('retries 429 rate limits that are not insufficient_quota', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAiError(429, JSON.stringify({ error: { type: 'rate_limit_exceeded' } }))
      )
      .mockResolvedValueOnce(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      sleepFn: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.text)).toEqual({ exercises: [] });
  });

  it('retries 500/502/503', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiError(500))
      .mockResolvedValueOnce(openAiError(502))
      .mockResolvedValueOnce(openAiError(503))
      .mockResolvedValueOnce(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      sleepFn: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('throws StopRunError immediately on insufficient_quota, without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiInsufficientQuota());
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(StopRunError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(
      callOpenAI({ model: 'gpt-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(/quota\/credits exhausted — check billing/);
  });
});

describe('generateAndRepair with provider openai', () => {
  it('uses callOpenAI end to end and reports no blocking problems on success', async () => {
    const id = 'm2-classroom-objects';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(openAiOk({ id, exercises: fakeExercises(id, 1, 20) }));
    vi.stubGlobal('fetch', fetchMock);

    const job = fakeTopicJob({ count: 20 });
    const result = await generateAndRepair(
      job,
      fakeCli({ provider: 'openai', model: 'gpt-x' }),
      'key',
      'sys',
      () => []
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(result.problems).toEqual([]);
    expect(result.merged.exercises).toHaveLength(20);
  });

  it('stops the whole run (StopRunError propagates out) on insufficient_quota', async () => {
    const id = 'm2-classroom-objects';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openAiInsufficientQuota()));

    await expect(
      generateAndRepair(
        fakeTopicJob({ topicId: id, count: 20 }),
        fakeCli({ provider: 'openai', model: 'gpt-x' }),
        'key',
        'sys',
        () => []
      )
    ).rejects.toThrow(StopRunError);
  });
});

describe('parseArgs — provider/model resolution', () => {
  it('defaults to gemini with DEFAULT_MODEL', () => {
    const cli = parseArgs(['--topic', 'x']);
    expect(cli.provider).toBe('gemini');
    expect(cli.model).not.toBe('');
  });

  it('--provider openai with no OPENAI_MODEL/--model leaves model empty (missing-model condition)', () => {
    const cli = parseArgs(['--provider', 'openai', '--topic', 'x']);
    expect(cli.provider).toBe('openai');
    expect(cli.model).toBe('');
    expect(openAiModelError(cli)).toMatch(/OPENAI_MODEL is not set/);
  });

  it('--model overrides whichever provider is active', () => {
    const cli = parseArgs(['--provider', 'openai', '--model', 'gpt-x', '--topic', 'x']);
    expect(cli.model).toBe('gpt-x');
    expect(openAiModelError(cli)).toBeUndefined();
  });

  it('reads AI_PROVIDER and OPENAI_MODEL from the environment', () => {
    const prevProvider = process.env.AI_PROVIDER;
    const prevModel = process.env.OPENAI_MODEL;
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_MODEL = 'gpt-env';
    try {
      const cli = parseArgs(['--topic', 'x']);
      expect(cli.provider).toBe('openai');
      expect(cli.model).toBe('gpt-env');
    } finally {
      if (prevProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = prevProvider;
      if (prevModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = prevModel;
    }
  });
});

describe('callGemini — daily quota (review: Task B)', () => {
  it('throws StopRunError without retrying when the 429 body is a PerDay QuotaFailure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiDailyQuota429('7200s'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callGemini({ model: 'gemini-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(StopRunError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes which model, a reset hint, and the --model/tomorrow hint in the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiDailyQuota429('7200s')));
    await expect(
      callGemini({ model: 'gemini-special', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(/gemini-special/);
    await expect(
      callGemini({ model: 'gemini-special', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(/--model/);
  });

  it('a short per-minute 429 (no PerDay quotaId, short retryDelay) still retries as before', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gemini429('0'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callGemini({ model: 'm', apiKey: 'k', systemPrompt: 's', userPrompt: 'u', maxAttempts: 2 })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2); // retried, not stopped immediately
  });

  it('stops the whole run via generateAndRepair/runJob, and writes no draft for a never-attempted job', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiDailyQuota429('7200s')));

    const job = fakeTopicJob({ topicId: 'm2-zz-quota-test', count: 20 });
    const draft = draftPath(job);
    try {
      await expect(
        runJob(job, fakeCli(), 'key', () => ({ title: 'T', targetLanguage: 'pt-PT' }))
      ).rejects.toThrow(StopRunError);
      expect(existsSync(draft)).toBe(false);
    } finally {
      rmSync(draft, { force: true });
    }
  });
});

describe('no empty draft is written (review: Task C)', () => {
  it('writeDraft (via runJob) writes nothing when the job never received any content', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiError(400)));

    const job = fakeTopicJob({ topicId: 'm2-zz-empty-draft-test', count: 20 });
    const draft = draftPath(job);
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(false);
      expect(existsSync(draft)).toBe(false);
    } finally {
      rmSync(draft, { force: true });
    }
  });

  it('still writes a draft when there is partial content', async () => {
    const job = fakeTopicJob({ topicId: 'm2-zz-partial-draft-test', count: 40 });
    const draft = draftPath(job);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          geminiOk({ id: 'm2-zz-partial-draft-test', exercises: fakeExercises('x', 1, 20) })
        )
        .mockResolvedValueOnce(geminiError(400))
    );
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(false);
      expect(existsSync(draft)).toBe(true);
    } finally {
      rmSync(draft, { force: true });
    }
  });
});

describe('repairRequestFor ignores missing-chunk problems for fixHeader (review item 1)', () => {
  const id = 'm2-classroom-objects';

  it('does not set fixHeader when the only problem is a lost/short chunk', () => {
    const job = fakeTopicJob({ count: 20 });
    const merged = normalizeMerged(job, { exercises: fakeExercises(id, 1, 10) });
    const missingIds = [`${id}-11`, `${id}-12`];
    const missingProblem: ContentProblem & { kind?: 'missing' } = {
      path: `${id}.exercises`,
      message: '2 exercise(s) missing',
      severity: 'error',
      kind: 'missing',
    };
    const request = repairRequestFor(merged, [missingProblem], missingIds);
    expect(request.fixHeader).toBe(false);
    expect(request.missingIds).toEqual(missingIds);
  });

  it('still sets fixHeader for a real header-level problem (no exerciseId, no kind)', () => {
    const job = fakeTopicJob({ count: 20 });
    const merged = normalizeMerged(job, { exercises: fakeExercises(id, 1, 20) });
    const request = repairRequestFor(
      merged,
      [{ path: `${id}.context`, message: 'context is empty', severity: 'error' }],
      []
    );
    expect(request.fixHeader).toBe(true);
  });
});

describe('deletes a stale draft after a successful write (review item 2)', () => {
  it('removes _draft-<id>.json once the real file is written', async () => {
    const job = fakeTopicJob({ topicId: 'm2-zz-draft-cleanup-test', count: 20 });
    const draft = draftPath(job);
    const outPath = path.join(REPO_ROOT, 'content/pt-PT-A1/topics/m2-zz-draft-cleanup-test.json');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(draft, '{}\n', 'utf8');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        geminiOk({
          id: 'm2-zz-draft-cleanup-test',
          context: 'c'.repeat(10),
          keyItems: [{ target: 'x', support: 'y' }],
          exercises: validExercises('m2-zz-draft-cleanup-test', 1, 20),
        })
      )
    );
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(existsSync(draft)).toBe(false);
    } finally {
      rmSync(draft, { force: true });
      rmSync(outPath, { force: true });
    }
  });
});

describe('DEFAULT_MODEL (review item 3)', () => {
  it('is gemini-3.6-flash', () => {
    expect(DEFAULT_MODEL).toBe('gemini-3.6-flash');
  });
});

describe('parseArgs — empty GEMINI_MODEL/OPENAI_MODEL count as unset (review item 4)', () => {
  it('falls back to DEFAULT_MODEL when GEMINI_MODEL is an empty string', () => {
    const prev = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = '';
    try {
      const cli = parseArgs(['--topic', 'x']);
      expect(cli.model).toBe(DEFAULT_MODEL);
    } finally {
      if (prev === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = prev;
    }
  });

  it('leaves the model empty (missing-model condition) when OPENAI_MODEL is an empty string', () => {
    const prev = process.env.OPENAI_MODEL;
    process.env.OPENAI_MODEL = '';
    try {
      const cli = parseArgs(['--provider', 'openai', '--topic', 'x']);
      expect(cli.model).toBe('');
    } finally {
      if (prev === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = prev;
    }
  });
});

describe('parseArgs — provider validation (review item 5)', () => {
  it('lowercases a mixed-case provider', () => {
    const cli = parseArgs(['--provider', 'Gemini', '--topic', 'x']);
    expect(cli.provider).toBe('gemini');
  });

  it('throws a clear error for an unknown provider', () => {
    expect(() => parseArgs(['--provider', 'claude', '--topic', 'x'])).toThrow(
      /must be "gemini" or "openai"/
    );
  });
});

describe('504 is retried (review item 6)', () => {
  it('callGemini retries a 504', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiError(504))
      .mockResolvedValueOnce(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callGemini({
      model: 'm',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      sleepFn: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('callOpenAI retries a 504', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiError(504))
      .mockResolvedValueOnce(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      sleepFn: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('retryDelayMs reads retry-after-ms before retry-after (review item 7)', () => {
  it('prefers retry-after-ms (already milliseconds) over retry-after (seconds)', () => {
    expect(retryDelayMs('7', '', 0, Date.now(), '1500')).toBe(1500);
  });

  it('falls back to retry-after when retry-after-ms is absent/blank', () => {
    expect(retryDelayMs('7', '', 0, Date.now(), null)).toBe(7000);
    expect(retryDelayMs('7', '', 0, Date.now(), '')).toBe(7000);
  });

  it('callOpenAI passes the retry-after-ms header through to the wait', async () => {
    const waits: number[] = [];
    const res429 = {
      ok: false,
      status: 429,
      headers: {
        get: (k: string) => {
          const lower = k.toLowerCase();
          if (lower === 'retry-after-ms') return '250';
          if (lower === 'retry-after') return '99';
          return null;
        },
      } as unknown as Headers,
      json: async () => ({}),
      text: async () => JSON.stringify({ error: { type: 'rate_limit_exceeded' } }),
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res429)
      .mockResolvedValueOnce(openAiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([250]);
  });
});

describe('GEMINI_MAX_OUTPUT_TOKENS override (review item 8)', () => {
  it('callGemini uses maxOutputTokens from options when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callGemini({
      model: 'gemini-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
      maxOutputTokens: 8192,
    });
    const body = requestBody(fetchMock, 0) as { generationConfig: { maxOutputTokens: number } };
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
  });

  it('generateAndRepair reads GEMINI_MAX_OUTPUT_TOKENS from the environment', async () => {
    const id = 'm2-classroom-objects';
    const prev = process.env.GEMINI_MAX_OUTPUT_TOKENS;
    process.env.GEMINI_MAX_OUTPUT_TOKENS = '8192';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ id, exercises: fakeExercises(id, 1, 20) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await generateAndRepair(fakeTopicJob({ count: 20 }), fakeCli(), 'key', 'sys', () => []);
      const body = requestBody(fetchMock, 0) as {
        generationConfig: { maxOutputTokens: number };
      };
      expect(body.generationConfig.maxOutputTokens).toBe(8192);
    } finally {
      if (prev === undefined) delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
      else process.env.GEMINI_MAX_OUTPUT_TOKENS = prev;
    }
  });
});

describe('topic stats printed after a successful write (review item 9)', () => {
  it('prints a WARN when build_phrase/question_for_answer are under the pedagogy minimum', async () => {
    const job = fakeTopicJob({ topicId: 'm2-zz-stats-test', count: 20 });
    const outPath = path.join(REPO_ROOT, 'content/pt-PT-A1/topics/m2-zz-stats-test.json');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        geminiOk({
          id: 'm2-zz-stats-test',
          context: 'c'.repeat(10),
          keyItems: [{ target: 'x', support: 'y' }],
          // All translate_word (0 build_phrase, 0 question_for_answer) — both WARN thresholds trip.
          exercises: validExercises('m2-zz-stats-test', 1, 20),
        })
      )
    );
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(logs.some((l) => /WARN.*build_phrase/.test(l))).toBe(true);
      expect(logs.some((l) => /WARN.*question_for_answer/.test(l))).toBe(true);
    } finally {
      rmSync(outPath, { force: true });
    }
  });
});

describe('OpenAI content null with finish_reason "length" is a cut-off, not fatal (nit)', () => {
  it('callOpenAI returns an empty text + finishReason "length" instead of throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null } as unknown as Headers,
      json: async () => ({
        choices: [{ message: { content: null }, finish_reason: 'length' }],
      }),
      text: async () => '',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAI({
      model: 'gpt-x',
      apiKey: 'k',
      systemPrompt: 's',
      userPrompt: 'u',
    });
    expect(result.finishReason).toBe('length');
    expect(result.text).toBe('');
  });

  it('still throws when content is null and finish_reason is not "length"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null } as unknown as Headers,
      json: async () => ({
        choices: [{ message: { content: null }, finish_reason: 'stop' }],
      }),
      text: async () => '',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-x', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow(/no message content/);
  });
});

describe('drafts are Prettier-formatted (nit)', () => {
  it('writeDraft (via runJob) writes a draft with 2-space indentation, not compact JSON', async () => {
    const job = fakeTopicJob({ topicId: 'm2-zz-draft-format-test', count: 40 });
    const draft = draftPath(job);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          geminiOk({ id: 'm2-zz-draft-format-test', exercises: fakeExercises('x', 1, 20) })
        )
        .mockResolvedValueOnce(geminiError(400))
    );
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(false);
      const text = readFileSync(draft, 'utf8');
      expect(text).toContain('\n  "id"');
    } finally {
      rmSync(draft, { force: true });
    }
  });
});

describe('--topic + --module for the same topic is queued only once (nit)', () => {
  it('does not duplicate a topic that is both --topic and inside --module', () => {
    const jobs = buildJobs(fakeCli({ topic: 'm2-family-pets', module: 'm2', force: true }));
    const matches = jobs.filter((j) => j.kind === 'topic' && j.topicId === 'm2-family-pets');
    expect(matches).toHaveLength(1);
  });
});

describe('--count/--sleep must be numeric (nit)', () => {
  it('throws a clear error for a non-numeric --count', () => {
    expect(() => parseArgs(['--topic', 'x', '--count', 'abc'])).toThrow(/--count must be a number/);
  });

  it('throws a clear error for a non-numeric --sleep', () => {
    expect(() => parseArgs(['--topic', 'x', '--sleep', 'abc'])).toThrow(/--sleep must be a number/);
  });
});

describe('value flags do not swallow a following flag (nit)', () => {
  it('--count immediately followed by another flag is treated as missing, not NaN', () => {
    const cli = parseArgs(['--topic', 'x', '--count', '--force']);
    expect(cli.count).toBeUndefined();
    expect(cli.force).toBe(true);
  });

  it('--model immediately followed by another flag is treated as missing', () => {
    const cli = parseArgs(['--topic', 'x', '--model', '--dry-run']);
    expect(cli.model).toBe(DEFAULT_MODEL);
    expect(cli.dryRun).toBe(true);
  });
});

// ---------- Feature A: resume from a draft, and Feature B: --add ----------

/** A valid topic/phrase-set header (context + keyItems) for hand-written draft/final fixtures. */
function validHeader(id: string, moduleId = 'm2') {
  return {
    id,
    moduleId,
    title: 'T',
    kind: 'vocabulary' as const,
    context: 'c'.repeat(10),
    keyItems: [{ target: 'x', support: 'y' }],
  };
}

function topicPathFor(id: string): string {
  return path.join(REPO_ROOT, `content/pt-PT-A1/topics/${id}.json`);
}

function silenceConsole() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('Feature A — resume from draft (default behaviour)', () => {
  it('keeps valid draft exercises and requests only the missing ids', async () => {
    const id = 'm2-zz-resume-keep-test';
    const job = fakeTopicJob({ topicId: id, count: 40 });
    silenceConsole();
    writeFileSync(
      draftPath(job),
      JSON.stringify({ ...validHeader(id), exercises: validExercises(id, 1, 20) }),
      'utf8'
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ exercises: validExercises(id, 21, 40) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1); // only one chunk for the 20 missing ids
      const prompt = userPromptOf(fetchMock, 0);
      expect(prompt).toContain(`${id}-21`);
      expect(prompt).toContain(`${id}-40`);
      expect(prompt).not.toContain(`${id}-05`); // the kept exercises are never resent

      const written = JSON.parse(readFileSync(topicPathFor(id), 'utf8')) as {
        exercises: { id: string }[];
      };
      expect(written.exercises).toHaveLength(40);
      expect(written.exercises.map((e) => e.id)[0]).toBe(`${id}-01`);
      expect(written.exercises.map((e) => e.id)[39]).toBe(`${id}-40`);
      expect(existsSync(draftPath(job))).toBe(false);
    } finally {
      rmSync(draftPath(job), { force: true });
      rmSync(topicPathFor(id), { force: true });
    }
  });

  it('drops invalid draft exercises and regenerates only those', async () => {
    const id = 'm2-zz-resume-drop-test';
    const job = fakeTopicJob({ topicId: id, count: 20 });
    silenceConsole();
    const exercises = validExercises(id, 1, 20);
    exercises[13] = { ...exercises[13], prompt: '' }; // id "<id>-14" is now invalid (empty prompt)
    writeFileSync(draftPath(job), JSON.stringify({ ...validHeader(id), exercises }), 'utf8');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ exercises: validExercises(id, 14, 14) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const prompt = userPromptOf(fetchMock, 0);
      expect(prompt).toContain(`${id}-14`);
      expect(prompt).not.toContain(`${id}-13`);

      const written = JSON.parse(readFileSync(topicPathFor(id), 'utf8')) as {
        exercises: { id: string; prompt: string }[];
      };
      expect(written.exercises).toHaveLength(20);
      expect(written.exercises[13].prompt).not.toBe('');
    } finally {
      rmSync(draftPath(job), { force: true });
      rmSync(topicPathFor(id), { force: true });
    }
  });

  it('regenerates the header as part of the first request when it is missing/invalid', async () => {
    const id = 'm2-zz-resume-header-test';
    const job = fakeTopicJob({ topicId: id, count: 20 });
    silenceConsole();
    // No context/keyItems at all — structurally invalid header.
    writeFileSync(
      draftPath(job),
      JSON.stringify({ id, moduleId: 'm2', exercises: validExercises(id, 1, 10) }),
      'utf8'
    );
    const fetchMock = vi.fn().mockResolvedValue(
      geminiOk({
        id,
        moduleId: 'm2',
        title: 'T',
        kind: 'vocabulary',
        context: 'brand new context'.padEnd(20, '.'),
        keyItems: [{ target: 'a', support: 'b' }],
        exercises: validExercises(id, 11, 20),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const prompt = userPromptOf(fetchMock, 0);
      expect(prompt).toContain('Return the full Topic JSON');
      expect(prompt).toContain(`${id}-11`);
      expect(prompt).toContain(`${id}-20`);

      const written = JSON.parse(readFileSync(topicPathFor(id), 'utf8')) as {
        context: string;
        exercises: unknown[];
      };
      expect(written.context).toContain('brand new context');
      expect(written.exercises).toHaveLength(20);
    } finally {
      rmSync(draftPath(job), { force: true });
      rmSync(topicPathFor(id), { force: true });
    }
  });

  it('rewrites the draft on a further failure without losing the exercises already kept', async () => {
    const id = 'm2-zz-resume-fail-test';
    const job = fakeTopicJob({ topicId: id, count: 40 });
    silenceConsole();
    writeFileSync(
      draftPath(job),
      JSON.stringify({ ...validHeader(id), exercises: validExercises(id, 1, 20) }),
      'utf8'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiError(400)));

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(false);
      expect(existsSync(topicPathFor(id))).toBe(false);
      const draft = JSON.parse(readFileSync(draftPath(job), 'utf8')) as {
        exercises: { id: string }[];
      };
      expect(draft.exercises).toHaveLength(20); // the 20 valid kept exercises were never lost
      expect(draft.exercises[0].id).toBe(`${id}-01`);
    } finally {
      rmSync(draftPath(job), { force: true });
      rmSync(topicPathFor(id), { force: true });
    }
  });

  it('--fresh ignores an existing draft and generates from scratch', async () => {
    const id = 'm2-zz-resume-fresh-test';
    const job = fakeTopicJob({ topicId: id, count: 20 });
    silenceConsole();
    writeFileSync(
      draftPath(job),
      JSON.stringify({ ...validHeader(id), exercises: validExercises(id, 1, 20) }),
      'utf8'
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ ...validHeader(id), exercises: validExercises(id, 1, 20) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ok = await runJob(job, fakeCli({ fresh: true }), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const prompt = userPromptOf(fetchMock, 0);
      // The normal (non-resume) first-chunk wording, proving the draft was never consulted.
      expect(prompt).toContain('Return the full Topic JSON');
      expect(prompt).toContain(`${id}-01..${id}-20`);
    } finally {
      rmSync(draftPath(job), { force: true });
      rmSync(topicPathFor(id), { force: true });
    }
  });
});

describe('Feature B — buildJobs --add', () => {
  it('errors when --add is combined with --module or --phrases', () => {
    expect(() => buildJobs(fakeCli({ topic: 'm2-family-pets', add: 10, module: 'm2' }))).toThrow(
      /--add only works with --topic/
    );
    expect(() =>
      buildJobs(fakeCli({ topic: 'm2-family-pets', add: 10, phrases: 'everyday-2' }))
    ).toThrow(/--add only works with --topic/);
  });

  it('errors when the final topic file does not exist yet', () => {
    if (!unwritten) return;
    expect(() =>
      buildJobs(fakeCli({ program: unwritten.program, topic: unwritten.topic, add: 10 }))
    ).toThrow(/--add requires an existing topic file/);
  });

  it('builds a job with appendFrom = existing exercise count and count = existing + n', () => {
    const jobs = buildJobs(fakeCli({ topic: 'm2-family-pets', add: 10 }));
    expect(jobs).toHaveLength(1);
    const job = jobs[0] as TopicJob;
    expect(job.appendFrom).toBeGreaterThan(0);
    expect(job.count).toBe((job.appendFrom ?? 0) + 10);
  });
});

describe('Feature B — append to an existing topic (runJob end to end)', () => {
  it('appends new exercises after the highest existing id, never touching 01..40, and dedupes sentences', async () => {
    const id = 'm2-zz-append-test';
    const job: TopicJob = { ...fakeTopicJob({ topicId: id, count: 60 }), appendFrom: 40 };
    silenceConsole();
    const original = { ...validHeader(id), exercises: validExercises(id, 1, 40) };
    writeFileSync(topicPathFor(id), JSON.stringify(original), 'utf8');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ exercises: validExercises(id, 41, 60) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const prompt = userPromptOf(fetchMock, 0);
      expect(prompt).toContain(`${id}-41`);
      expect(prompt).toContain(`${id}-60`);
      expect(prompt).toContain('Sentence with **word01** in it.'); // old sentences passed to dedupe

      const written = JSON.parse(readFileSync(topicPathFor(id), 'utf8')) as {
        exercises: Record<string, unknown>[];
      };
      expect(written.exercises).toHaveLength(60);
      expect(written.exercises.slice(0, 40)).toEqual(original.exercises);
      expect(existsSync(draftPath(job))).toBe(false);
    } finally {
      rmSync(topicPathFor(id), { force: true });
      rmSync(draftPath(job), { force: true });
    }
  });

  it('writes a draft (old + valid new) and leaves the final file untouched on failure', async () => {
    const id = 'm2-zz-append-fail-test';
    const job: TopicJob = { ...fakeTopicJob({ topicId: id, count: 60 }), appendFrom: 40 };
    silenceConsole();
    const original = { ...validHeader(id), exercises: validExercises(id, 1, 40) };
    writeFileSync(topicPathFor(id), JSON.stringify(original), 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiError(400)));

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(false);
      const untouched = JSON.parse(readFileSync(topicPathFor(id), 'utf8')) as {
        exercises: unknown[];
      };
      expect(untouched.exercises).toHaveLength(40); // final file left exactly as it was
      const draft = JSON.parse(readFileSync(draftPath(job), 'utf8')) as {
        exercises: unknown[];
        $targetCount: number;
      };
      expect(draft.exercises).toHaveLength(40);
      expect(draft.$targetCount).toBe(60);
    } finally {
      rmSync(topicPathFor(id), { force: true });
      rmSync(draftPath(job), { force: true });
    }
  });

  it('resumes an append draft (continuing to the target count) instead of starting over', async () => {
    const id = 'm2-zz-append-resume-test';
    const job: TopicJob = { ...fakeTopicJob({ topicId: id, count: 60 }), appendFrom: 40 };
    silenceConsole();
    const original = { ...validHeader(id), exercises: validExercises(id, 1, 40) };
    writeFileSync(topicPathFor(id), JSON.stringify(original), 'utf8');
    writeFileSync(
      draftPath(job),
      JSON.stringify({
        ...validHeader(id),
        exercises: [...validExercises(id, 1, 40), ...validExercises(id, 41, 50)],
        $targetCount: 60,
        $existingCount: 40,
      }),
      'utf8'
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ exercises: validExercises(id, 51, 60) }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({
        title: 'T',
        targetLanguage: 'pt-PT',
      }));
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1); // only the remaining 10 (51..60) were requested
      const prompt = userPromptOf(fetchMock, 0);
      expect(prompt).toContain(`${id}-51`);
      expect(prompt).toContain(`${id}-60`);
      expect(prompt).not.toContain(`${id}-45`);

      const written = JSON.parse(readFileSync(topicPathFor(id), 'utf8')) as {
        exercises: unknown[];
        $targetCount?: number;
      };
      expect(written.exercises).toHaveLength(60);
      expect(written.$targetCount).toBeUndefined(); // the $ marker is stripped before the final write
      expect(existsSync(draftPath(job))).toBe(false);
    } finally {
      rmSync(topicPathFor(id), { force: true });
      rmSync(draftPath(job), { force: true });
    }
  });
});
