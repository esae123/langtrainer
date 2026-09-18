import type { ReactNode } from 'react';
import { BottomTabBar } from './BottomTabBar';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-50 dark:bg-slate-950">
      {/* pt-6 plus the top safe-area inset, combined so neither is dead code. */}
      <main className="flex-1 px-4 pb-8 pt-[calc(var(--spacing)*6+env(safe-area-inset-top))]">
        {children}
      </main>
      <BottomTabBar />
    </div>
  );
}
