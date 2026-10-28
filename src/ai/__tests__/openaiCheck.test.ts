import { describe, expect, it, vi } from 'vitest';
import { makeBuildPhrase } from '../../test/fixtures';
import type { AboutMeExercise } from '../../content/types';
import {
  AI_MAX_COMPLETION_TOKENS,
  OPENAI_CHAT_URL,
  aiRoute,
  aiWanted,
  buildSystemPrompt,
  buildUserMessage,
  classifyHttpError,
  parseCompletion,
  runAiCheck,
  testConnection,
  type AiCheckContext,
  type AiGateInput,
  type FetchFn,
} from '../openaiCheck';

const KEY = 'sk-unit-test-key';

const gate: AiGateInput = {
  aiCheckEnabled: true,
  openaiApiKey: KEY,
  mode: 'typing',
  exerciseType: 'build_phrase',
  locallyCorrect: false,
};

const aboutMe: AboutMeExercise = {
  id: 'am1',
  type: 'about_me',
  topicId: 't1',
  difficulty: 2,
  allowedModes: ['typing'],
  prompt: 'Answer about yourself.',
  explanation: 'Morar goes with em.',
  question: 'Onde é que moras?',
  sampleAnswer: 'Moro em Lisboa.',
  hints: ['numa', 'aldeia'],
};

