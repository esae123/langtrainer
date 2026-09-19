import { NavLink } from 'react-router';
// Individual named imports (the package has no per-icon type declarations, so a deep
// import would be untyped); Rollup tree-shakes the rest of the set out of the bundle.
import { BookOpen, ChartLine, Settings, type LucideIcon } from 'lucide-react';
import { useT, type TranslationKey } from '../i18n';

interface TabDefinition {
  to: string;
  labelKey: TranslationKey;
  Icon: LucideIcon;
  end?: boolean;
}

const TABS: TabDefinition[] = [
  { to: '/', labelKey: 'nav.learn', Icon: BookOpen, end: true },
  { to: '/progress', labelKey: 'nav.progress', Icon: ChartLine },
  { to: '/settings', labelKey: 'nav.settings', Icon: Settings },
];

export function BottomTabBar() {
  const t = useT();
  return (
    <nav className="safe-bottom sticky bottom-0 z-30 border-t border-line bg-sheet/95 backdrop-blur">
      <ul className="mx-auto flex w-full max-w-[480px]">
        {TABS.map(({ to, labelKey, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive ? 'text-accent' : 'text-muted'
                }`
              }
            >
              <Icon size={22} strokeWidth={2} aria-hidden />
              <span>{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
