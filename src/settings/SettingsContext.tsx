import type { ReactNode } from 'react';
import { SettingsContext as Context, useLiveSettings } from './settingsStore';

/** Wraps the app; keeps a single Dexie liveQuery subscription for settings. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useLiveSettings();
  return <Context.Provider value={settings}>{children}</Context.Provider>;
}
