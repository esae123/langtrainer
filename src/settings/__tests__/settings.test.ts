import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_MIX,
  DEFAULT_SETTINGS,
  INPUT_PRESETS,
  SESSION_MIX_PRESETS,
  isInputSharesValid,
  normalizeInputShares,
  normalizeMixShares,
  sanitizeSessionMix,
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

describe('session mix', () => {
  it('defaults to balanced 50/33/17 and the presets match the spec', () => {
    expect(DEFAULT_SETTINGS.sessionMix).toEqual({
      preset: 'balanced',
      shares: { new: 50, review: 33, phrases: 17 },
    });
    expect(SESSION_MIX_PRESETS['more-new']).toEqual({ new: 70, review: 20, phrases: 10 });
    expect(SESSION_MIX_PRESETS['more-review']).toEqual({ new: 30, review: 55, phrases: 15 });
  });

  it('normalizeMixShares keeps the sum at 100', () => {
    expect(normalizeMixShares({ new: 100, review: 33, phrases: 17 })).toEqual({
      new: 67,
      review: 22,
      phrases: 11,
    });
    expect(normalizeMixShares({ new: 0, review: 0, phrases: 0 })).toEqual({
      new: 100,
      review: 0,
      phrases: 0,
    });
  });

  it('sanitizeSessionMix fills in or repairs a stored value', () => {
    expect(sanitizeSessionMix(undefined)).toEqual(DEFAULT_SESSION_MIX);
    expect(sanitizeSessionMix('nonsense')).toEqual(DEFAULT_SESSION_MIX);
    expect(sanitizeSessionMix({ preset: 'huge' })).toEqual(DEFAULT_SESSION_MIX);
    expect(sanitizeSessionMix({ preset: 'more-new', shares: { new: 1 } })).toEqual({
      preset: 'more-new',
      shares: SESSION_MIX_PRESETS['more-new'],
    });
    expect(
      sanitizeSessionMix({ preset: 'custom', shares: { new: 60, review: 60, phrases: 'x' } })
    ).toEqual({ preset: 'custom', shares: { new: 50, review: 50, phrases: 0 } });
    const custom = { preset: 'custom', shares: { new: 20, review: 70, phrases: 10 } };
    expect(sanitizeSessionMix(custom)).toEqual(custom);
  });
});
