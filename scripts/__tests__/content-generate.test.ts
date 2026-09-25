import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentProblem } from '../../src/content/contentRules.ts';
import {
  buildJobs,
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  callGemini,
  draftPath,
  generateAndRepair,
  hasBlockingProblems,
  MAX_OUTPUT_TOKENS,
  MAX_RETRY_DELAY_MS,
  mergeExerciseChunks,
  MAX_REPAIR_ROUNDS,
  normalizeMerged,
  parseModelJson,
  REPO_ROOT,
  retryDelayMs,
  runJob,
  validateMerged,
  type Cli,
  type TopicJob,
} from '../content-generate.ts';

function fakeCli(overrides: Partial<Cli> = {}): Cli {
  return {
    program: 'pt-PT-A1',
    force: false,
    dryRun: false,
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
    out.push({ id: `${id}-${nn}`, type: 'translate_word', topicId: id, sentence: `Sentence ${nn}.`, ...extra });
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
    headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? retryAfterSeconds : null) } as unknown as Headers,
    json: async () => ({}),
    text: async () => 'rate limited',
  } as unknown as Response;
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

  it('asks for a continuation with the second chunk\'s id range, without repeating sentences', () => {
    const job = fakeTopicJob({ count: 40 });
    const prompt = buildUserPrompt(job, { startNum: 21, endNum: 40, isContinuation: true });
    expect(prompt).toContain('m2-classroom-objects-21..m2-classroom-objects-40');
    expect(prompt.toLowerCase()).toContain('do not repeat sentences');
  });
});

describe('mergeExerciseChunks', () => {
  it('concatenates exercises across chunks, keeping the first chunk as the base object', () => {
    const merged = mergeExerciseChunks([
      { id: 'm2-a', title: 'A', context: 'c', keyItems: [], exercises: [{ id: 'm2-a-01' }, { id: 'm2-a-02' }] },
      { exercises: [{ id: 'm2-a-03' }] },
    ]);
    expect(merged.id).toBe('m2-a');
    expect(merged.context).toBe('c');
    expect((merged.exercises as { id: string }[]).map((e) => e.id)).toEqual(['m2-a-01', 'm2-a-02', 'm2-a-03']);
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
    const fetchMock = vi.fn().mockResolvedValue(geminiOk({ exercises: [] }, { totalTokenCount: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr' });
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

    const result = await callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(result.text)).toEqual({ exercises: [] });
  });

  it('gives up after maxAttempts tries and throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gemini429('0'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr', maxAttempts: 2 })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 500 and 503 too, waiting per the body retryDelay', async () => {
    const waits: number[] = [];
    const retryBody = JSON.stringify({ error: { details: [{ '@type': 'RetryInfo', retryDelay: '3s' }] } });
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

    await expect(callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr' })).rejects.toThrow(
      /Gemini API error 400/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the key in x-goog-api-key (not the URL), maxOutputTokens, and no systemInstruction role', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk({ exercises: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await callGemini({ model: 'gemini-x', apiKey: 'SECRET', systemPrompt: 'sys', userPrompt: 'usr' });
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

  it('joins all text parts and skips thought parts', async () => {
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"a":' }, { text: '1}' }] },
          },
        ],
      }),
      text: async () => '',
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    const result = await callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr' });
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
    expect(retryDelayMs(null, 'not json', 2, now)).toBe(4000);
  });

  it('never returns NaN or more than the cap', () => {
    expect(retryDelayMs('soon-ish', '', 1, now)).toBe(2000);
    expect(retryDelayMs('3600', '', 0, now)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(null, '', 20, now)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs('Fri, 25 Sep 2026 11:00:00 GMT', '', 0, now)).toBe(0);
  });
});

