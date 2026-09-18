import { createContext, useContext } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const SETTINGS_ROW_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get(SETTINGS_ROW_KEY);
  if (!row) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<Settings>) };
}

export async function updateSettings(partial: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await db.settings.put({ key: SETTINGS_ROW_KEY, value: { ...current, ...partial } });
}

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS);

export function useSettings(): Settings {
  return useContext(SettingsContext);
}

/** Single Dexie liveQuery subscription, consumed by SettingsProvider. */
export function useLiveSettings(): Settings {
  return useLiveQuery(loadSettings, [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
}
