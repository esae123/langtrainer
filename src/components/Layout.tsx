import type { ReactNode } from 'react';
import { BottomTabBar } from './BottomTabBar';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-50 dark:bg-slate-950">
      <main className="safe-top flex-1 px-4 pb-8 pt-6">{children}</main>
      <BottomTabBar />
    </div>
  );
}
