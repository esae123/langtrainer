import type { ReactNode } from 'react';
import { Card } from './Card';

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <Card className="divide-y divide-slate-100 !p-0 dark:divide-slate-800">{children}</Card>
    </section>
  );
}