const context: AiCheckContext = {
  targetLanguage: 'pt-PT',
  topicTitle: 'Regular -ar verbs',
  exercise: makeBuildPhrase('e1', 't1', { tags: ['falar', 'present'] }),
  learnerAnswer: 'Eu fala inglês',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completion(content: string, totalTokens = 321): Response {
  return jsonResponse({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { total_tokens: totalTokens },
  });
}

const verdictJson = (verdict: string) =>
  JSON.stringify({ verdict, correction: 'Eu falo inglês.', explanation: 'Use falo with eu.' });

const noSleep = vi.fn(async () => {});

describe('aiWanted / aiRoute (§2)', () => {
  it('runs for a wrong typed answer to an open exercise when switched on with a key', () => {
    expect(aiWanted(gate)).toBe(true);
    expect(aiRoute({ ...gate, online: true, suspended: false })).toBe('ai');
  });

  it('never runs when the switch is off, even with a key', () => {
    expect(aiWanted({ ...gate, aiCheckEnabled: false })).toBe(false);
  });

  it('never runs without a key', () => {
    expect(aiWanted({ ...gate, openaiApiKey: '' })).toBe(false);
    expect(aiWanted({ ...gate, openaiApiKey: '   ' })).toBe(false);
  });

  it('only for typing mode', () => {
    expect(aiWanted({ ...gate, mode: 'tiles' })).toBe(false);
    expect(aiWanted({ ...gate, mode: 'letters' })).toBe(false);
  });

  it('only for open exercise types', () => {
    expect(aiWanted({ ...gate, exerciseType: 'question_for_answer' })).toBe(true);
    expect(aiWanted({ ...gate, exerciseType: 'about_me' })).toBe(true);
    for (const type of ['translate_word', 'fill_gaps', 'find_error', 'number_sequence'] as const) {
      expect(aiWanted({ ...gate, exerciseType: type })).toBe(false);
    }
  });

  it('only when the local check did not accept the answer (about_me always)', () => {
    expect(aiWanted({ ...gate, locallyCorrect: true })).toBe(false);
    expect(aiWanted({ ...gate, exerciseType: 'about_me', locallyCorrect: true })).toBe(true);
  });

  it('falls back to the self-grade when offline or suspended, stays local when not wanted', () => {
    expect(aiRoute({ ...gate, online: false, suspended: false })).toBe('fallback');
    expect(aiRoute({ ...gate, online: true, suspended: true })).toBe('fallback');
    expect(aiRoute({ ...gate, aiCheckEnabled: false, online: false, suspended: true })).toBe(
      'local'
    );
  });
});

describe('system prompt and user message (§3)', () => {
  it('describes a fair teacher, the verdict JSON and the grading rules', () => {
    const prompt = buildSystemPrompt('en');
    expect(prompt).toContain('fair language teacher');
    expect(prompt).toContain('ONE learner answer');
    expect(prompt).toContain('English (en)');
    expect(prompt).toContain('"verdict":"correct"|"almost"|"incorrect"');
    expect(prompt).toContain('"correction"');
    expect(prompt).toContain('"explanation":"<one short sentence in English>"');
    expect(prompt).toMatch(/- correct: .*target word\/phrase\/structure/);
    expect(prompt).toMatch(/names, who, when/);
    expect(prompt).toMatch(/Ignore capitalisation, punctuation and missing accents/);
    expect(prompt).toMatch(/- almost: .*one small slip/);
    expect(prompt).toMatch(/- incorrect: .*different language\/variety/);
    expect(prompt).not.toMatch(/Brazilian/);
  });

  it('accepts European Portuguese only for pt-PT', () => {
    const prompt = buildSystemPrompt('pt-PT');
    expect(prompt).toContain('(pt-PT)');
    expect(prompt).toMatch(/European Portuguese only — Brazilian forms.* are wrong/);
  });

  it('sends the exercise, model answer, accepted answers, topic and learner answer', () => {
    const message = JSON.parse(buildUserMessage(context));
    expect(message).toEqual({
      exercise: {
        type: 'build_phrase',
        prompt: "Build: 'I speak English.'",
        modelAnswer: 'Eu falo inglês.',
        acceptedAnswers: ['Falo inglês.'],
      },
      topic: { title: 'Regular -ar verbs', tags: ['falar', 'present'] },
      learnerAnswer: 'Eu fala inglês',
    });
  });

  it('sends the question, sample answer and hints for about_me', () => {
    const message = JSON.parse(
      buildUserMessage({ ...context, exercise: aboutMe, learnerAnswer: 'Moro no Porto.' })
    );
    expect(message.exercise).toEqual({
      type: 'about_me',
      prompt: 'Answer about yourself.',
      question: 'Onde é que moras?',
      sampleAnswer: 'Moro em Lisboa.',
      hints: ['numa', 'aldeia'],
    });
  });
});

describe('request shape', () => {
  it('posts to chat completions with bearer, json_object, model, token cap, low effort, no temperature', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => completion(verdictJson('correct')));
    await runAiCheck({ apiKey: KEY, model: 'gpt-5.4-mini', context }, { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(OPENAI_CHAT_URL);
    expect(url).not.toContain(KEY);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_completion_tokens).toBe(AI_MAX_COMPLETION_TOKENS);
    expect(body.max_completion_tokens).toBe(400);
    expect(body.reasoning_effort).toBe('low');
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages[0]).toEqual({ role: 'system', content: buildSystemPrompt('pt-PT') });
    expect(body.messages[1]).toEqual({ role: 'user', content: buildUserMessage(context) });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('parseCompletion', () => {
  it('reads a valid verdict and the token usage', () => {
    const json = {
      choices: [{ message: { content: verdictJson('almost') } }],
      usage: { total_tokens: 250 },
    };
    expect(parseCompletion(json)).toEqual({
      verdict: 'almost',
      correction: 'Eu falo inglês.',
      explanation: 'Use falo with eu.',
      totalTokens: 250,
    });
  });

  it('tolerates markdown fences', () => {
    const json = {
      choices: [{ message: { content: '```json\n' + verdictJson('correct') + '\n```' } }],
    };
    expect(parseCompletion(json)?.verdict).toBe('correct');
  });

  it('treats invalid JSON, an unknown verdict or a missing message as no verdict', () => {
    expect(parseCompletion({ choices: [{ message: { content: 'not json' } }] })).toBeNull();
    expect(
      parseCompletion({ choices: [{ message: { content: JSON.stringify({ verdict: 'great' }) } }] })
    ).toBeNull();
    expect(parseCompletion({ choices: [{ message: { content: null } }] })).toBeNull();
    expect(parseCompletion({})).toBeNull();
    expect(parseCompletion(null)).toBeNull();
  });
});

describe('classifyHttpError (§4)', () => {
  it('classifies invalid keys, billing, transient and other errors', () => {
    expect(classifyHttpError(401, '{"error":{"code":"invalid_api_key"}}')).toBe('invalidKey');
    expect(classifyHttpError(429, '{"error":{"code":"insufficient_quota"}}')).toBe('noCredit');
    expect(classifyHttpError(429, '{"error":{"type":"insufficient_quota"}}')).toBe('noCredit');
    expect(classifyHttpError(429, '{"error":{"code":"rate_limit_exceeded"}}')).toBe('retryable');
    for (const status of [500, 502, 503, 504]) {
      expect(classifyHttpError(status, '')).toBe('retryable');
    }
    expect(classifyHttpError(404, '{"error":{"code":"model_not_found"}}')).toBe('other');
  });
});

describe('runAiCheck errors and retries', () => {
  it('returns invalidKey on 401 without retrying', async () => {
    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse({ error: { code: 'invalid_api_key', message: 'bad' } }, 401)
    );
    const outcome = await runAiCheck(
      { apiKey: KEY, model: 'm', context },
      { fetchFn, sleep: noSleep }
    );
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'invalidKey' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns noCredit on 429 insufficient_quota without retrying', async () => {
    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse({ error: { code: 'insufficient_quota' } }, 429)
    );
    const outcome = await runAiCheck(
      { apiKey: KEY, model: 'm', context },
      { fetchFn, sleep: noSleep }
    );
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'noCredit' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 exactly once after 2 s, then gives up', async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi.fn<FetchFn>(async () => jsonResponse({ error: {} }, 503));
    const outcome = await runAiCheck({ apiKey: KEY, model: 'm', context }, { fetchFn, sleep });
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'error' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it('uses the retry when it succeeds', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(completion(verdictJson('incorrect')));
    const outcome = await runAiCheck(
      { apiKey: KEY, model: 'm', context },
      { fetchFn, sleep: noSleep }
    );
    expect(outcome.kind).toBe('verdict');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('times out (and retries once) when OpenAI does not answer', async () => {
    const fetchFn = vi.fn<FetchFn>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const outcome = await runAiCheck(
      { apiKey: KEY, model: 'm', context },
      { fetchFn, sleep: noSleep, timeoutMs: 5 }
    );
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports a network error after one retry', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const outcome = await runAiCheck(
      { apiKey: KEY, model: 'm', context },
      { fetchFn, sleep: noSleep }
    );
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'network' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('treats an unparsable reply as unavailable, never as a verdict', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => completion('{"verdict":"maybe"}'));
    const outcome = await runAiCheck({ apiKey: KEY, model: 'm', context }, { fetchFn });
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'badResponse' });
  });

  it('stops when aborted (skip link)', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<FetchFn>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const pending = runAiCheck(
      { apiKey: KEY, model: 'm', context },
      { fetchFn, sleep: noSleep, signal: controller.signal }
    );
    controller.abort();
    expect(await pending).toEqual({ kind: 'unavailable', reason: 'aborted' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('testConnection', () => {
  it('reports Connected on any 200', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => completion('{"ok":true}'));
    expect(await testConnection(KEY, 'gpt-5.4-mini', { fetchFn })).toEqual({ ok: true });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.max_completion_tokens).toBeLessThan(AI_MAX_COMPLETION_TOKENS);
  });

  it('maps invalid key, no credit, network and other errors', async () => {
    const respond = (response: Response | Error) =>
      vi.fn<FetchFn>(async () => {
        if (response instanceof Error) throw response;
        return response;
      });
    expect(await testConnection(KEY, 'm', { fetchFn: respond(jsonResponse({}, 401)) })).toEqual({
      ok: false,
      reason: 'invalidKey',
    });
    expect(
      await testConnection(KEY, 'm', {
        fetchFn: respond(jsonResponse({ error: { code: 'insufficient_quota' } }, 429)),
      })
    ).toEqual({ ok: false, reason: 'noCredit' });
    expect(await testConnection(KEY, 'm', { fetchFn: respond(new TypeError('x')) })).toEqual({
      ok: false,
      reason: 'network',
    });
    const other = await testConnection(KEY, 'm', {
      fetchFn: respond(jsonResponse({ error: { message: 'The model `m` does not exist' } }, 404)),
    });
    expect(other).toEqual({
      ok: false,
      reason: 'error',
      message: 'The model `m` does not exist',
      status: 404,
    });
    expect(JSON.stringify(other)).not.toContain(KEY);
  });
});
