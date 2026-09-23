export type UiLanguage = 'en' | 'ru';
export type Theme = 'system' | 'light' | 'dark';
export type SessionLength = 5 | 10 | 15 | 20 | 30 | 'open';
export type InputPreset = 'easy' | 'normal' | 'serious' | 'custom';

export interface InputShares {
  tiles: number;
  letters: number;
  typing: number;
}

export interface Settings {
  uiLanguage: UiLanguage;
  theme: Theme;
  activeProgramId: string;
  sessionLength: SessionLength;
  inputPreset: InputPreset;
  inputShares: InputShares;
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
  typingHint: true,
  geminiApiKey: '',
  generateOnlyOnWifi: true,
  lastBackupAt: null,
};

export const SESSION_LENGTH_OPTIONS: SessionLength[] = [5, 10, 15, 20, 30, 'open'];

/** Normalizes three shares so they sum to exactly 100, preserving proportions. */
export function normalizeInputShares(shares: InputShares): InputShares {
  const { tiles, letters, typing } = shares;
  const clamped = {
    tiles: Math.max(0, tiles),
    letters: Math.max(0, letters),
    typing: Math.max(0, typing),
  };
  const total = clamped.tiles + clamped.letters + clamped.typing;
  if (total === 0) return { tiles: 100, letters: 0, typing: 0 };
  if (total === 100) return clamped;

  const scaled = {
    tiles: Math.round((clamped.tiles / total) * 100),
    letters: Math.round((clamped.letters / total) * 100),
    typing: Math.round((clamped.typing / total) * 100),
  };
  // Rounding can leave the sum off by a point or two; fix it up on the largest share.
  const diff = 100 - (scaled.tiles + scaled.letters + scaled.typing);
  if (diff !== 0) {
    const largestKey = (['tiles', 'letters', 'typing'] as const).reduce((a, b) =>
      scaled[a] >= scaled[b] ? a : b
    );
    scaled[largestKey] += diff;
  }
  return scaled;
}

export function isInputSharesValid(shares: InputShares): boolean {
  return shares.tiles + shares.letters + shares.typing === 100;
}
