// AI check runtime state (docs/stage-7-spec.md §1, §4): the suspension after an invalid
// key or exhausted credit, and the monthly usage counters.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { hashString } from '../engine/rng';
import { isRecord } from '../lib/isRecord';

// ---------------------------------------------------------------------------
// Suspension
// ---------------------------------------------------------------------------

export type AiSuspensionReason = 'invalidKey' | 'noCredit';

interface Suspension {
  reason: AiSuspensionReason;
  /** Hash of the key + model it was raised for; the key itself is never kept here. */
  fingerprint: number;
}

/**
 * Kept in memory only, so a suspension ends with the app (the next start tries again)
 * or as soon as the key or model changes — whichever comes first.
 */
let suspension: Suspension | null = null;

interface AiKeySettings {
  openaiApiKey: string;
  openaiModel: string;
}

export function aiFingerprint(settings: AiKeySettings): number {
  return hashString(`${settings.openaiApiKey.trim()}\n${settings.openaiModel.trim()}`);
}

export function suspendAi(reason: AiSuspensionReason, settings: AiKeySettings): void {
  suspension = { reason, fingerprint: aiFingerprint(settings) };
}

/** The active suspension for these settings, or `null`. */
export function aiSuspension(settings: AiKeySettings): AiSuspensionReason | null {
  if (!suspension) return null;
  return suspension.fingerprint === aiFingerprint(settings) ? suspension.reason : null;
}

/** Called whenever the AI settings change in Settings (and by tests). */
export function clearAiSuspension(): void {
  suspension = null;
}

// ---------------------------------------------------------------------------
// Monthly usage
// ---------------------------------------------------------------------------

/** A `settings`-table row of its own, so the Settings blob stays untouched. */
export const AI_USAGE_KEY = 'aiUsage';

export interface AiUsage {
  /** Calendar month, "YYYY-MM" (local time). */
  month: string;
  checks: number;
  tokens: number;
}

export function monthKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** This month's counters from whatever is stored; another month (or garbage) reads as zero. */
export function usageForMonth(stored: unknown, now: number): AiUsage {
  const month = monthKey(now);
  if (
    isRecord(stored) &&
    stored.month === month &&
    typeof stored.checks === 'number' &&
    typeof stored.tokens === 'number'
  ) {
    return { month, checks: stored.checks, tokens: stored.tokens };
  }
  return { month, checks: 0, tokens: 0 };
}

/** Pure: one more check with `tokens` tokens, starting over when the month changed. */
export function addUsage(stored: unknown, tokens: number, now: number): AiUsage {
  const current = usageForMonth(stored, now);
  return {
    month: current.month,
    checks: current.checks + 1,
    tokens: current.tokens + Math.max(0, Math.round(tokens)),
  };
}

export async function recordAiUsage(tokens: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(AI_USAGE_KEY);
    await db.settings.put({ key: AI_USAGE_KEY, value: addUsage(row?.value, tokens, now) });
  });
}

export async function readAiUsage(now = Date.now()): Promise<AiUsage> {
  const row = await db.settings.get(AI_USAGE_KEY);
  return usageForMonth(row?.value, now);
}

export function useAiUsage(): AiUsage | undefined {
  return useLiveQuery(() => readAiUsage(), []);
}
