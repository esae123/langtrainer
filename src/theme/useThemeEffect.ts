import { useEffect } from 'react';
import { useSettings } from '../settings/settingsStore';

// Must match the key read by the inline anti-flash script in index.html.
export const THEME_STORAGE_KEY = 'langtrainer:theme';

/** Applies the `dark` class to <html> from settings.theme, tracking the system preference live. */
export function useThemeEffect(): void {
  const { theme } = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
    };

    apply();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // storage disabled (e.g. private mode) — the app still works, just without the anti-flash cache
    }

    if (theme !== 'system') return;

    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
