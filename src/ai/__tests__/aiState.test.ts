import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import {
  AI_USAGE_KEY,
  addUsage,
  aiSuspension,
  clearAiSuspension,
  monthKey,
  readAiUsage,
  recordAiUsage,
  suspendAi,
  usageForMonth,
} from '../aiState';

const OCT = new Date(2026, 9, 15).getTime();
const NOV = new Date(2026, 10, 1).getTime();

beforeEach(async () => {
  clearAiSuspension();
  await db.settings.clear();
});

describe('AI suspension', () => {
  const settings = { openaiApiKey: 'sk-a', openaiModel: 'gpt-5.4-mini' };

  it('holds for the same key and model', () => {
    expect(aiSuspension(settings)).toBeNull();
    suspendAi('invalidKey', settings);
    expect(aiSuspension(settings)).toBe('invalidKey');
  });

  it('lifts when the key or the model changes', () => {
    suspendAi('invalidKey', settings);
    expect(aiSuspension({ ...settings, openaiApiKey: 'sk-b' })).toBeNull();
    expect(aiSuspension({ ...settings, openaiModel: 'other' })).toBeNull();
  });

  it('lifts on clear (settings changed / next app start)', () => {
    suspendAi('noCredit', settings);
    expect(aiSuspension(settings)).toBe('noCredit');
    clearAiSuspension();
    expect(aiSuspension(settings)).toBeNull();
  });
});

describe('monthly usage', () => {
  it('increments checks and tokens within a month', () => {
    const first = addUsage(undefined, 300, OCT);
    expect(first).toEqual({ month: '2026-10', checks: 1, tokens: 300 });
    expect(addUsage(first, 250, OCT)).toEqual({ month: '2026-10', checks: 2, tokens: 550 });
  });

  it('resets when the month changes', () => {
    const october = { month: '2026-10', checks: 7, tokens: 2000 };
    expect(usageForMonth(october, NOV)).toEqual({ month: '2026-11', checks: 0, tokens: 0 });
    expect(addUsage(october, 100, NOV)).toEqual({ month: '2026-11', checks: 1, tokens: 100 });
  });

  it('reads garbage as zero', () => {
    expect(usageForMonth('nope', OCT)).toEqual({ month: monthKey(OCT), checks: 0, tokens: 0 });
  });

  it('persists in its own settings row', async () => {
    await recordAiUsage(120, OCT);
    await recordAiUsage(80, OCT);
    expect(await readAiUsage(OCT)).toEqual({ month: '2026-10', checks: 2, tokens: 200 });
    expect(await readAiUsage(NOV)).toEqual({ month: '2026-11', checks: 0, tokens: 0 });
    expect(await db.settings.get(AI_USAGE_KEY)).toBeDefined();
  });
});
