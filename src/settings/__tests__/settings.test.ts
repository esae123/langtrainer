import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  INPUT_PRESETS,
  isInputSharesValid,
  normalizeInputShares,
} from '../settings';

describe('input share presets', () => {
  it('easy, normal and serious presets sum to 100', () => {
    for (const preset of Object.values(INPUT_PRESETS)) {
      expect(isInputSharesValid(preset)).toBe(true);
    }
  });

  it('matches the exact percentages from the spec', () => {
    expect(INPUT_PRESETS.easy).toEqual({ tiles: 80, letters: 20, typing: 0 });
    expect(INPUT_PRESETS.normal).toEqual({ tiles: 60, letters: 30, typing: 10 });
    expect(INPUT_PRESETS.serious).toEqual({ tiles: 40, letters: 30, typing: 30 });
  });

  it('the default settings use the normal preset', () => {
    expect(DEFAULT_SETTINGS.inputPreset).toBe('normal');
    expect(DEFAULT_SETTINGS.inputShares).toEqual(INPUT_PRESETS.normal);
  });

  it('the typing hint is on by default', () => {
    expect(DEFAULT_SETTINGS.typingHint).toBe(true);
  });
});

describe('normalizeInputShares', () => {
  it('leaves an already-valid split untouched', () => {
    const shares = { tiles: 60, letters: 30, typing: 10 };
    expect(normalizeInputShares(shares)).toEqual(shares);
  });

  it('scales an arbitrary split so it sums to exactly 100', () => {
    const result = normalizeInputShares({ tiles: 1, letters: 1, typing: 1 });
    expect(result.tiles + result.letters + result.typing).toBe(100);
  });

  it('scales a split that sums to more than 100', () => {
    const result = normalizeInputShares({ tiles: 80, letters: 80, typing: 40 });
    expect(result.tiles + result.letters + result.typing).toBe(100);
  });

  it('handles all-zero input by falling back to 100% tiles', () => {
    expect(normalizeInputShares({ tiles: 0, letters: 0, typing: 0 })).toEqual({
      tiles: 100,
      letters: 0,
      typing: 0,
    });
  });

  it('clamps negative shares to zero before normalizing', () => {
    const result = normalizeInputShares({ tiles: -10, letters: 60, typing: 40 });
    expect(result.tiles).toBeGreaterThanOrEqual(0);
    expect(result.tiles + result.letters + result.typing).toBe(100);
  });
});
