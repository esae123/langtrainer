import { useEffect } from 'react';
import { useSettings } from '../settings/settingsStore';

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
    if (theme !== 'system') return;

    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
