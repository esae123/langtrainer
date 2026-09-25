export type UiLanguage = 'en' | 'ru';
export type Theme = 'system' | 'light' | 'dark';
export type SessionLength = 5 | 10 | 15 | 20 | 30 | 'open';
export type InputPreset = 'easy' | 'normal' | 'serious' | 'custom';
export type SessionMixPreset = 'balanced' | 'more-new' | 'more-review' | 'custom';

export interface InputShares {
  tiles: number;
  letters: number;
  typing: number;
}

/** Percent of a session given to each block; integers summing to 100. */
export interface SessionMixShares {
  new: number;
  review: number;
  phrases: number;
}

export interface SessionMix {
  preset: SessionMixPreset;
  shares: SessionMixShares;
}

export interface Settings {
  uiLanguage: UiLanguage;
  theme: Theme;
  activeProgramId: string;
  sessionLength: SessionLength;
  inputPreset: InputPreset;
  inputShares: InputShares;
  /** How a session is split between new material, review and everyday phrases. */
  sessionMix: SessionMix;
  /** Show "first letter + length" under the prompt in typing mode. */
  typingHint: boolean;
  /** Stored locally only. Never included in backup export; masked in the UI. */
  geminiApiKey: string;
  generateOnlyOnWifi: boolean;
  lastBackupAt: number | null;
}

export const INPUT_PRESETS: Record<Exclude<InputPreset, 'custom'>, InputShares> = {
  easy: { tiles: 80, letters: 20, typing: 0 },
  normal: { tiles: 60, letters: 30, typing: 10 },
  serious: { tiles: 40, letters: 30, typing: 30 },
};

export const SESSION_MIX_PRESETS: Record<Exclude<SessionMixPreset, 'custom'>, SessionMixShares> = {
  // `balanced` is planned with the fixed BLOCK_COMPOSITION table (src/engine/plan.ts);
  // these shares only describe it and seed the custom sliders.
  balanced: { new: 50, review: 33, phrases: 17 },
  'more-new': { new: 70, review: 20, phrases: 10 },
  'more-review': { new: 30, review: 55, phrases: 15 },
};

export const DEFAULT_SESSION_MIX: SessionMix = {
  preset: 'balanced',
  shares: SESSION_MIX_PRESETS.balanced,
};

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'en',
  theme: 'system',
  // The first bundled course. Kept as a literal so this module (which the engine
  // imports) stays independent of the content bundle; if the id ever points at a
  // course that isn't installed, programRegistry falls back to the first bundled one.
  activeProgramId: 'pt-PT-A1',
  sessionLength: 10,
  inputPreset: 'normal',
  inputShares: INPUT_PRESETS.normal,
  sessionMix: DEFAULT_SESSION_MIX,
  typingHint: true,
  geminiApiKey: '',
  generateOnlyOnWifi: true,
  lastBackupAt: null,
};

export const SESSION_LENGTH_OPTIONS: SessionLength[] = [5, 10, 15, 20, 30, 'open'];

/**
 * Normalizes non-negative integer shares so they sum to exactly 100, preserving
 * proportions. All zero → the first key gets 100.
 */
export function normalizeShares<K extends string>(
  shares: Record<K, number>,
  keys: readonly K[]
): Record<K, number> {
  const clamped = {} as Record<K, number>;
  for (const key of keys) {
    const value = shares[key];
    clamped[key] = Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  const total = keys.reduce((sum, key) => sum + clamped[key], 0);
  if (total === 0) {
    const first = {} as Record<K, number>;
    keys.forEach((key, i) => (first[key] = i === 0 ? 100 : 0));
    return first;
  }
  if (total === 100 && keys.every((key) => Number.isInteger(clamped[key]))) return clamped;

  const scaled = {} as Record<K, number>;
  for (const key of keys) scaled[key] = Math.round((clamped[key] / total) * 100);
  // Rounding can leave the sum off by a point or two; fix it up on the largest share.
  const diff = 100 - keys.reduce((sum, key) => sum + scaled[key], 0);
  if (diff !== 0) {
    const largestKey = keys.reduce((a, b) => (scaled[a] >= scaled[b] ? a : b));
    scaled[largestKey] += diff;
  }
  return scaled;
}

const INPUT_SHARE_KEYS = ['tiles', 'letters', 'typing'] as const;
export const SESSION_MIX_KEYS = ['new', 'review', 'phrases'] as const;

/** Normalizes three shares so they sum to exactly 100, preserving proportions. */
export function normalizeInputShares(shares: InputShares): InputShares {
  return normalizeShares(shares, INPUT_SHARE_KEYS);
}

export function normalizeMixShares(shares: SessionMixShares): SessionMixShares {
  return normalizeShares(shares, SESSION_MIX_KEYS);
}

const SESSION_MIX_PRESET_IDS: readonly SessionMixPreset[] = [
  'balanced',
  'more-new',
  'more-review',
  'custom',
];

/**
 * A usable `sessionMix` from whatever was stored (settings saved before Stage 5 have
 * none; a hand-edited backup may carry garbage). A named preset always uses its own
 * shares; `custom` keeps the stored shares, normalized to 100.
 */
export function sanitizeSessionMix(value: unknown): SessionMix {
  if (typeof value !== 'object' || value === null) return DEFAULT_SESSION_MIX;
  const { preset, shares } = value as { preset?: unknown; shares?: unknown };
  if (!SESSION_MIX_PRESET_IDS.includes(preset as SessionMixPreset)) return DEFAULT_SESSION_MIX;
  if (preset !== 'custom') {
    const named = preset as Exclude<SessionMixPreset, 'custom'>;
    return { preset: named, shares: SESSION_MIX_PRESETS[named] };
  }
  if (typeof shares !== 'object' || shares === null) {
    return { preset: 'custom', shares: SESSION_MIX_PRESETS.balanced };
  }
  const raw = shares as Record<string, unknown>;
  const numeric = (key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : 0);
  return {
    preset: 'custom',
    shares: normalizeMixShares({
      new: numeric('new'),
      review: numeric('review'),
      phrases: numeric('phrases'),
    }),
  };
}

export function isInputSharesValid(shares: InputShares): boolean {
  return shares.tiles + shares.letters + shares.typing === 100;
}