describe('generateAndRepair — repair loop', () => {
  it('does not call the repair prompt when the first validation has no blocking problems', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiOk({ id: 'm2-classroom-objects', exercises: fakeExercises('m2-classroom-objects', 1, 20) }));
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

    const problem: ContentProblem = { path: 'x', message: 'bad exercise', severity: 'error', exerciseId: `${id}-01` };
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
    const alwaysBadPayload = { id: 'm2-classroom-objects', exercises: fakeExercises('m2-classroom-objects', 1, 20) };
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
    expect(existsSync(path.join(REPO_ROOT, 'content/pt-PT-A1/topics/m2-family-pets.json'))).toBe(true);
    expect(buildJobs(fakeCli({ topic: 'm2-family-pets' }))).toEqual([]);
  });

  it('regenerates an existing --topic with --force', () => {
    const jobs = buildJobs(fakeCli({ topic: 'm2-family-pets', force: true }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'topic', topicId: 'm2-family-pets', moduleId: 'm2' });
  });

  it('still builds a --topic job when there is no file yet', () => {
    expect(buildJobs(fakeCli({ topic: 'm2-classroom-objects' }))).toHaveLength(1);
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
      vi.fn().mockResolvedValue(geminiOk({ id: 'renamed', moduleId: 'm7', exercises: fakeExercises('renamed', 5, 24) }))
    );
    const validate = vi.fn().mockReturnValue([]);

    const result = await generateAndRepair(job, fakeCli(), 'key', 'sys', validate);
    const seen = validate.mock.calls[0][0] as { id: string; moduleId: string; exercises: { id: string }[] };
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
      .mockResolvedValueOnce(geminiRaw('{"id": "m2-classroom-objects", "exercises": [{"id"', 'MAX_TOKENS'))
      .mockResolvedValueOnce(geminiOk({ id, exercises: fakeExercises(id, 1, 20) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAndRepair(fakeTopicJob({ count: 20 }), fakeCli(), 'key', 'sys', () => []);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.problems).toEqual([]);
    expect(result.merged.exercises).toHaveLength(20);
  });

  it('keeps chunk 1 when chunk 2 is invalid twice, then repair writes only the missing exercises', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiOk({ id, context: 'c', keyItems: [], exercises: fakeExercises(id, 1, 20) }))
      .mockResolvedValueOnce(geminiRaw('not json at all'))
      .mockResolvedValueOnce(geminiRaw('{"exercises": [', 'MAX_TOKENS'))
      .mockResolvedValueOnce(geminiOk({ exercises: fakeExercises(id, 21, 40) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAndRepair(fakeTopicJob({ count: 40 }), fakeCli(), 'key', 'sys', () => []);
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
        geminiOk({ exercises: [{ id: `${id}-05`, type: 'translate_word', sentence: 'Fixed five.' }] })
      );
    vi.stubGlobal('fetch', fetchMock);
    const problem: ContentProblem = { path: 'p', message: 'wrong options', severity: 'error', exerciseId: `${id}-05` };
    const validate = vi.fn().mockReturnValueOnce([problem]).mockReturnValue([]);

    const result = await generateAndRepair(fakeTopicJob({ count: 20 }), fakeCli(), 'key', 'sys', validate);
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
    const merged = normalizeMerged(job, { context: '', keyItems: [], exercises: fakeExercises(id, 1, 20) });
    const prompt = buildRepairPrompt(job, merged, [{ path: 'x.context', message: 'empty context' }], {
      fixIds: [],
      missingIds: [],
      fixHeader: true,
    });
    expect(prompt).toContain('"header"');
    expect(prompt).not.toContain(`"id":"${id}-01"`);
  });

  it('never throws on an API failure and returns what was merged', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiOk({ id, exercises: fakeExercises(id, 1, 20) }))
      .mockResolvedValueOnce(geminiError(400));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAndRepair(fakeTopicJob({ count: 40 }), fakeCli(), 'key', 'sys', () => []);
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
        .mockResolvedValueOnce(geminiOk({ id: 'm2-zz-generator-test', exercises: fakeExercises('x', 1, 20) }))
        .mockResolvedValueOnce(geminiError(400))
    );
    try {
      const ok = await runJob(job, fakeCli(), 'key', () => ({ title: 'T', targetLanguage: 'pt-PT' }));
      expect(ok).toBe(false);
      const written = JSON.parse(readFileSync(draft, 'utf8')) as { id: string; exercises: unknown[] };
      expect(written.id).toBe('m2-zz-generator-test');
      expect(written.exercises).toHaveLength(20);
    } finally {
      rmSync(draft, { force: true });
    }
  });
});
