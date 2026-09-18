import { createContext, useContext } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const SETTINGS_ROW_KEY = 'settings';

function mergeWithDefaults(value: unknown): Settings {
  return { ...DEFAULT_SETTINGS, ...(value as Partial<Settings>) };
}

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get(SETTINGS_ROW_KEY);
  return row ? mergeWithDefaults(row.value) : DEFAULT_SETTINGS;
}

/** Read-modify-write inside one transaction so concurrent updates can't clobber each other. */
export async function updateSettings(partial: Partial<Settings>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(SETTINGS_ROW_KEY);
    const current = row ? mergeWithDefaults(row.value) : DEFAULT_SETTINGS;
    await db.settings.put({ key: SETTINGS_ROW_KEY, value: { ...current, ...partial } });
  });
}

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS);

export function useSettings(): Settings {
  return useContext(SettingsContext);
}

/**
 * Single Dexie liveQuery subscription, consumed by SettingsProvider. Returns
 * undefined until the first read completes, so callers can avoid flashing
 * default values (light theme, English, backup banner) on a cold start.
 */
export function useLiveSettings(): Settings | undefined {
  return useLiveQuery(loadSettings, []);
}
