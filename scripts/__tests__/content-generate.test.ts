import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentProblem } from '../../src/content/contentRules.ts';
import {
  buildSystemPrompt,
  buildUserPrompt,
  callGemini,
  generateAndRepair,
  hasBlockingProblems,
  mergeExerciseChunks,
  MAX_REPAIR_ROUNDS,
  parseModelJson,
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
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as unknown as Headers,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      usageMetadata: usage,
    }),
    text: async () => '',
  } as unknown as Response;
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

  it('gives up after maxRetries consecutive 429s and throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gemini429('0'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr', maxRetries: 1 })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('throws immediately on a non-429 error response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiError(500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callGemini({ model: 'm', apiKey: 'k', systemPrompt: 'sys', userPrompt: 'usr' })).rejects.toThrow(
      /Gemini API error 500/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateAndRepair — repair loop', () => {
  it('does not call the repair prompt when the first validation has no blocking problems', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk({ id: 'm2-a', exercises: [{ id: 'm2-a-01' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const validate = vi.fn().mockReturnValue([]);

    const job = fakeTopicJob({ count: 20 });
    const result = await generateAndRepair(job, fakeCli(), 'key', 'sys', validate);

    expect(fetchMock).toHaveBeenCalledTimes(1); // one chunk, no repair
    expect(result.repairRounds).toBe(0);
    expect(result.problems).toEqual([]);
  });

  it('sends a repair call including the problems, and re-validates the corrected JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiOk({ id: 'm2-a', exercises: [{ id: 'm2-a-01', bad: true }] }))
      .mockResolvedValueOnce(geminiOk({ id: 'm2-a', exercises: [{ id: 'm2-a-01', bad: false }] }));
    vi.stubGlobal('fetch', fetchMock);

    const problem: ContentProblem = { path: 'x', message: 'bad exercise', severity: 'error' };
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
    const alwaysBadPayload = { id: 'm2-a', exercises: [{ id: 'm2-a-01' }] };
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
