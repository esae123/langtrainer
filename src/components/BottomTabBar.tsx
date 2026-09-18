import { NavLink } from 'react-router';
import { useT, type TranslationKey } from '../i18n';

const TABS: { to: string; labelKey: TranslationKey; icon: string; end?: boolean }[] = [
  { to: '/', labelKey: 'nav.learn', icon: '📘', end: true },
  { to: '/progress', labelKey: 'nav.progress', icon: '📈' },
  { to: '/settings', labelKey: 'nav.settings', icon: '⚙️' },
];

export function BottomTabBar() {
  const t = useT();
  return (
    <nav className="safe-bottom sticky bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <ul className="mx-auto flex w-full max-w-[480px]">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  isActive
                    ? 'text-accent-600 dark:text-accent-300'
                    : 'text-slate-500 dark:text-slate-400'
                }`
              }
            >
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              <span>{t(tab.labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
