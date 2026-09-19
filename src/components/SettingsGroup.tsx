import type { ReactNode } from 'react';
import { Card } from './Card';

export function SettingsGroup({
  title,
  icon,
  children,
}: {
  title: string;
  /** Small outline icon shown before the group title. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </h2>
      <Card className="divide-y divide-line !p-0">{children}</Card>
    </section>
  );
}
