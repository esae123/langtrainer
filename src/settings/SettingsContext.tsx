import type { ReactNode } from 'react';
import { SettingsContext as Context, useLiveSettings } from './settingsStore';

/**
 * Wraps the app; keeps a single Dexie liveQuery subscription for settings.
 * Renders a minimal, unstyled-assumption-free shell until the first read
 * completes, instead of flashing DEFAULT_SETTINGS (light theme, English,
 * backup banner) for a frame on a cold start.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useLiveSettings();
  if (!settings) return <div className="min-h-screen bg-slate-50 dark:bg-slate-950" />;
  return <Context.Provider value={settings}>{children}</Context.Provider>;
}
