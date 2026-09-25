import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { DEFAULT_SETTINGS } from '../settings';
import { loadSettings, updateSettings } from '../settingsStore';

beforeEach(async () => {
  await db.settings.clear();
});

describe('loadSettings / updateSettings', () => {
  it('returns the defaults before anything has been saved', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial update into the existing settings', async () => {
    await updateSettings({ uiLanguage: 'ru' });
    await updateSettings({ theme: 'dark' });
    const settings = await loadSettings();
    expect(settings.uiLanguage).toBe('ru');
    expect(settings.theme).toBe('dark');
    // Untouched fields keep their defaults.
    expect(settings.sessionLength).toBe(DEFAULT_SETTINGS.sessionLength);
  });

  it('does not lose an update when two calls race (read-modify-write is transactional)', async () => {
    await updateSettings({ uiLanguage: 'en', theme: 'system' });

    await Promise.all([updateSettings({ uiLanguage: 'ru' }), updateSettings({ theme: 'dark' })]);

    const settings = await loadSettings();
    expect(settings.uiLanguage).toBe('ru');
    expect(settings.theme).toBe('dark');
  });

  it('fills in sessionMix for settings stored before it existed', async () => {
    const { sessionMix: _omit, ...legacy } = { ...DEFAULT_SETTINGS, uiLanguage: 'ru' as const };
    await db.settings.put({ key: 'settings', value: legacy });
    const settings = await loadSettings();
    expect(settings.uiLanguage).toBe('ru');
    expect(settings.sessionMix).toEqual(DEFAULT_SETTINGS.sessionMix);
  });

  it('keeps a custom sessionMix', async () => {
    const sessionMix = { preset: 'custom' as const, shares: { new: 10, review: 80, phrases: 10 } };
    await updateSettings({ sessionMix });
    expect((await loadSettings()).sessionMix).toEqual(sessionMix);
  });
});
